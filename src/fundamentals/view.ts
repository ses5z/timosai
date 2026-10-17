import type { AppContext } from "../context.js";
import { buildHoldReport, loadUnlocks, type HoldReport } from "./holdReport.js";

export async function holdReportFor(ctx: AppContext, instId: string): Promise<HoldReport> {
  const base = instId.split("-")[0];
  const c = ctx.agent.candidates.get(instId);
  const s = await ctx.fundamentals.supply(base);
  return buildHoldReport(base, s, loadUnlocks(), { volUsdt24h: c?.volUsdt24h ?? 0, risk: c?.risk ?? 50 });
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
