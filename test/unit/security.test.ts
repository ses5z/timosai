import test from "node:test";
import assert from "node:assert/strict";
import { decide, goplusFindings, GoPlusSecurity, ScamScanner, type SourceResult } from "../../src/security/tokenSecurity.js";
import { buildHoldReport } from "../../src/fundamentals/holdReport.js";

const src = (o: Partial<SourceResult>): SourceResult => ({ source: "X", available: true, honeypot: false, warnings: [], raw: {}, ...o });

test("scam oylaması: herhangi bir kaynak honeypot → BLOCK; uyarı → WARN; temiz → PASS; kaynak yok → veri yok", () => {
  assert.equal(decide([src({ source: "GoPlus", honeypot: true }), src({ source: "OnchainOS" })]).verdict, "BLOCK");
  assert.equal(decide([src({ warnings: ["Satış vergisi %25.0 (> %10)"] })]).verdict, "WARN");
  assert.equal(decide([src({})]).verdict, "PASS");
  const none = decide([src({ available: false })]);
  assert.equal(none.verdict, "WARN");
  assert.match(none.reasons[0], /veri yok/);
});

test("scam: çelişkide simülasyon kazanır", () => {
  const d = decide([src({ source: "GoPlus", honeypot: true })], src({ source: "Simülasyon", honeypot: false }));
  assert.equal(d.verdict, "PASS");
  assert.ok(d.reasons.some((r) => r.includes("simülasyon")));
});

test("GoPlus bulguları: vergi > %10, mint, sahip bakiye değiştirme, kilitsiz LP → uyarı", () => {
  const f = goplusFindings({ is_honeypot: "0", buy_tax: "0.12", sell_tax: "0.3", is_mintable: "1", owner_change_balance: "1", lp_holders: [{ is_locked: 0, percent: "0.9" }] });
  assert.equal(f.honeypot, false);
  assert.equal(f.warnings.length, 5);
  assert.equal(goplusFindings({ is_honeypot: "1" }).honeypot, true);
});

test("tarayıcı: geçersiz adres/zincir reddedilir; sahte fetch ile GoPlus honeypot → BLOCK", async () => {
  const addr = "0x" + "ab".repeat(20);
  const f = (async () => new Response(JSON.stringify({ code: 1, result: { [addr]: { token_name: "Tuzak", token_symbol: "TZK", is_honeypot: "1", sell_tax: "1" } } }), { status: 200 })) as unknown as typeof fetch;
  const s = new ScamScanner([new GoPlusSecurity(f)]);
  await assert.rejects(() => s.scan("avax", "0x123"), /Geçersiz/);
  await assert.rejects(() => s.scan("tron", addr), /Desteklenmeyen/);
  const r = await s.scan("avax", addr);
  assert.equal(r.verdict, "BLOCK");
  assert.equal(r.token?.symbol, "TZK");
});

test("hold raporu: yüksek FDV/MC + 90 günde büyük kilit açılımı → hold riskli; düşük dolaşım → manipülasyona açık", () => {
  const now = Date.parse("2026-10-17T00:00:00Z");
  const r = buildHoldReport("XYZ", { circulating: 200, total: 1000, max: 1000, marketCap: 100, fdv: 500, source: "test" }, [{ coin: "XYZ", date: "2026-11-20", pctOfCirculating: 15, source: "x", sample: true }], { volumeScore: 20, risk: 60 }, now);
  assert.equal(r.verdict, "ikisi de riskli");
  assert.ok(r.reasons.some((x) => x.includes("hold riskli")));
  assert.ok(r.reasons.some((x) => x.includes("manipülasyona açık")));
  assert.equal(r.distribution.status, "veri yok");
  const btc = buildHoldReport("BTC", { circulating: 19.9e6, total: 19.9e6, max: 21e6, marketCap: 1.6e12, fdv: 1.7e12, source: "test" }, [], { volumeScore: 70, risk: 30 }, now);
  assert.equal(btc.verdict, "hold profiline uygun");
  assert.equal(btc.distribution.status, "uygulanmaz");
  const trade = buildHoldReport("ABC", { circulating: 400, total: 1000, max: null, marketCap: 100, fdv: 250, source: "test" }, [], { volumeScore: 100, risk: 30 }, now);
  assert.equal(trade.verdict, "kısa vade trade edilebilir");
});

test("Güncelleme2 madde 3: hold raporu hacim kuralı skor motoruyla aynı fonksiyon/eşik (hacim skoru 100 iken 'hacim düşük' yazmaz)", async () => {
  const { volumeScore, isVolumeLow } = await import("../../src/agent/scoring.js");
  const s = { circulating: 400, total: 1000, max: null, marketCap: 100, fdv: 250, source: "test" };
  const hi = buildHoldReport("ABC", s, [], { volumeScore: volumeScore(3, 1), risk: 30 });
  assert.equal(volumeScore(3, 1), 100);
  assert.equal(hi.reasons.some((r) => r.includes("Hacim düşük")), false);
  const lo = buildHoldReport("ABC", s, [], { volumeScore: volumeScore(0.4, -1), risk: 30 });
  assert.equal(isVolumeLow(volumeScore(0.4, -1), {}), true);
  assert.ok(lo.reasons.some((r) => r.includes("Hacim düşük")));
});
