// Express uygulaması: JSON API + SSE + statik sayfalar. KULLANICI EMİR UÇ NOKTASI YOKTUR.
import express, { type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { slim } from "./agent/agent.js";
import { buildPlan, sizePosition } from "./agent/sizing.js";
import type { AppContext } from "./context.js";
import { round } from "./util/math.js";
import { mask } from "./util/log.js";

const PAGES: Record<string, string> = {
  "/": "index.html",
  "/kesfet": "kesfet.html",
  "/mentor": "mentor.html",
  "/telegram": "telegram.html",
  "/isi-haritasi": "isi-haritasi.html",
  "/hakkimizda": "hakkimizda.html",
  "/panel": "panel.html",
};

export function validInstId(s: unknown): s is string {
  return typeof s === "string" && /^[A-Z0-9]{2,12}-USDT$/.test(s);
}

export function createApp(ctx: AppContext) {
  const app = express();
  const { store, agent, ledger, warnings, limits } = ctx;
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });

  const publicDir = path.resolve(process.cwd(), "public");
  for (const [route, file] of Object.entries(PAGES)) app.get(route, (_req, res) => res.sendFile(path.join(publicDir, file)));
  app.use(express.static(publicDir, { index: false, maxAge: 0 }));

  const json = (res: Response, data: unknown) => res.type("application/json").send(mask(JSON.stringify(data)));

  // ---------- Durum ----------
  app.get("/api/status", (_req, res) => {
    const mentor = ctx.extras.mentor?.status?.() ?? { active: "kural tabanlı", provider: "rule", ai: false };
    json(res, {
      agent: agent.status(),
      dry: agent.trading.mode === "KURU",
      tradingMode: agent.trading.mode,
      atkMode: ctx.env.atkMode,
      atkConnected: ctx.atk?.available() ?? false,
      publicData: ctx.derivatives.stats(),
      liveData: ctx.market.isLive(),
      mentor,
      telegram: ctx.extras.telegram?.status?.() ?? { enabled: false, connected: false },
      missingEnv: ctx.missingEnv,
      envFileFound: ctx.env.envFileFound,
      riskScore: agent.riskScore(),
      limits,
      followsCount: store.follows.length,
      quickCommands: ctx.env.quickCommands,
      disclaimer: "Gerçek piyasa verisi, sınırlı bakiye, yatırım tavsiyesi değildir.",
    });
  });

  // ---------- Adaylar / keşfet ----------
  app.get("/api/candidates", (_req, res) => json(res, agent.queue().map((c) => ({ ...c, followed: store.follows.includes(c.instId) }))));

  app.get("/api/queue", (_req, res) => {
    // Kuyruk: önce aç/izle, 15'e tamamlanana kadar en iyi "ele"ler; en fazla 20 aday.
    const open = agent.queue().filter((c) => !store.passed.has(c.instId) && !store.follows.includes(c.instId));
    const good = open.filter((c) => c.decision !== "ele");
    const rest = open.filter((c) => c.decision === "ele");
    const q = [...good, ...rest.slice(0, Math.max(0, 15 - good.length))].slice(0, 20);
    json(res, { queue: q, follows: store.follows, canUndo: store.swipeHistory.length > 0, total: agent.candidates.size });
  });

  app.post("/api/swipe", async (req: Request, res: Response) => {
    const { instId, action } = req.body ?? {};
    if (!validInstId(instId) || !["like", "pass"].includes(action)) return res.status(400).json({ error: "geçersiz istek" });
    store.swipe(instId, action);
    let softWarning = null;
    let analysis = null;
    if (action === "like") {
      const r = store.follow(instId);
      softWarning = followWarning(ctx, r.count);
      analysis = ctx.extras.analyze ? await ctx.extras.analyze(instId) : null;
    }
    json(res, { ok: true, follows: store.follows, softWarning, analysis });
  });

  app.post("/api/swipe/undo", (_req, res) => {
    const last = store.undoSwipe();
    json(res, { ok: Boolean(last), last, follows: store.follows });
  });

  app.post("/api/queue/reset", (_req, res) => {
    store.resetQueue();
    json(res, { ok: true });
  });

  app.get("/api/follows", (_req, res) => {
    json(res, {
      follows: store.follows.map((id) => {
        const c = agent.candidates.get(id);
        return c ? slim(c) : { instId: id, base: id.split("-")[0] };
      }),
    });
  });

  app.post("/api/follows", (req, res) => {
    const { instId } = req.body ?? {};
    if (!validInstId(instId)) return res.status(400).json({ error: "geçersiz sembol" });
    const r = store.follow(instId);
    json(res, { ok: true, follows: store.follows, softWarning: followWarning(ctx, r.count) });
  });

  app.delete("/api/follows/:instId", (req, res) => {
    const id = req.params.instId;
    if (!validInstId(id)) return res.status(400).json({ error: "geçersiz sembol" });
    store.unfollow(id);
    json(res, { ok: true, follows: store.follows });
  });

  app.post("/api/priority", (req, res) => {
    const { instId } = req.body ?? {};
    if (!validInstId(instId)) return res.status(400).json({ error: "geçersiz sembol" });
    store.addPriority(instId);
    store.addEvent("bilgi", `${instId.split("-")[0]} ajanın tarama sırasında öne alındı (emir değildir).`, instId);
    json(res, { ok: true, priority: store.priority });
  });

  app.get("/api/coin/:instId", async (req, res) => {
    const id = req.params.instId;
    if (!validInstId(id)) return res.status(400).json({ error: "geçersiz sembol" });
    const c = agent.candidates.get(id);
    if (!c) return res.status(404).json({ error: "bu coin henüz taranmadı" });
    const pos = agent.positionsView().find((p) => p.instId === id) ?? null;
    const size = sizePosition({ equityUsdt: agent.trading.equity(), riskPct: store.settings.riskPct, entry: c.entry, stop: c.stop, openNotionalUsdt: agent.trading.openNotional(), limits });
    json(res, { candidate: c, position: pos, size, followed: store.follows.includes(id), prioritized: store.priority.includes(id) });
  });

  app.get("/api/derivatives/:instId", async (req, res) => {
    const id = req.params.instId;
    if (!validInstId(id)) return res.status(400).json({ error: "geçersiz sembol" });
    const { derivAnalysisFor } = await import("./derivatives/view.js");
    const a = await derivAnalysisFor(ctx, id);
    if (!a) return res.status(404).json({ error: "vadeli veri yok" });
    json(res, { ...a, source: { atk: "funding, OI, OI geçmişi (ATK)", public: `L/S ve taker hacmi: ${a.snapshot.publicSource ? a.snapshot.publicSource + " vadeli verisi (ATK dışı)" : "veri yok"}` }, stats: ctx.derivatives.stats() });
  });

  // Grafik verisi: mumlar ATK'den (bizim verimiz), giriş/stop/hedef, ajanın al/sat işaretleri, ATR trend çizgisi.
  const candleCache = new Map<string, { at: number; v: any[] }>();
  app.get("/api/candles/:instId", async (req, res) => {
    const id = req.params.instId;
    const bar = ["15m", "1H", "4H"].includes(String(req.query.bar)) ? String(req.query.bar) : "15m";
    if (!validInstId(id)) return res.status(400).json({ error: "geçersiz sembol" });
    let candles: any[] | undefined = bar === "15m" ? agent.lastCandles.get(id) : undefined;
    const key = `${id}:${bar}`;
    if (!candles) {
      const c = candleCache.get(key);
      if (c && Date.now() - c.at < 60_000) candles = c.v;
      else {
        try {
          candles = await ctx.market.candles(id, bar, 150);
          candleCache.set(key, { at: Date.now(), v: candles });
        } catch {
          return res.status(502).json({ error: "mum verisi yok" });
        }
      }
    }
    const { atrTrend, loadAtrTrendConfig } = await import("./indicators/atrTrend.js");
    const cfg = loadAtrTrendConfig();
    const at = atrTrend(candles as any, cfg.period, cfg.mult);
    const sec = (ms: number) => Math.floor(ms / 1000);
    const barMs = bar === "15m" ? 900_000 : bar === "1H" ? 3_600_000 : 14_400_000;
    const cand = agent.candidates.get(id);
    const markers = agent.trading
      .listTrades(200)
      .filter((t) => t.instId === id)
      .map((t) => ({ time: sec(Math.floor(t.ts / barMs) * barMs), position: t.side === "buy" ? "belowBar" : "aboveBar", color: t.side === "buy" ? "#62c98f" : "#f06a66", shape: t.side === "buy" ? "arrowUp" : "arrowDown", text: `${t.side === "buy" ? "AL" : "SAT"}${t.origin === "hızlı" ? " (hızlı)" : ""}` }))
      .filter((m) => m.time >= sec(candles![0].ts))
      .sort((a, b) => a.time - b.time);
    json(res, {
      bar,
      candles: candles.map((c: any) => ({ time: sec(c.ts), open: c.open, high: c.high, low: c.low, close: c.close, vol: c.vol })),
      atrTrend: at.map((p, i) => ({ time: sec(candles![i].ts), value: p.line, dir: p.dir })),
      markers,
      levels: cand ? { entry: cand.entry, stop: cand.stop, target: cand.target } : null,
      position: agent.positionsView().find((p) => p.instId === id) ?? null,
      live: ctx.market.isLive(),
    });
  });

  app.get("/api/hold/:instId", async (req, res) => {
    const id = req.params.instId;
    if (!validInstId(id)) return res.status(400).json({ error: "geçersiz sembol" });
    const { holdReportFor } = await import("./fundamentals/view.js");
    json(res, await holdReportFor(ctx, id));
  });

  app.post("/api/scan", async (req, res) => {
    const { chain, address } = req.body ?? {};
    if (typeof chain !== "string" || typeof address !== "string") return res.status(400).json({ error: "zincir ve adres gerekli" });
    try {
      const { scanToken } = await import("./security/view.js");
      json(res, await scanToken(ctx, chain, address.trim()));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });
  app.get("/api/demo-tokens", (_req, res) => {
    try {
      res.json(JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "config/demo-tokens.json"), "utf8")));
    } catch {
      res.json({ tokens: [], honeypot: null });
    }
  });

  // ---------- Plan (tercih listesi; emir değildir) ----------
  app.post("/api/plan", async (req, res) => {
    const ids: string[] = Array.isArray(req.body?.symbols) ? req.body.symbols.filter(validInstId) : store.follows;
    const plan = makePlan(ctx, ids);
    const explanation = ctx.extras.explainPlan ? await ctx.extras.explainPlan(plan) : null;
    json(res, { plan, explanation });
  });

  app.post("/api/plan/apply", (req, res) => {
    const ids: string[] = Array.isArray(req.body?.symbols) ? req.body.symbols.filter(validInstId) : [];
    store.planPreference = ids.slice(0, 10);
    ledger.append("plan", { tercih: store.planPreference });
    store.addEvent("bilgi", `Plan ajana tercih olarak iletildi: ${ids.map((i) => i.split("-")[0]).join(", ") || "boş"}. Emirleri ajan kendi kararıyla verir.`);
    json(res, { ok: true, planPreference: store.planPreference });
  });

  // ---------- Portföy / panel ----------
  app.get("/api/portfolio", (_req, res) => {
    const t = agent.trading;
    json(res, {
      mode: t.mode,
      equity: round(t.equity(), 4),
      cash: round(t.cashUsdt(), 4),
      startEquity: t.startEquity,
      openNotional: round(t.openNotional(), 2),
      dailyPnl: round(t.dailyPnl(), 4),
      unrealized: round(t.unrealizedPnl(), 4),
      positions: agent.positionsView(),
      trades: t.listTrades(60),
      equityHistory: agent.equityHistory,
      riskPct: store.settings.riskPct,
      riskBudgetUsdt: round((t.equity() * store.settings.riskPct) / 100, 3),
    });
  });

  app.get("/api/contract", (_req, res) => {
    const t = agent.trading;
    json(res, {
      riskScore: agent.riskScore(),
      sizeMultiplier: agent.sizeMultiplier(),
      lossStreak: agent.lossStreak,
      halveAfterLosses: store.settings.halveAfterLosses,
      breaker: agent.breaker,
      warningsTotal: warnings.total(),
      blockedByAgent: agent.totalBlocked,
      warnings: warnings.list(20),
      bars: [
        { label: "Toplam açık", value: round(t.openNotional(), 2), max: limits.maxTotalOpenUsdt, unit: "USDT" },
        { label: "Açık pozisyon", value: t.listPositions().length, max: limits.maxOpenPositions, unit: "" },
        { label: "Son 1 saat emir", value: t.ordersLastHour(), max: limits.maxOrdersPerHour, unit: "" },
        { label: "Günlük zarar", value: round(Math.max(0, -t.dailyPnl()), 2), max: limits.dailyLossWarnUsdt, unit: "USDT", warnOnly: true },
      ],
      rules: ctx.contract,
      limits,
    });
  });

  app.get("/api/events", (_req, res) => json(res, store.events.slice(-120).reverse()));
  app.get("/api/atk", (_req, res) => json(res, { ...ledger.atkStats(), connected: ctx.atk?.available() ?? false, tools: ctx.atk?.toolNames() ?? [] }));
  app.get("/api/ledger", async (_req, res) =>
    json(res, { head: ledger.headHash(), count: ledger.count(), valid: ledger.verify(), entries: ledger.list(["decision", "order", "warning", "plan", "position"], 60), anchor: ctx.proof.status() }),
  );

  // ---------- Ajan ayarları (kullanıcı yalnızca ayar yapar, emir veremez) ----------
  app.post("/api/agent", (req, res) => {
    const { autonomous, paused } = req.body ?? {};
    if (typeof autonomous === "boolean") {
      store.settings.autonomous = autonomous;
      store.addEvent("bilgi", `Otonom mod ${autonomous ? "açıldı" : "kapatıldı"}.`);
    }
    if (typeof paused === "boolean") {
      store.settings.paused = paused;
      store.addEvent("bilgi", paused ? "Ajan kullanıcı tarafından duraklatıldı (açık pozisyonlar yönetilmeye devam eder)." : "Ajan yeniden çalışıyor.");
    }
    store.bus.publish("agent", agent.status());
    json(res, agent.status());
  });

  app.post("/api/agent/resume", (_req, res) => {
    agent.resumeBreaker();
    json(res, agent.status());
  });

  app.post("/api/settings/halve", (req, res) => {
    if (typeof req.body?.on === "boolean") store.settings.halveAfterLosses = req.body.on;
    json(res, { halveAfterLosses: store.settings.halveAfterLosses });
  });

  app.post("/api/agent/scan", async (_req, res) => {
    await agent.scanOnce();
    json(res, agent.status());
  });

  app.post("/api/settings/risk", (req, res) => {
    const v = Number(req.body?.riskPct);
    if (!Number.isFinite(v) || v < 0.25 || v > ctx.contract.riskPerTradePct) return res.status(400).json({ error: `risk %0.25 ile %${ctx.contract.riskPerTradePct} arasında olmalı` });
    store.settings.riskPct = round(v, 2);
    store.addEvent("bilgi", `İşlem başı risk bütçesi %${store.settings.riskPct} olarak ayarlandı.`);
    json(res, { riskPct: store.settings.riskPct });
  });

  app.post("/api/settings/notifications", (req, res) => {
    const n = store.settings.notifications;
    const b = req.body ?? {};
    for (const k of ["developments", "critical", "opportunitySummary"] as const) if (typeof b[k] === "boolean") n[k] = b[k];
    if (typeof b.quietMinutes === "number") n.quietUntil = b.quietMinutes > 0 ? Date.now() + Math.min(b.quietMinutes, 24 * 60) * 60_000 : 0;
    json(res, n);
  });
  app.get("/api/settings", (_req, res) => json(res, store.settings));

  // ---------- Uzantılar (mentor, telegram, senaryo) ----------
  for (const mount of (ctx.extras.routes ?? []) as ((a: express.Express) => void)[]) mount(app);

  // ---------- SSE ----------
  app.get("/api/stream", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(`retry: 3000\n\n`);
    const send = (ev: { type: string; data: unknown }) => res.write(`event: ${ev.type}\ndata: ${mask(JSON.stringify(ev.data))}\n\n`);
    send({ type: "hello", data: { ts: Date.now(), agent: agent.status() } });
    store.bus.on("sse", send);
    const ping = setInterval(() => res.write(`: ping\n\n`), 20_000);
    req.on("close", () => {
      clearInterval(ping);
      store.bus.off("sse", send);
    });
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "bulunamadı" }));
  app.use((_req, res) => res.status(404).sendFile(path.join(publicDir, "404.html")));
  return app;
}

export function followWarning(ctx: AppContext, count: number) {
  if (count >= ctx.contract.softWatchlistWarnAt) {
    const w = ctx.warnings.raise(
      "liste_15",
      String(count),
      "Takip listen kalabalıklaştı",
      `Listende ${count} coin var. Listeye almak işlem açmak değildir; ajan aynı anda en fazla ${ctx.limits.maxOpenPositions} pozisyon tutar. Odaklı bir liste daha sakin karar demektir.`,
      [{ label: "Takip edilen coin", value: String(count), limit: `yumuşak sınır ${ctx.contract.softWatchlistWarnAt}` }],
      ctx.agent.riskScore().score,
    );
    return w ?? { kind: "liste_15", title: "Takip listen kalabalıklaştı", text: `Listende ${count} coin var.` };
  }
  return null;
}

export function makePlan(ctx: AppContext, ids: string[]) {
  const t = ctx.agent.trading;
  const items = ids
    .map((id) => ctx.agent.candidates.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({ instId: c.instId, entry: c.entry, stop: c.stop, target: c.target, rr: c.rr, opportunity: c.opportunity, risk: c.risk }));
  return buildPlan(items, { equityUsdt: t.equity(), riskPct: ctx.store.settings.riskPct, openNotionalUsdt: t.openNotional(), openCount: t.listPositions().length, limits: ctx.limits });
}
