import test from "node:test";
import assert from "node:assert/strict";
import { mkCtx } from "./helpers.js";
import { MentorService } from "../../src/mentor/mentorService.js";
import { ClaudeMentor } from "../../src/mentor/llm.js";
import { MentorTools } from "../../src/mentor/tools.js";
import { SYSTEM_PROMPT, buildSystemPrompt } from "../../src/mentor/systemPrompt.js";
import { wantsDetail, enforceShort, splitSentences, wordCount } from "../../src/mentor/detail.js";
import { TelegramBot } from "../../src/telegram/bot.js";

async function ready(env: Record<string, string> = {}) {
  const ctx = mkCtx({ AUTONOMOUS: "false", ...env });
  await ctx.agent.scanOnce();
  return ctx;
}

function fakeGemini(texts: string[]) {
  const bodies: any[] = [];
  const f = (async (_u: string, init: any) => {
    bodies.push(JSON.parse(init.body));
    const t = texts.shift() ?? "Tamam.";
    return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: t }] }, finishReason: "STOP" }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, bodies };
}

test("detail bayrağı: 'detaylı anlat' → true, 'SOL nasıl?' → false; düğme ve Pro modu → true", () => {
  assert.equal(wantsDetail("SOL'u detaylı anlat"), true);
  assert.equal(wantsDetail("Neden izlemede?"), true);
  assert.equal(wantsDetail("adım adım açıkla"), true);
  assert.equal(wantsDetail("SOL nasıl?"), false);
  assert.equal(wantsDetail("risk bütçem ne?"), false);
  assert.equal(wantsDetail("SOL nasıl?", { detail: true }), true);
  assert.equal(wantsDetail("SOL nasıl?", { mode: "pro" }), true);
});

test("sistem prompt'u: cevap uzunluğu bölümü, few-shot örnekler ve cevap modu etiketi", () => {
  for (const s of ["Cevap uzunluğu", "Örnekler", "SOL nasıl?", "SOL'u detaylı anlat", "risk bütçem ne?", "Ayrıntı ister misin?", "umarım yardımcı olur"]) assert.ok(SYSTEM_PROMPT.includes(s), s);
  assert.ok(buildSystemPrompt(false).endsWith("<cevap_modu>kisa</cevap_modu>"));
  assert.ok(buildSystemPrompt(true).endsWith("<cevap_modu>ayrintili</cevap_modu>"));
});

test("Gemini: kısa modda maxOutputTokens 220, ayrıntılıda 800; sıcaklık 0.3; mod etiketi sistem prompt'unda", async () => {
  const ctx = await ready({ GEMINI_API_KEY: "test-key-123" });
  const { f, bodies } = fakeGemini(["Kısa cevap.", "Uzun cevap."]);
  const m = new MentorService(ctx, { fetchImpl: f });
  const a = await m.chat("SOL nasıl?");
  assert.equal(bodies[0].generationConfig.maxOutputTokens, 220);
  assert.equal(bodies[0].generationConfig.temperature, 0.3);
  assert.match(bodies[0].systemInstruction.parts[0].text, /<cevap_modu>kisa<\/cevap_modu>$/);
  assert.equal(a.detail, false);
  assert.equal(a.canDetail, true);
  const b = await m.chat("SOL'u detaylı anlat");
  assert.equal(bodies[1].generationConfig.maxOutputTokens, 800);
  assert.match(bodies[1].systemInstruction.parts[0].text, /<cevap_modu>ayrintili<\/cevap_modu>$/);
  assert.equal(b.detail, true);
  assert.equal(b.canDetail, false);
  await m.chat("SOL nasıl?", "web", { detail: true });
  assert.equal(bodies[2].generationConfig.maxOutputTokens, 800);
});

test("Claude: kısa 220, ayrıntılı 800 max_tokens ve sıcaklık 0.3", async () => {
  const ctx = await ready();
  const bodies: any[] = [];
  const f = (async (_u: string, init: any) => (bodies.push(JSON.parse(init.body)), new Response(JSON.stringify({ content: [{ type: "text", text: "Tamam." }] }), { status: 200 }))) as unknown as typeof fetch;
  const c = new ClaudeMentor("k", "claude-haiku-5-5", f);
  await c.reply({ text: "SOL nasıl?", history: [], tools: new MentorTools(ctx) });
  await c.reply({ text: "detay", history: [], tools: new MentorTools(ctx), detail: true });
  assert.equal(bodies[0].max_tokens, 220);
  assert.equal(bodies[1].max_tokens, 800);
  assert.equal(bodies[0].temperature, 0.3);
  assert.match(bodies[1].system, /<cevap_modu>ayrintili<\/cevap_modu>$/);
});

test("kısa modda 120 kelimeyi aşan cevap ilk 4 cümleye kırpılır; ayrıntılı mod kırpılmaz", async () => {
  const long = Array.from({ length: 12 }, (_, i) => `Bu ${i + 1}. cümle ajanın kararını uzun uzun ve gereksiz ayrıntıyla anlatan bir dolgu cümlesidir.`).join(" ");
  assert.ok(wordCount(long) > 120);
  assert.deepEqual(splitSentences("Giriş 105.02, stop 104.1. Hedef 107.3 civarı."), ["Giriş 105.02, stop 104.1.", "Hedef 107.3 civarı."]);
  const e = enforceShort(long);
  assert.equal(e.trimmed, true);
  assert.equal(splitSentences(e.text).length, 4);
  const ctx = await ready({ GEMINI_API_KEY: "test-key-123" });
  const { f } = fakeGemini([long, long]);
  const m = new MentorService(ctx, { fetchImpl: f });
  const short = await m.chat("SOL nasıl?");
  assert.equal(splitSentences(short.text).length, 4);
  const det = await m.chat("SOL'u ayrıntılı anlat");
  assert.equal(splitSentences(det.text).length, 12);
});

test("Gemini: token sınırı düşünmeye harcanıp boş dönerse tek sefer daha geniş bütçeyle dener", async () => {
  const ctx = await ready({ GEMINI_API_KEY: "test-key-123" });
  const bodies: any[] = [];
  let n = 0;
  const f = (async (_u: string, init: any) => {
    bodies.push(JSON.parse(init.body));
    n++;
    const c = n === 1 ? { content: { role: "model", parts: [] }, finishReason: "MAX_TOKENS" } : { content: { role: "model", parts: [{ text: "Kısa cevap." }] }, finishReason: "STOP" };
    return new Response(JSON.stringify({ candidates: [c] }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await new MentorService(ctx, { fetchImpl: f }).chat("durum?");
  assert.equal(r.text, "Kısa cevap.");
  assert.equal(bodies[1].generationConfig.maxOutputTokens, 660);
});

test("RuleMentor: kısa ve ayrıntılı iki sürüm", async () => {
  const ctx = await ready();
  const m = new MentorService(ctx);
  const s = await m.chat("SOL analizi");
  const d = await m.chat("SOL analizini detaylı anlat");
  assert.ok(wordCount(s.text) <= 60, `kısa ${wordCount(s.text)} kelime`);
  assert.ok(wordCount(d.text) > wordCount(s.text));
  assert.ok(d.text.includes("\n"));
  const p1 = await m.chat("portföyüm");
  const p2 = await m.chat("portföyümü ayrıntılı anlat");
  assert.ok(p2.text.length > p1.text.length);
  const b1 = await m.chat("risk bütçem ne?");
  assert.match(b1.text, /^İşlem başına %1, yani yaklaşık [\d.]+ USDT\.$/);
  const a1 = await m.chat("adaylar");
  assert.ok(wordCount(a1.text) <= 40);
});

test("Telegram: kısa cevabın altında tek 'Ayrıntı' düğmesi; basınca aynı soru ayrıntılı gelir", async () => {
  const ctx = await ready();
  const calls: any[] = [];
  const f = (async (url: string, init: any) => {
    calls.push({ method: url.split("/").pop(), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const bot = new TelegramBot(ctx, new MentorService(ctx), { token: "1:x", allowedUserId: "42", fetchImpl: f, pollTimeoutSec: 0 });
  await bot.handleUpdate({ update_id: 1, message: { text: "SOL analizi", from: { id: 42 }, chat: { id: 42 } } });
  const kb = calls.at(-1).body.reply_markup.inline_keyboard;
  assert.equal(kb.length, 1);
  assert.equal(kb[0].length, 1);
  assert.equal(kb[0][0].text, "Ayrıntı");
  const shortText = calls.at(-1).body.text;
  await bot.handleCallback(kb[0][0].callback_data);
  const longText = calls.at(-1).body.text;
  assert.ok(longText.length > shortText.length);
  assert.equal(calls.at(-1).body.reply_markup, undefined);
});
