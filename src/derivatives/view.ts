// Tek coin için vadeli durum analizi (mentor, Telegram, API ortak kullanır).
import type { AppContext } from "../context.js";
import { analyzeDerivatives, type DerivAnalysis } from "./rules.js";

export async function derivAnalysisFor(ctx: AppContext, instId: string): Promise<DerivAnalysis | null> {
  const c = ctx.agent.candidates.get(instId);
  const snap = await ctx.agent.derivativesFor(instId);
  if (!snap) return c?.derivatives ?? null;
  const sp = c?.spark ?? [];
  const last = sp.at(-1) ?? 0;
  const p1 = sp[Math.max(0, sp.length - 5)] ?? last;
  const p4 = sp[Math.max(0, sp.length - 17)] ?? last;
  return analyzeDerivatives(snap, { chg1hPct: p1 ? ((last - p1) / p1) * 100 : 0, chg4hPct: p4 ? ((last - p4) / p4) * 100 : 0, spotVolRatio: 1, maxWickPct: 0 }, ctx.derivConfig);
}

export function derivText(a: DerivAnalysis, base: string): string {
  const s = a.snapshot;
  if (!a.available) return `${base}: vadeli veri yok.`;
  const f = (v: number | null, d = 2) => (v === null ? "-" : v.toFixed(d));
  return [
    `${base} vadeli durum: ${a.badge}. Kalabalık taraf: ${a.crowded}. Manipülasyon şüphesi: ${a.manipulation}.`,
    ...a.reasons.map((r) => `- ${r}`),
    `Funding ${s.funding === null ? "-" : (s.funding * 100).toFixed(4) + "%"} · OI ${s.oiUsd === null ? "-" : (s.oiUsd / 1e6).toFixed(1) + " Mn USD"} (1 sa ${f(s.oiDeltaPct1h)}%) · Genel hesap oranı ${f(s.lsAccount)} · Üst trader oranı (pozisyon) ${f(s.lsTopPosition)}`,
    "Vadeli veri yalnızca analiz girdisidir; işlem spot.",
  ].join("\n");
}
