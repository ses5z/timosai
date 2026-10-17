import test from "node:test";
import assert from "node:assert/strict";
import { mkCtx } from "./helpers.js";
import { installExtensions } from "../../src/extensions.js";
import { createApp } from "../../src/app.js";
import { liquidationPrice } from "../../src/trading/quick.js";
import { MentorTools, activeToolDefs } from "../../src/mentor/tools.js";

async function ctxWith(flag: boolean) {
  const ctx = mkCtx({ AUTONOMOUS: "false", QUICK_COMMANDS: flag ? "true" : "false" });
  await installExtensions(ctx, { fetchImpl: (async () => new Response("{}", { status: 500 })) as any });
  await ctx.agent.scanOnce();
  return ctx;
}

test("bayrak kapalı: /al reddedilir, /api/quick 404, mentor hizli_islem aracını görmez", async () => {
  const ctx = await ctxWith(false);
  const r = await ctx.extras.quick.run("/al SOL 5", "test");
  assert.equal(r.ok, false);
  assert.equal(ctx.agent.trading.listPositions().length, 0);
  assert.equal(activeToolDefs(new MentorTools(ctx)).some((d) => d.name === "hizli_islem"), false);
  const app = createApp(ctx);
  const srv = app.listen(0);
  await new Promise((res) => srv.once("listening", res));
  const port = (srv.address() as any).port;
  const res = await fetch(`http://127.0.0.1:${port}/api/quick`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "/al SOL 5" }) });
  srv.close();
  assert.equal(res.status, 404);
  const m = await ctx.extras.mentor.chat("/al SOL 5");
  assert.equal(ctx.agent.trading.listPositions().length, 0);
  assert.match(m.text, /Emir veremem|kapalı/);
});

test("bayrak açık: /al tutarı 5 USDT'ye kırpar ve söyler, zorunlu stop konur, HIZLI etiketi", async () => {
  const ctx = await ctxWith(true);
  const r = await ctx.extras.quick.run("/al SOL 20", "test");
  assert.equal(r.ok, true, r.text);
  assert.match(r.text, /kırpıldı/);
  const p = ctx.agent.trading.listPositions()[0];
  assert.equal(p.costUsdt, 5);
  assert.ok(p.stopPx > 0 && p.stopPx < p.entryPx);
  assert.equal(ctx.agent.trading.listTrades()[0].origin, "hızlı");
  const k = await ctx.extras.quick.run("/kapat SOL", "test");
  assert.equal(k.ok, true);
  assert.equal(ctx.agent.trading.listPositions().length, 0);
});

test("bayrak açık: sert limit kapısı atlanmaz (4. pozisyon reddedilir)", async () => {
  const ctx = await ctxWith(true);
  for (const s of ["SOL", "ETH", "BTC"]) assert.equal((await ctx.extras.quick.run(`/al ${s} 5`, "t")).ok, true);
  const r = await ctx.extras.quick.run("/al XRP 1", "t");
  assert.equal(r.ok, false);
  assert.match(r.text, /Toplam açık|Açık pozisyon/);
});

test("kaldıraçlı komut yalnızca SİMÜLASYON; likidasyon fiyatı hesaplanır, gerçek pozisyon açılmaz", async () => {
  const ctx = await ctxWith(true);
  const r = await ctx.extras.quick.run("/l SOL 5x 20", "t");
  assert.equal(r.ok, true);
  assert.match(r.text, /SİMÜLASYON/);
  assert.equal(ctx.agent.trading.listPositions().length, 0);
  const s = ctx.extras.quick.simView()[0];
  assert.ok(Math.abs(s.liqPx - liquidationPrice("long", s.entryPx, 5)) / s.liqPx < 1e-3);
  assert.ok(liquidationPrice("short", 100, 4) > 100 && liquidationPrice("long", 100, 4) < 100);
});
