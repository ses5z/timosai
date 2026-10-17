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
import { log } from "./util/log.js";

export async function installExtensions(ctx: AppContext, opts: { fetchImpl?: typeof fetch } = {}): Promise<void> {
  ctx.extras.routes = ctx.extras.routes ?? [];
  const mentor = new MentorService(ctx, opts);
  ctx.extras.mentor = mentor;
  ctx.extras.analyze = async (instId: string) => mentor.analyze(instId);
  ctx.extras.explainPlan = async (plan: any) => mentor.explainPlan(plan);

  const futures = new PaperFutures(ctx);
  ctx.extras.futures = futures;
  const futTimer = setInterval(() => futures.tick(), 10_000);
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
