import test from "node:test";
import assert from "node:assert/strict";
import { mkCtx } from "./helpers.js";
import { AlertEngine, DEFAULT_ALERTS } from "../../src/alerts/alertEngine.js";
import { volRatios } from "../../src/agent/decisionProvider.js";
import { NotifyPolicy } from "../../src/telegram/notifyPolicy.js";

async function setup() {
  const ctx = mkCtx({ AUTONOMOUS: "false" });
  await ctx.agent.scanOnce();
  let now = 1_800_000_000_000;
  const eng = new AlertEngine(ctx, { cfg: { ...DEFAULT_ALERTS, positiveNewsRe: "(listing|partnership)", criticalNewsRe: "(hack|exploit|delist|unlock)" }, events: [{ coin: "SOL", date: new Date(now + 5 * 3_600_000).toISOString(), title: "Ağ yükseltmesi", sample: true }], now: () => now });
  return { ctx, eng, tick: (ms: number) => (now += ms) };
}

test("hacim oranları: son saat 3 katı ise vol1hRatio ≥ 3", () => {
  const r = volRatios(Array.from({ length: 100 }, (_, i) => ({ vol: i >= 96 ? 300 : 100 })));
  assert.equal(r.vol1hRatio, 3);
  const r2 = volRatios(Array.from({ length: 100 }, (_, i) => ({ vol: i === 99 ? 300 : 100 })));
  assert.equal(r2.vol15mRatio, 3);
});

test("takip dışı coin için bildirim üretilmez; takip edilen için hacim/etkinlik/haber bildirimi", async () => {
  const { ctx, eng } = await setup();
  const sol = { ...ctx.agent.candidates.get("SOL-USDT")!, vol1hRatio: 4 };
  assert.equal(eng.evaluate([sol]).length, 0);
  ctx.store.follow("SOL-USDT");
  eng.setNews([{ coin: "SOL", title: "Big exchange listing announced", ts: 0 }]);
  const out = eng.evaluate([sol]);
  const rules = out.map((a) => a.rule.split(":")[0]);
  assert.ok(rules.includes("hacim_1sa"));
  assert.ok(rules.includes("etkinlik"));
  assert.ok(rules.includes("haber_olumlu"));
  assert.ok(out.every((a) => !a.critical));
  // aynı içerik tekrar üretilmez
  assert.equal(eng.evaluate([sol]).length, 0);
});

test("eldeki coin: kritik haber ve olağandışı düşüş kritik bildirim olur", async () => {
  const { ctx, eng } = await setup();
  const base = ctx.agent.queue()[0];
  const c = { ...base, decision: "aç" as const, rr: 2.2, risk: 20, entry: base.price, stop: base.price * 0.99, target: base.price * 1.022, security: { ...base.security, spreadPct: 0.01 } };
  assert.equal((await ctx.agent.tryEnter(c)).ok, true);
  const p = base.price;
  const dropped = { ...ctx.agent.candidates.get(base.instId)!, spark: [...base.spark.slice(0, -2), p, p - 3 * base.atr], vol15mRatio: 4 };
  eng.setNews([{ coin: base.base, title: `${base.base} bridge exploit reported`, ts: 0 }]);
  const out = eng.evaluate([dropped]);
  assert.ok(out.some((a) => a.rule === "olagandisi_dusus" && a.critical));
  assert.ok(out.some((a) => a.rule.startsWith("haber_kritik") && a.critical));
});

test("kritikler saatlik sınıra takılmaz", () => {
  const p = new NotifyPolicy(() => 0, { perSymbolMs: 30 * 60_000, perHour: 1, dedupeMs: 6 * 3_600_000 });
  const s = { developments: true, critical: true, opportunitySummary: false, quietUntil: 0 };
  assert.equal(p.decide({ kind: "development", symbol: "A-USDT", text: "1" }, { follows: ["A-USDT", "B-USDT"], held: [], settings: s }).send, true);
  assert.equal(p.decide({ kind: "development", symbol: "B-USDT", text: "2" }, { follows: ["A-USDT", "B-USDT"], held: [], settings: s }).send, false);
  for (let i = 0; i < 5; i++) assert.equal(p.decide({ kind: "critical", symbol: "A-USDT", text: `kritik ${i}` }, { follows: [], held: ["A-USDT"], settings: s }).send, true);
});
