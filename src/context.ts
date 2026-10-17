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
import { LiveDerivativesData, MockDerivativesData, type DerivativesData } from "./derivatives/derivativesData.js";
import { loadDerivConfig, type DerivConfig } from "./derivatives/rules.js";
import { CoinGeckoFundamentals, MockFundamentals, type FundamentalsData } from "./fundamentals/holdReport.js";
import { GoPlusSecurity, MockTokenSecurity, OnchainOsSecurity, ScamScanner } from "./security/tokenSecurity.js";
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
  derivatives: DerivativesData;
  derivConfig: DerivConfig;
  fundamentals: FundamentalsData;
  scanner: ScamScanner;
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
    return [{ instId: "BTC-USDT", category: "Layer 1" }, { instId: "ETH-USDT", category: "Layer 1" }, { instId: "SOL-USDT", category: "Layer 1" }];
  }
}

export interface ContextOptions {
  market?: MarketData;
  atk?: AtkCaller | null;
  derivatives?: DerivativesData;
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
        // Paper modda ATK sunucusu salt okuma bayrağıyla açılır: emir aracı hiç yüklenmez.
        readOnly: !env.live,
        credentials: hasOkxKeys(env) ? env.okx : undefined,
      },
      ledger,
    );
  }
  const market: MarketData = opts.market ?? (atk ? new ResilientMarketData(new AtkMarketData(atk), mock) : mock);

  const derivConfig = loadDerivConfig();
  const derivatives: DerivativesData = opts.derivatives ?? (atk ? new LiveDerivativesData(atk) : new MockDerivativesData());
  const trading: TradingClient = opts.trading ?? new MockTradingClient(limits, ledger, env.paperBalanceUsdt);
  const agent = new Agent({
    market,
    trading,
    decision: new RuleDecisionProvider(thresholds, derivConfig),
    ledger,
    store,
    warnings,
    limits,
    thresholds,
    contract,
    watchlist,
    scanIntervalSec: env.scanIntervalSec,
    derivatives,
    derivRefreshPerScan: derivConfig.refreshPerScan,
    derivCacheMs: derivConfig.cacheMinutes * 60_000,
  });

  warnings.onWarning((w) => {
    store.addEvent("uyarı", `${w.title}: ${w.text}`);
    ledger.append("warning", { tur: w.kind, baslik: w.title, maddeler: w.items, riskSkoru: w.riskScore });
    store.bus.publish("warning", w);
  });

  return { env, store, ledger, warnings, limits, thresholds, contract, watchlist, market, mock, derivatives, derivConfig, fundamentals: env.atkMode === "live" ? new CoinGeckoFundamentals() : new MockFundamentals(), scanner: new ScamScanner(env.atkMode === "live" ? [new GoPlusSecurity(), new OnchainOsSecurity()] : [new MockTokenSecurity()]), atk, agent, proof: new NoopProofAnchor(), missingEnv: missingEnvLines(env), extras: {} };
}

/** LIVE=true ise ve koşullar uygunsa canlı işlem istemcisine geçer; değilse PAPER kalır. */
export async function maybeEnableLiveTrading(ctx: AppContext): Promise<void> {
  const { env } = ctx;
  if (!env.live) {
    ctx.store.addEvent("bilgi", "Paper trade: emirler ATK'ya gitmez, canlı fiyatla simüle edilir.");
    return;
  }
  if (!ctx.atk || !hasOkxKeys(env)) {
    ctx.store.addEvent("uyarı", "LIVE=true ama OKX API anahtarları eksik; Paper trade sürüyor.");
    return;
  }
  const live = new AtkTradingClient(ctx.limits, ctx.ledger, ctx.atk, 0);
  try {
    const bal = await live.refreshBalance(true);
    if (bal < ctx.limits.minBalanceForLiveUsdt) {
      ctx.store.addEvent("uyarı", `Bakiye ${bal.toFixed(2)} USDT; gerçek emir için en az ${ctx.limits.minBalanceForLiveUsdt} USDT gerekli. Paper trade sürüyor.`);
      return;
    }
    ctx.agent.setTrading(live);
    ctx.store.addEvent("uyarı", `CANLI İŞLEM AÇIK: bakiye ${bal.toFixed(2)} USDT. Sert limitler: tek emir ≤ ${ctx.limits.maxOrderNotionalUsdt} USDT.`);
    log.warn("CANLI İŞLEM modu etkin.");
  } catch (e) {
    ctx.store.addEvent("uyarı", `Bakiye okunamadı (${(e as Error).message}); Paper trade sürüyor.`);
  }
}
