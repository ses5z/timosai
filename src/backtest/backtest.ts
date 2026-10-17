// Mini backtest: son 30 gün, yalnızca kapanışlar, ileriye bakış yok. Her 4s kapanışında yalnızca o ana kadarki
// mumlar kullanılır: yön (4s + günlüğe toplanmış 4s), stop (trend çizgisi ya da ATR×1,6), hedef 1 (1,5R), hedef 2.
// Sonuç sonraki kapanışlarla çözülür. Geçmiş performans geleceği garanti etmez.
import { atrTrend } from "../indicators/atrTrend.js";
import { atr, round, type Candle } from "../util/math.js";
import { tfDirection } from "../mentor/setup.js";
import type { TradingPlan } from "../plan/plan.js";

export interface BtTrade {
  instId: string;
  side: "LONG" | "SHORT";
  openTs: number;
  closeTs: number;
  entry: number;
  stop: number;
  r: number;
  outcome: "hedef 2" | "hedef 1" | "stop" | "süre doldu";
}

export interface BtResult {
  trades: number;
  hitPct: number; // hedef 1 ya da 2'ye ulaşan
  avgR: number;
  maxDrawdownR: number;
  long: { trades: number; avgR: number };
  short: { trades: number; avgR: number };
  list: BtTrade[];
  note: string;
  coins: string[];
  from: number;
  to: number;
}

export const BT_NOTE = "Geçmiş performans geleceği garanti etmez.";
const HOLD_BARS: Record<TradingPlan["horizon"], number> = { scalp: 3, swing: 18, pozisyon: 60 }; // 4s mum sayısı

/** 4s mumlarından günlük mumlar (ileriye bakış yok: yalnızca verilen mumlar). */
export function toDaily(c: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const x of c) {
    const day = Math.floor(x.ts / 86_400_000);
    const last = out.at(-1);
    if (last && Math.floor(last.ts / 86_400_000) === day) {
      last.high = Math.max(last.high, x.high);
      last.low = Math.min(last.low, x.low);
      last.close = x.close;
      last.vol += x.vol;
    } else out.push({ ...x });
  }
  return out;
}

export function backtestCoin(instId: string, c4h: Candle[], plan: TradingPlan, fromTs: number): BtTrade[] {
  const trades: BtTrade[] = [];
  const hold = HOLD_BARS[plan.horizon];
  const rr2 = Math.max(plan.minRR, 2.5);
  let i = 60;
  while (i < c4h.length - 1) {
    if (c4h[i].ts < fromTs) { i++; continue; }
    const past = c4h.slice(0, i + 1); // yalnızca bu kapanışa kadar
    const d4 = tfDirection(past);
    const d1 = tfDirection(toDaily(past));
    let side: "LONG" | "SHORT" | null = null;
    if (d4 === "up" && d1 === "up") side = "LONG";
    else if (d4 === "down" && d1 === "down" && plan.direction === "longshort") side = "SHORT";
    if (!side) { i++; continue; }
    const px = past[i].close;
    const sign = side === "LONG" ? 1 : -1;
    const line = atrTrend(past, 14, 2).at(-1)!.line;
    const a = atr(past, 14);
    const lineOk = sign * (px - line) > 0 && Math.abs(px - line) / px <= 0.06 && Math.abs(px - line) / px >= 0.003;
    const stop = lineOk ? line : px - sign * Math.max(1.6 * a, px * 0.005);
    const R = Math.abs(px - stop);
    const t1 = px + sign * 1.5 * R;
    const t2 = px + sign * rr2 * R;
    let j = i + 1, hitT1 = false, out: BtTrade["outcome"] | null = null, r = 0;
    for (; j < c4h.length && j <= i + hold; j++) {
      const cl = c4h[j].close;
      if (sign * (cl - stop) <= 0) { out = hitT1 ? "hedef 1" : "stop"; r = hitT1 ? 1.5 * (plan.partialPct / 100) : -1; break; }
      if (sign * (cl - t2) >= 0) { out = "hedef 2"; r = rr2; break; }
      if (!hitT1 && sign * (cl - t1) >= 0) hitT1 = true;
    }
    if (!out) {
      if (j >= c4h.length) break; // sonuç henüz belli değil: sayılmaz (ileriye bakış yok)
      j = Math.min(j, c4h.length - 1, i + hold);
      out = hitT1 ? "hedef 1" : "süre doldu";
      r = (sign * (c4h[j].close - px)) / R;
    }
    trades.push({ instId, side, openTs: c4h[i].ts, closeTs: c4h[j].ts, entry: px, stop, r: round(r, 2), outcome: out });
    i = j + 1; // coin başına aynı anda tek pozisyon
  }
  return trades;
}

export function summarize(list: BtTrade[], coins: string[], from: number, to: number): BtResult {
  const avg = (xs: BtTrade[]) => (xs.length ? round(xs.reduce((s, t) => s + t.r, 0) / xs.length, 2) : 0);
  const sorted = [...list].sort((a, b) => a.closeTs - b.closeTs);
  let eq = 0, peak = 0, dd = 0;
  for (const t of sorted) { eq += t.r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const L = list.filter((t) => t.side === "LONG"), S = list.filter((t) => t.side === "SHORT");
  return {
    trades: list.length,
    hitPct: list.length ? Math.round((list.filter((t) => t.outcome === "hedef 1" || t.outcome === "hedef 2").length / list.length) * 100) : 0,
    avgR: avg(list),
    maxDrawdownR: round(dd, 2),
    long: { trades: L.length, avgR: avg(L) },
    short: { trades: S.length, avgR: avg(S) },
    list: sorted.slice(-40),
    note: BT_NOTE,
    coins,
    from,
    to,
  };
}
