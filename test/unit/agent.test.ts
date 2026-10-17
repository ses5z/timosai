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

test("ajan: uygun kararda KURU emir verir ve stop'ta kapatır; zarardan sonra çalışmaya devam eder", async () => {
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
