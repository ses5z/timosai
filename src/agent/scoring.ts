// Skorlama: momentum, hacim, trend, volatilite/ATR, funding, haber duygusu, RSI. Her bileşen 0-100.
import type { DecisionInput, ScoreParts } from "../ports.js";
import { atr, clamp, ema, pctChange, rsi as calcRsi } from "../util/math.js";
import type { Thresholds } from "./thresholds.js";

/** Hacim ölçüsü: son 1 saat (4×15 dk) hacmi / önceki 10 saat ortalaması → 0-100. Skor motoru ve hold raporu AYNI fonksiyonu kullanır. */
export function volumeScore(volRatio: number, mom4h = 0): number {
  return clamp(35 + (volRatio - 1) * 35 + (mom4h > 0 ? 8 : -4), 0, 100);
}
/** Hacim düşük mü? Eşik config/thresholds.json → lowVolumeScore (varsayılan 35). */
export function isVolumeLow(score: number, th: { lowVolumeScore?: number }): boolean {
  return score < (th.lowVolumeScore ?? 35);
}

export interface ScoreResult {
  parts: ScoreParts;
  opportunity: number;
  risk: number;
  atr: number;
  atrPct: number;
  rsi: number | null;
  trendUp: boolean;
  trendDown: boolean;
  mom4h: number;
  volRatio: number;
}

export function scoreInput(inp: DecisionInput, th: Thresholds): ScoreResult {
  const c = inp.candles;
  const closes = c.map((x) => x.close);
  const last = inp.ticker.last || closes.at(-1) || 0;
  const a = atr(c, 14);
  const atrPct = last > 0 ? (a / last) * 100 : 0;

  // Momentum: son 4 saat (16 x 15dk) + 24 sa
  const ref4h = closes[Math.max(0, closes.length - 17)] ?? last;
  const mom4h = pctChange(ref4h, last);
  const momentum = clamp(50 + mom4h * 12 + inp.ticker.change24hPct * 2.5, 0, 100);

  // Trend: EMA20/EMA50 düzeni ve eğim
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e20l = e20.at(-1) ?? last;
  const e50l = e50.at(-1) ?? last;
  const slope = pctChange(e20[Math.max(0, e20.length - 9)] ?? e20l, e20l);
  const trendUp = last > e20l && e20l > e50l;
  const trendDown = last < e20l && e20l < e50l;
  const trend = clamp(50 + (trendUp ? 22 : trendDown ? -22 : 0) + slope * 15, 0, 100);

  // Hacim: son 4 mumun ortalaması / önceki 40 mumun ortalaması
  const recent = c.slice(-4).reduce((s, x) => s + x.vol, 0) / Math.max(1, Math.min(4, c.length));
  const prev = c.slice(-44, -4);
  const base = prev.reduce((s, x) => s + x.vol, 0) / Math.max(1, prev.length);
  const volRatio = base > 0 ? recent / base : 1;
  const volume = volumeScore(volRatio, mom4h);

  // RSI: ATK göstergesi varsa o, yoksa mumdan
  const r = inp.rsi ?? calcRsi(closes);
  let rsiScore = 50;
  if (r !== null) {
    if (r >= th.rsiOverbought) rsiScore = 25;
    else if (r <= th.rsiOversold) rsiScore = 40;
    else if (r >= 50 && r < 66) rsiScore = 78;
    else if (r >= 66) rsiScore = 58;
    else rsiScore = 45 + (r - th.rsiOversold) * 0.3;
  }

  // Volatilite: ılımlı ATR iyi, aşırı yüksek kötü
  // (15 dakikalık mumlarda ATR% tipik olarak 0.2-0.8 arasıdır)
  const volatility = clamp(atrPct < 0.12 ? 45 : atrPct <= th.highVolAtrPct ? 78 - Math.abs(atrPct - 0.4) * 40 : 45 - (atrPct - th.highVolAtrPct) * 40, 0, 100);

  // Funding: sıfıra yakın iyi, aşırı pozitif kalabalık long
  let funding = 55;
  if (inp.funding !== null) {
    const f = inp.funding;
    funding = clamp(f > th.fundingCrowdedAbs ? 25 : f < -th.fundingCrowdedAbs ? 60 : 70 - Math.abs(f) * 50000, 0, 100);
  }

  // Duygu: -1..1 → 0..100, veri yoksa nötr
  // Haber duygusu yoksa skora katılmaz (ağırlık diğerlerine dağılır), arayüzde "veri yok" görünür.
  const sentiment = inp.sentiment === null ? null : clamp(50 + inp.sentiment * 40, 0, 100);

  const parts: ScoreParts = { momentum, trend, volume, rsi: rsiScore, volatility, funding, sentiment };
  const w = th.weights;
  const ws = sentiment === null ? 0 : w.sentiment;
  const wsum = w.momentum + w.trend + w.volume + w.rsi + w.volatility + w.funding + ws || 1;
  const opportunity = clamp(
    (momentum * w.momentum + trend * w.trend + volume * w.volume + rsiScore * w.rsi + volatility * w.volatility + funding * w.funding + (sentiment ?? 0) * ws) / wsum,
    0,
    100,
  );

  // Risk: volatilite, RSI uçları, kalabalık funding, makas, düşüş trendi
  const range24 = last > 0 ? ((inp.ticker.high24h - inp.ticker.low24h) / last) * 100 : 0;
  let risk = 12;
  risk += clamp((atrPct - 0.3) * 45, 0, 28);
  risk += clamp((range24 - 3) * 2.5, 0, 18);
  if (r !== null && r >= th.rsiOverbought) risk += 18;
  if (r !== null && r <= th.rsiOversold) risk += 10;
  if (inp.funding !== null && Math.abs(inp.funding) > th.fundingCrowdedAbs) risk += 12;
  if (inp.orderbook && inp.orderbook.spreadPct > th.maxSpreadPct) risk += 15;
  if (trendDown) risk += 12;
  if (Math.abs(inp.ticker.change24hPct) > 12) risk += 10;
  risk = clamp(risk, 0, 100);

  return { parts, opportunity, risk, atr: a, atrPct, rsi: r, trendUp, trendDown, mom4h, volRatio };
}
