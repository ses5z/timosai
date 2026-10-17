import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSupply, SupplyService } from "../../src/fundamentals/supply.js";
import { buildHoldReport } from "../../src/fundamentals/holdReport.js";

const now = Date.parse("2026-10-17T00:00:00Z");
const day = 86_400_000;
const series = (g: number, jumpAt?: number) => Array.from({ length: 366 }, (_, i) => ({ t: now - (365 - i) * day, circ: 1e9 * Math.pow(1 + g, i / 365) * (jumpAt !== undefined && i >= jumpAt ? 1.05 : 1) }));

test("arz değişimi: 1G/1A/1Y ve yıllık enflasyon (MC/fiyat tahmini), sıçrama işareti", () => {
  const r = analyzeSupply("XYZ", { circulating: 1e9, total: 2e9, max: 2e9, marketCap: 1e8, fdv: 2e8, source: "t" }, series(0.12, 300), [], now);
  assert.ok(r.change!.y1! > 15 && r.change!.y1! < 20, String(r.change!.y1));
  assert.ok(r.change!.m1! > 0);
  assert.equal(r.change!.estimated, true);
  assert.equal(r.jumps.length, 1);
  assert.equal(r.structure!.capped, true);
  assert.equal(r.structure!.circulatingPct, 50);
});

test("deflasyon: arz azalıyorsa 'deflasyonist'; sınırsız arz rozeti", () => {
  const r = analyzeSupply("ETH", { circulating: 1e8, total: 1e8, max: null, marketCap: 1e11, fdv: 1e11, source: "t" }, series(-0.01), [], now);
  assert.equal(r.change!.deflationary, true);
  assert.equal(r.structure!.capped, false);
  assert.ok(r.pressure.reasons.some((x) => x.includes("deflasyonist")));
});

test("açılım: sonraki tarih, miktar, 30/90 gün toplamı; arz baskısı yüksek → hold raporu riskli", () => {
  const unlocks = [{ coin: "XYZ", date: "2026-10-27", pctOfCirculating: 6, source: "x", sample: true }, { coin: "XYZ", date: "2026-12-20", pctOfCirculating: 8, source: "x", sample: true }];
  const r = analyzeSupply("XYZ", { circulating: 1e9, total: 3e9, max: 3e9, marketCap: 1e8, fdv: 3e8, source: "t" }, series(0.15), unlocks, now);
  assert.equal(r.unlocks.next!.date, "2026-10-27");
  assert.equal(r.unlocks.next!.amountTokens, 6e7);
  assert.equal(r.unlocks.total30dPct, 6);
  assert.equal(r.unlocks.total90dPct, 14);
  assert.equal(r.pressure.level, "yüksek");
  const h = buildHoldReport("XYZ", { circulating: 1e9, total: 3e9, max: 3e9, marketCap: 1e8, fdv: 3e8, source: "t" }, [], { volumeScore: 80, risk: 30 }, now, r.pressure);
  assert.ok(h.reasons[0].startsWith("Arz baskısı yüksek"));
  assert.notEqual(h.verdict, "hold profiline uygun");
});

test("arz servisi: 1 saat önbellek; CoinGecko'ya ulaşılamazsa 'veri yok' (sahte veri yok)", async () => {
  let n = 0;
  const f = (async () => (n++, new Response("rate limited", { status: 429 }))) as unknown as typeof fetch;
  const svc = new SupplyService(async () => null, f, false);
  const r = await svc.report("AVAX");
  assert.equal(r.available, false);
  assert.match(r.note!, /veri yok/);
  const ok = new SupplyService(async () => ({ circulating: 1, total: 2, max: 2, marketCap: 1, fdv: 2, source: "t" }), (async () => (n++, new Response(JSON.stringify({ market_caps: [[now - day, 10], [now, 11]], prices: [[now - day, 10], [now, 10]] }), { status: 200 }))) as unknown as typeof fetch, false);
  await ok.report("AVAX");
  const before = n;
  await ok.report("AVAX");
  assert.equal(n, before);
});
