import test from "node:test";
import assert from "node:assert/strict";
import { mkCtx } from "./helpers.js";
import { validateAddress, resolveChain } from "../../src/discover/dex.js";
import { InstrumentCatalog } from "../../src/market/instruments.js";
import { installExtensions } from "../../src/extensions.js";
import { createApp } from "../../src/app.js";

test("DEX: adres biçimi zincire göre (EVM 0x+40 hex, Solana base58)", () => {
  assert.equal(validateAddress("43114", "0x" + "a".repeat(40)).ok, true);
  assert.equal(validateAddress("43114", "0x123").ok, false);
  assert.equal(validateAddress("solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").ok, true);
  assert.equal(validateAddress("solana", "0x" + "a".repeat(40)).ok, false);
  assert.equal(resolveChain("bsc"), "56");
  assert.equal(resolveChain("tron"), null);
});

test("CEX kataloğu: ATK enstrüman listesinden arama ve yalnızca borsada olan pariteler", async () => {
  const rows = [
    { instId: "AVAX-USDT", baseCcy: "AVAX", quoteCcy: "USDT", tickSz: "0.001", lotSz: "0.0001", minSz: "0.01", state: "live" },
    { instId: "AVAX-BTC", baseCcy: "AVAX", quoteCcy: "BTC", tickSz: "0.0000001", lotSz: "0.0001", minSz: "0.01", state: "live" },
    { instId: "AVAX-TRY", baseCcy: "AVAX", quoteCcy: "TRY", tickSz: "0.01", lotSz: "0.0001", minSz: "0.01", state: "live" },
    { instId: "AVAX-EUR", baseCcy: "AVAX", quoteCcy: "EUR", tickSz: "0.01", lotSz: "0.0001", minSz: "0.01", state: "live" },
    { instId: "AAVE-USDT", baseCcy: "AAVE", quoteCcy: "USDT", tickSz: "0.01", lotSz: "0.0001", minSz: "0.01", state: "live" },
  ];
  const calls: string[] = [];
  const atk = { available: () => true, toolNames: () => [], call: async (n: string) => (calls.push(n), rows) } as any;
  const cat = new InstrumentCatalog(atk);
  await cat.ensure();
  await cat.ensure(); // 1 saat önbellek
  assert.deepEqual(calls, ["market_get_instruments"]);
  const r = cat.search("av");
  assert.equal(r[0].base, "AVAX");
  assert.deepEqual(r[0].pairs, ["AVAX-USDT", "AVAX-BTC", "AVAX-TRY"]); // EUR aranabilir kotelerde değil, USDC borsada yok
  assert.equal(cat.search("avalanche")[0].base, "AVAX");
  assert.deepEqual(cat.pairsOf("AVAX").map((p) => p.instId), ["AVAX-USDT", "AVAX-BTC", "AVAX-TRY"]);
  assert.equal(cat.get("AVAX-BTC")!.tickSz, 0.0000001);
});

test("CEX görünümü: izin listesi dışındaki paritede 'işlem izin listesinde değil' notu; geçersiz parite 400", async () => {
  const ctx = mkCtx({ AUTONOMOUS: "false" });
  await installExtensions(ctx, { fetchImpl: (async () => new Response("{}", { status: 500 })) as any });
  await ctx.agent.scanOnce();
  const srv = createApp(ctx).listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${(srv.address() as any).port}`;
  try {
    const v: any = await (await fetch(base + "/api/cex/view/SOL-USDC")).json();
    assert.equal(v.pair.tradable, false);
    assert.equal(v.tradeNote, "Analiz için; işlem izin listesinde değil.");
    assert.ok(v.pairs.some((p: any) => p.instId === "SOL-USDT"));
    const u: any = await (await fetch(base + "/api/cex/view/SOL-USDT")).json();
    assert.equal(u.pair.tradable, true);
    assert.equal((await fetch(base + "/api/cex/view/SOL-XYZ")).status, 400);
    const s: any = await (await fetch(base + "/api/cex/search?q=so")).json();
    assert.equal(s.results[0].base, "SOL");
    const d: any = await (await fetch(base + "/api/dex/search?q=PEPE")).json();
    assert.match(d.warning, /sahte tokenlar/);
  } finally {
    srv.close();
  }
});
