// Uygulama bağlamı: portları ortama göre seçer ve birbirine bağlar.
import fs from "node:fs";
import path from "node:path";
import { AtkMcpClient, type AtkCaller } from "./atk/mcpClient.js";
import { Agent, type WatchPair } from "./agent/agent.js";
import { RuleDecisionProvider } from "./agent/decisionProvider.js";
import { loadThresholds, type Thresholds } from "./agent/thresholds.js";
import { hasOkxKeys, missingEnvLines, secretValues, type AppEnv } from "./config/env.js";
import { loadContract, type ContractRules } from "./contract/contract.js";
import { WarningCenter } from "./contract/warnings.js";
import { SignalLedger } from "./ledger/signalLedger.js";
import { AtkMarketData } from "./market/atkMarketData.js";
import { MockMarketData } from "./market/mockMarketData.js";
import { ResilientMarketData } from "./market/resilientMarketData.js";
import type { MarketData, ProofAnchor } from "./ports.js";
import { NoopProofAnchor } from "./proof/proofAnchor.js";
import { Store } from "./state/store.js";
import { loadHardLimits, type HardLimits } from "./trading/hardLimits.js";
import { AtkTradingClient, MockTradingClient, type TradingClient } from "./trading/tradingClient.js";
import { log, registerSecrets } from "./util/log.js";

export interface AppContext {
  env: AppEnv;
  store: Store;
  ledger: SignalLedger;
  warnings: WarningCenter;
  limits: HardLimits;
  thresholds: Thresholds;
  contract: ContractRules;
  watchlist: WatchPair[];
  market: MarketData;
  mock: MockMarketData;
  atk: AtkCaller | null;
  agent: Agent;
  proof: ProofAnchor;
  missingEnv: string[];
  extras: Record<string, any>;
}

export function loadWatchlist(file = path.resolve(process.cwd(), "config/watchlist.json")): WatchPair[] {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    return (j.pairs as WatchPair[]).filter((p) => p.instId.endsWith("-USDT"));
  } catch {
    return [{ instId: "BTC-USDT", category: "Katman 1" }, { instId: "ETH-USDT", category: "Katman 1" }, { instId: "SOL-USDT", category: "Katman 1" }];
  }
}

export interface ContextOptions {
  market?: MarketData;
  atk?: AtkCaller | null;
  trading?: TradingClient;
}

export function createContext(env: AppEnv, opts: ContextOptions = {}): AppContext {
  registerSecrets(secretValues(env));
  const store = new Store();
  store.settings.autonomous = env.autonomous;
  const ledger = new SignalLedger();
  const warnings = new WarningCenter();
  const limits = loadHardLimits();
  const thresholds = loadThresholds();
  const contract = loadContract();
  const watchlist = loadWatchlist();
  const mock = opts.market instanceof MockMarketData ? opts.market : new MockMarketData();

  let atk: AtkCaller | null = opts.atk ?? null;
  if (opts.atk === undefined && env.atkMode === "live") {
    atk = new AtkMcpClient(
      {
        site: env.okxSite,
        // Kuru modda ATK sunucusu salt okuma bayrağıyla açılır: emir aracı hiç yüklenmez.
        readOnly: !env.live,
        credentials: hasOkxKeys(env) ? env.okx : undefined,
      },
      ledger,
    );
  }
  const market: MarketData = opts.market ?? (atk ? new ResilientMarketData(new AtkMarketData(atk), mock) : mock);

  const trading: TradingClient = opts.trading ?? new MockTradingClient(limits, ledger, env.paperBalanceUsdt);
  const agent = new Agent({
    market,
    trading,
    decision: new RuleDecisionProvider(thresholds),
    ledger,
    store,
    warnings,
    limits,
    thresholds,
    contract,
    watchlist,
    scanIntervalSec: env.scanIntervalSec,
  });

  warnings.onWarning((w) => {
    store.addEvent("uyarı", `${w.title}: ${w.text}`);
    ledger.append("warning", { tur: w.kind, baslik: w.title, maddeler: w.items, riskSkoru: w.riskScore });
    store.bus.publish("warning", w);
  });

  return { env, store, ledger, warnings, limits, thresholds, contract, watchlist, market, mock, atk, agent, proof: new NoopProofAnchor(), missingEnv: missingEnvLines(env), extras: {} };
}

/** LIVE=true ise ve koşullar uygunsa gerçek işlem istemcisine geçer; değilse KURU kalır. */
export async function maybeEnableLiveTrading(ctx: AppContext): Promise<void> {
  const { env } = ctx;
  if (!env.live) {
    ctx.store.addEvent("bilgi", "KURU ÇALIŞMA: emirler ATK'ya gitmez, canlı fiyatla simüle edilir.");
    return;
  }
  if (!ctx.atk || !hasOkxKeys(env)) {
    ctx.store.addEvent("uyarı", "LIVE=true ama OKX API anahtarları eksik; KURU ÇALIŞMA sürüyor.");
    return;
  }
  const live = new AtkTradingClient(ctx.limits, ctx.ledger, ctx.atk, 0);
  try {
    const bal = await live.refreshBalance(true);
    if (bal < ctx.limits.minBalanceForLiveUsdt) {
      ctx.store.addEvent("uyarı", `Bakiye ${bal.toFixed(2)} USDT; gerçek emir için en az ${ctx.limits.minBalanceForLiveUsdt} USDT gerekli. KURU ÇALIŞMA sürüyor.`);
      return;
    }
    ctx.agent.setTrading(live);
    ctx.store.addEvent("uyarı", `GERÇEK İŞLEM AÇIK: bakiye ${bal.toFixed(2)} USDT. Sert limitler: tek emir ≤ ${ctx.limits.maxOrderNotionalUsdt} USDT.`);
    log.warn("GERÇEK İŞLEM modu etkin.");
  } catch (e) {
    ctx.store.addEvent("uyarı", `Bakiye okunamadı (${(e as Error).message}); KURU ÇALIŞMA sürüyor.`);
  }
}
