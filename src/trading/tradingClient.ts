// TradingClient: SERT LİMİT KAPISI burada. Kuru (Mock) ve gerçek (Atk) uygulamalar aynı kapıdan geçer.
// Kullanıcı emir yolu yoktur; bu sınıfı yalnızca ajan (ve deterministik senaryo) çağırır.
import crypto from "node:crypto";
import type { AtkCaller } from "../atk/mcpClient.js";
import type { SignalLedger } from "../ledger/signalLedger.js";
import { round, roundPrice } from "../util/math.js";
import { assertToolAllowed, type HardLimits } from "./hardLimits.js";

export type ExecMode = "KURU" | "GERÇEK";

export interface EntryRequest {
  instId: string;
  notionalUsdt: number;
  entryPx: number;
  stopPx: number;
  targetPx: number;
  atr: number;
  reason: string;
  origin: "ajan" | "senaryo" | "hızlı";
  /** Spot dışı bir şey istenirse kapı reddeder (testler için açık alan). */
  instType?: string;
}

export interface Position {
  id: string;
  instId: string;
  qty: number;
  entryPx: number;
  stopPx: number;
  initialStop: number;
  targetPx: number;
  costUsdt: number;
  openedAt: number;
  partialDone: boolean;
  trailing: boolean;
  mode: ExecMode;
  reason: string;
  realizedPnl: number;
  lastPx: number;
  atr: number;
  origin: string;
  ordId?: string;
}

export interface Trade {
  id: string;
  instId: string;
  side: "buy" | "sell";
  qty: number;
  px: number;
  notionalUsdt: number;
  ts: number;
  mode: ExecMode;
  reason: string;
  pnl?: number;
  origin: string;
}

export class HardLimitError extends Error {
  constructor(readonly violations: string[]) {
    super(`Sert limit: ${violations.join("; ")}`);
    this.name = "HardLimitError";
  }
}

export const FEE_RATE = 0.001;

export abstract class TradingClient {
  abstract readonly mode: ExecMode;
  protected positions = new Map<string, Position>();
  protected trades: Trade[] = [];
  protected entryTimes: number[] = [];
  protected realizedByDay = new Map<string, number>();
  readonly startEquity: number;

  constructor(
    readonly limits: HardLimits,
    protected readonly ledger: SignalLedger,
    startEquity: number,
  ) {
    this.startEquity = startEquity;
  }

  // ---------------- KAPI ----------------
  /** Sert limit ihlallerini döndürür; boş dizi = geçer. Saf fonksiyon gibi davranır. */
  checkEntry(req: EntryRequest, now = Date.now()): string[] {
    const v: string[] = [];
    const L = this.limits;
    if ((req.instType ?? "SPOT") !== "SPOT" || !req.instId.endsWith("-USDT")) v.push("Yalnızca spot USDT çiftleri işlem görebilir.");
    if (!L.allowedPairs.includes(req.instId)) v.push(`${req.instId} izin listesinde değil.`);
    if (!(req.stopPx > 0) || !(req.stopPx < req.entryPx)) v.push("Her girişte geçerli bir stop zorunlu (stop < giriş).");
    if (!(req.notionalUsdt > 0)) v.push("Emir büyüklüğü sıfırdan büyük olmalı.");
    if (req.notionalUsdt > L.maxOrderNotionalUsdt + 1e-9) v.push(`Tek emir ${req.notionalUsdt.toFixed(2)} USDT > sınır ${L.maxOrderNotionalUsdt} USDT.`);
    const open = this.openNotional();
    if (open + req.notionalUsdt > L.maxTotalOpenUsdt + 1e-9) v.push(`Toplam açık ${round(open + req.notionalUsdt, 2)} USDT > sınır ${L.maxTotalOpenUsdt} USDT.`);
    if (this.positions.size >= L.maxOpenPositions) v.push(`Açık pozisyon sayısı ${this.positions.size} = sınır ${L.maxOpenPositions}.`);
    const lastHour = this.entryTimes.filter((t) => now - t < 3_600_000).length;
    if (lastHour >= L.maxOrdersPerHour) v.push(`Son 1 saatte ${lastHour} emir = sınır ${L.maxOrdersPerHour}.`);
    if ([...this.positions.values()].some((p) => p.instId === req.instId)) v.push(`${req.instId} için zaten açık pozisyon var.`);
    return v;
  }

  async openPosition(req: EntryRequest): Promise<Position> {
    const violations = this.checkEntry(req);
    const extra = await this.preflight();
    if (extra) violations.push(extra);
    if (violations.length) {
      this.ledger.append("order", { durum: "REDDEDİLDİ", instId: req.instId, notional: req.notionalUsdt, violations, origin: req.origin });
      throw new HardLimitError(violations);
    }
    this.entryTimes.push(Date.now());
    const pos = await this.executeEntry(req);
    this.positions.set(pos.id, pos);
    this.pushTrade({ instId: pos.instId, side: "buy", qty: pos.qty, px: pos.entryPx, notionalUsdt: pos.costUsdt, mode: this.mode, reason: req.reason, origin: req.origin });
    this.ledger.append("order", { durum: this.mode, yon: "AL", instId: pos.instId, qty: pos.qty, px: pos.entryPx, stop: pos.stopPx, hedef: pos.targetPx, notional: pos.costUsdt, gerekce: req.reason, origin: req.origin });
    return pos;
  }

  /** Pozisyonu kısmen/tamamen kapatır. Çıkışlar (risk azaltma) sert limitlerce engellenmez. */
  async reducePosition(id: string, fraction: number, px: number, reason: string, origin = "ajan"): Promise<{ pnl: number; closed: boolean; qty: number; px: number } | null> {
    const pos = this.positions.get(id);
    if (!pos) return null;
    const f = Math.min(1, Math.max(0, fraction));
    const res = await this.executeExit(pos, f >= 0.999 ? pos.qty : pos.qty * f, px);
    const qty = res.qty;
    const proceeds = qty * res.px * (1 - FEE_RATE);
    const costPart = pos.costUsdt * (qty / pos.qty);
    const pnl = proceeds - costPart;
    pos.costUsdt -= costPart;
    pos.qty -= qty;
    pos.realizedPnl += pnl;
    const day = new Date().toISOString().slice(0, 10);
    this.realizedByDay.set(day, (this.realizedByDay.get(day) ?? 0) + pnl);
    const closed = pos.qty <= 1e-12 || res.closedAll;
    if (closed) this.positions.delete(id);
    this.pushTrade({ instId: pos.instId, side: "sell", qty, px: res.px, notionalUsdt: qty * res.px, mode: this.mode, reason, pnl, origin });
    this.ledger.append("order", { durum: this.mode, yon: "SAT", instId: pos.instId, qty, px: res.px, pnl: round(pnl, 4), gerekce: reason, kapandi: closed, origin });
    return { pnl, closed, qty, px: res.px };
  }

  updateStop(id: string, stopPx: number, trailing = false): void {
    const pos = this.positions.get(id);
    if (!pos) return;
    if (stopPx > pos.stopPx) {
      pos.stopPx = roundPrice(stopPx);
      pos.trailing = pos.trailing || trailing;
      void this.onStopMoved(pos).catch(() => undefined);
    }
  }

  markPrices(prices: Map<string, number>): void {
    for (const p of this.positions.values()) {
      const px = prices.get(p.instId);
      if (px) p.lastPx = px;
    }
  }

  // ---------------- Durum ----------------
  listPositions(): Position[] {
    return [...this.positions.values()];
  }
  listTrades(limit = 100): Trade[] {
    return this.trades.slice(-limit).reverse();
  }
  openNotional(): number {
    return [...this.positions.values()].reduce((s, p) => s + p.costUsdt, 0);
  }
  ordersLastHour(now = Date.now()): number {
    return this.entryTimes.filter((t) => now - t < 3_600_000).length;
  }
  unrealizedPnl(): number {
    return [...this.positions.values()].reduce((s, p) => s + (p.qty * p.lastPx * (1 - FEE_RATE) - p.costUsdt), 0);
  }
  dailyRealized(): number {
    return this.realizedByDay.get(new Date().toISOString().slice(0, 10)) ?? 0;
  }
  /** Günlük K/Z = bugünkü gerçekleşen + açık pozisyonların gerçekleşmemiş K/Z'si. */
  dailyPnl(): number {
    return this.dailyRealized() + this.unrealizedPnl();
  }
  abstract cashUsdt(): number;
  equity(): number {
    return this.cashUsdt() + [...this.positions.values()].reduce((s, p) => s + p.qty * p.lastPx, 0);
  }

  protected pushTrade(t: Omit<Trade, "id" | "ts">): void {
    this.trades.push({ ...t, id: crypto.randomUUID().slice(0, 8), ts: Date.now() });
    if (this.trades.length > 500) this.trades.shift();
  }

  /** Ek kontrol (ör. canlıda asgari bakiye). İhlal metni döndürür. */
  protected async preflight(): Promise<string | null> {
    return null;
  }
  protected abstract executeEntry(req: EntryRequest): Promise<Position>;
  protected abstract executeExit(pos: Position, qty: number, refPx: number): Promise<{ qty: number; px: number; closedAll: boolean }>;
  protected async onStopMoved(_pos: Position): Promise<void> {}
}

/** MockTradingClient: KURU ÇALIŞMA. Emir ATK'ya gitmez; canlı fiyatla simüle edilir. */
export class MockTradingClient extends TradingClient {
  readonly mode = "KURU" as const;
  private cash: number;

  constructor(limits: HardLimits, ledger: SignalLedger, startEquity: number) {
    super(limits, ledger, startEquity);
    this.cash = startEquity;
  }

  cashUsdt(): number {
    return this.cash;
  }

  protected async executeEntry(req: EntryRequest): Promise<Position> {
    const px = req.entryPx;
    const qty = (req.notionalUsdt * (1 - FEE_RATE)) / px;
    this.cash -= req.notionalUsdt;
    return {
      id: crypto.randomUUID().slice(0, 8),
      instId: req.instId,
      qty,
      entryPx: px,
      stopPx: req.stopPx,
      initialStop: req.stopPx,
      targetPx: req.targetPx,
      costUsdt: req.notionalUsdt,
      openedAt: Date.now(),
      partialDone: false,
      trailing: false,
      mode: "KURU",
      reason: req.reason,
      realizedPnl: 0,
      lastPx: px,
      atr: req.atr,
      origin: req.origin,
    };
  }

  protected async executeExit(_pos: Position, qty: number, refPx: number) {
    this.cash += qty * refPx * (1 - FEE_RATE);
    return { qty, px: refPx, closedAll: false };
  }
}

/** AtkTradingClient: GERÇEK emir. Yalnızca LIVE=true ve bakiye ≥ asgari iken kullanılır. */
export class AtkTradingClient extends TradingClient {
  readonly mode = "GERÇEK" as const;
  private balance = 0;
  private balanceAt = 0;
  private lot = new Map<string, { lotSz: number; minSz: number }>();

  constructor(
    limits: HardLimits,
    ledger: SignalLedger,
    private readonly atk: AtkCaller,
    startEquity: number,
  ) {
    super(limits, ledger, startEquity);
    this.balance = startEquity;
  }

  private async tool<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
    assertToolAllowed(name); // izin dışı araç → hata
    return this.atk.call<T>(name, args);
  }

  cashUsdt(): number {
    return this.balance;
  }

  async refreshBalance(force = false): Promise<number> {
    if (!force && Date.now() - this.balanceAt < 30_000) return this.balance;
    const data: any = await this.tool("account_get_balance", { ccy: "USDT" });
    const details: any[] = data?.[0]?.details ?? [];
    const usdt = details.find((d) => d.ccy === "USDT");
    this.balance = Number(usdt?.availBal ?? usdt?.cashBal ?? 0) || 0;
    this.balanceAt = Date.now();
    return this.balance;
  }

  protected async preflight(): Promise<string | null> {
    try {
      const bal = await this.refreshBalance(true);
      if (bal < this.limits.minBalanceForLiveUsdt) return `Bakiye ${bal.toFixed(2)} USDT < gerçek emir için asgari ${this.limits.minBalanceForLiveUsdt} USDT.`;
      return null;
    } catch (e) {
      return `Bakiye okunamadı: ${(e as Error).message}`;
    }
  }

  private async lotOf(instId: string) {
    let l = this.lot.get(instId);
    if (!l) {
      const data: any = await this.tool("market_get_instruments", { instType: "SPOT", instId });
      l = { lotSz: Number(data?.[0]?.lotSz) || 1e-8, minSz: Number(data?.[0]?.minSz) || 0 };
      this.lot.set(instId, l);
    }
    return l;
  }

  protected async executeEntry(req: EntryRequest): Promise<Position> {
    const clOrdId = `tms${Date.now().toString(36)}`;
    const placed: any = await this.tool("spot_place_order", {
      instId: req.instId,
      tdMode: "cash",
      side: "buy",
      ordType: "market",
      sz: req.notionalUsdt.toFixed(2),
      tgtCcy: "quote_ccy",
      clOrdId,
      slTriggerPx: String(req.stopPx),
      slOrdPx: "-1",
      tpTriggerPx: String(req.targetPx),
      tpOrdPx: "-1",
    });
    const ordId = placed?.[0]?.ordId;
    if (!ordId || (placed?.[0]?.sCode && placed[0].sCode !== "0")) throw new Error(`Emir reddedildi: ${placed?.[0]?.sMsg ?? "bilinmiyor"}`);
    let fill: any = null;
    for (let i = 0; i < 5 && !(Number(fill?.accFillSz) > 0); i++) {
      await new Promise((r) => setTimeout(r, 600));
      fill = (await this.tool<any[]>("spot_get_order", { instId: req.instId, ordId }))?.[0];
    }
    const accFill = Number(fill?.accFillSz) || req.notionalUsdt / req.entryPx;
    const avgPx = Number(fill?.avgPx) || req.entryPx;
    const fee = Math.abs(Number(fill?.fee) || 0);
    const feeInBase = fill?.feeCcy && fill.feeCcy === req.instId.split("-")[0];
    const qty = feeInBase ? accFill - fee : accFill;
    void this.refreshBalance(true).catch(() => undefined);
    return {
      id: crypto.randomUUID().slice(0, 8),
      instId: req.instId,
      qty,
      entryPx: avgPx,
      stopPx: req.stopPx,
      initialStop: req.stopPx,
      targetPx: req.targetPx,
      costUsdt: accFill * avgPx,
      openedAt: Date.now(),
      partialDone: false,
      trailing: false,
      mode: "GERÇEK",
      reason: req.reason,
      realizedPnl: 0,
      lastPx: avgPx,
      atr: req.atr,
      origin: req.origin,
      ordId,
    };
  }

  private async availBase(instId: string): Promise<number> {
    const base = instId.split("-")[0];
    const data: any = await this.tool("account_get_balance", { ccy: base });
    const d = (data?.[0]?.details ?? []).find((x: any) => x.ccy === base);
    return Number(d?.availBal ?? 0) || 0;
  }

  private async cancelAlgos(instId: string): Promise<void> {
    for (const ordType of ["conditional", "oco"]) {
      const list: any[] = (await this.tool<any[]>("spot_get_algo_orders", { instId, ordType, status: "pending" }).catch(() => [])) ?? [];
      for (const a of list) await this.tool("spot_cancel_algo_order", { instId, algoId: a.algoId }).catch(() => undefined);
    }
  }

  protected async executeExit(pos: Position, qty: number, refPx: number) {
    const { lotSz, minSz } = await this.lotOf(pos.instId);
    const avail = await this.availBase(pos.instId);
    if (avail < Math.max(minSz, lotSz)) {
      // Borsadaki bağlı stop/hedef zaten tetiklenmiş: pozisyon kapalı kabul edilir.
      return { qty: pos.qty, px: refPx, closedAll: true };
    }
    const full = qty >= pos.qty - 1e-12;
    if (full) await this.cancelAlgos(pos.instId);
    let sz = Math.min(qty, avail);
    sz = Math.floor(sz / lotSz) * lotSz;
    if (sz < minSz) return { qty: 0, px: refPx, closedAll: false };
    const placed: any = await this.tool("spot_place_order", { instId: pos.instId, tdMode: "cash", side: "sell", ordType: "market", sz: sz.toFixed(8).replace(/0+$/, "").replace(/\.$/, "") });
    if (placed?.[0]?.sCode && placed[0].sCode !== "0") throw new Error(`Satış reddedildi: ${placed[0].sMsg}`);
    if (!full) await this.onStopMoved(pos).catch(() => undefined);
    void this.refreshBalance(true).catch(() => undefined);
    return { qty: full ? pos.qty : sz, px: refPx, closedAll: full };
  }

  /** Kısmi çıkış/trailing sonrası borsadaki stopu kalan miktara göre yeniler. */
  protected async onStopMoved(pos: Position): Promise<void> {
    const { lotSz } = await this.lotOf(pos.instId);
    await this.cancelAlgos(pos.instId);
    const sz = Math.floor(Math.min(pos.qty, await this.availBase(pos.instId)) / lotSz) * lotSz;
    if (sz <= 0) return;
    await this.tool("spot_place_algo_order", {
      instId: pos.instId,
      tdMode: "cash",
      side: "sell",
      ordType: "oco",
      sz: String(sz),
      slTriggerPx: String(pos.stopPx),
      slOrdPx: "-1",
      tpTriggerPx: String(pos.targetPx),
      tpOrdPx: "-1",
    });
  }
}
