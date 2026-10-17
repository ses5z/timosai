import test from "node:test";
import assert from "node:assert/strict";
import { loadEnv, parseEnvFile, missingEnvLines } from "../../src/config/env.js";
import { SignalLedger } from "../../src/ledger/signalLedger.js";
import { mask, registerSecrets } from "../../src/util/log.js";
import { mkCtx } from "./helpers.js";
import { createApp } from "../../src/app.js";

test(".env yokken çökmez, varsayılanlar güvenli", () => {
  const env = loadEnv({ file: "/yok/.env", source: {} });
  assert.equal(env.envFileFound, false);
  assert.equal(env.live, false);
  assert.ok(missingEnvLines(env).includes("GEMINI_API_KEY"));
});

test(".env ayrıştırıcı tırnak ve yorumları işler", () => {
  const r = parseEnvFile(`# yorum\nA=1\nB="iki"\n\nC='uc'\nBOZUK`);
  assert.deepEqual(r, { A: "1", B: "iki", C: "uc" });
});

test("ledger sha256 zinciri doğrulanır ve bozulma yakalanır", () => {
  const l = new SignalLedger();
  l.append("decision", { a: 1 });
  l.append("order", { b: 2 });
  assert.equal(l.verify(), true);
  (l.list()[0].data as any).b = 3;
  assert.equal(l.verify(), false);
});

test("sır değerleri maskelenir", () => {
  registerSecrets(["SUPERSECRETKEY123", "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]);
  const out = mask("anahtar SUPERSECRETKEY123 ve https://api.telegram.org/bot123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/getMe");
  assert.equal(out.includes("SUPERSECRETKEY123"), false);
  assert.equal(out.includes("AAAAAAAAAAAAAAAA"), false);
});

async function withServer<T>(ctx: ReturnType<typeof mkCtx>, fn: (base: string) => Promise<T>): Promise<T> {
  const app = createApp(ctx);
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as any).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    srv.close();
  }
}

test("API: anahtarlar hiçbir yanıtta geçmez; kullanıcı emir uç noktası yok", async () => {
  const ctx = mkCtx({ GEMINI_API_KEY: "GEMINIKEY_abcdefgh123", TELEGRAM_BOT_TOKEN: "987654321:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", OKX_API_KEY: "okxkey-xyz-0000", OKX_API_SECRET: "okxsecret-0000", OKX_API_PASSPHRASE: "passphrase-0000" });
  await ctx.agent.scanOnce();
  await withServer(ctx, async (base) => {
    const bodies: string[] = [];
    for (const p of ["/api/status", "/api/candidates", "/api/portfolio", "/api/contract", "/api/events", "/api/atk", "/api/ledger", "/api/settings"]) {
      const r = await fetch(base + p);
      assert.equal(r.status, 200, p);
      bodies.push(await r.text());
    }
    const all = bodies.join("\n");
    for (const s of ["GEMINIKEY_abcdefgh123", "BBBBBBBBBBBBBBBB", "okxkey-xyz-0000", "okxsecret-0000", "passphrase-0000"]) assert.equal(all.includes(s), false, s);
    for (const p of ["/api/order", "/api/orders", "/api/trade", "/api/buy", "/api/sell", "/api/manual-order"]) {
      const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instId: "SOL-USDT", side: "buy", sz: 5 }) });
      assert.equal(r.status, 404, p);
    }
  });
});

test("API: 15 coin takibe alınınca yumuşak uyarı döner, kilit yok", async () => {
  const ctx = mkCtx();
  await ctx.agent.scanOnce();
  await withServer(ctx, async (base) => {
    let last: any = null;
    for (const c of ctx.agent.queue().slice(0, 15)) {
      const r = await fetch(base + "/api/follows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instId: c.instId }) });
      last = await r.json();
    }
    assert.equal(last.follows.length, 15);
    assert.ok(last.softWarning);
    const r16 = await fetch(base + "/api/follows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instId: ctx.agent.queue()[15].instId }) });
    assert.equal(r16.status, 200);
  });
});
