// Mentor, Telegram ve senaryo gibi uzantıları bağlama takar.
import type express from "express";
import type { AppContext } from "./context.js";
import { MentorService } from "./mentor/mentorService.js";
import { Scenario } from "./scenario.js";
import { TelegramBot, candidateChart } from "./telegram/bot.js";

export async function installExtensions(ctx: AppContext, opts: { fetchImpl?: typeof fetch } = {}): Promise<void> {
  ctx.extras.routes = ctx.extras.routes ?? [];
  const mentor = new MentorService(ctx, opts);
  ctx.extras.mentor = mentor;
  ctx.extras.analyze = async (instId: string) => mentor.analyze(instId);
  ctx.extras.explainPlan = async (plan: any) => mentor.explainPlan(plan);

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
  ctx.extras.startBackground = () => void bot.start();
  ctx.extras.stopBackground = () => bot.stop();

  const scenario = new Scenario(ctx);
  ctx.extras.scenario = scenario;

  ctx.extras.routes.push((app: express.Express) => {
    app.post("/api/scenario/start", (_req, res) => {
      if (scenario.running) return res.status(409).json({ error: "Senaryo zaten çalışıyor." });
      void scenario.start();
      res.json({ ok: true });
    });
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
      res.json(await mentor.chat(text, via));
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
