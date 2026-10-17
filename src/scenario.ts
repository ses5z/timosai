// Deterministik demo: ajan tarar → karar → ajan emir verir → sözleşmeye aykırı karar engellenir (uyarı penceresi) → bildirim.
// Her zaman KURU çalışır: ana istemci gerçekse ayrı bir kâğıt ajan kullanılır.
import { Agent } from "./agent/agent.js";
import { RuleDecisionProvider } from "./agent/decisionProvider.js";
import type { AppContext } from "./context.js";
import type { Candidate } from "./ports.js";
import { MockTradingClient } from "./trading/tradingClient.js";
import { roundPrice } from "./util/math.js";

export interface ScenarioStep {
  step: number;
  total: number;
  title: string;
  text: string;
  done?: boolean;
}

export class Scenario {
  running = false;
  private steps: ScenarioStep[] = [];

  constructor(
    private readonly ctx: AppContext,
    private readonly delayMs = 2200,
  ) {}

  history(): ScenarioStep[] {
    return [...this.steps];
  }

  private agent(): Agent {
    const main = this.ctx.agent;
    if (main.trading.mode === "KURU") return main;
    const sandbox = new Agent({ ...main.d, trading: new MockTradingClient(this.ctx.limits, this.ctx.ledger, this.ctx.env.paperBalanceUsdt), decision: new RuleDecisionProvider(this.ctx.thresholds) });
    sandbox.candidates = new Map(main.candidates);
    sandbox.prices = new Map(main.prices);
    return sandbox;
  }

  private emit(s: ScenarioStep): void {
    this.steps.push(s);
    this.ctx.store.bus.publish("scenario", s);
    this.ctx.store.addEvent("bilgi", `[Senaryo ${s.step}/${s.total}] ${s.title}: ${s.text}`);
  }

  private wait(): Promise<void> {
    return new Promise((r) => setTimeout(r, this.delayMs));
  }

  async start(): Promise<ScenarioStep[]> {
    if (this.running) return this.steps;
    this.running = true;
    this.steps = [];
    const total = 8;
    try {
      const agent = this.agent();
      const sandboxNote = agent === this.ctx.agent ? "" : " (gerçek mod açık olduğu için ayrı kâğıt hesapta)";
      this.emit({ step: 1, total, title: "Canlı tarama", text: `ATK'den fiyat, mum, RSI, order book, funding ve OI; OKX vadeli istatistikleri${sandboxNote}.` });
      await agent.scanOnce();
      await this.wait();

      const held = new Set(agent.trading.listPositions().map((p) => p.instId));
      const pick = agent.queue().find((c) => !held.has(c.instId) && this.ctx.limits.allowedPairs.includes(c.instId));
      if (!pick) {
        this.emit({ step: total, total, title: "Bitti", text: "Uygun aday bulunamadı.", done: true });
        return this.steps;
      }
      const { derivAnalysisFor } = await import("./derivatives/view.js");
      const dv = await derivAnalysisFor(this.ctx, pick.instId).catch(() => null);
      this.emit({ step: 2, total, title: "Vadeli durum kartı", text: dv && dv.available ? `${pick.base}: ${dv.badge}, kalabalık taraf ${dv.crowded}, manipülasyon şüphesi ${dv.manipulation}. ${dv.reasons[0]}` : `${pick.base}: vadeli veri yok.` });
      await this.wait();

      const p = pick.price;
      const calm: Candidate = { ...pick, decision: "aç", entry: roundPrice(p), stop: roundPrice(p * 0.99), target: roundPrice(p * 1.022), rr: 2.2, risk: Math.min(pick.risk, 30), security: { ...pick.security, spreadPct: Math.min(pick.security.spreadPct ?? 0.02, 0.05) }, reason: "Senaryo: sakin bir kurulum; stop %1 altta, hedef 2.2R." };
      this.ctx.store.follow(calm.instId);
      const r1 = await agent.tryEnter(calm, "senaryo");
      this.emit({ step: 3, total, title: "Ajan kararı ve spot emir", text: `${calm.base}: aç (R:R 2.2). ${r1.ok ? r1.reason : "Emir verilmedi: " + r1.reason}` });
      await this.wait();

      const other = agent.queue().find((c) => c.instId !== calm.instId && !held.has(c.instId)) ?? pick;
      const q = other.price;
      const risky: Candidate = { ...other, decision: "aç", entry: roundPrice(q), stop: roundPrice(q * 0.91), target: roundPrice(q * 1.05), rr: 0.56, reason: "Senaryo: aceleci bir kurulum; stop çok uzak, ödül/risk düşük." };
      const r2 = await agent.tryEnter(risky, "senaryo", { warnKey: `senaryo-${Date.now()}` });
      this.emit({ step: 4, total, title: "Sözleşmeye aykırı karar engellendi", text: r2.ok ? "Beklenmedik: emir geçti." : `Ajan ${risky.base} emrini vermedi (${r2.reason}). Uyarı penceresi açıldı.` });
      await this.wait();

      const quick = this.ctx.extras.quick;
      if (quick?.enabled() && agent === this.ctx.agent) {
        const third = agent.queue().find((c) => ![calm.instId, other.instId].includes(c.instId) && !held.has(c.instId));
        const r = third ? await quick.run(`/al ${third.base} 3`, "senaryo") : { text: "Uygun coin yok." };
        this.emit({ step: 5, total, title: "Hızlı komut", text: r.text });
      } else this.emit({ step: 5, total, title: "Hızlı komut", text: "Hızlı komutlar kapalı (QUICK_COMMANDS=false): kullanıcı emir yolu yok, emirleri yalnızca ajan verir." });
      await this.wait();

      const note = `[SENARYO] ${calm.base}: hacim ve OI bildirimi örneği (takip edilen coin için gerçek bildirimler aynı yoldan gider).`;
      this.ctx.agent.emitDev({ symbol: calm.instId, kind: "bildirim", text: note, critical: false });
      const tg = this.ctx.extras.telegram?.status?.();
      this.emit({ step: 6, total, title: "Haber/hacim bildirimi", text: tg?.connected ? "Takip edilen coin için bildirim Telegram'a gönderildi." : "Telegram kapalı; bildirim olay günlüğüne yazıldı." });
      await this.wait();

      try {
        const fs = await import("node:fs");
        const demo = JSON.parse(fs.readFileSync("config/demo-tokens.json", "utf8"));
        const t = demo.honeypot ?? demo.tokens?.[0];
        if (t) {
          const { scanToken } = await import("./security/view.js");
          const r = await scanToken(this.ctx, t.chain, t.address);
          this.emit({ step: 7, total, title: "Token tarama", text: `${r.token?.symbol ?? "token"} (${r.chainName}): ${r.verdict}. ${r.reasons[0] ?? ""}${demo.honeypot ? "" : " (Doğrulanmış honeypot adresi eklenmediği için temiz örnek tarandı.)"}` });
        } else this.emit({ step: 7, total, title: "Token tarama", text: "Demo token tanımlı değil." });
      } catch (e) {
        this.emit({ step: 7, total, title: "Token tarama", text: `Tarama yapılamadı: ${(e as Error).message}` });
      }
      await this.wait();

      const st: any = this.ctx.proof.status();
      if (st.enabled) {
        const r = await this.ctx.proof.anchor(this.ctx.ledger.headHash(), this.ctx.ledger.count());
        this.emit({ step: 8, total, title: "Avalanche kaydı", text: r.note, done: true });
      } else this.emit({ step: 8, total, title: "Avalanche kaydı", text: st.note, done: true });
      return this.steps;
    } finally {
      this.running = false;
    }
  }
}
