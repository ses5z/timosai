// Mentor, Telegram ve senaryo gibi uzantıları bağlama takar.
import type express from "express";
import type { AppContext } from "./context.js";
import { MentorService } from "./mentor/mentorService.js";
import { Scenario } from "./scenario.js";
import { TelegramBot, candidateChart } from "./telegram/bot.js";
import { AlertEngine } from "./alerts/alertEngine.js";
import { AvalancheProofAnchor, loadDeployment, makeViemWriter } from "./proof/avalancheAnchor.js";
import { NoopProofAnchor } from "./proof/proofAnchor.js";
import { QuickTrader } from "./trading/quick.js";
import { PaperFutures } from "./trading/paperFutures.js";
import { CexService, PAIR_RE } from "./discover/cex.js";
import { DEX_CHAINS, onchainOsStatus, resolveChain, validateAddress } from "./discover/dex.js";
import { buildSecurityTable } from "./security/table.js";
import { LongShortService, lsText } from "./longshort/longShort.js";
import { analyzeCandidate } from "./mentor/analysis.js";
import { holdReportFor } from "./fundamentals/view.js";
import { derivAnalysisFor } from "./derivatives/view.js";
import { log } from "./util/log.js";
import { SetupTracker } from "./mentor/outcomes.js";

export async function installExtensions(ctx: AppContext, opts: { fetchImpl?: typeof fetch } = {}): Promise<void> {
  ctx.extras.routes = ctx.extras.routes ?? [];
  const mentor = new MentorService(ctx, opts);
  ctx.extras.mentor = mentor;
  ctx.extras.analyze = async (instId: string) => mentor.analyze(instId);
  ctx.extras.explainPlan = async (plan: any) => mentor.explainPlan(plan);

  const futures = new PaperFutures(ctx);
  ctx.extras.futures = futures;
  // G3 madde 6: Mentor işlemi kurulumlarının sonucu fiyat güncellemeleriyle izlenir.
  const tracker = new SetupTracker();
  ctx.extras.setupTracker = tracker;
  const futTimer = setInterval(() => {
    futures.tick();
    const px = new Map([...ctx.agent.prices].map(([k, v]) => [k, v.last]));
    for (const t of tracker.update(px)) ctx.store.addEvent("bilgi", `Kurulum sonucu: ${t.instId.split("-")[0]} ${t.direction} → ${t.outcome}${t.r !== null ? ` (${t.r >= 0 ? "+" : ""}${t.r}R)` : ""}.`, t.instId);
  }, 10_000);
  futTimer.unref?.();
  // Ajanın vadeli kararları (yalnızca paper): kalabalık long + düşüş trendinde kısa SİMÜLASYON; short squeeze + yükselişte uzun.
  ctx.agent.onScan(async (cands) => {
    futures.tick();
    const af = ctx.paper.agentFutures;
    if (!af.enabled || ctx.agent.trading.mode !== "PAPER" || !ctx.store.settings.autonomous || ctx.store.settings.paused) return;
    const open = futures.positions.filter((p) => !p.closed);
    if (open.length >= af.maxOpen) return;
    for (const c of cands) {
      if (open.some((p) => p.instId === c.instId) || !c.derivatives?.available) continue;
      const f = c.derivatives.flags;
      const down = c.atrTrend?.dir === -1 && c.direction.endsWith("aşağı");
      const up = c.atrTrend?.dir === 1 && c.direction.endsWith("yukarı");
      let side: "long" | "short" | null = null;
      if (down && (f.includes("long_squeeze") || c.derivatives.crowded === "long")) side = "short";
      else if (up && (f.includes("short_squeeze") || f.includes("shortlar_sikisiyor"))) side = "long";
      if (!side) continue;
      await futures.open({ instId: c.instId, side, leverage: af.leverage, marginUsdt: af.marginUsdt, origin: "ajan", stopPct: af.stopPct, targetPct: af.targetPct });
      ctx.store.addEvent("karar", `Ajan vadeli kararı (paper): ${c.base} ${side} — ${c.derivatives.badge}, ${c.direction}.`, c.instId);
      break;
    }
  });
  // Güvenlik tablosu: mock modda deterministik örnek yanıtlar (ÖRNEK VERİ), canlıda GoPlus + Honeypot.is.
  const secFetch: typeof fetch = ctx.env.atkMode === "mock" ? mockSecurityFetch : opts.fetchImpl ?? fetch;
  const scanTable = async (chain: string, ca: string) => {
    const t = await buildSecurityTable(chain, ca, secFetch);
    ctx.ledger.append("decision", { tur: "guvenlik_tablosu", zincir: t.chainName, adres: ca, karar: t.verdict, ozet: t.summary, gerekce: t.reasons.slice(0, 4) });
    ctx.store.addEvent(t.verdict === "BLOCK" ? "uyarı" : "bilgi", `Güvenlik taraması ${t.chainName} ${ca.slice(0, 10)}… (${t.token?.symbol ?? "?"}): ${t.verdict}. ${t.reasons[0]}`);
    return t;
  };
  ctx.extras.scanTable = scanTable;
  const ls = new LongShortService(ctx, ctx.env.atkMode === "live" ? opts.fetchImpl ?? fetch : null);
  ctx.extras.ls = ls;
  ctx.extras.lsText = lsText;
  const lsAlerted = new Map<string, number>();
  ctx.agent.onScan(async () => {
    await ls.refresh();
    for (const a of ls.categoryAlerts()) {
      const key = `${a.category}:${a.side}`;
      if (Date.now() - (lsAlerted.get(key) ?? 0) < 6 * 3_600_000) continue; // tek bildirim
      lsAlerted.set(key, Date.now());
      const text = `${a.category} kategorisinde üst trader long oranı %${a.pct.toFixed(0)} (${a.side === "high" ? `eşik %${ls.cfg.categoryLongHighPct}` : `eşik %${ls.cfg.categoryLongLowPct}`}): ${a.side === "high" ? "long kalabalık" : "short kalabalık"}. Vadeli veri yalnızca analiz girdisidir.`;
      ctx.store.addEvent("bilgi", `[L/S] ${text}`);
      void bot.notify({ kind: "market", symbol: `KATEGORI:${a.category}`, text });
    }
  });
  const cex = new CexService(ctx);
  ctx.extras.cex = cex;
  const quick = new QuickTrader(ctx);
  ctx.extras.quick = quick;
  const bot = new TelegramBot(ctx, mentor, { token: ctx.env.telegramToken, allowedUserId: ctx.env.telegramAllowedUserId, fetchImpl: opts.fetchImpl });
  ctx.extras.telegram = bot;
  ctx.agent.onDevelopment((d) => {
    const buttons = d.symbol.endsWith("-USDT") ? [{ text: "Analiz", data: `an:${d.symbol}` }, { text: "Takibi bırak", data: `unf:${d.symbol}` }] : undefined;
    void bot.notify({ kind: d.critical ? "critical" : "development", symbol: d.symbol, text: d.text, buttons });
  });
  ctx.warnings.onWarning((w) => {
    if (w.kind === "gunluk_zarar") return; // kritik gelişme mesajı zaten tek mesaj olarak gider
    const first = w.items[0] ? ` (${w.items[0].label}: ${w.items[0].value})` : "";
    void bot.notify({ kind: "warning", text: `Uyarı: ${w.title}. ${w.text}${first}` });
  });
  // Avalanche ProofAnchor: anahtar + dağıtım varsa periyodik özet ve kapanan işlem sonuçları zincire.
  const dep = loadDeployment(ctx.env.avaxNetwork);
  let anchorTimer: NodeJS.Timeout | null = null;
  if (ctx.env.avaxPrivateKey && dep && !opts.fetchImpl) {
    try {
      const anchor = new AvalancheProofAnchor(dep, await makeViemWriter(ctx.env.avaxPrivateKey, ctx.env.avaxNetwork === "mainnet" ? ctx.env.avaxMainnetRpc : ctx.env.avaxFujiRpc, dep));
      ctx.proof = anchor;
      ctx.agent.onDevelopment((d) => {
        if (d.kind === "pozisyon_kapandı" && d.critical && d.symbol.endsWith("-USDT")) {
          const m = d.text.match(/Sonuç ([+-]?\d+(?:\.\d+)?) USDT/);
          if (m) void anchor.outcome(d.symbol, Number(m[1]), ctx.ledger.headHash());
        }
      });
      anchorTimer = setInterval(() => void anchor.anchor(ctx.ledger.headHash(), ctx.ledger.list(["decision", "order", "warning", "plan"], 100000).length), ctx.env.anchorIntervalMin * 60_000);
      setTimeout(() => void anchor.anchor(ctx.ledger.headHash(), ctx.ledger.list(["decision", "order", "warning", "plan"], 100000).length), 90_000);
      log.info(`Avalanche ${dep.network}: DecisionLog ${dep.address}`);
    } catch (e) {
      ctx.proof = new NoopProofAnchor(`Avalanche yazıcısı başlatılamadı: ${(e as Error).message.slice(0, 120)}`);
    }
  } else if (ctx.env.avaxPrivateKey && !dep) {
    ctx.proof = new NoopProofAnchor("Anahtar var ama sözleşme dağıtılmamış: npm run deploy:fuji");
  }

  ctx.extras.startBackground = () => void bot.start();
  ctx.extras.stopBackground = () => {
    bot.stop();
    clearInterval(futTimer);
    if (anchorTimer) clearInterval(anchorTimer);
  };

  const alerts = new AlertEngine(ctx);
  ctx.extras.alerts = alerts;
  ctx.agent.onScan(async (cands) => {
    await alerts.refreshSources();
    for (const a of alerts.evaluate(cands)) {
      ctx.store.addEvent(a.critical ? "uyarı" : "bilgi", `[Bildirim] ${a.text}`, a.symbol.endsWith("-USDT") ? a.symbol : undefined);
      ctx.agent.emitDev({ symbol: a.symbol, kind: "bildirim", text: a.text, critical: a.critical });
    }
  });

  const scenario = new Scenario(ctx);
  ctx.extras.scenario = scenario;

  ctx.extras.routes.push((app: express.Express) => {
    app.post("/api/scenario/start", (_req, res) => {
      if (scenario.running) return res.status(409).json({ error: "Senaryo zaten çalışıyor." });
      void scenario.start();
      res.json({ ok: true });
    });
    // Hızlı komut: QUICK_COMMANDS=false iken bu uç nokta YOKTUR (404).
    app.post("/api/quick", async (req, res, next) => {
      if (!quick.enabled()) return next();
      const text = typeof req.body?.text === "string" ? req.body.text : "";
      res.json(await quick.run(text, "web"));
    });
    app.post("/api/settings/quick", (req, res, next) => {
      if (!quick.enabled()) return next();
      const q = ctx.store.settings.quick;
      const b = req.body ?? {};
      if (typeof b.amountUsdt === "number" && b.amountUsdt > 0) q.amountUsdt = Math.min(b.amountUsdt, ctx.limits.maxOrderNotionalUsdt);
      if (b.stopMode === "atr" || b.stopMode === "pct") q.stopMode = b.stopMode;
      if (typeof b.stopValue === "number" && b.stopValue > 0 && b.stopValue <= 10) q.stopValue = b.stopValue;
      res.json(q);
    });
    // ---------- Keşfet CEX ----------
    app.get("/api/cex/search", async (req, res) => res.json({ results: await cex.search(String(req.query.q ?? "").slice(0, 20)) }));
    app.get("/api/cex/pairs/:base", async (req, res) => {
      const base = String(req.params.base).toUpperCase();
      if (!/^[A-Z0-9]{1,15}$/.test(base)) return res.status(400).json({ error: "geçersiz sembol" });
      res.json({ base, pairs: await cex.pairs(base) });
    });
    app.get("/api/cex/view/:instId", async (req, res) => {
      const id = String(req.params.instId).toUpperCase();
      if (!PAIR_RE.test(id)) return res.status(400).json({ error: "geçersiz parite" });
      const base = id.split("-")[0];
      const pairs = await cex.pairs(base);
      const pair = pairs.find((p) => p.instId === id);
      if (!pair) return res.status(404).json({ error: "Bu parite borsada yok." });
      const cand = await cex.analyze(id);
      const an = cand ? analyzeCandidate(ctx, id, cand) : null;
      const usdtId = `${base}-USDT`;
      const deriv = await derivAnalysisFor(ctx, usdtId).catch(() => null);
      const hold = await holdReportFor(ctx, id, cand).catch(() => null);
      res.json({
        pair,
        pairs,
        candidate: cand,
        analysis: an ? { short: an.short, text: an.text, levels: an.levels, decision: an.decision } : null,
        derivatives: deriv && deriv.available ? deriv : null,
        hold,
        watchlisted: ctx.watchlist.some((w) => w.instId === usdtId),
        followed: ctx.store.follows.includes(usdtId),
        tradeNote: pair.tradable ? "Ajanın işlem izin listesinde (sert limitler geçerli)." : "Analiz için; işlem izin listesinde değil.",
      });
    });

    // ---------- Keşfet DEX ----------
    app.get("/api/dex/chains", (_req, res) => res.json({ chains: Object.entries(DEX_CHAINS).map(([id, c]) => ({ id, name: c.name, kind: c.kind, honeypotIs: Boolean(c.honeypot) })) }));
    app.get("/api/dex/validate", (req, res) => {
      const chain = resolveChain(String(req.query.chain ?? ""));
      if (!chain) return res.status(400).json({ ok: false, error: "Desteklenmeyen zincir." });
      res.json({ chain, ...validateAddress(chain, String(req.query.ca ?? "").trim()) });
    });
    app.get("/api/dex/scan", async (req, res) => {
      const chain = resolveChain(String(req.query.chain ?? ""));
      const ca = String(req.query.ca ?? "").trim();
      if (!chain) return res.status(400).json({ error: "Desteklenmeyen zincir." });
      const v = validateAddress(chain, ca);
      if (!v.ok) return res.status(400).json({ error: v.error });
      try {
        res.json(await scanTable(chain, ca));
      } catch (e) {
        res.status(502).json({ error: (e as Error).message });
      }
    });
    app.get("/api/dex/search", (req, res) => {
      res.json({ query: String(req.query.q ?? ""), results: [], onchainos: onchainOsStatus(), warning: "Aynı isimli sahte tokenlar olabilir; kontrat adresini doğrula." });
    });

    app.get("/api/longshort", async (_req, res) => {
      await ls.refresh();
      res.json(ls.table());
    });
    app.get("/api/paper", (_req, res) => {
      const t = ctx.agent.trading;
      res.json({ mode: t.mode, config: ctx.paper, stats: t.stats(ctx.agent.equityHistory), futures: futures.view(), futuresStats: futures.stats(), quickCommands: quick.enabled() });
    });
    app.post("/api/paper/reset", (_req, res) => {
      if (ctx.agent.trading.mode !== "PAPER") return res.status(409).json({ error: "Yalnızca paper modda sıfırlanabilir." });
      ctx.agent.setTrading(ctx.newPaperClient());
      ctx.agent.equityHistory = [];
      ctx.agent.lossStreak = 0;
      ctx.agent.awaitingNewSetup.clear();
      futures.positions = [];
      ctx.store.addEvent("bilgi", `Paper hesap sıfırlandı: ${ctx.agent.trading.startEquity} USDT sanal bakiye.`);
      ctx.store.bus.publish("positions", ctx.agent.positionsView());
      res.json({ ok: true, balance: ctx.agent.trading.startEquity });
    });
    app.get("/api/quick/sims", (_req, res) => res.json({ enabled: quick.enabled(), sims: quick.simView(), settings: ctx.store.settings.quick }));
    app.get("/api/telegram/chart/:file", (req, res) => {
      const id = req.params.file.replace(/\.png$/, "");
      const c = ctx.agent.candidates.get(id);
      if (!c) return res.status(404).json({ error: "bulunamadı" });
      res.type("image/png").setHeader("Cache-Control", "no-store");
      res.send(candidateChart(c, 640, 360));
    });
    app.get("/api/telegram", (_req, res) => res.json({ status: bot.status(), preview: bot.preview.slice(-20), settings: ctx.store.settings.notifications }));
    app.get("/api/scenario", (_req, res) => res.json({ running: scenario.running, steps: scenario.history() }));
    app.post("/api/mentor/chat", async (req, res) => {
      const text = typeof req.body?.text === "string" ? req.body.text : "";
      const via = req.body?.via === "ses" ? "ses" : "web";
      res.json(await mentor.chat(text, via, { detail: req.body?.detail === true, mode: req.body?.mode === "pro" ? "pro" : "basic" }));
    });
    app.post("/api/mentor/confirm", async (req, res) => {
      const { id, yes } = req.body ?? {};
      if (typeof id !== "string") return res.status(400).json({ error: "geçersiz" });
      res.json(await mentor.confirm(id, yes === true));
    });
    app.get("/api/mentor/history", (_req, res) => res.json({ history: mentor.history(), status: mentor.status(), pending: [...ctx.store.pending.values()].map((p) => ({ id: p.id, summary: p.summary })) }));
    app.get("/api/mentor/analysis/:instId", (req, res) => {
      const a = mentor.analyze(req.params.instId);
      if (!a) return res.status(404).json({ error: "bulunamadı" });
      res.json(a);
    });
  });
}

/** Mock mod için güvenlik kaynakları (ÖRNEK VERİ): adresi "dead" ile biten token honeypot. */
const mockSecurityFetch = (async (url: string) => {
  const u = new URL(url);
  const addr = (u.searchParams.get("contract_addresses") ?? u.searchParams.get("address") ?? "").toLowerCase();
  const hp = addr.endsWith("dead");
  if (u.hostname.includes("gopluslabs")) {
    return new Response(JSON.stringify({ code: 1, result: { [addr]: { token_name: "Örnek token", token_symbol: "ORN", is_open_source: "1", is_honeypot: hp ? "1" : "0", buy_tax: hp ? "0.05" : "0", sell_tax: hp ? "1" : "0", is_proxy: "0", is_mintable: hp ? "1" : "0", slippage_modifiable: hp ? "1" : "0", is_blacklisted: "0", transfer_pausable: "0", hidden_owner: "0", owner_change_balance: hp ? "1" : "0", holder_count: hp ? "42" : "12000", holders: [{ percent: "0.3", is_contract: 1 }], lp_holders: [{ is_locked: hp ? 0 : 1, percent: "0.95" }] } } }), { status: 200 });
  }
  if (u.hostname.includes("honeypot")) {
    return new Response(JSON.stringify({ token: { name: "Örnek token", symbol: "ORN", totalHolders: hp ? 42 : 12000 }, simulationSuccess: true, honeypotResult: { isHoneypot: hp }, simulationResult: { buyTax: hp ? 5 : 0, sellTax: hp ? 100 : 0 }, contractCode: { openSource: true, isProxy: false }, pair: { liquidity: 25000 } }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
}) as unknown as typeof fetch;
