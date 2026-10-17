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
    const total = 5;
    try {
      const agent = this.agent();
      const sandboxNote = agent === this.ctx.agent ? "" : " (gerçek mod açık olduğu için ayrı kâğıt hesapta)";
      this.emit({ step: 1, total, title: "Ajan tarıyor", text: `ATK'den fiyat, mum, gösterge ve funding verisi çekiliyor${sandboxNote}.` });
      await agent.scanOnce();
      await this.wait();

      const held = new Set(agent.trading.listPositions().map((p) => p.instId));
      const pick = agent.queue().find((c) => !held.has(c.instId) && this.ctx.limits.allowedPairs.includes(c.instId));
      if (!pick) {
        this.emit({ step: 5, total, title: "Bitti", text: "Uygun aday bulunamadı.", done: true });
        return this.steps;
      }
      const p = pick.price;
      const calm: Candidate = { ...pick, decision: "aç", entry: roundPrice(p), stop: roundPrice(p * 0.99), target: roundPrice(p * 1.02), rr: 2, risk: Math.min(pick.risk, 30), security: { ...pick.security, spreadPct: Math.min(pick.security.spreadPct ?? 0.02, 0.05) }, reason: "Senaryo: sakin bir kurulum; stop %1 altta, hedef 2R." };
      this.ctx.store.follow(calm.instId); // bildirim politikası: yalnızca takip edilen coin
      this.emit({ step: 2, total, title: "Ajan karar verdi", text: `${calm.base}: aç. Giriş ${calm.entry}, stop ${calm.stop}, hedef ${calm.target}, R:R 2. ${calm.base} takip listesine alındı.` });
      await this.wait();

      const r1 = await agent.tryEnter(calm, "senaryo");
      this.emit({ step: 3, total, title: "Ajan emir verdi", text: r1.ok ? r1.reason : `Emir verilmedi: ${r1.reason}` });
      await this.wait();

      const other = agent.queue().find((c) => c.instId !== calm.instId && !held.has(c.instId)) ?? pick;
      const q = other.price;
      const risky: Candidate = { ...other, decision: "aç", entry: roundPrice(q), stop: roundPrice(q * 0.91), target: roundPrice(q * 1.05), rr: 0.56, reason: "Senaryo: aceleci bir kurulum; stop çok uzak, ödül/risk düşük." };
      const r2 = await agent.tryEnter(risky, "senaryo", { warnKey: `senaryo-${Date.now()}` });
      this.emit({ step: 4, total, title: "Sözleşmeye aykırı karar engellendi", text: r2.ok ? "Beklenmedik: emir geçti." : `Ajan ${risky.base} emrini vermedi (${r2.reason}). Uyarı penceresi açıldı.` });
      await this.wait();

      const tg = this.ctx.extras.telegram?.status?.();
      this.emit({ step: 5, total, title: "Bildirim", text: tg?.connected ? "Takip edilen coin için pozisyon bildirimi ve uyarı Telegram'a gönderildi." : "Telegram kapalı; bildirim olay günlüğüne yazıldı.", done: true });
      return this.steps;
    } finally {
      this.running = false;
    }
  }
}
