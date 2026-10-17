import { SignalLedger } from "../../src/ledger/signalLedger.js";
import { resolveHardLimits } from "../../src/trading/hardLimits.js";
import { MockTradingClient, type EntryRequest } from "../../src/trading/tradingClient.js";
import { loadEnv } from "../../src/config/env.js";
import { createContext } from "../../src/context.js";
import { MockMarketData } from "../../src/market/mockMarketData.js";
import { setQuiet } from "../../src/util/log.js";

setQuiet(true);

export function mkTrading(balance = 30) {
  const ledger = new SignalLedger();
  const limits = resolveHardLimits({});
  return { ledger, limits, t: new MockTradingClient(limits, ledger, balance) };
}

export function req(over: Partial<EntryRequest> = {}): EntryRequest {
  return { instId: "SOL-USDT", notionalUsdt: 4, entryPx: 100, stopPx: 98, targetPx: 104, atr: 0.5, reason: "test", origin: "ajan", ...over };
}

export function mkCtx(envOver: Record<string, string> = {}) {
  const env = loadEnv({ file: "/nonexistent/.env", source: { ATK_MODE: "mock", PAPER_BALANCE_USDT: "30", ...envOver } });
  const market = new MockMarketData(1_790_000_000_000);
  return createContext(env, { market, atk: null });
}
