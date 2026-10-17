// Mentor işlemi: çok zaman dilimli kurulum taslağı. Yön ve seviyeleri KOD hesaplar; gerekçe metnini Gemini yazar.
// Yatırım tavsiyesi değildir. Yön üst dilimlerden (varsayılan 4H + 1D), alt dilim yalnızca giriş zamanlaması.
import type { AppContext } from "../context.js";
import { atrTrend } from "../indicators/atrTrend.js";
import { atr, ema, roundPrice, round, type Candle } from "../util/math.js";
import { okxBar, type Bar } from "../market/bars.js";
import { horizonFrames, type TradingPlan } from "../plan/plan.js";

export const SETUP_FRAMES = ["15m", "1H", "4H", "1D"] as const;
export type TfDir = "up" | "down" | "flat";
export const ARROW: Record<TfDir, string> = { up: "↑", down: "↓", flat: "→" };
export const TF_LABEL: Record<string, string> = { "15m": "15dk", "1H": "1s", "4H": "4s", "1D": "1g" };
export const DISCLAIMER = "Ajan kurulum taslağı; yatırım tavsiyesi değildir.";

export interface Setup {
  instId: string;
  frames: { tf: string; label: string; dir: TfDir }[];
  badgeText: string; // "15dk ↓ · 1s ↓ · 4s ↑ · 1g ↑"
  direction: "LONG" | "SHORT" | null;
  horizon: string;
  showLevels: boolean;
  noTradeReason: string | null;
  entryZone: [number, number] | null;
  stop: number | null;
  stopType: string | null;
  target1: number | null;
  target2: number | null;
  rr1: number | null;
  rr2: number | null;
  confidence: "düşük" | "orta" | "yüksek" | null;
  reasons: string[];
  reasonsBy: string; // "kod" ya da LLM sağlayıcı adı
  invalidation: string | null;
  shortNote: string | null;
  agentDecision: string | null;
  disclaimer: string;
  ts: number;
}

/** Bir zaman dilimi trendi: trend çizgisi yönü ve EMA20 eğimi aynı yöndeyse up/down, değilse flat. */
export function tfDirection(c: Candle[]): TfDir {
  if (c.length < 30) return "flat";
  const at = atrTrend(c, 14, 2).at(-1)!;
  const e = ema(c.map((x) => x.close), 20);
  const slope = e.at(-1)! - e[Math.max(0, e.length - 9)];
  if (at.dir === 1 && slope > 0) return "up";
  if (at.dir === -1 && slope < 0) return "down";
  return "flat";
}

/** Saf hesap (test edilir): mumlar + plan + ajan kararı → kurulum. */
export function buildSetup(instId: string, candles: Record<string, Candle[]>, plan: TradingPlan, extra: { agentDecision: string | null; agentReason?: string; agentSafetyBlock?: boolean; opportunity?: number; crowded?: "long" | "short" | "dengeli" | null; derivBadge?: string | null; maxStopPct?: number }): Setup {
  const frames = SETUP_FRAMES.map((tf) => ({ tf, label: TF_LABEL[tf], dir: tfDirection(candles[tf] ?? []) }));
  const badgeText = frames.map((f) => `${f.label} ${ARROW[f.dir]}`).join(" · ");
  const hf = horizonFrames(plan.horizon);
  const d = (tf: string) => frames.find((f) => f.tf === tf)!.dir;
  const [a, b] = hf.trend;
  let direction: Setup["direction"] = null;
  if (d(a) === "up" && d(b) === "up") direction = "LONG";
  else if (d(a) === "down" && d(b) === "down") direction = "SHORT";
  const base: Setup = { instId, frames, badgeText, direction, horizon: hf.label, showLevels: false, noTradeReason: null, entryZone: null, stop: null, stopType: null, target1: null, target2: null, rr1: null, rr2: null, confidence: null, reasons: [], reasonsBy: "kod", invalidation: null, shortNote: null, agentDecision: extra.agentDecision, disclaimer: DISCLAIMER, ts: Date.now() };
  if (!direction) return { ...base, noTradeReason: `İşlem yok: zaman dilimleri çelişiyor (${TF_LABEL[a]} ${ARROW[d(a)]}, ${TF_LABEL[b]} ${ARROW[d(b)]}).` };
  // Ajan spot-long çalışır: düşüş trendi nedeniyle "ele" SHORT kurulumunu geçersiz kılmaz; güvenlik/risk elemesi kılar.
  const eliminated = extra.agentDecision === "ele" && (direction === "LONG" || extra.agentSafetyBlock === true);
  if (eliminated) return { ...base, noTradeReason: `Ajan bu coini eledi${extra.agentReason ? `: ${extra.agentReason}` : "."} Giriş, stop ve hedef gösterilmiyor.` };
  if (direction === "SHORT" && plan.direction === "long") base.shortNote = "SHORT: spot'ta \"sat / bekle\" anlamına gelir. Planın yalnızca long; short yalnızca paper futures'ta ve planda long + short seçiliyse açılır.";
  else if (direction === "SHORT") base.shortNote = "SHORT: spot'ta \"sat / bekle\" anlamına gelir; short pozisyon yalnızca paper futures'ta açılır.";
  const ec = candles[hf.entry] ?? [];
  if (ec.length < 20) return { ...base, noTradeReason: "Giriş zaman dilimi için yeterli mum yok (veri yok)." };
  const price = ec.at(-1)!.close;
  const at = atr(ec, 14);
  const line = atrTrend(ec, 14, 2).at(-1)!.line;
  const sign = direction === "LONG" ? 1 : -1;
  const maxStop = (extra.maxStopPct ?? 6) / 100;
  let stop: number;
  let stopType: string;
  const lineOk = sign * (price - line) > 0 && Math.abs(price - line) / price <= maxStop && Math.abs(price - line) / price >= 0.003;
  if (lineOk) {
    stop = line;
    stopType = `trend çizgisi · TimosAI ATR, ${TF_LABEL[hf.entry]}`;
  } else {
    stop = price - sign * Math.max(1.6 * at, price * 0.005);
    stopType = `ATR × 1,6 · ${TF_LABEL[hf.entry]}`;
  }
  const R = Math.abs(price - stop);
  const rr2 = Math.max(plan.minRR, 2.5);
  const t1 = price + sign * 1.5 * R;
  const t2 = price + sign * rr2 * R;
  let score = 0;
  const same = frames.filter((f) => f.dir === (direction === "LONG" ? "up" : "down")).length;
  if (same === 4) score += 2;
  else if (same === 3) score += 1;
  if ((extra.opportunity ?? 0) >= plan.minOpportunity) score += 1;
  if (extra.crowded && extra.crowded === (direction === "LONG" ? "long" : "short")) score -= 1;
  const confidence: Setup["confidence"] = score >= 3 ? "yüksek" : score >= 2 ? "orta" : "düşük";
  const reasons = [
    `${TF_LABEL[a]} ve ${TF_LABEL[b]} trend ${direction === "LONG" ? "yukarı" : "aşağı"} (trend çizgisi + EMA20 eğimi); yönü üst dilimler belirliyor.`,
    `${TF_LABEL[hf.entry]} giriş zamanlaması için: ${d(hf.entry) === (direction === "LONG" ? "up" : "down") ? "aynı yönde, giriş uygun" : "henüz teyit etmedi, bölgeye dönüş beklenebilir"}.`,
    extra.derivBadge ? `Vadeli: ${extra.derivBadge}${extra.crowded && extra.crowded === (direction === "LONG" ? "long" : "short") ? " (kalabalık tarafla aynı yön, güven düşürüldü)" : ""}.` : "Vadeli veri yok.",
  ];
  return {
    ...base,
    showLevels: true,
    entryZone: [roundPrice(price - 0.25 * at), roundPrice(price + 0.25 * at)],
    stop: roundPrice(stop),
    stopType,
    target1: roundPrice(t1),
    target2: roundPrice(t2),
    rr1: 1.5,
    rr2: round(rr2, 2),
    confidence,
    reasons,
    invalidation: direction === "LONG" ? `Geçersiz olur eğer fiyat ${roundPrice(stop)} altına kapanırsa ya da ${TF_LABEL[a]} trendi aşağı dönerse.` : `Geçersiz olur eğer fiyat ${roundPrice(stop)} üstüne kapanırsa ya da ${TF_LABEL[a]} trendi yukarı dönerse.`,
  };
}

const cache = new Map<string, { at: number; v: Candle[] }>();

/** Kurulumu canlı veriyle hesaplar (grafik aralığından bağımsız: her zaman 15m/1H/4H/1D). */
export async function computeSetup(ctx: AppContext, instId: string): Promise<Setup> {
  const plan: TradingPlan = ctx.store.settings.plan;
  const candles: Record<string, Candle[]> = {};
  await Promise.all(
    SETUP_FRAMES.map(async (tf) => {
      const key = `${instId}:${tf}`;
      const c = cache.get(key);
      if (c && Date.now() - c.at < 180_000) return void (candles[tf] = c.v);
      const v = await ctx.market.candles(instId, okxBar(tf as Bar), 120).catch(() => [] as Candle[]);
      cache.set(key, { at: Date.now(), v });
      candles[tf] = v;
    }),
  );
  const cand = ctx.agent.candidates.get(instId) ?? (await ctx.extras.cex?.analyze?.(instId).catch(() => null)) ?? null;
  return buildSetup(instId, candles, plan, { agentDecision: cand?.decision ?? null, agentReason: cand?.reason, agentSafetyBlock: cand ? cand.risk > 75 || cand.security?.level === "zayıf" : false, opportunity: cand?.opportunity, crowded: cand?.derivatives?.available ? cand.derivatives.crowded : null, derivBadge: cand?.derivatives?.available ? cand.derivatives.badge : null, maxStopPct: ctx.contract.maxStopPct });
}

const rationaleCache = new Map<string, { at: number; key: string; lines: string[]; provider: string }>();

/** Kod hesaplar, Gemini gerekçeyi yazar (yoksa kod gerekçesi kalır). Yön ve seviyeleri LLM değiştiremez. */
export async function computeSetupWithRationale(ctx: AppContext, instId: string): Promise<Setup> {
  const s = await computeSetup(ctx, instId);
  const mentor = ctx.extras.mentor;
  if (!s.showLevels || !mentor?.rationale) return s;
  const key = `${s.direction}:${s.badgeText}:${s.stop}`;
  const c = rationaleCache.get(instId);
  if (c && c.key === key && Date.now() - c.at < 15 * 60_000) return { ...s, reasons: c.lines, reasonsBy: c.provider };
  const prompt = [
    `Aşağıdaki kurulum taslağı için 2 ya da 3 kısa gerekçe cümlesi yaz (her biri ayrı satırda, en fazla 20 kelime).`,
    `Araç çağırma. Yön ve seviyeleri değiştirme, yeni sayı uydurma. "Al" ya da "sat" diye komut verme; yatırım tavsiyesi verme.`,
    `Coin: ${instId.split("-")[0]} · Yön: ${s.direction} · Vade: ${s.horizon} · Trendler: ${s.badgeText}`,
    `Giriş bölgesi ${s.entryZone?.join("–")} · Stop ${s.stop} (${s.stopType}) · Hedef 1 ${s.target1} · Hedef 2 ${s.target2} · Güven ${s.confidence}`,
    `Kod gerekçeleri: ${s.reasons.join(" | ")}`,
  ].join("\n");
  const r = await mentor.rationale(prompt).catch(() => null);
  if (!r) return s;
  rationaleCache.set(instId, { at: Date.now(), key, lines: r.lines, provider: r.provider });
  return { ...s, reasons: r.lines, reasonsBy: r.provider };
}
