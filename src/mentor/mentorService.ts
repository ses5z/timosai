// MentorService: seçili sağlayıcı → diğeri → RuleMentor zinciri. Hata/limitte sessizce yedeğe geçer.
// Web, ses ve Telegram aynı sohbet geçmişini paylaşır.
import type { AppContext } from "../context.js";
import { ClaudeMentor, DEFAULT_CLAUDE_MODEL, DEFAULT_GEMINI_MODEL, GeminiMentor, type MentorProvider } from "./llm.js";
import { INJECTION_RE, RuleMentor, explainPlanText } from "./ruleMentor.js";
import { MentorTools } from "./tools.js";
import { analyzeCandidate } from "./analysis.js";
import { log } from "../util/log.js";
import type { ChatMessage } from "../state/store.js";
import { enforceShort, wantsDetail, type DetailOpts } from "./detail.js";

export interface MentorReply {
  text: string;
  provider: string;
  ai: boolean;
  pending: { id: string; summary: string } | null;
  /** Bu cevap ayrıntılı modda mı üretildi? */
  detail?: boolean;
  /** Arayüz "Ayrıntı" düğmesi gösterebilir mi? */
  canDetail?: boolean;
  question?: string;
}

const YES_RE = /^(evet|onayl[ıi]yorum|onayla|tamam|olur|kabul|yes)\b/i;
const NO_RE = /^(hay[ıi]r|vazge[çc]|iptal|istemiyorum|no)\b/i;

/** Model bazen sistem talimatındaki <cevap_modu> etiketini cevaba kopyalar: kullanıcıya gösterilmez. */
export const stripModeTag = (t: string) => t.replace(/<\/?cevap_modu>\s*(kisa|ayrintili)?\s*(<\/cevap_modu>)?/gi, "").replace(/[ \t]+\n/g, "\n").trim();

export class MentorService {
  readonly tools: MentorTools;
  readonly rule: RuleMentor;
  private chain: MentorProvider[] = [];
  private calls: number[] = [];
  private lastProvider = "kural tabanlı";
  private lastAi = false;

  constructor(
    private readonly ctx: AppContext,
    opts: { fetchImpl?: typeof fetch } = {},
  ) {
    this.tools = new MentorTools(ctx);
    this.rule = new RuleMentor(ctx, this.tools);
    const env = ctx.env;
    const gemini = env.geminiKey ? new GeminiMentor(env.geminiKey, env.mentorModel || DEFAULT_GEMINI_MODEL, opts.fetchImpl) : null;
    const claude = env.anthropicKey ? new ClaudeMentor(env.anthropicKey, env.claudeModel || DEFAULT_CLAUDE_MODEL, opts.fetchImpl) : null;
    if (env.mentorProvider === "claude") this.chain = [claude, gemini].filter(Boolean) as MentorProvider[];
    else if (env.mentorProvider === "gemini") this.chain = [gemini, claude].filter(Boolean) as MentorProvider[];
    else this.chain = [];
    if (this.chain[0]) {
      this.lastProvider = this.chain[0].name;
      this.lastAi = true;
    }
  }

  status() {
    return { active: this.lastProvider, ai: this.lastAi, provider: this.chain[0]?.name ?? "kural tabanlı", chain: [...this.chain.map((c) => c.name), "kural tabanlı"], hourlyLimit: this.ctx.env.mentorHourlyLimit, usedLastHour: this.usedLastHour() };
  }

  /** Mentor işlemi gerekçesi: seviyeleri kod hesaplar, LLM yalnızca 2-3 kısa gerekçe cümlesi yazar. */
  async rationale(prompt: string): Promise<{ lines: string[]; provider: string } | null> {
    if (this.usedLastHour() >= this.ctx.env.mentorHourlyLimit) return null;
    for (const p of this.chain) {
      if (!p.available()) continue;
      try {
        this.calls.push(Date.now());
        const out = stripModeTag(await p.reply({ text: prompt, history: [], tools: this.tools, detail: false }));
        const lines = out.split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").replace(/\*\*/g, "").trim()).filter((l) => l.length > 8).map((l) => l[0].toLocaleUpperCase("tr-TR") + l.slice(1)).slice(0, 3);
        if (lines.length >= 2) return { lines, provider: p.name };
      } catch {
        /* sıradakine geç */
      }
    }
    return null;
  }

  private usedLastHour(): number {
    const now = Date.now();
    this.calls = this.calls.filter((t) => now - t < 3_600_000);
    return this.calls.length;
  }

  history(): ChatMessage[] {
    return this.ctx.store.chat.slice(-40);
  }

  async chat(textRaw: string, via: ChatMessage["via"] = "web", opts: DetailOpts = {}): Promise<MentorReply> {
    const text = String(textRaw ?? "").slice(0, 800).trim();
    const detail = wantsDetail(text, opts);
    if (!text) return { text: "Bir şey yazmadın.", provider: "kural tabanlı", ai: false, pending: null };
    const history = this.ctx.store.chat.slice(-8);
    this.ctx.store.addChat({ role: "user", text, via });
    this.tools.lastPending = null;
    let reply: MentorReply | null = null;

    // Bekleyen onaya evet/hayır
    const pending = [...this.ctx.store.pending.values()].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (pending && (YES_RE.test(text) || NO_RE.test(text))) {
      const r = await this.tools.confirm(pending.id, YES_RE.test(text));
      reply = { text: r.ok ? (YES_RE.test(text) ? `Tamam, yapıldı: ${pending.summary}` : "Vazgeçtim, hiçbir şey değişmedi.") : r.error ?? "Olmadı.", provider: "kural tabanlı", ai: false, pending: null };
    } else if (this.ctx.env.quickCommands && this.ctx.extras.quick && /^\/(al|sat|kapat|l|s)\s/i.test(text)) {
      // Kullanıcının açık komutu: komutun kendisi onaydır (sert limit kapısı yine geçerli).
      const r = await this.ctx.extras.quick.run(text, via);
      reply = { text: r.text, provider: "hızlı komut", ai: false, pending: null };
    } else if (/^\/(al|sat|kapat|l|s)\s/i.test(text)) {
      reply = { text: "Hızlı komutlar kapalı (QUICK_COMMANDS=false). Emir veremem; emirleri yalnızca ajan, sözleşme ve sert limitler içinde verir.", provider: "kural tabanlı", ai: false, pending: null };
    } else if (INJECTION_RE.test(text.toLocaleLowerCase("tr"))) {
      // Kural delme / prompt sızdırma girişimleri modele hiç gitmez.
      reply = { ...(await this.rule.reply(text, false)), provider: "kural tabanlı", ai: false, pending: null };
    } else {
      const limited = this.usedLastHour() >= this.ctx.env.mentorHourlyLimit;
      if (!limited) {
        this.tools.currentUserText = text;
        for (const p of this.chain) {
          if (!p.available()) continue;
          try {
            this.calls.push(Date.now());
            let out = await p.reply({ text, history, tools: this.tools, detail });
            out = stripModeTag(out);
            if (!detail) {
              const s = enforceShort(out);
              if (s.trimmed) log.warn(`Mentor: uzun cevap (${p.name}); kısa modda ilk 4 cümle gönderildi.`);
              out = s.text;
            }
            reply = { text: out, provider: p.name, ai: true, pending: this.tools.lastPending };
            break;
          } catch (e) {
            log.warn(`Mentor sağlayıcısı başarısız, yedeğe geçiliyor: ${(e as Error).message}`);
          }
        }
      }
      if (!reply) {
        const r = await this.rule.reply(text, detail);
        reply = { text: r.text, provider: "kural tabanlı", ai: false, pending: this.tools.lastPending };
      }
    }
    reply.detail = detail;
    reply.question = text;
    reply.canDetail = !detail && !reply.pending && reply.provider !== "hızlı komut" && !INJECTION_RE.test(text.toLocaleLowerCase("tr"));
    this.lastProvider = reply.provider;
    this.lastAi = reply.ai;
    this.ctx.store.addChat({ role: "mentor", text: reply.text, via, provider: reply.provider, pendingId: reply.pending?.id });
    return reply;
  }

  async confirm(id: string, yes: boolean, via: ChatMessage["via"] = "web"): Promise<MentorReply> {
    const p = this.ctx.store.pending.get(id);
    const r = await this.tools.confirm(id, yes);
    const text = r.ok ? (yes ? `Tamam, yapıldı: ${p?.summary ?? ""}` : "Vazgeçtim, hiçbir şey değişmedi.") : r.error ?? "Olmadı.";
    this.ctx.store.addChat({ role: "mentor", text, via, provider: "kural tabanlı" });
    return { text, provider: "kural tabanlı", ai: false, pending: null };
  }

  /** Keşfet'te sağa kaydırınca otomatik analiz (kod hesaplar; metin kural tabanlı ve kısa). */
  analyze(instId: string) {
    return analyzeCandidate(this.ctx, instId);
  }

  explainPlan(plan: any): string {
    return explainPlanText(plan);
  }
}
