import test from "node:test";
import assert from "node:assert/strict";
import { mkCtx } from "./helpers.js";
import { RuleDecisionProvider } from "../../src/agent/decisionProvider.js";
import { DEFAULT_THRESHOLDS } from "../../src/agent/thresholds.js";
import { sizePosition, buildPlan } from "../../src/agent/sizing.js";
import { resolveHardLimits } from "../../src/trading/hardLimits.js";
import { computeRiskScore, checkAgentEntry, DEFAULT_CONTRACT } from "../../src/contract/contract.js";
import { WarningCenter } from "../../src/contract/warnings.js";
import type { Candle } from "../../src/util/math.js";

function trendCandles(dir: 1 | -1, n = 100, p0 = 100): Candle[] {
  const out: Candle[] = [];
  let p = p0;
  for (let i = 0; i < n; i++) {
    const o = p;
    p = p * (1 + dir * 0.0015 + (i % 3 === 0 ? -0.0006 : 0.0004));
    out.push({ ts: i * 900_000, open: o, high: Math.max(o, p) * 1.001, low: Math.min(o, p) * 0.999, close: p, vol: 1e6 * (i > 95 ? 2 : 1) });
  }
  return out;
}

const tick = (c: Candle[]) => ({ instId: "SOL-USDT", last: c.at(-1)!.close, open24h: c[4].close, high24h: Math.max(...c.map((x) => x.high)), low24h: Math.min(...c.map((x) => x.low)), change24hPct: ((c.at(-1)!.close - c[4].close) / c[4].close) * 100, volUsdt24h: 1e8, ts: 0 });

test("skorlama: yükselen trend 'ele'den iyi, düşen trend 'aç' olmaz", () => {
  const dp = new RuleDecisionProvider(DEFAULT_THRESHOLDS);
  const up = trendCandles(1);
  const down = trendCandles(-1);
  const a = dp.decide({ instId: "SOL-USDT", category: "x", ticker: tick(up), candles: up, rsi: 60, funding: 0.00001, sentiment: 0.2, orderbook: { bid: 1, ask: 1.0001, spreadPct: 0.01, depthUsdt: 1e6 }, live: true });
  const b = dp.decide({ instId: "SOL-USDT", category: "x", ticker: tick(down), candles: down, rsi: 35, funding: 0.00001, sentiment: -0.2, orderbook: null, live: true });
  assert.ok(a.opportunity > b.opportunity);
  assert.notEqual(b.decision, "aç");
  assert.ok(a.stop < a.entry && a.target > a.entry);
  assert.ok(a.rr >= 1.9);
  assert.equal(a.security.label, "ÖRNEK VERİ");
  assert.ok(a.reason.length > 10);
});

test("boyutlandırma: risk bütçesi ve sert limitlerle kırpılır", () => {
  const limits = resolveHardLimits({});
  const s = sizePosition({ equityUsdt: 30, riskPct: 1, entry: 100, stop: 99, openNotionalUsdt: 0, limits });
  assert.equal(s.notionalUsdt, 5);
  assert.equal(s.cappedBy, "tek emir limiti");
  const s2 = sizePosition({ equityUsdt: 30, riskPct: 1, entry: 100, stop: 90, openNotionalUsdt: 0, limits });
  assert.equal(s2.notionalUsdt, 3);
  assert.equal(s2.cappedBy, "risk");
  const s3 = sizePosition({ equityUsdt: 30, riskPct: 1, entry: 100, stop: 99, openNotionalUsdt: 14.5, limits });
  assert.equal(s3.notionalUsdt, 0);
});

test("plan: en fazla 3 satır dahil, toplam ≤ 15 USDT", () => {
  const limits = resolveHardLimits({});
  const items = ["A", "B", "C", "D"].map((x, i) => ({ instId: `${x}-USDT`, entry: 10, stop: 9.9, target: 10.2, rr: 2, opportunity: 70 - i, risk: 20 }));
  const p = buildPlan(items, { equityUsdt: 30, riskPct: 1, openNotionalUsdt: 0, openCount: 0, limits });
  assert.equal(p.rows.filter((r) => r.included).length, 3);
  assert.ok(p.totalNotional <= 15);
  assert.ok(p.notes.some((n) => n.includes("ajan")));
});

test("risk skoru zararla artar ama hiçbir kilit üretmez", () => {
  const base = { dailyLossWarnUsdt: 5, openNotional: 0, maxTotalOpen: 15, ordersLastHour: 0, maxOrdersPerHour: 6, openCount: 0, maxOpen: 3, blockedLastHour: 0, lossStreak: 0 };
  const a = computeRiskScore({ ...base, dailyPnl: 0 });
  const b = computeRiskScore({ ...base, dailyPnl: -6, lossStreak: 3 });
  assert.ok(b.score > a.score);
  assert.equal(Object.keys(b).includes("locked"), false);
});

test("uyarı merkezi: 60 sn içinde aynı uyarı tekrar çıkmaz, sonra çıkar", () => {
  let now = 0;
  const w = new WarningCenter(60_000, () => now);
  assert.ok(w.raise("ajan_engelledi", "SOL", "t", "x", [], 10));
  now = 30_000;
  assert.equal(w.raise("ajan_engelledi", "SOL", "t", "x", [], 10), null);
  now = 61_000;
  assert.ok(w.raise("ajan_engelledi", "SOL", "t", "x", [], 10));
  assert.equal(w.total(), 2);
});

test("sözleşme: düşük R:R ve yüksek risk skorunu yakalar", () => {
  const c: any = { entry: 100, stop: 99, target: 100.5, rr: 0.5, risk: 30, security: { spreadPct: 0.01 } };
  const items = checkAgentEntry(c, { notionalUsdt: 5, qty: 0.05, riskUsdt: 0.05, stopPct: 1, cappedBy: "risk", explain: "" }, { riskScore: 80, equityUsdt: 30, riskPct: 1, rules: DEFAULT_CONTRACT });
  assert.ok(items.some((i) => i.label.includes("R:R")));
  assert.ok(items.some((i) => i.label.includes("Risk skoru")));
});

test("ajan: örnek veriyle tarar, kuyruk üretir, sözleşmeye aykırı kararı göndermez ve uyarı açar", async () => {
  const ctx = mkCtx({ AUTONOMOUS: "false" });
  const res = await ctx.agent.scanOnce();
  assert.ok(res.length >= 20);
  const c = { ...ctx.agent.queue()[0], rr: 0.8, decision: "aç" as const };
  const warnings: string[] = [];
  ctx.warnings.onWarning((w) => warnings.push(w.text));
  const r = await ctx.agent.tryEnter(c);
  assert.equal(r.ok, false);
  assert.ok(warnings[0].startsWith("Ajan şu emri sözleşmeye aykırı buldu ve vermedi"));
  assert.equal(ctx.agent.trading.listPositions().length, 0);
});

test("ajan: uygun kararda PAPER emir verir ve stop'ta kapatır; zarardan sonra çalışmaya devam eder", async () => {
  const ctx = mkCtx({ AUTONOMOUS: "false" });
  await ctx.agent.scanOnce();
  const base = ctx.agent.queue()[0];
  const c = { ...base, decision: "aç" as const, rr: 2, risk: 20, entry: base.price, stop: base.price * 0.99, target: base.price * 1.02, security: { ...base.security, spreadPct: 0.01 } };
  const r = await ctx.agent.tryEnter(c);
  assert.equal(r.ok, true, r.reason);
  ctx.mock.setPrice(c.instId, c.price * 0.97);
  await ctx.agent.priceTick();
  assert.equal(ctx.agent.trading.listPositions().length, 0);
  assert.ok(ctx.agent.trading.dailyPnl() < 0);
  const other = ctx.agent.queue().find((x) => x.instId !== c.instId)!;
  const r2 = await ctx.agent.tryEnter({ ...other, decision: "aç", rr: 2, risk: 20, entry: other.price, stop: other.price * 0.99, target: other.price * 1.02, security: { ...other.security, spreadPct: 0.01 } });
  assert.equal(r2.ok, true, r2.reason);
});

test("risk: art arda 3 zararda boyut yarıya iner, ilk kazançla normale döner", async () => {
  const ctx = mkCtx({ AUTONOMOUS: "false" });
  await ctx.agent.scanOnce();
  assert.equal(ctx.agent.sizeMultiplier(), 1);
  ctx.agent.lossStreak = 3;
  assert.equal(ctx.agent.sizeMultiplier(), 0.5);
  ctx.store.settings.halveAfterLosses = false;
  assert.equal(ctx.agent.sizeMultiplier(), 1);
  ctx.store.settings.halveAfterLosses = true;
  // geniş stoplu adayda yarım risk → yarım boyut
  const base = ctx.agent.queue()[0];
  const c = { ...base, decision: "aç" as const, rr: 2.2, risk: 20, entry: base.price, stop: base.price * 0.9, target: base.price * 1.25, security: { ...base.security, spreadPct: 0.01 } };
  const contractLoose = { ...ctx.contract, maxStopPct: 20 };
  (ctx.agent.d as any).contract = contractLoose;
  const r = await ctx.agent.tryEnter(c);
  assert.equal(r.ok, true, r.reason);
  assert.ok(Math.abs(r.position!.costUsdt - 1.5) < 0.02, String(r.position!.costUsdt)); // 30*%0.5/10% = 1.5
});

test("risk: stop olunan coine yeni kurulum oluşmadan tekrar girilmez", async () => {
  const ctx = mkCtx({ AUTONOMOUS: "false" });
  await ctx.agent.scanOnce();
  const base = ctx.agent.queue()[0];
  const c = { ...base, decision: "aç" as const, rr: 2.2, risk: 20, entry: base.price, stop: base.price * 0.99, target: base.price * 1.022, security: { ...base.security, spreadPct: 0.01 } };
  assert.equal((await ctx.agent.tryEnter(c)).ok, true);
  ctx.mock.setPrice(c.instId, c.price * 0.97);
  await ctx.agent.priceTick();
  assert.ok(ctx.agent.awaitingNewSetup.has(c.instId));
  // karar "aç" dışına çıkınca kurulum sıfırlanır
  ctx.agent.candidates.set(c.instId, { ...ctx.agent.candidates.get(c.instId)!, decision: "aç" });
  (ctx.agent as any).applyResults([{ ...ctx.agent.candidates.get(c.instId)!, decision: "izle" }]);
  assert.equal(ctx.agent.awaitingNewSetup.has(c.instId), false);
});

test("devre kesici: piyasa kaybı tetiklemez; ardışık teknik hata ve anormal emir sıklığı tetikler, tek tıkla devam", async () => {
  const ctx = mkCtx({ AUTONOMOUS: "false" });
  await ctx.agent.scanOnce();
  const base = ctx.agent.queue()[0];
  const c = { ...base, decision: "aç" as const, rr: 2.2, risk: 20, entry: base.price, stop: base.price * 0.99, target: base.price * 1.022, security: { ...base.security, spreadPct: 0.01 } };
  await ctx.agent.tryEnter(c);
  ctx.mock.setPrice(c.instId, c.price * 0.5); // büyük piyasa kaybı
  await ctx.agent.priceTick();
  assert.equal(ctx.agent.breaker.active, false);
  for (let i = 0; i < 5; i++) (ctx.agent as any).techFailure("ATK zaman aşımı");
  assert.equal(ctx.agent.breaker.active, true);
  const blocked = await ctx.agent.tryEnter({ ...c, instId: "ETH-USDT" });
  assert.match(blocked.reason, /Devre kesici/);
  ctx.agent.resumeBreaker();
  assert.equal(ctx.agent.breaker.active, false);
  // döngü hatası: 60 sn'de 5. deneme kesiciyi açar
  for (let i = 0; i < 5; i++) await ctx.agent.tryEnter({ ...c, rr: 0.5 });
  assert.equal(ctx.agent.breaker.active, true);
  assert.match(ctx.agent.breaker.reason, /anormal emir sıklığı/);
});

test("ATR trend filtresi: elle hesaplanmış fixture ile birebir", async () => {
  const fs = await import("node:fs");
  const { atrTrend } = await import("../../src/indicators/atrTrend.js");
  const fx = JSON.parse(fs.readFileSync("test/fixtures/atrtrend.json", "utf8"));
  const candles = fx.candles.map(([h, l, c]: number[], i: number) => ({ ts: i, open: c, high: h, low: l, close: c, vol: 1 }));
  const out = atrTrend(candles, fx.period, fx.mult);
  for (const e of fx.expected) {
    assert.equal(out[e.i].dir, e.dir, `yön i=${e.i}`);
    assert.ok(Math.abs(out[e.i].line - e.line) < 1e-9, `çizgi i=${e.i}: ${out[e.i].line} != ${e.line}`);
  }
});

test("ATR trend filtresi düşüşteyken ajan long açmaz (karar izle, gerekçede yazar)", () => {
  const dp = new RuleDecisionProvider(DEFAULT_THRESHOLDS);
  const up = trendCandles(1);
  // son mumlarda sert düşüş: trend çizgisi kırılır
  const crash = [...up.slice(0, 95), ...Array.from({ length: 5 }, (_, i) => { const p = up[94].close * (1 - 0.01 * (i + 1)); return { ts: 0, open: p, high: p * 1.001, low: p * 0.999, close: p, vol: 1e6 }; })];
  const d = dp.decide({ instId: "SOL-USDT", category: "x", ticker: tick(crash), candles: crash, rsi: 60, funding: 0.00001, sentiment: 0.5, orderbook: null, live: true });
  assert.equal(d.atrTrend?.dir, -1);
  assert.notEqual(d.decision, "aç");
});

test("Güncelleme2 madde 3: haber duygusu yoksa skor 'veri yok' (null), 50 değil; yön etiketinde zaman aralığı", () => {
  const dp = new RuleDecisionProvider(DEFAULT_THRESHOLDS);
  const up = trendCandles(1);
  const d = dp.decide({ instId: "SOL-USDT", category: "x", ticker: tick(up), candles: up, rsi: 60, funding: 0.00001, sentiment: null, orderbook: null, live: true });
  assert.equal(d.parts.sentiment, null);
  assert.match(d.direction, /^15 dk trend: (yukarı|aşağı|yatay)$/);
  assert.ok(d.whyBullets.some((b) => b.includes("Haber duygusu: veri yok")));
});

test("Güncelleme2 madde 3: her taramada news_get_coin_sentiment ve news_get_latest çağrılır", async () => {
  const calls: string[] = [];
  const { AtkMarketData } = await import("../../src/market/atkMarketData.js");
  const atk = { available: () => true, toolNames: () => [], call: async (n: string) => { calls.push(n); if (n.startsWith("news")) throw new Error("okx-auth rejected"); return []; } } as any;
  const m = new AtkMarketData(atk);
  await m.sentiment(["BTC", "SOL"]);
  await m.sentiment(["BTC", "SOL"]);
  await assert.rejects(() => m.news(["BTC"]));
  assert.equal(calls.filter((c) => c === "news_get_coin_sentiment").length, 2);
  assert.equal(calls.filter((c) => c === "news_get_latest").length, 1);
});
