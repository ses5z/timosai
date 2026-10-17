// Hızlı komutlar (komut = onay): /al SOL 5, /sat SOL, /kapat SOL; kaldıraçlı /l SOL 5x 20, /s ETH 3x 10 yalnızca SİMÜLASYON.
// QUICK_COMMANDS=false iken tamamen kapalıdır (kullanıcı emir yolu yoktur). Sert limit kapısı ve zorunlu stop atlanmaz.
import crypto from "node:crypto";
import type { AppContext } from "../context.js";
import { HardLimitError } from "./tradingClient.js";
import { roundPrice, round } from "../util/math.js";

export const QUICK_RE = /^\/?(al|sat|kapat|l|s)\s+([A-Za-z0-9]{2,12})(?:-USDT)?(?:\s+(\d+(?:[.,]\d+)?)x)?(?:\s+(\d+(?:[.,]\d+)?))?\s*$/i;

export interface SimPosition {
  id: string;
  instId: string;
  side: "long" | "short";
  leverage: number;
  marginUsdt: number;
  entryPx: number;
  liqPx: number;
  openedAt: number;
}

export interface QuickResult {
  ok: boolean;
  text: string;
}

const MMR = 0.005; // bakım teminatı oranı (simülasyon varsayımı)

export function liquidationPrice(side: "long" | "short", entry: number, lev: number): number {
  return side === "long" ? entry * (1 - 1 / lev + MMR) : entry * (1 + 1 / lev - MMR);
}

export class QuickTrader {
  constructor(private readonly ctx: AppContext) {}

  enabled(): boolean {
    return this.ctx.env.quickCommands;
  }

  async run(text: string, via: string): Promise<QuickResult> {
    if (!this.enabled()) return { ok: false, text: "Hızlı komutlar kapalı (QUICK_COMMANDS=false). Emirleri yalnızca ajan verir." };
    const m = text.trim().match(QUICK_RE);
    if (!m) return { ok: false, text: "Kullanım: /al SOL 5 · /sat SOL · /kapat SOL · /l SOL 5x 20 · /s ETH 3x 10" };
    const cmd = m[1].toLowerCase();
    const instId = `${m[2].toUpperCase()}-USDT`;
    const lev = m[3] ? Number(m[3].replace(",", ".")) : null;
    const amount = m[4] ? Number(m[4].replace(",", ".")) : null;
    if (cmd === "l" || cmd === "s") return this.sim(cmd === "l" ? "long" : "short", instId, lev ?? 2, amount ?? 10, via);
    if (cmd === "al") return this.buy(instId, amount, via);
    return this.close(instId, via);
  }

  private stopFor(price: number, atr: number): number {
    const q = this.ctx.store.settings.quick;
    const dist = q.stopMode === "atr" && atr > 0 ? atr * q.stopValue : (price * q.stopValue) / 100;
    return roundPrice(price - Math.max(dist, price * 0.003));
  }

  async buy(instId: string, amount: number | null, via: string): Promise<QuickResult> {
    const { ctx } = this;
    const c = ctx.agent.candidates.get(instId);
    const price = ctx.agent.prices.get(instId)?.last ?? c?.price;
    if (!price) return { ok: false, text: `${instId} için güncel fiyat yok (izleme listesinde olmayabilir).` };
    const L = ctx.limits;
    let usdt = amount ?? ctx.store.settings.quick.amountUsdt;
    const notes: string[] = [];
    if (usdt > L.maxOrderNotionalUsdt) {
      notes.push(`Tutar ${usdt} USDT, sert limit nedeniyle ${L.maxOrderNotionalUsdt} USDT'ye kırpıldı.`);
      usdt = L.maxOrderNotionalUsdt;
    }
    const room = L.maxTotalOpenUsdt - ctx.agent.trading.openNotional();
    if (usdt > room && room >= 1) {
      notes.push(`Toplam açık limit nedeniyle ${round(room, 2)} USDT'ye kırpıldı.`);
      usdt = Math.floor(room * 100) / 100;
    }
    const stop = this.stopFor(price, c?.atr ?? 0);
    const target = roundPrice(price + (price - stop) * 2.2);
    try {
      const pos = await ctx.agent.trading.openPosition({ instId, notionalUsdt: usdt, entryPx: price, stopPx: stop, targetPx: target, atr: c?.atr ?? 0, reason: `Hızlı komut (${via})`, origin: "hızlı" });
      const msg = `HIZLI ${pos.mode}: ${instId.split("-")[0]} alındı. Giriş ${roundPrice(pos.entryPx)}, stop ${pos.stopPx}, hedef ${pos.targetPx}, tutar ${pos.costUsdt.toFixed(2)} USDT.${notes.length ? " " + notes.join(" ") : ""}`;
      ctx.store.addEvent("emir", msg, instId);
      ctx.store.bus.publish("positions", ctx.agent.positionsView());
      return { ok: true, text: msg };
    } catch (e) {
      const why = e instanceof HardLimitError ? e.violations.join(" ") : (e as Error).message;
      ctx.store.addEvent("bilgi", `HIZLI komut reddedildi (${instId}): ${why}`, instId);
      return { ok: false, text: `Emir verilmedi: ${why}` };
    }
  }

  async close(instId: string, via: string): Promise<QuickResult> {
    const { ctx } = this;
    const p = ctx.agent.trading.listPositions().find((x) => x.instId === instId);
    if (!p) {
      const fp = this.ctx.extras.futures?.closeBySymbol?.(instId);
      if (fp) return { ok: true, text: `HIZLI: ${instId.split("-")[0]} paper futures pozisyonu (SİMÜLASYON) kapatıldı.` };
      return { ok: false, text: `${instId.split("-")[0]} için açık pozisyon yok. (Spotta açığa satış yapılmaz.)` };
    }
    const r = await ctx.agent.trading.reducePosition(p.id, 1, p.lastPx, `Hızlı komut: kapat (${via})`, "hızlı");
    const msg = `HIZLI: ${instId.split("-")[0]} pozisyonu kapatıldı @ ${roundPrice(p.lastPx)}. Sonuç ${r ? (r.pnl >= 0 ? "+" : "") + r.pnl.toFixed(3) : "?"} USDT.`;
    ctx.store.addEvent("emir", msg, instId);
    ctx.store.bus.publish("positions", ctx.agent.positionsView());
    return { ok: true, text: msg };
  }

  /** Kaldıraçlı komutlar yalnızca SİMÜLASYON (paper futures): global SWAP fiyatı, isolated margin, likidasyon, funding. */
  async sim(side: "long" | "short", instId: string, lev: number, margin: number, _via: string): Promise<QuickResult> {
    const f = this.ctx.extras.futures as import("./paperFutures.js").PaperFutures | undefined;
    if (!f) return { ok: false, text: "Paper futures modülü yüklü değil." };
    const r = await f.open({ instId, side, leverage: lev, marginUsdt: margin, origin: "hızlı" });
    return { ok: r.ok, text: r.text };
  }

  simView() {
    return (this.ctx.extras.futures?.view?.() ?? []) as any[];
  }
}
