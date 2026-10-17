// Yapay zeka mentorları: GeminiMentor (varsayılan) ve ClaudeMentor. Harici SDK yok, yalnızca fetch.
// Araç döngüsü en fazla 4 tur; araç sonuçları <durum_verisi> bloğunda veri olarak verilir.
import type { MentorTools } from "./tools.js";
import { activeToolDefs } from "./tools.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import type { ChatMessage } from "../state/store.js";
import { mask } from "../util/log.js";

export interface LlmInput {
  text: string;
  history: ChatMessage[];
  tools: MentorTools;
}

export interface MentorProvider {
  readonly name: string;
  available(): boolean;
  reply(input: LlmInput): Promise<string>;
}

export const MAX_TOOL_TURNS = 4;
// ai.google.dev/gemini-api/docs/models (2026-10-17): en güncel kararlı, ücretsiz katmanlı flash modeli.
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";

export const wrapData = (v: unknown) => `<durum_verisi>${JSON.stringify(v).slice(0, 6000)}</durum_verisi>`;

type FetchLike = typeof fetch;

export class GeminiMentor implements MentorProvider {
  readonly name: string;
  private thinkingOk = true;
  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_GEMINI_MODEL,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly maxTokens = 1024,
  ) {
    this.name = `Gemini (${model})`;
  }

  available(): boolean {
    return Boolean(this.apiKey);
  }

  async reply({ text, history, tools }: LlmInput): Promise<string> {
    const decl = activeToolDefs(tools).map((t) => (Object.keys(t.parameters.properties).length ? { name: t.name, description: t.description, parameters: t.parameters } : { name: t.name, description: t.description }));
    const contents: any[] = history.slice(-8).map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] }));
    contents.push({ role: "user", parts: [{ text }] });
    for (let turn = 0; turn <= MAX_TOOL_TURNS; turn++) {
      const body: any = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { maxOutputTokens: this.maxTokens, temperature: 0.4 },
      };
      if (turn < MAX_TOOL_TURNS) body.tools = [{ functionDeclarations: decl }];
      // Kısa ve hızlı cevap için düşünme en düşük ayarda.
      if (/2\.5-flash/.test(this.model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
      else if (/gemini-3/.test(this.model) && this.thinkingOk) body.generationConfig.thinkingConfig = { thinkingLevel: "low" };
      const send = () =>
        this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        });
      let res = await send();
      if (res.status === 400 && body.generationConfig.thinkingConfig) {
        const t = await res.text();
        if (/thinking/i.test(t)) {
          this.thinkingOk = false;
          delete body.generationConfig.thinkingConfig;
          res = await send();
        } else throw new Error(mask(`Gemini 400: ${t.slice(0, 200)}`));
      }
      if (!res.ok) throw new Error(mask(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`));
      const data: any = await res.json();
      const content = data?.candidates?.[0]?.content;
      const parts: any[] = content?.parts ?? [];
      const calls = parts.filter((p) => p.functionCall);
      if (!calls.length) {
        const out = parts.map((p) => p.text ?? "").join("").trim();
        if (!out) throw new Error("Gemini boş yanıt");
        return out;
      }
      contents.push(content); // düşünce imzaları dahil modelin içeriği aynen geri gönderilir
      const responses = [];
      for (const c of calls) {
        const r = await tools.call(c.functionCall.name, c.functionCall.args ?? {});
        responses.push({ functionResponse: { name: c.functionCall.name, response: { icerik: wrapData(r) } } });
      }
      contents.push({ role: "user", parts: responses });
    }
    throw new Error("Gemini araç döngüsü sınırı aşıldı");
  }
}

export class ClaudeMentor implements MentorProvider {
  readonly name: string;
  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_CLAUDE_MODEL,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly maxTokens = 600,
  ) {
    this.name = `Claude (${model})`;
  }

  available(): boolean {
    return Boolean(this.apiKey);
  }

  async reply({ text, history, tools }: LlmInput): Promise<string> {
    const toolDefs = activeToolDefs(tools).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    const messages: any[] = [];
    for (const m of history.slice(-8)) {
      const role = m.role === "user" ? "user" : "assistant";
      if (messages.length && messages[messages.length - 1].role === role) messages[messages.length - 1].content += "\n" + m.text;
      else messages.push({ role, content: m.text });
    }
    if (messages.length && messages[0].role !== "user") messages.shift();
    if (messages.length && messages[messages.length - 1].role === "user") messages[messages.length - 1].content += "\n" + text;
    else messages.push({ role: "user", content: text });
    for (let turn = 0; turn <= MAX_TOOL_TURNS; turn++) {
      const body: any = { model: this.model, max_tokens: this.maxTokens, system: SYSTEM_PROMPT, messages };
      if (turn < MAX_TOOL_TURNS) body.tools = toolDefs;
      const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(mask(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`));
      const data: any = await res.json();
      const blocks: any[] = data?.content ?? [];
      const uses = blocks.filter((b) => b.type === "tool_use");
      if (!uses.length) {
        const out = blocks.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
        if (!out) throw new Error("Claude boş yanıt");
        return out;
      }
      messages.push({ role: "assistant", content: blocks });
      const results = [];
      for (const u of uses) {
        const r = await tools.call(u.name, u.input ?? {});
        results.push({ type: "tool_result", tool_use_id: u.id, content: wrapData(r) });
      }
      messages.push({ role: "user", content: results });
    }
    throw new Error("Claude araç döngüsü sınırı aşıldı");
  }
}
