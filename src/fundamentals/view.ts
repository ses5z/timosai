import type { AppContext } from "../context.js";
import { buildHoldReport, loadUnlocks, type HoldReport } from "./holdReport.js";

export async function holdReportFor(ctx: AppContext, instId: string, override?: import("../ports.js").Candidate | null): Promise<HoldReport> {
  const base = instId.split("-")[0];
  const c = override ?? ctx.agent.candidates.get(instId) ?? ctx.agent.candidates.get(`${base}-USDT`);
  const s = await ctx.fundamentals.supply(base);
  return buildHoldReport(base, s, loadUnlocks(), { volumeScore: c ? c.parts.volume : null, risk: c?.risk ?? 50, lowVolumeScore: ctx.thresholds.lowVolumeScore });
}

export function holdText(r: HoldReport): string {
  const m = r.metrics;
  const f = (v: number | null, d = 2) => (v === null ? "-" : v.toFixed(d));
  return [
    `${r.base} hold raporu: ${r.verdict}.`,
    ...r.reasons.map((x) => `- ${x}`),
    `Dolaşım oranı ${m.circulatingRatio === null ? "-" : "%" + (m.circulatingRatio * 100).toFixed(0)} · FDV/piyasa değeri ${f(m.fdvToMc)} · 90 gün kilit açılımı %${m.unlock90dPct.toFixed(1)} (ÖRNEK VERİ)`,
    `Cüzdan dağılımı: ${r.distribution.status}. Kaynak: ${r.supply?.source ?? "veri yok"}.`,
  ].join("\n");
}
