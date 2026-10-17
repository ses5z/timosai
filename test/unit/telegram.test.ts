import test from "node:test";
import assert from "node:assert/strict";
import { mkCtx } from "./helpers.js";
import { NotifyPolicy } from "../../src/telegram/notifyPolicy.js";
import { TelegramBot, splitMessage, candidateCaption, CAPTION_MAX } from "../../src/telegram/bot.js";
import { PNG_SIGNATURE, renderLineChartPng, crc32 } from "../../src/telegram/chartPng.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { MentorService } from "../../src/mentor/mentorService.js";

const settings = () => ({ developments: true, critical: true, opportunitySummary: false, quietUntil: 0 });

test("politika: takip dışı coin için gelişme mesajı yok", () => {
  const p = new NotifyPolicy(() => 0);
  const d = p.decide({ kind: "development", symbol: "SOL-USDT", text: "SOL hareket" }, { follows: [], held: [], settings: settings() });
  assert.equal(d.send, false);
  assert.equal(d.reason, "takip dışı coin");
});

test("politika: sembol başına 30 dk, saatte 6, aynı içerik tekrar yok", () => {
  let now = 0;
  const p = new NotifyPolicy(() => now);
  const ctx = { follows: ["A-USDT", "B-USDT", "C-USDT", "D-USDT", "E-USDT", "F-USDT", "G-USDT"], held: [], settings: settings() };
  assert.equal(p.decide({ kind: "development", symbol: "A-USDT", text: "1" }, ctx).send, true);
  assert.equal(p.decide({ kind: "development", symbol: "A-USDT", text: "2" }, ctx).send, false);
  for (const s of ["B", "C", "D", "E", "F"]) assert.equal(p.decide({ kind: "development", symbol: `${s}-USDT`, text: s }, ctx).send, true);
  assert.equal(p.decide({ kind: "development", symbol: "G-USDT", text: "g" }, ctx).reason, "saatlik sınır");
  now = 31 * 60_000;
  assert.equal(p.decide({ kind: "development", symbol: "A-USDT", text: "1" }, ctx).reason, "aynı içerik");
  now = 61 * 60_000;
  assert.equal(p.decide({ kind: "development", symbol: "A-USDT", text: "3" }, ctx).send, true);
});

test("politika: sessiz modda gelişme yok, kritik geçer; elde tutulan coin takip sayılır", () => {
  const p = new NotifyPolicy(() => 1000);
  const s = { ...settings(), quietUntil: 10_000 };
  assert.equal(p.decide({ kind: "development", symbol: "A-USDT", text: "x" }, { follows: ["A-USDT"], held: [], settings: s }).send, false);
  assert.equal(p.decide({ kind: "critical", symbol: "A-USDT", text: "stop" }, { follows: [], held: [], settings: s }).send, true);
  const p2 = new NotifyPolicy(() => 0);
  assert.equal(p2.decide({ kind: "development", symbol: "H-USDT", text: "y" }, { follows: [], held: ["H-USDT"], settings: settings() }).send, true);
});

test("4096 karakter bölme", () => {
  const parts = splitMessage("a ".repeat(5000));
  assert.ok(parts.length >= 3);
  assert.ok(parts.every((p) => p.length <= 4096));
});

async function readBody(init: any): Promise<{ body: any; raw: Buffer | null }> {
  if (init.body instanceof FormData) {
    const raw = Buffer.from(await new Response(init.body).arrayBuffer());
    const body: any = {};
    for (const [k, v] of init.body.entries()) body[k] = typeof v === "string" ? (k === "reply_markup" ? JSON.parse(v) : v) : "<dosya>";
    return { body, raw };
  }
  return { body: JSON.parse(init.body), raw: null };
}

function fakeTelegram(responses: Record<string, any> = {}, failPhoto = false) {
  const calls: { method: string; body: any; url: string; raw: Buffer | null }[] = [];
  let first429 = true;
  const f = (async (url: string, init: any) => {
    const method = url.split("/").pop()!;
    const { body, raw } = await readBody(init);
    calls.push({ method, body, url, raw });
    if (method === "sendPhoto" && failPhoto) return new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: IMAGE_PROCESS_FAILED" }), { status: 400 });
    if (method === "sendPhoto" && body.caption === "RATE" && first429) {
      first429 = false;
      return new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 0 } }), { status: 429 });
    }
    if (method === "sendMessage" && body.text === "RATE" && first429) {
      first429 = false;
      return new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 0 } }), { status: 429 });
    }
    const r = responses[method] ?? (method === "getMe" ? { username: "timos_test_bot" } : method === "getUpdates" ? [] : { message_id: 1 });
    return new Response(JSON.stringify({ ok: true, result: r }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function mkBot(token = "111111:TESTTOKENTESTTOKENTESTTOKEN12345", failPhoto = false) {
  const ctx = mkCtx({ AUTONOMOUS: "false", TELEGRAM_BOT_TOKEN: token, TELEGRAM_ALLOWED_USER_ID: "42" });
  await ctx.agent.scanOnce();
  const { f, calls } = fakeTelegram({}, failPhoto);
  const bot = new TelegramBot(ctx, new MentorService(ctx), { token, allowedUserId: "42", fetchImpl: f, pollTimeoutSec: 0 });
  return { ctx, bot, calls };
}

test("bot: yalnızca izinli kullanıcıya cevap verir", async () => {
  const { bot, calls } = await mkBot();
  await bot.handleUpdate({ update_id: 1, message: { text: "/durum", from: { id: 999 }, chat: { id: 999 } } });
  assert.equal(calls.length, 0);
  await bot.handleUpdate({ update_id: 2, message: { text: "/durum", from: { id: 42 }, chat: { id: 42 } } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.chat_id, "42");
});

test("bot: /kesfet kalp/kırık kalp kartı; kalp → takip + analiz + sıradaki aday (web ile ortak)", async () => {
  const { ctx, bot, calls } = await mkBot();
  await bot.handleCommand("/kesfet");
  const kb = calls.at(-1)!.body.reply_markup.inline_keyboard[0];
  assert.equal(kb.length, 2);
  assert.match(kb[0].text, /💔/);
  assert.match(kb[1].text, /❤️/);
  const sym = kb[1].callback_data.split(":")[1];
  await bot.handleCallback(`like:${sym}`);
  assert.ok(ctx.store.follows.includes(sym));
  assert.match(calls.at(-2)!.body.text, /takipte/);
  assert.ok(calls.at(-1)!.body.reply_markup); // sıradaki aday
  const next = calls.at(-1)!.body.reply_markup.inline_keyboard[0][0].callback_data.split(":")[1];
  await bot.handleCallback(`pass:${next}`);
  assert.ok(ctx.store.passed.has(next));
});

test("bot: slash olmayan mesaj mentora gider ve sohbet geçmişi ortak", async () => {
  const { ctx, bot, calls } = await mkBot();
  await bot.handleUpdate({ update_id: 3, message: { text: "adaylar", from: { id: 42 }, chat: { id: 42 } } });
  assert.ok(ctx.store.chat.some((m) => m.via === "telegram" && m.role === "user" && m.text === "adaylar"));
  assert.match(calls.at(-1)!.body.text, /aday/i);
});

test("bot: 429'da retry_after kadar bekleyip yeniden dener", async () => {
  const { bot, calls } = await mkBot();
  const ok = await bot.send("RATE");
  assert.equal(ok, true);
  assert.equal(calls.filter((c) => c.method === "sendMessage").length, 2);
});

test("bot: başlangıçta eski güncellemeleri atlar; token hiçbir durum/önizlemede geçmez", async () => {
  const token = "222222:SECRETSECRETSECRETSECRET99999";
  const ctx = mkCtx({ AUTONOMOUS: "false", TELEGRAM_BOT_TOKEN: token, TELEGRAM_ALLOWED_USER_ID: "42" });
  const { f, calls } = fakeTelegram({ getUpdates: [{ update_id: 500, message: { text: "eski", from: { id: 42 }, chat: { id: 42 } } }] });
  const bot = new TelegramBot(ctx, new MentorService(ctx), { token, allowedUserId: "42", fetchImpl: f, pollTimeoutSec: 0 });
  await bot.start();
  bot.stop();
  const gu = calls.filter((c) => c.method === "getUpdates");
  assert.equal(gu[0].body.offset, -1);
  assert.equal(calls.filter((c) => c.method === "sendMessage").length, 0);
  assert.equal(JSON.stringify(bot.status()).includes("SECRETSECRET"), false);
  assert.equal(JSON.stringify(bot.preview).includes("SECRETSECRET"), false);
});

test("bot: takip dışı coin gelişmesi gönderilmez, takip edilen gönderilir (en fazla 2 düğme)", async () => {
  const { ctx, bot, calls } = await mkBot();
  assert.equal(await bot.notify({ kind: "development", symbol: "SOL-USDT", text: "SOL hareketi" }), false);
  ctx.store.follow("SOL-USDT");
  assert.equal(await bot.notify({ kind: "development", symbol: "SOL-USDT", text: "SOL hareketi", buttons: [{ text: "Analiz", data: "an:SOL-USDT" }, { text: "Takibi bırak", data: "unf:SOL-USDT" }, { text: "X", data: "x" }] }), true);
  assert.equal(calls.at(-1)!.body.reply_markup.inline_keyboard[0].length, 2);
});

test("PNG: dosyaya yazılır; imza, IHDR (800x450 RGBA), CRC ve zlib verisi geçerli", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 6) * 3 + i * 0.05);
  const png = renderLineChartPng(closes, [{ v: 101, kind: "entry" }, { v: 98, kind: "stop" }, { v: 106, kind: "target" }]);
  const file = path.join(os.tmpdir(), `timosai-grafik-${process.pid}.png`);
  fs.writeFileSync(file, png);
  const back = fs.readFileSync(file);
  assert.ok(back.length > 2000 && back.length < 400_000, `boyut ${back.length}`);
  assert.deepEqual([...back.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(back.toString("ascii", 12, 16), "IHDR");
  assert.equal(back.readUInt32BE(16), 800);
  assert.equal(back.readUInt32BE(20), 450);
  assert.equal(back[25], 6);
  assert.equal(back.readUInt32BE(29), crc32(back.subarray(12, 29)));
  const idatLen = back.readUInt32BE(33);
  assert.equal(back.toString("ascii", 37, 41), "IDAT");
  const raw = zlib.inflateSync(back.subarray(41, 41 + idatLen));
  assert.equal(raw.length, (800 * 4 + 1) * 450);
  assert.equal(back.subarray(-8, -4).toString("ascii"), "IEND");
  fs.unlinkSync(file);
});

test("bot: /kesfet sendPhoto multipart gövdesinde PNG imzası, düğmeler aynı mesajda, caption ≤ 1024", async () => {
  const { bot, calls } = await mkBot();
  await bot.handleCommand("/kesfet");
  const call = calls.at(-1)!;
  assert.equal(call.method, "sendPhoto");
  assert.ok(call.raw!.includes(PNG_SIGNATURE), "PNG imzası yok");
  assert.ok(call.raw!.includes(Buffer.from('filename="grafik.png"')));
  assert.equal(call.body.chat_id, "42");
  assert.ok(call.body.caption.length <= CAPTION_MAX);
  assert.match(call.body.caption, /Fırsat \d+ · Risk \d+/);
  const kb = call.body.reply_markup.inline_keyboard[0];
  assert.match(kb[0].text, /💔/);
  assert.match(kb[1].text, /❤️/);
});

test("bot: sendPhoto başarısız olursa aynı içerik sparkline'lı metin olarak gider, çökmez, token sızmaz", async () => {
  const { bot, calls } = await mkBot("333333:LEAKLEAKLEAKLEAKLEAKLEAK7777", true);
  await bot.handleCommand("/kesfet");
  assert.equal(calls.at(-2)!.method, "sendPhoto");
  const txt = calls.at(-1)!;
  assert.equal(txt.method, "sendMessage");
  assert.match(txt.body.text, /[▁▂▃▄▅▆▇█]{8,}/);
  assert.ok(txt.body.reply_markup.inline_keyboard[0].length === 2);
  assert.match(bot.status().lastError ?? "", /IMAGE_PROCESS_FAILED/);
  assert.equal(JSON.stringify(bot.status()).includes("LEAKLEAK"), false);
});

test("bot: sendPhoto 429'da retry_after'a uyar", async () => {
  const { ctx, bot, calls } = await mkBot();
  const c = ctx.agent.queue()[0];
  const ok = await bot.sendPhoto(renderLineChartPng(c.spark), "RATE", undefined, "yedek");
  assert.equal(ok, true);
  assert.equal(calls.filter((x) => x.method === "sendPhoto").length, 2);
  assert.equal(calls.filter((x) => x.method === "sendMessage").length, 0);
});

test("caption 1024 karakteri aşmaz", async () => {
  const { ctx } = await mkBot();
  const c = { ...ctx.agent.queue()[0], reason: "uzun ".repeat(600) };
  const cap = candidateCaption(c, "Gelişme: ".repeat(50));
  assert.ok(cap.length <= CAPTION_MAX, String(cap.length));
  assert.ok(cap.endsWith("…"));
});

test("bot: takip edilen coin bildiriminde mini grafik; takip dışı/elde tutulan için metin", async () => {
  const { ctx, bot, calls } = await mkBot();
  const [a, b] = ctx.agent.queue();
  ctx.store.follow(a.instId);
  await bot.notify({ kind: "development", symbol: a.instId, text: `${a.base} 15 dakikada +1,2% hareket etti.`, buttons: [{ text: "Analiz", data: `an:${a.instId}` }, { text: "Takibi bırak", data: `unf:${a.instId}` }] });
  const p = calls.at(-1)!;
  assert.equal(p.method, "sendPhoto");
  assert.ok(p.raw!.includes(PNG_SIGNATURE));
  assert.match(p.body.caption, /hareket etti/);
  assert.equal(p.body.reply_markup.inline_keyboard[0].length, 2);
  await bot.notify({ kind: "warning", text: "Uyarı: test" });
  assert.equal(calls.at(-1)!.method, "sendMessage");
  void b;
});
