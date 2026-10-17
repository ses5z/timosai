// Mentor, Telegram ve senaryo gibi uzantıları bağlama takar.
import type express from "express";
import type { AppContext } from "./context.js";
import { MentorService } from "./mentor/mentorService.js";

export async function installExtensions(ctx: AppContext, opts: { fetchImpl?: typeof fetch } = {}): Promise<void> {
  ctx.extras.routes = ctx.extras.routes ?? [];
  const mentor = new MentorService(ctx, opts);
  ctx.extras.mentor = mentor;
  ctx.extras.analyze = async (instId: string) => mentor.analyze(instId);
  ctx.extras.explainPlan = async (plan: any) => mentor.explainPlan(plan);

  ctx.extras.routes.push((app: express.Express) => {
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
