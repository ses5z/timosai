// Paper futures: global SWAP fiyatıyla simülasyon. Isolated margin, likidasyon fiyatı, funding etkisi (8 saatte bir),
// kaldıraç tavanı config. OKX TR'de kaldıraç yoktur; bu pozisyonlar hiçbir zaman gerçek emre dönüşmez.
import crypto from "node:crypto";
import type { AppContext } from "../context.js";
import { roundPrice, round } from "../util/math.js";

export interface FuturesPosition {
  id: string;
  instId: string;
  side: "long" | "short";
  leverage: number;
  marginUsdt: number;
  notionalUsdt: number;
  entryPx: number;
  liqPx: number;
  stopPx: number | null;
  targetPx: number | null;
  openedAt: number;
  fundingPaid: number; // pozitif = ödenen
  lastFundingAt: number;
  origin: "hızlı" | "ajan";
  lastPx: number;
  closed?: { px: number; pnl: number; reason: string; at: number };
}

export function liquidationPrice(side: "long" | "short", entry: number, lev: number, mmr = 0.005): number {
  return side === "long" ? entry * (1 - 1 / lev + mmr) : entry * (1 + 1 / lev - mmr);
}

export function futuresPnl(p: Pick<FuturesPosition, "side" | "notionalUsdt" | "entryPx">, px: number): number {
  const dir = p.side === "long" ? 1 : -1;
  return p.notionalUsdt * dir * ((px - p.entryPx) / p.entryPx);
}

export class PaperFutures {
  positions: FuturesPosition[] = [];
  constructor(private readonly ctx: AppContext) {}

  private swapId(instId: string) {
    return `${instId.split("-")[0]}-USDT-SWAP`;
  }

  /** Global SWAP fiyatı (ATK market_get_ticker); yoksa spot fiyatı. */
  async swapPrice(instId: string): Promise<{ px: number; src: string }> {
    try {
      const t: any = await this.ctx.atk?.call("market_get_ticker", { instId: this.swapId(instId) });
      const v = Number(t?.[0]?.last);
      if (v > 0) return { px: v, src: "SWAP fiyatı (ATK)" };
    } catch {
      /* spot fiyatına düş */
    }
    return { px: this.ctx.agent.prices.get(instId)?.last ?? 0, src: "spot fiyatı" };
  }

  async open(o: { instId: string; side: "long" | "short"; leverage: number; marginUsdt: number; origin: "hızlı" | "ajan"; stopPct?: number; targetPct?: number }): Promise<{ ok: boolean; text: string; pos?: FuturesPosition }> {
    const cfg = this.ctx.paper;
    const lev = Math.max(1, Math.min(cfg.maxLeverage, o.leverage));
    const { px, src } = await this.swapPrice(o.instId);
    if (!px) return { ok: false, text: `${o.instId} için fiyat yok.` };
    const dir = o.side === "long" ? 1 : -1;
    const pos: FuturesPosition = {
      id: crypto.randomUUID().slice(0, 8),
      instId: o.instId,
      side: o.side,
      leverage: lev,
      marginUsdt: o.marginUsdt,
      notionalUsdt: o.marginUsdt * lev,
      entryPx: px,
      liqPx: roundPrice(liquidationPrice(o.side, px, lev, cfg.maintenanceMarginRate)),
      stopPx: o.stopPct ? roundPrice(px * (1 - dir * o.stopPct / 100)) : null,
      targetPx: o.targetPct ? roundPrice(px * (1 + dir * o.targetPct / 100)) : null,
      openedAt: Date.now(),
      fundingPaid: 0,
      lastFundingAt: Date.now(),
      origin: o.origin,
      lastPx: px,
    };
    this.positions.push(pos);
    const capNote = lev < o.leverage ? ` Kaldıraç tavanı ${cfg.maxLeverage}x uygulandı.` : "";
    const text = `SİMÜLASYON (paper futures): ${o.instId.split("-")[0]} ${o.side} ${lev}x, isolated teminat ${o.marginUsdt} USDT, giriş ${roundPrice(px)} (${src}), likidasyon ≈ ${pos.liqPx}.${capNote} OKX TR'de kaldıraç yoktur; gerçek emre dönüşmez.`;
    this.ctx.ledger.append("order", { durum: "SİMÜLASYON", tur: "futures", instId: o.instId, yon: o.side, kaldirac: lev, teminat: o.marginUsdt, giris: px, likidasyon: pos.liqPx, origin: o.origin });
    this.ctx.store.addEvent("emir", text, o.instId);
    return { ok: true, text, pos };
  }

  close(p: FuturesPosition, px: number, reason: string, liquidated = false): number {
    // Isolated margin: likidasyonda teminatın tamamı kaybedilir; aksi halde PnL − funding − komisyon (en fazla teminat kadar).
    const pnl = liquidated ? -p.marginUsdt : Math.max(-p.marginUsdt, futuresPnl(p, px) - p.fundingPaid - p.notionalUsdt * this.ctx.paper.feeRate * 2);
    p.closed = { px, pnl: round(pnl, 4), reason, at: Date.now() };
    this.ctx.store.addEvent("emir", `SİMÜLASYON kapandı: ${p.instId.split("-")[0]} ${p.side} ${p.leverage}x · ${reason} · PnL ${pnl >= 0 ? "+" : ""}${pnl.toFixed(3)} USDT`, p.instId);
    this.ctx.ledger.append("order", { durum: "SİMÜLASYON", tur: "futures_kapanis", instId: p.instId, yon: p.side, px, pnl: round(pnl, 4), sebep: reason });
    return pnl;
  }

  closeBySymbol(instId: string): FuturesPosition | null {
    const p = this.positions.find((x) => x.instId === instId && !x.closed);
    if (!p) return null;
    this.close(p, this.ctx.agent.prices.get(instId)?.last ?? p.lastPx, "kullanıcı komutu");
    return p;
  }

  /** Fiyat güncellemesi: likidasyon, stop/hedef ve funding (her fundingIntervalHours saatte bir). */
  tick(now = Date.now(), fundingOf: (instId: string) => number | null = (id) => this.ctx.agent.derivSnap.get(id)?.v.funding ?? null): void {
    const interval = this.ctx.paper.fundingIntervalHours * 3_600_000;
    for (const p of this.positions) {
      if (p.closed) continue;
      const px = this.ctx.agent.prices.get(p.instId)?.last ?? p.lastPx;
      p.lastPx = px;
      while (now - p.lastFundingAt >= interval) {
        const f = fundingOf(p.instId) ?? 0;
        // pozitif funding: long öder, short alır
        p.fundingPaid += p.notionalUsdt * f * (p.side === "long" ? 1 : -1);
        p.lastFundingAt += interval;
      }
      const liq = p.side === "long" ? px <= p.liqPx : px >= p.liqPx;
      if (liq) {
        this.close(p, p.liqPx, "likidasyon (isolated teminat kaybedildi)", true);
        continue;
      }
      if (p.stopPx !== null && (p.side === "long" ? px <= p.stopPx : px >= p.stopPx)) this.close(p, px, "stop");
      else if (p.targetPx !== null && (p.side === "long" ? px >= p.targetPx : px <= p.targetPx)) this.close(p, px, "hedef");
    }
  }

  view() {
    return this.positions.slice(-30).reverse().map((p) => {
      const open = !p.closed;
      const pnl = open ? futuresPnl(p, p.lastPx) - p.fundingPaid : p.closed!.pnl;
      return { ...p, open, pnlUsdt: round(pnl, 4) };
    });
  }

  stats() {
    const closed = this.positions.filter((p) => p.closed);
    return { trades: closed.length, open: this.positions.filter((p) => !p.closed).length, realized: round(closed.reduce((s, p) => s + p.closed!.pnl, 0), 4), wins: closed.filter((p) => p.closed!.pnl > 0).length };
  }
}
