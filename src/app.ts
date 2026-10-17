// Express uygulaması: JSON API + SSE + statik sayfalar. KULLANICI EMİR UÇ NOKTASI YOKTUR.
import express, { type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { slim } from "./agent/agent.js";
import { buildPlan, sizePosition } from "./agent/sizing.js";
import type { AppContext } from "./context.js";
import { round } from "./util/math.js";
import { applyPlan, CODE_ALLOWED_PAIRS } from "./trading/hardLimits.js";
import { planRef, sanitizePlan } from "./plan/plan.js";
import { computeSetupWithRationale } from "./mentor/setup.js";
import { mask } from "./util/log.js";

const PAGES: Record<string, string> = {
  "/": "index.html",
  "/kesfet": "kesfet.html",
  "/mentor": "mentor.html",
  "/telegram": "telegram.html",
  "/isi-haritasi": "isi-haritasi.html",
  "/hakkimizda": "hakkimizda.html",
  "/panel": "panel.html",
  "/terminal": "terminal.html",
};

export function validPair(s: unknown): s is string {
  return typeof s === "string" && /^[A-Z0-9]{1,15}-(USDT|USDC|BTC|ETH|SOL|TRY)$/.test(s);
}

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
      dry: agent.trading.mode === "PAPER",
      tradingMode: agent.trading.mode,
      atkMode: ctx.env.atkMode,
      atkConnected: ctx.atk?.available() ?? false,
      publicData: ctx.derivatives.stats(),
      newsStatus: agent.newsStatus,
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
    const { isBar, okxBar, BAR_MS } = await import("./market/bars.js");
    const bar = isBar(req.query.bar) ? req.query.bar : "15m";
    const before = Number(req.query.before) || 0; // geçmiş yükleme: bu zamandan önceki mumlar
    if (!validPair(id)) return res.status(400).json({ error: "geçersiz sembol" });
    let candles: any[] | undefined = bar === "15m" && !before ? agent.lastCandles.get(id) : undefined;
    const key = `${id}:${bar}:${before}`;
    if (!candles) {
      const c = candleCache.get(key);
      if (c && Date.now() - c.at < (before ? 3_600_000 : 60_000)) candles = c.v;
      else {
        try {
          candles = await ctx.market.candles(id, okxBar(bar), before ? 100 : 200, before || undefined);
          candleCache.set(key, { at: Date.now(), v: candles });
        } catch {
          return res.status(502).json({ error: "mum verisi yok" });
        }
      }
    }
    if (!candles.length) return json(res, { bar, okxBar: okxBar(bar), tickSz: 0, candles: [], atrTrend: [], trendFlips: [], markers: [], levels: null, position: null, live: ctx.market.isLive(), end: true });
    const { atrTrend, loadAtrTrendConfig } = await import("./indicators/atrTrend.js");
    const cfg = loadAtrTrendConfig();
    const at = atrTrend(candles as any, cfg.period, cfg.mult);
    const sec = (ms: number) => Math.floor(ms / 1000);
    const barMs = BAR_MS[bar];
    const cand = agent.candidates.get(id);
    const markers = agent.trading
      .listTrades(200)
      .filter((t) => t.instId === id)
      .map((t) => ({ time: sec(Math.floor(t.ts / barMs) * barMs), position: t.side === "buy" ? "belowBar" : "aboveBar", color: t.side === "buy" ? "#62c98f" : "#f06a66", shape: t.side === "buy" ? "arrowUp" : "arrowDown", text: `${t.side === "buy" ? "AL" : "SAT"}${t.origin === "hızlı" ? " (hızlı)" : ""}` }))
      .filter((m) => m.time >= sec(candles![0].ts))
      .sort((a, b) => a.time - b.time);
    await ctx.instruments.ensure().catch(() => undefined);
    const tickSz = ctx.instruments.get(id)?.tickSz ?? 0;
    const flips = at
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i > 0 && p.dir !== at[i - 1].dir)
      .map(({ p, i }) => ({ time: sec(candles![i].ts), position: p.dir === 1 ? "belowBar" : "aboveBar", color: p.dir === 1 ? "#4f8cff" : "#f06a66", shape: p.dir === 1 ? "arrowUp" : "arrowDown", text: p.dir === 1 ? "yukarı" : "aşağı" }));
    json(res, {
      bar,
      okxBar: okxBar(bar),
      tickSz,
      atrCfg: cfg,
      trendFlips: flips,
      candles: candles.map((c: any) => ({ time: sec(c.ts), open: c.open, high: c.high, low: c.low, close: c.close, vol: c.vol })),
      atrTrend: at.map((p, i) => ({ time: sec(candles![i].ts), value: p.line, dir: p.dir })),
      markers,
      levels: cand ? { entry: cand.entry, stop: cand.stop, target: cand.target } : null,
      position: agent.positionsView().find((p) => p.instId === id) ?? null,
      live: ctx.market.isLive(),
    });
  });

  // Order book derinliği (ATK market_get_orderbook); mock modda örnek fiyat kademeleri.
  app.get("/api/orderbook/:instId", async (req, res) => {
    const id = String(req.params.instId).toUpperCase();
    if (!validPair(id)) return res.status(400).json({ error: "geçersiz parite" });
    try {
      let bids: [number, number][] = [];
      let asks: [number, number][] = [];
      if (ctx.atk && ctx.env.atkMode === "live") {
        const data: any = await ctx.atk.call("market_get_orderbook", { instId: id, sz: 15 });
        const book = Array.isArray(data) ? data[0] : data;
        bids = (book?.bids ?? []).slice(0, 15).map((r: string[]) => [Number(r[0]), Number(r[1])]);
        asks = (book?.asks ?? []).slice(0, 15).map((r: string[]) => [Number(r[0]), Number(r[1])]);
      } else {
        const ob = await ctx.market.orderbook(id);
        if (ob) for (let i = 0; i < 15; i++) {
          bids.push([ob.bid * (1 - i * 0.0004), 10 + ((i * 37) % 50)]);
          asks.push([ob.ask * (1 + i * 0.0004), 10 + ((i * 53) % 50)]);
        }
      }
      await ctx.instruments.ensure().catch(() => undefined);
      json(res, { instId: id, bids, asks, tickSz: ctx.instruments.get(id)?.tickSz ?? 0, live: ctx.env.atkMode === "live", ts: Date.now() });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });

  app.get("/api/supply/:base", async (req, res) => {
    const base = String(req.params.base).toUpperCase().replace(/-.*$/, "");
    if (!/^[A-Z0-9]{1,15}$/.test(base)) return res.status(400).json({ error: "geçersiz sembol" });
    json(res, await ctx.supply.report(base));
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
    store.settings.plan.riskPct = store.settings.riskPct;
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

  // ---------- Planım: planı ve limitleri kullanıcı yapar; ajan bu plana göre otonom işler ----------
  const planPayload = (notes: string[] = []) => {
    const live = agent.trading.mode === "CANLI";
    return { plan: store.settings.plan, live, balance: live ? round(agent.trading.equity(), 2) : null, coinsAvailable: [...CODE_ALLOWED_PAIRS], notes, fixedRules: ["Canlı modda tutarlar hesap bakiyesini aşamaz.", "Her girişte stop zorunlu; yalnızca spot (short yalnızca paper futures).", "Çekim, transfer, earn, bot ve event araçları her koşulda kapalı."] };
  };
  app.get("/api/plan", (_req, res) => json(res, planPayload()));
  app.post("/api/plan", (req, res) => {
    const live = agent.trading.mode === "CANLI";
    const { plan, notes } = sanitizePlan(req.body ?? {}, store.settings.plan, { live, balance: live ? agent.trading.equity() : null, validCoins: [...CODE_ALLOWED_PAIRS] });
    store.settings.plan = plan;
    store.settings.riskPct = plan.riskPct;
    applyPlan(limits, plan);
    store.addEvent("bilgi", `Plan güncellendi: ${planRef(plan)} · tek işlem ≤ ${plan.maxOrderUsdt} USDT · toplam ≤ ${plan.maxTotalUsdt} USDT · ${plan.maxPositions} pozisyon · ${plan.coins.length} coin.`);
    store.bus.publish("plan", plan);
    json(res, planPayload(notes));
  });
  app.post("/api/plan/add", (req, res) => {
    const id = String(req.body?.instId ?? "");
    if (!CODE_ALLOWED_PAIRS.includes(id)) return res.status(400).json({ error: `${id} plana eklenebilir coinler arasında değil (spot izin listesi).` });
    const p = store.settings.plan;
    if (!p.coins.includes(id)) p.coins.push(id);
    applyPlan(limits, p);
    store.planPreference = [id, ...store.planPreference.filter((x) => x !== id)].slice(0, 10);
    store.addEvent("bilgi", `${id.split("-")[0]} plana eklendi. Ajan yalnızca plan koşulları sağlanırsa işlem açar.`, id);
    json(res, planPayload());
  });

  // ---------- Mentor işlemi: çok zaman dilimli kurulum taslağı (yatırım tavsiyesi değildir) ----------
  app.get("/api/setup/:instId", async (req, res) => {
    try {
      json(res, await computeSetupWithRationale(ctx, req.params.instId));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ---------- Uzantılar (mentor, telegram, senaryo) ----------
  for (const mount of (ctx.extras.routes ?? []) as ((a: express.Express) => void)[]) mount(app);

  // ---------- Kısa yoklama (SSE'yi tamponlayan vekillerin arkasında yedek) ----------
  app.get("/api/poll", (req, res) => {
    const since = Number(req.query.since) || 0;
    const prices: Record<string, { p: number; c: number }> = {};
    for (const [k, v] of agent.prices) prices[k] = { p: v.last, c: round(v.change24hPct, 2) };
    json(res, {
      now: Date.now(),
      prices,
      events: store.events.filter((e) => e.ts > since).slice(-50),
      warnings: since ? warnings.list(10).filter((w) => w.ts > since).reverse() : [],
      chat: since ? store.chat.filter((m) => m.ts > since) : [],
      lastScanAt: agent.lastScanAt,
      positions: agent.positionsView(),
    });
  });

  // ---------- SSE ----------
  app.get("/api/stream", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no", "Content-Encoding": "identity" });
    res.flushHeaders();
    // Ters vekiller (ör. Cloudflare tüneli) ilk baytları tamponlayabilir: 2 KB yorum dolgusu akışı hemen açar.
    res.write(`: ${" ".repeat(2048)}\n\nretry: 3000\n\n`);
    const send = (ev: { type: string; data: unknown }) => res.write(`event: ${ev.type}\ndata: ${mask(JSON.stringify(ev.data))}\n\n`);
    send({ type: "hello", data: { ts: Date.now(), agent: agent.status() } });
    store.bus.on("sse", send);
    const ping = setInterval(() => res.write(`: ping\n\n`), 15_000);
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
