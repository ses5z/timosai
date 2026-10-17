export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number; // quote hacmi (USDT)
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round = (v: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

export function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

export function atr(c: Candle[], period = 14): number {
  if (c.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < c.length; i++) {
    const p = c[i - 1].close;
    trs.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - p), Math.abs(c[i].low - p)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export function pctChange(from: number, to: number): number {
  return from > 0 ? ((to - from) / from) * 100 : 0;
}

/** Fiyatı büyüklüğüne göre anlamlı basamakla yuvarlar. */
export function roundPrice(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return p;
  const d = p >= 1000 ? 1 : p >= 100 ? 2 : p >= 1 ? 4 : p >= 0.01 ? 6 : 10;
  return round(p, d);
}

export const sparkChars = "▁▂▃▄▅▆▇█";
export function sparkline(values: number[], width = 16): string {
  if (!values.length) return "";
  const step = Math.max(1, Math.floor(values.length / width));
  const s = values.filter((_, i) => i % step === 0).slice(-width);
  const lo = Math.min(...s);
  const hi = Math.max(...s);
  return s.map((v) => sparkChars[hi === lo ? 3 : Math.round(((v - lo) / (hi - lo)) * 7)]).join("");
}
