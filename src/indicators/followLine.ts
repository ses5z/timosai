// Follow Line trend göstergesi.
// Kaynak fikir: Kıvanç Özbilgiç'in TradingView'da açık kaynak yayımladığı "Follow Line" göstergesi
// (https://tr.tradingview.com/script/UXKo4RaJ/), yaygın bir MT4 trend takip göstergesinin uyarlaması.
// Pine kodu kopyalanmadı; göstergenin yayımlanmış açıklamasındaki mantık bu projede TypeScript ile yeniden yazıldı.
// Yazarın bu projeyi onayladığı anlamına gelmez.
//
// Mantık: kapanış üst Bollinger bandının (varsayılan sapma 1) üstüne çıkınca çizgi `low − ATR` seviyesine çekilir
// ve yükseliş sürdükçe yalnızca yukarı hareket eder; kapanış alt bandın altına inince çizgi `high + ATR` seviyesine
// çekilir ve düşüş sürdükçe yalnızca aşağı hareket eder; kapanış bantlar arasındayken çizgi sabit kalır.
// Yön değişimi (mavi ↔ kırmızı) al/sat dönüş sinyalidir. ATR filtresi kapalıysa yalnızca low/high kullanılır.
import fs from "node:fs";
import path from "node:path";
import type { Candle } from "../util/math.js";
import { atrSeries, type AtrTrendPoint } from "./atrTrend.js";

export interface FollowLineConfig {
  bbPeriod: number;
  bbDev: number;
  atrPeriod: number;
  atrFilter: boolean;
}

export const FOLLOW_LINE_DEFAULTS: FollowLineConfig = { bbPeriod: 21, bbDev: 1, atrPeriod: 5, atrFilter: true };

export function loadFollowLineConfig(file = path.resolve(process.cwd(), "config/indicators.json")): FollowLineConfig {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")).followLine ?? {};
    return {
      bbPeriod: Number(j.bbPeriod) || FOLLOW_LINE_DEFAULTS.bbPeriod,
      bbDev: Number(j.bbDev) || FOLLOW_LINE_DEFAULTS.bbDev,
      atrPeriod: Number(j.atrPeriod) || FOLLOW_LINE_DEFAULTS.atrPeriod,
      atrFilter: j.atrFilter === undefined ? FOLLOW_LINE_DEFAULTS.atrFilter : Boolean(j.atrFilter),
    };
  } catch {
    return { ...FOLLOW_LINE_DEFAULTS };
  }
}

export function followLine(c: Candle[], cfg: Partial<FollowLineConfig> = {}): AtrTrendPoint[] {
  const k = { ...FOLLOW_LINE_DEFAULTS, ...cfg };
  if (!c.length) return [];
  const atr = atrSeries(c, k.atrPeriod);
  const out: AtrTrendPoint[] = [];
  let line = NaN;
  let dir: 1 | -1 = 1;
  for (let i = 0; i < c.length; i++) {
    // Bollinger bantları (popülasyon std sapması); ilk mumlarda mevcut pencereyle.
    const from = Math.max(0, i - k.bbPeriod + 1);
    let sum = 0;
    for (let j = from; j <= i; j++) sum += c[j].close;
    const n = i - from + 1;
    const mean = sum / n;
    let v = 0;
    for (let j = from; j <= i; j++) v += (c[j].close - mean) ** 2;
    const sd = Math.sqrt(v / n);
    const upper = mean + k.bbDev * sd;
    const lower = mean - k.bbDev * sd;
    const off = k.atrFilter ? atr[i] : 0;
    const close = c[i].close;

    if (Number.isNaN(line)) {
      // Başlangıç: ilk sinyale kadar kapanışa göre geçici çizgi.
      dir = close >= mean ? 1 : -1;
      line = dir === 1 ? c[i].low - off : c[i].high + off;
    } else if (n >= 2 && close > upper) {
      const cand = c[i].low - off;
      if (dir === 1) line = Math.max(line, cand);
      else {
        dir = 1;
        line = cand;
      }
    } else if (n >= 2 && close < lower) {
      const cand = c[i].high + off;
      if (dir === -1) line = Math.min(line, cand);
      else {
        dir = -1;
        line = cand;
      }
    }
    out.push({ line, dir });
  }
  return out;
}
