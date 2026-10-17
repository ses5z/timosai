// Davranış sözleşmesi: uyarır, KİLİTLEMEZ. Ajan sözleşmeye aykırı kararı göndermez; kimse dondurulmaz.
import fs from "node:fs";
import path from "node:path";
import type { Candidate } from "../ports.js";
import type { SizeResult } from "../agent/sizing.js";
import { clamp, round } from "../util/math.js";

export interface ContractRules {
  riskPerTradePct: number;
  minRR: number;
  maxStopPct: number;
  maxRiskScoreForEntry: number;
  maxSpreadPct: number;
  nearLimitRatio: number;
  softWatchlistWarnAt: number;
  riskScoreWarnAt: number;
}

export const DEFAULT_CONTRACT: ContractRules = {
  riskPerTradePct: 2,
  minRR: 1.5,
  maxStopPct: 6,
  maxRiskScoreForEntry: 70,
  maxSpreadPct: 0.25,
  nearLimitRatio: 0.8,
  softWatchlistWarnAt: 15,
  riskScoreWarnAt: 70,
};

export function loadContract(file = path.resolve(process.cwd(), "config/contract.json")): ContractRules {
  try {
    return { ...DEFAULT_CONTRACT, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return DEFAULT_CONTRACT;
  }
}

export interface ContractItem {
  label: string;
  value: string;
  limit: string;
}

/** Ajanın bir giriş kararını sözleşmeye göre denetler. Boş dizi = uygun. */
export function checkAgentEntry(
  c: Candidate,
  size: SizeResult,
  ctx: { riskScore: number; equityUsdt: number; riskPct: number; rules: ContractRules },
): ContractItem[] {
  const r = ctx.rules;
  const out: ContractItem[] = [];
  if (c.rr < r.minRR) out.push({ label: "Ödül/risk oranı (R:R) düşük", value: c.rr.toFixed(2), limit: `en az ${r.minRR}` });
  const stopPct = ((c.entry - c.stop) / c.entry) * 100;
  if (stopPct > r.maxStopPct) out.push({ label: "Stop çok uzak", value: `%${stopPct.toFixed(2)}`, limit: `en fazla %${r.maxStopPct}` });
  const maxRisk = (ctx.equityUsdt * Math.min(ctx.riskPct, r.riskPerTradePct)) / 100;
  if (size.riskUsdt > maxRisk * 1.05) out.push({ label: "İşlem riski bütçeyi aşıyor", value: `${size.riskUsdt.toFixed(3)} USDT`, limit: `en fazla ${maxRisk.toFixed(3)} USDT` });
  if (ctx.riskScore >= r.maxRiskScoreForEntry) out.push({ label: "Risk skoru yüksek", value: String(Math.round(ctx.riskScore)), limit: `girişte en fazla ${r.maxRiskScoreForEntry}` });
  if (c.security.spreadPct !== null && c.security.spreadPct > r.maxSpreadPct) out.push({ label: "Alış-satış makası geniş", value: `%${c.security.spreadPct.toFixed(3)}`, limit: `en fazla %${r.maxSpreadPct}` });
  if (c.risk > 75) out.push({ label: "Coin risk puanı çok yüksek", value: String(c.risk), limit: "en fazla 75" });
  return out;
}

export interface RiskCtx {
  dailyPnl: number;
  dailyLossWarnUsdt: number;
  openNotional: number;
  maxTotalOpen: number;
  ordersLastHour: number;
  maxOrdersPerHour: number;
  openCount: number;
  maxOpen: number;
  blockedLastHour: number;
  lossStreak: number;
}

export interface RiskScore {
  score: number;
  parts: { label: string; value: number }[];
  level: "güvenli" | "dikkat" | "riskli";
}

/** Risk skoru 0-100: günlük zarar, maruziyet, emir temposu, engellenen kararlar, art arda kayıp. */
export function computeRiskScore(c: RiskCtx): RiskScore {
  const loss = c.dailyPnl < 0 ? clamp((-c.dailyPnl / c.dailyLossWarnUsdt) * 35, 0, 45) : 0;
  const exposure = clamp((c.openNotional / c.maxTotalOpen) * 20, 0, 20);
  const pace = clamp((c.ordersLastHour / c.maxOrdersPerHour) * 15, 0, 15);
  const slots = clamp((c.openCount / c.maxOpen) * 5, 0, 5);
  const blocked = clamp(c.blockedLastHour * 4, 0, 10);
  const streak = clamp(c.lossStreak * 4, 0, 12);
  const score = Math.round(clamp(loss + exposure + pace + slots + blocked + streak, 0, 100));
  return {
    score,
    parts: [
      { label: "Günlük zarar", value: round(loss, 1) },
      { label: "Açık maruziyet", value: round(exposure, 1) },
      { label: "Emir temposu", value: round(pace, 1) },
      { label: "Pozisyon yuvası", value: round(slots, 1) },
      { label: "Engellenen kararlar", value: round(blocked, 1) },
      { label: "Art arda kayıp", value: round(streak, 1) },
    ],
    level: score >= 70 ? "riskli" : score >= 40 ? "dikkat" : "güvenli",
  };
}
