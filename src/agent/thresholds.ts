import fs from "node:fs";
import path from "node:path";

export interface Thresholds {
  weights: Record<"momentum" | "trend" | "volume" | "rsi" | "volatility" | "funding" | "sentiment", number>;
  openMinOpportunity: number;
  openMaxRisk: number;
  watchMinOpportunity: number;
  stopAtrMult: number;
  minStopPct: number;
  maxStopPct: number;
  targetRR: number;
  rsiOverbought: number;
  rsiOversold: number;
  highVolAtrPct: number;
  fundingCrowdedAbs: number;
  maxSpreadPct: number;
  management: { partialAtR: number; partialFraction: number; trailStartR: number; trailAtrMult: number; timeStopHours: number; timeStopMinR: number };
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  weights: { momentum: 0.22, trend: 0.24, volume: 0.14, rsi: 0.14, volatility: 0.1, funding: 0.08, sentiment: 0.08 },
  openMinOpportunity: 64,
  openMaxRisk: 55,
  watchMinOpportunity: 48,
  stopAtrMult: 1.6,
  minStopPct: 0.8,
  maxStopPct: 6,
  targetRR: 2,
  rsiOverbought: 74,
  rsiOversold: 28,
  highVolAtrPct: 0.9,
  fundingCrowdedAbs: 0.0003,
  maxSpreadPct: 0.25,
  management: { partialAtR: 1, partialFraction: 0.5, trailStartR: 1.5, trailAtrMult: 1, timeStopHours: 6, timeStopMinR: 0.3 },
};

export function loadThresholds(file = path.resolve(process.cwd(), "config/thresholds.json")): Thresholds {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...DEFAULT_THRESHOLDS, ...j, weights: { ...DEFAULT_THRESHOLDS.weights, ...j.weights }, management: { ...DEFAULT_THRESHOLDS.management, ...j.management } };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}
