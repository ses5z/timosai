// RuleDecisionProvider: skorlardan aç/izle/ele, giriş/stop/hedef ve sade Türkçe gerekçe üretir.
import type { Candidate, DecisionInput, DecisionKind, DecisionProvider, SecuritySummary } from "../ports.js";
import { clamp, round, roundPrice } from "../util/math.js";
import { scoreInput } from "./scoring.js";
import type { Thresholds } from "./thresholds.js";
import { analyzeDerivatives, priceContext, DEFAULT_DERIV, type DerivConfig } from "../derivatives/rules.js";

const PART_LABEL: Record<string, string> = {
  momentum: "ivme",
  trend: "trend",
  volume: "hacim",
  rsi: "RSI dengesi",
  volatility: "oynaklık dengesi",
  funding: "funding",
  sentiment: "haber duygusu",
};

function hashStr(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function sampleSecurity(instId: string, spreadPct: number | null, depthUsdt: number | null): SecuritySummary {
  const h = hashStr(instId);
  const big = ["BTC", "ETH", "SOL", "BNB", "XRP", "LTC", "BCH"].includes(instId.split("-")[0]);
  const spreadOk = spreadPct === null || spreadPct < 0.15;
  const level: SecuritySummary["level"] = big && spreadOk ? "iyi" : spreadOk && h % 3 !== 0 ? "orta" : "zayıf";
  return {
    sample: true,
    label: "ÖRNEK VERİ",
    contractAudit: big ? "var" : h % 2 ? "var" : "bilinmiyor",
    unlockNext30d: big ? "yok" : h % 4 === 0 ? "%2-3 arz açılışı" : "önemli açılış yok",
    concentration: big ? "dağınık" : h % 3 === 0 ? "ilk 10 cüzdan yüksek pay" : "orta",
    spreadPct: spreadPct === null ? null : round(spreadPct, 3),
    depthUsdt: depthUsdt === null ? null : Math.round(depthUsdt),
    level,
  };
}

export class RuleDecisionProvider implements DecisionProvider {
  readonly name = "kural";
  constructor(
    private readonly th: Thresholds,
    private readonly derivCfg: DerivConfig = DEFAULT_DERIV,
  ) {}

  decide(inp: DecisionInput): Candidate {
    const th = this.th;
    const s = scoreInput(inp, th);
    const price = inp.ticker.last;
    const security = sampleSecurity(inp.instId, inp.orderbook?.spreadPct ?? null, inp.orderbook?.depthUsdt ?? null);

    const deriv = inp.derivSnapshot ? analyzeDerivatives(inp.derivSnapshot, priceContext(inp.candles, s.volRatio), this.derivCfg) : null;
    if (deriv) s.risk = Math.min(100, s.risk + deriv.riskAdj);

    let decision: DecisionKind = "ele";
    if (s.opportunity >= th.openMinOpportunity && s.risk <= th.openMaxRisk && s.trendUp && security.level !== "zayıf") decision = "aç";
    else if (s.opportunity >= th.watchMinOpportunity) decision = "izle";

    const stopPct = clamp(((s.atr * th.stopAtrMult) / price) * 100, th.minStopPct, th.maxStopPct);
    const entry = roundPrice(price);
    const stop = roundPrice(price * (1 - stopPct / 100));
    const target = roundPrice(price + (price - stop) * th.targetRR);
    const rr = price - stop > 0 ? round((target - price) / (price - stop), 2) : 0;

    const ranked = Object.entries(s.parts).sort((a, b) => b[1] - a[1]);
    const strong = ranked.slice(0, 2).map(([k]) => PART_LABEL[k]);
    const weak = ranked.at(-1)!;
    const direction = s.trendUp ? "Yukarı eğilimli" : s.trendDown ? "Aşağı eğilimli" : "Yatay, yön arıyor";

    let reason: string;
    if (decision === "aç") reason = `${strong.join(" ve ")} güçlü, risk makul; stop ${stopPct.toFixed(1)}% altta, hedef ${th.targetRR}R.`;
    else if (decision === "izle") reason = `${strong[0]} olumlu ama ${PART_LABEL[weak[0]]} zayıf; teyit beklemek daha sakin.`;
    else reason = s.trendDown ? `Trend aşağı ve ${PART_LABEL[weak[0]]} zayıf; şimdilik uzak durmak mantıklı.` : `Belirgin bir fırsat görünmüyor; ${PART_LABEL[weak[0]]} zayıf.`;

    if (decision === "aç" && deriv?.manipulation === "yüksek") {
      decision = "izle";
      reason = `Teknik görünüm olumlu ama vadeli tarafta manipülasyon şüphesi yüksek (${deriv.badge}); izlemede.`;
    }
    const why: string[] = [];
    why.push(`Son 4 saatte ${s.mom4h >= 0 ? "+" : ""}${s.mom4h.toFixed(2)}%, 24 saatte ${inp.ticker.change24hPct >= 0 ? "+" : ""}${inp.ticker.change24hPct.toFixed(2)}% değişim.`);
    why.push(s.trendUp ? "Fiyat kısa ve orta ortalamaların üstünde (EMA20 > EMA50)." : s.trendDown ? "Fiyat ortalamaların altında, eğilim aşağı." : "Ortalamalar iç içe; net bir trend yok.");
    why.push(`Hacim son saatte normalin ${s.volRatio.toFixed(1)} katı.`);
    if (s.rsi !== null) why.push(`RSI ${s.rsi.toFixed(0)}: ${s.rsi >= th.rsiOverbought ? "aşırı alım bölgesi, dikkat" : s.rsi <= th.rsiOversold ? "aşırı satım bölgesi" : "dengeli bölgede"}.`);
    why.push(`Oynaklık (ATR) fiyatın %${s.atrPct.toFixed(2)}'si.`);
    if (inp.funding !== null) why.push(`Funding ${(inp.funding * 100).toFixed(4)}%: ${Math.abs(inp.funding) > th.fundingCrowdedAbs ? "kalabalık pozisyon işareti" : "nötr"}.`);
    if (deriv?.available) why.push(`Vadeli: ${deriv.badge}; ${deriv.reasons[0]}`);
    if (inp.sentiment !== null) why.push(`Haber duygusu ${inp.sentiment >= 0 ? "olumlu" : "olumsuz"} (${(inp.sentiment * 100).toFixed(0)}).`);

    return {
      instId: inp.instId,
      base: inp.instId.split("-")[0],
      category: inp.category,
      price,
      change24hPct: round(inp.ticker.change24hPct, 2),
      volUsdt24h: Math.round(inp.ticker.volUsdt24h),
      spark: inp.candles.slice(-60).map((x) => x.close),
      atr: s.atr,
      atrPct: round(s.atrPct, 2),
      rsi: s.rsi === null ? null : round(s.rsi, 1),
      funding: inp.funding,
      sentiment: inp.sentiment,
      parts: Object.fromEntries(Object.entries(s.parts).map(([k, v]) => [k, Math.round(v)])) as any,
      opportunity: Math.round(s.opportunity),
      risk: Math.round(s.risk),
      decision,
      direction,
      entry,
      stop,
      target,
      rr,
      reason,
      whyBullets: why,
      security,
      derivatives: deriv,
      updatedAt: Date.now(),
      live: inp.live,
    };
  }
}
