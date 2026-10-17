// Vadeli durum kuralları: kalabalık taraf, manipülasyon şüphesi ve gerekçe listesi.
import fs from "node:fs";
import path from "node:path";
import type { DerivSnapshot } from "./derivativesData.js";

export interface DerivConfig {
  pxUpPct1h: number;
  oiSurgePct1h: number;
  oiDropPct1h: number;
  weakSpotVolRatio: number;
  fundingHigh: number;
  lsHigh: number;
  lsLow: number;
  divergenceMargin: number;
  wickPct: number;
  pxUpPct4hForShortSqueeze: number;
  cacheMinutes: number;
  refreshPerScan: number;
}

export const DEFAULT_DERIV: DerivConfig = { pxUpPct1h: 1, oiSurgePct1h: 3, oiDropPct1h: 4, weakSpotVolRatio: 1, fundingHigh: 0.0003, lsHigh: 1.8, lsLow: 0.7, divergenceMargin: 0.15, wickPct: 1, pxUpPct4hForShortSqueeze: 1, cacheMinutes: 5, refreshPerScan: 6 };

export function loadDerivConfig(file = path.resolve(process.cwd(), "config/derivatives.json")): DerivConfig {
  try {
    return { ...DEFAULT_DERIV, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return DEFAULT_DERIV;
  }
}

export interface PriceContext {
  chg1hPct: number;
  chg4hPct: number;
  spotVolRatio: number;
  maxWickPct: number;
}

export type Crowded = "long" | "dengeli" | "short";
export type Manipulation = "düşük" | "orta" | "yüksek";

export interface DerivAnalysis {
  available: boolean;
  crowded: Crowded;
  manipulation: Manipulation;
  badge: string; // Basic modda tek etiket
  reasons: string[];
  flags: string[];
  snapshot: DerivSnapshot;
  riskAdj: number;
}

const pct = (v: number | null, d = 2) => (v === null ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);

export function analyzeDerivatives(s: DerivSnapshot, px: PriceContext, cfg: DerivConfig = DEFAULT_DERIV): DerivAnalysis {
  const reasons: string[] = [];
  const flags: string[] = [];
  const has = s.funding !== null || s.lsAccount !== null || s.oiDeltaPct1h !== null;
  if (!has) {
    return { available: false, crowded: "dengeli", manipulation: "düşük", badge: "vadeli veri yok", reasons: ["Vadeli veri alınamadı; analiz yapılmadı."], flags, snapshot: s, riskAdj: 0 };
  }
  const f = s.funding ?? 0;
  const ls = s.lsAccount;
  const oi1 = s.oiDeltaPct1h;
  let suspicion = 0;

  if (px.chg1hPct >= cfg.pxUpPct1h && oi1 !== null && oi1 >= cfg.oiSurgePct1h && px.spotVolRatio < cfg.weakSpotVolRatio) {
    flags.push("vadeli_kaynakli");
    reasons.push(`Fiyat 1 saatte ${pct(px.chg1hPct)}, OI ${pct(oi1)} ama spot hacim zayıf: vadeli kaynaklı hareket, sıkışma/likidasyon riski.`);
    suspicion += 2;
  }
  if (f >= cfg.fundingHigh && ls !== null && ls >= cfg.lsHigh) {
    flags.push("long_squeeze");
    reasons.push(`Funding yüksek pozitif (${(f * 100).toFixed(4)}%) ve genel hesap oranı ${ls.toFixed(2)}: long kalabalık, long squeeze riski.`);
    suspicion += 1;
  }
  if (f <= -cfg.fundingHigh && ls !== null && ls <= cfg.lsLow) {
    flags.push("short_squeeze");
    reasons.push(`Funding negatif (${(f * 100).toFixed(4)}%) ve genel hesap oranı ${ls.toFixed(2)}: short kalabalık, short squeeze riski.`);
    suspicion += 1;
  }
  if (px.chg4hPct >= cfg.pxUpPct4hForShortSqueeze && s.funding !== null && f < 0) {
    flags.push("shortlar_sikisiyor");
    reasons.push(`Fiyat 4 saatte ${pct(px.chg4hPct)} yükselirken funding negatif: short'lar sıkışıyor.`);
  }
  if (s.lsTopPosition !== null && ls !== null) {
    const top = s.lsTopPosition;
    const m = cfg.divergenceMargin;
    if ((top < 1 - m && ls > 1 + m) || (top > 1 + m && ls < 1 - m)) {
      flags.push("ayrisma");
      reasons.push(`Üst trader pozisyon oranı ${top.toFixed(2)}, genel hesap oranı ${ls.toFixed(2)}: ayrışma (üst traderlar genel kalabalığın tersinde).`);
      suspicion += 1;
    }
  }
  if (oi1 !== null && oi1 <= -cfg.oiDropPct1h && px.maxWickPct >= cfg.wickPct) {
    flags.push("likidasyon_kaskadi");
    reasons.push(`OI 1 saatte ${pct(oi1)} düştü ve uzun fitil var (%${px.maxWickPct.toFixed(2)}): likidasyon kaskadı yaşandı.`);
    suspicion += 1;
  }

  let crowded: Crowded = "dengeli";
  if ((ls !== null && ls >= cfg.lsHigh) || f >= cfg.fundingHigh) crowded = "long";
  else if ((ls !== null && ls <= cfg.lsLow) || f <= -cfg.fundingHigh) crowded = "short";
  const manipulation: Manipulation = suspicion >= 3 ? "yüksek" : suspicion >= 1 ? "orta" : "düşük";
  if (!reasons.length) reasons.push(`Belirgin bir vadeli dengesizlik yok (funding ${s.funding === null ? "-" : (f * 100).toFixed(4) + "%"}, genel hesap oranı ${ls === null ? "-" : ls.toFixed(2)}, OI 1 sa ${pct(oi1)}).`);
  const badge = flags.includes("long_squeeze") ? "long kalabalık" : flags.includes("short_squeeze") ? "short kalabalık" : flags.includes("vadeli_kaynakli") ? "vadeli kaynaklı hareket" : flags.includes("likidasyon_kaskadi") ? "likidasyon kaskadı" : crowded === "long" ? "long ağırlıklı" : crowded === "short" ? "short ağırlıklı" : "vadeli dengeli";
  const riskAdj = (manipulation === "yüksek" ? 15 : manipulation === "orta" ? 6 : 0) + (flags.includes("long_squeeze") ? 6 : 0);
  return { available: true, crowded, manipulation, badge, reasons, flags, snapshot: s, riskAdj };
}

/** Mumlardan fiyat bağlamı (15 dk mumlar). */
export function priceContext(candles: { open: number; high: number; low: number; close: number; vol: number }[], volRatio: number): PriceContext {
  const c = candles;
  const last = c.at(-1)?.close ?? 0;
  const p1 = c[Math.max(0, c.length - 5)]?.close ?? last;
  const p4 = c[Math.max(0, c.length - 17)]?.close ?? last;
  let maxWick = 0;
  for (const k of c.slice(-4)) {
    const up = (k.high - Math.max(k.open, k.close)) / k.close;
    const dn = (Math.min(k.open, k.close) - k.low) / k.close;
    maxWick = Math.max(maxWick, up * 100, dn * 100);
  }
  return { chg1hPct: p1 ? ((last - p1) / p1) * 100 : 0, chg4hPct: p4 ? ((last - p4) / p4) * 100 : 0, spotVolRatio: volRatio, maxWickPct: maxWick };
}
