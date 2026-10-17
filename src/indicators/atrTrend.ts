// TimosAI ATR trend filtresi (bu projede sıfırdan yazıldı).
// Çizgi: fiyat çizginin üstündeyse çizgi = max(önceki, kapanış − k·ATR); altındaysa çizgi = min(önceki, kapanış + k·ATR).
// Kapanış çizgiyi kırınca yön değişir ve çizgi karşı tarafa taşınır. Kullanım: (a) trend filtresi (düşüşte long yok),
// (b) pozisyon yönetiminde isteğe bağlı iz süren stop.
import fs from "node:fs";
import path from "node:path";
import type { Candle } from "../util/math.js";

export interface AtrTrendPoint {
  line: number;
  dir: 1 | -1;
}

export function loadAtrTrendConfig(file = path.resolve(process.cwd(), "config/indicators.json")): { period: number; mult: number } {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    return { period: Number(j.atrTrend?.period) || 14, mult: Number(j.atrTrend?.mult) || 2 };
  } catch {
    return { period: 14, mult: 2 };
  }
}

/** Wilder ATR serisi. */
export function atrSeries(c: Candle[], period: number): number[] {
  const out: number[] = [];
  let prev = 0;
  for (let i = 0; i < c.length; i++) {
    const tr = i === 0 ? c[i].high - c[i].low : Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    prev = i < period ? (prev * i + tr) / (i + 1) : (prev * (period - 1) + tr) / period;
    out.push(prev);
  }
  return out;
}

export function atrTrend(c: Candle[], period = 14, mult = 2): AtrTrendPoint[] {
  if (!c.length) return [];
  const atr = atrSeries(c, period);
  const out: AtrTrendPoint[] = [];
  let dir: 1 | -1 = 1;
  let line = c[0].close - mult * atr[0];
  out.push({ line, dir });
  for (let i = 1; i < c.length; i++) {
    const close = c[i].close;
    const up = close - mult * atr[i];
    const dn = close + mult * atr[i];
    if (dir === 1) {
      if (close < line) {
        dir = -1;
        line = dn;
      } else line = Math.max(line, up);
    } else {
      if (close > line) {
        dir = 1;
        line = up;
      } else line = Math.min(line, dn);
    }
    out.push({ line, dir });
  }
  return out;
}
