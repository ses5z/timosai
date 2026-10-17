// SERT LİMİTLER: kodda tavan + config/hardlimits.json yalnızca sıkılaştırır. Hiçbir ayar/pop-up bunları aşamaz.
import fs from "node:fs";
import path from "node:path";

export interface HardLimits {
  maxOrderNotionalUsdt: number;
  maxTotalOpenUsdt: number;
  maxOpenPositions: number;
  maxOrdersPerHour: number;
  dailyLossWarnUsdt: number;
  minBalanceForLiveUsdt: number;
  spotOnly: true;
  requireStop: true;
  allowedPairs: string[];
}

/** Koddaki tavanlar: dosya bunlardan gevşek olamaz. */
export const CEILING = Object.freeze({
  maxOrderNotionalUsdt: 5,
  maxTotalOpenUsdt: 15,
  maxOpenPositions: 3,
  maxOrdersPerHour: 6,
  dailyLossWarnUsdt: 5,
  minBalanceForLiveUsdt: 1,
});

export const CODE_ALLOWED_PAIRS: readonly string[] = Object.freeze([
  "BTC-USDT", "ETH-USDT", "SOL-USDT", "BNB-USDT", "AVAX-USDT", "ADA-USDT", "DOT-USDT",
  "TRX-USDT", "TON-USDT", "NEAR-USDT", "APT-USDT", "SUI-USDT", "XRP-USDT", "LTC-USDT",
  "BCH-USDT", "ARB-USDT", "OP-USDT", "POL-USDT", "LINK-USDT", "UNI-USDT", "AAVE-USDT",
  "LDO-USDT", "FET-USDT", "RENDER-USDT", "WLD-USDT", "DOGE-USDT", "PEPE-USDT", "SHIB-USDT",
]);

const tighten = (fileVal: unknown, ceiling: number, minOk = 0) => {
  const n = Number(fileVal);
  return Number.isFinite(n) && n >= minOk && n <= ceiling ? n : ceiling;
};

export function resolveHardLimits(fileObj: Record<string, unknown> = {}): HardLimits {
  const filePairs = Array.isArray(fileObj.allowedPairs) ? (fileObj.allowedPairs as unknown[]).map(String) : [...CODE_ALLOWED_PAIRS];
  return Object.freeze({
    maxOrderNotionalUsdt: tighten(fileObj.maxOrderNotionalUsdt, CEILING.maxOrderNotionalUsdt),
    maxTotalOpenUsdt: tighten(fileObj.maxTotalOpenUsdt, CEILING.maxTotalOpenUsdt),
    maxOpenPositions: Math.floor(tighten(fileObj.maxOpenPositions, CEILING.maxOpenPositions)),
    maxOrdersPerHour: Math.floor(tighten(fileObj.maxOrdersPerHour, CEILING.maxOrdersPerHour)),
    dailyLossWarnUsdt: tighten(fileObj.dailyLossWarnUsdt, CEILING.dailyLossWarnUsdt),
    // canlı için gereken asgari bakiye yalnızca YÜKSELTİLEBİLİR
    minBalanceForLiveUsdt: Math.max(CEILING.minBalanceForLiveUsdt, Number(fileObj.minBalanceForLiveUsdt) || 0),
    spotOnly: true as const,
    requireStop: true as const,
    allowedPairs: Object.freeze(filePairs.filter((p) => CODE_ALLOWED_PAIRS.includes(p))) as string[],
  });
}

export function loadHardLimits(file = path.resolve(process.cwd(), "config/hardlimits.json")): HardLimits {
  try {
    return resolveHardLimits(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return resolveHardLimits({});
  }
}

// ---- ATK araç izin listesi (kodda, yapılandırılamaz) ----
export const ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  "market_get_ticker",
  "market_get_tickers",
  "market_get_candles",
  "market_get_indicator",
  "market_get_funding_rate",
  "market_get_orderbook",
  "market_get_instruments",
  "news_get_coin_sentiment",
  "news_get_by_coin",
  "smartmoney_get_signal_overview_by_filter",
  "smartmoney_get_signal_trend_by_filter",
  "account_get_balance",
  "account_get_positions",
  "spot_place_order",
  "spot_place_algo_order",
  "spot_cancel_order",
  "spot_cancel_algo_order",
  "spot_get_order",
  "spot_get_orders",
  "spot_get_algo_orders",
  "spot_get_fills",
]);

/** Bu kalıplar izin listesinde olsa bile asla çağrılamaz (savunma derinliği). */
const FORBIDDEN = /(withdraw|transfer|earn|savings|onchain|dcd|bot|grid|dca|event_|swap_|futures_|option_|leverage|set_position_mode|lending)/i;

export class ToolNotAllowedError extends Error {
  constructor(tool: string) {
    super(`ATK aracı izin listesinde değil: ${tool}`);
    this.name = "ToolNotAllowedError";
  }
}

export function assertToolAllowed(tool: string): void {
  if (!ALLOWED_TOOLS.has(tool) || FORBIDDEN.test(tool)) throw new ToolNotAllowedError(tool);
}

export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "spot_place_order",
  "spot_place_algo_order",
  "spot_cancel_order",
  "spot_cancel_algo_order",
]);
