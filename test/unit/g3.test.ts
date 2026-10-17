// GÜNCELLEME 3: Plan, Mentor işlemi (çok zaman dilimi), zaman dilimleri, Gemini yedek zinciri.
import test from "node:test";
import assert from "node:assert/strict";
import { mkCtx } from "./helpers.js";
import { defaultPlan, sanitizePlan, planRef } from "../../src/plan/plan.js";
import { buildSetup, tfDirection, DISCLAIMER } from "../../src/mentor/setup.js";
import { BARS, okxBar, isBar, BAR_MS } from "../../src/market/bars.js";
import { GeminiMentor } from "../../src/mentor/llm.js";
import { MentorTools } from "../../src/mentor/tools.js";
import { planBlockText } from "../../src/contract/contract.js";
import type { Candle } from "../../src/util/math.js";

/** Doğrusal trendli sentetik mumlar (dalgalı). */
function trend(n: number, slope: number, start = 100): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const mid = start + slope * i + Math.sin(i / 3) * 0.4;
    return { ts: i * 60_000, open: mid - slope / 2, high: mid + 0.6, low: mid - 0.6, close: mid + slope / 2, vol: 100, volUsdt: 10_000 };
  });
}
const up = trend(120, 0.5);
const down = trend(120, -0.5, 200);

test("zaman dilimi: 14 OKX bar değeri, 6H ve üstü utc hizalı", () => {
  assert.deepEqual([...BARS], ["1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "6H", "12H", "1D", "3D", "1W", "1M"]);
  assert.equal(okxBar("4H"), "4H");
  assert.equal(okxBar("1D"), "1Dutc");
  assert.equal(okxBar("1M"), "1Mutc");
  assert.equal(isBar("2H"), true);
  assert.equal(isBar("2h"), false);
  assert.equal(BAR_MS["1W"], 7 * 86_400_000);
});

test("trend yönü: trend çizgisi + EMA eğimi", () => {
  assert.equal(tfDirection(up), "up");
  assert.equal(tfDirection(down), "down");
  assert.equal(tfDirection(up.slice(0, 10)), "flat");
});

test("Mentor işlemi: 4s+1g yukarı → LONG, seviyeler, R:R, sabit ibare, 4 rozet", () => {
  const plan = defaultPlan(false, ["SOL-USDT"]);
  const s = buildSetup("SOL-USDT", { "15m": down, "1H": down, "4H": up, "1D": up }, plan, { agentDecision: "izle", opportunity: 70 });
  assert.equal(s.badgeText, "15dk ↓ · 1s ↓ · 4s ↑ · 1g ↑");
  assert.equal(s.direction, "LONG");
  assert.equal(s.showLevels, true);
  assert.ok(s.stop! < s.entryZone![0] && s.target1! > s.entryZone![1] && s.target2! > s.target1!);
  assert.equal(s.rr1, 1.5);
  assert.ok(s.rr2! >= plan.minRR);
  assert.ok(s.stopType);
  assert.ok(s.reasons.length >= 2 && s.reasons.length <= 3);
  assert.match(s.invalidation!, /^Geçersiz olur eğer/);
  assert.equal(s.disclaimer, DISCLAIMER);
  assert.equal(DISCLAIMER, "Ajan kurulum taslağı; yatırım tavsiyesi değildir.");
  assert.doesNotMatch(JSON.stringify(s), /\b(al|sat)\b!|hemen al|şimdi al/i);
});

test("Mentor işlemi: üst dilimler çelişirse işlem yok, seviye yok", () => {
  const s = buildSetup("SOL-USDT", { "15m": up, "1H": up, "4H": up, "1D": down }, defaultPlan(false, []), { agentDecision: "izle" });
  assert.equal(s.direction, null);
  assert.equal(s.showLevels, false);
  assert.equal(s.stop, null);
  assert.match(s.noTradeReason!, /İşlem yok: zaman dilimleri çelişiyor/);
});

test("Mentor işlemi: ajan eledi → yalnızca sebep, seviye yok", () => {
  const s = buildSetup("SOL-USDT", { "15m": up, "1H": up, "4H": up, "1D": up }, defaultPlan(false, []), { agentDecision: "ele", agentReason: "makas geniş" });
  assert.equal(s.showLevels, false);
  assert.equal(s.entryZone, null);
  assert.match(s.noTradeReason!, /makas geniş/);
});

test("Mentor işlemi: güvenlik nedeniyle elenen coinde SHORT da seviye göstermez", () => {
  const s = buildSetup("SOL-USDT", { "15m": down, "1H": down, "4H": down, "1D": down }, defaultPlan(false, []), { agentDecision: "ele", agentSafetyBlock: true, agentReason: "risk yüksek" });
  assert.equal(s.showLevels, false);
});

test("Mentor işlemi: SHORT notu spot'ta sat/bekle (long ajanının trend elemesi SHORT'u engellemez)", () => {
  const s = buildSetup("SOL-USDT", { "15m": down, "1H": down, "4H": down, "1D": down }, defaultPlan(false, []), { agentDecision: "ele", agentSafetyBlock: false });
  assert.equal(s.direction, "SHORT");
  assert.match(s.shortNote!, /sat \/ bekle/);
  assert.ok(s.stop! > s.entryZone![1]);
  assert.equal(s.confidence, "orta"); // 4 dilim uyumlu ama fırsat eşiği altında
});

test("Plan: paper ve canlı varsayılanları", () => {
  const p = defaultPlan(false, ["BTC-USDT"]);
  assert.deepEqual([p.riskPct, p.maxOrderUsdt, p.maxTotalUsdt, p.maxPositions, p.requireStop], [1, 100, 400, 4, true]);
  const l = defaultPlan(true, []);
  assert.deepEqual([l.riskPct, l.maxOrderUsdt, l.maxTotalUsdt, l.maxPositions, l.requireStop], [0.5, 5, 15, 3, true]);
});

test("Plan: canlıda tutarlar bakiyeyi aşamaz (tek sabit kural)", () => {
  const { plan, notes } = sanitizePlan({ maxTotalUsdt: 500, maxOrderUsdt: 200 }, defaultPlan(true, []), { live: true, balance: 42.5, validCoins: [] });
  assert.equal(plan.maxTotalUsdt, 42.5);
  assert.equal(plan.maxOrderUsdt, 42.5);
  assert.ok(notes.some((n) => /bakiyeyi/.test(n)));
  const paper = sanitizePlan({ maxTotalUsdt: 500 }, defaultPlan(false, []), { live: false, balance: null, validCoins: [] });
  assert.equal(paper.plan.maxTotalUsdt, 500);
});

test("Plan: geçersiz coin ve aralık dışı değerler süzülür", () => {
  const { plan } = sanitizePlan({ coins: ["SOL-USDT", "FAKE-USDT"], riskPct: 99, direction: "x" as any }, defaultPlan(false, ["BTC-USDT"]), { live: false, balance: null, validCoins: ["SOL-USDT", "BTC-USDT"] });
  assert.deepEqual(plan.coins, ["SOL-USDT"]);
  assert.equal(plan.riskPct, 10);
  assert.equal(plan.direction, "long");
});

test("Plan referansı ve plana referanslı engel metni", () => {
  assert.equal(planRef(defaultPlan(false, [])), "Plan: risk %1 · R:R ≥ 2 · Follow Line uyumlu ✓");
  const t = planBlockText("ADA", [
    { label: "R:R", value: "0.56", limit: "en az 2", planText: "R:R 0.56 (planın min 2)" },
    { label: "Stop", value: "%9", limit: "en fazla %6", planText: "stop %9.0 (planın maks %6)" },
  ]);
  assert.equal(t, "ADA long planına uymadı: R:R 0.56 (planın min 2) · stop %9.0 (planın maks %6)");
});

test("Plan API: kaydet → limit kapısı plana göre değişir; emir günlüğü plana referans verir", async () => {
  const ctx = mkCtx({ AUTONOMOUS: "false" });
  assert.equal(ctx.limits.maxOrderNotionalUsdt, 100);
  const { sanitizePlan: sp } = await import("../../src/plan/plan.js");
  const { applyPlan } = await import("../../src/trading/hardLimits.js");
  const { plan } = sp({ maxPositions: 2, maxOrderUsdt: 50 }, ctx.store.settings.plan, { live: false, balance: null, validCoins: ctx.limits.allowedPairs });
  ctx.store.settings.plan = plan;
  applyPlan(ctx.limits, plan);
  assert.equal(ctx.limits.maxOpenPositions, 2);
  assert.equal(ctx.limits.maxOrderNotionalUsdt, 50);
  await ctx.agent.scanOnce();
  const c = ctx.agent.queue().find((x) => x.rr >= 2 && x.atrTrend?.dir === 1);
  if (c) {
    const r = await ctx.agent.tryEnter({ ...c, decision: "aç", opportunity: 99 });
    if (r.ok) assert.match(r.reason, /Plan: risk %1 · R:R ≥ 2/);
  }
});

test("Gemini: 429 kota dolunca sıradaki flash modeline geçer", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(u);
    if (u.includes("gemini-3.8-flash")) return new Response("Quota exceeded. Please retry in 10h12m.", { status: 429 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Tamam." }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const g = new GeminiMentor("k", "gemini-3.8-flash", f);
  const ctx = mkCtx({ AUTONOMOUS: "false" });
  const out = await g.reply({ text: "selam", history: [], tools: new MentorTools(ctx) });
  assert.equal(out, "Tamam.");
  assert.equal(g.activeModel, "gemini-3.7-flash");
  assert.match(g.name, /3\.7/);
  urls.length = 0;
  await g.reply({ text: "tekrar", history: [], tools: new MentorTools(ctx) });
  assert.ok(!urls.some((u) => u.includes("3.8")), "kotası dolan model tekrar denenmez");
});

test("Emir defteri: durumlar (açıldı/hedef 1/stop/süre doldu/kapandı) ve günlük sınıfları", async () => {
  const { orderStatus, logKind } = await import("../../src/trading/orderLog.js");
  assert.equal(orderStatus({ side: "buy", reason: "x" }), "açıldı");
  assert.equal(orderStatus({ side: "sell", reason: "Kısmi kâr (+1.5R)" }), "hedef 1");
  assert.equal(orderStatus({ side: "sell", reason: "Stop tetiklendi" }), "stop");
  assert.equal(orderStatus({ side: "sell", reason: "Süre stopu (24 saatte ilerleme yok)" }), "süre doldu");
  assert.equal(orderStatus({ side: "sell", reason: "Hızlı komut: kapat (web)" }), "kapandı");
  assert.equal(logKind({ level: "emir", text: "PAPER emir: SOL" }), "emir");
  assert.equal(logKind({ level: "uyarı", text: "ADA long planına uymadı" }), "uyarı");
  assert.equal(logKind({ level: "bilgi", text: "Avalanche kanıtı yazıldı" }), "zincir");
  assert.equal(logKind({ level: "bilgi", text: "Telegram bildirimi gönderildi" }), "bildirim");
});

test("Toast/modal: yalnızca devre kesici ve canlı günlük zarar kritik; limit doluluğu metni", async () => {
  const { WarningCenter } = await import("../../src/contract/warnings.js");
  const { limitFillText } = await import("../../src/agent/agent.js");
  const w = new WarningCenter();
  assert.equal(w.raise("devre_kesici", "a", "t", "x", [], 1)!.critical, true);
  assert.equal(w.raise("limite_yakin", "a", "t", "x", [], 1)!.critical, false);
  assert.equal(w.raise("ajan_engelledi", "a", "t", "x", [], 1)!.critical, false);
  assert.equal(w.raise("gunluk_zarar", "a", "t", "x", [], 1, { critical: true })!.critical, true);
  assert.equal(limitFillText({ open: 13.2, maxOpen: 15, count: 3, maxCount: 3 }), "Limit doluluğu: açık tutar 13/15 · pozisyon 3/3. Yeni işlem açılmayacak, mevcutlar yönetiliyor.");
});

test("Mini backtest: ileriye bakış yok, yalnızca son 30 gün, özet alanları ve not", async () => {
  const { backtestCoin, summarize, BT_NOTE } = await import("../../src/backtest/backtest.js");
  const H4 = 4 * 3_600_000;
  const mk = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => { const m = f(i); return { ts: i * H4, open: m, high: m * 1.004, low: m * 0.996, close: m, vol: 1 }; });
  const plan = { ...defaultPlan(false, []), direction: "longshort" as const };
  const c = mk(300, (i) => 100 + i * 0.4 + Math.sin(i / 2) * 0.8);
  const from = c[120].ts;
  const t1 = backtestCoin("X-USDT", c, plan, from);
  assert.ok(t1.length > 0);
  assert.ok(t1.every((t) => t.openTs >= from && t.closeTs > t.openTs));
  // gelecekteki mumları değiştirmek, ilk işlemin giriş/stop değerini değiştirmez (ileriye bakış yok)
  const first = t1[0];
  const idx = c.findIndex((x) => x.ts === first.openTs);
  const c2 = c.map((x, i) => (i > idx ? { ...x, close: x.close * 0.5, low: x.low * 0.5, high: x.high * 0.5, open: x.open * 0.5 } : x));
  const t2 = backtestCoin("X-USDT", c2, plan, from);
  assert.equal(t2[0].entry, first.entry);
  assert.equal(t2[0].stop, first.stop);
  assert.equal(t2[0].outcome, "stop");
  const s = summarize(t1, ["X-USDT"], from, c.at(-1)!.ts);
  assert.equal(s.note, BT_NOTE);
  assert.equal(BT_NOTE, "Geçmiş performans geleceği garanti etmez.");
  assert.equal(s.trades, t1.length);
  assert.ok(s.long.trades + s.short.trades === s.trades);
  assert.ok(s.maxDrawdownR >= 0);
});

test("Kurulum sonuç takibi: hedef 1 → hedef 2, stop, süre doldu ve 7 gün özeti", async () => {
  const { SetupTracker } = await import("../../src/mentor/outcomes.js");
  const tr = new SetupTracker();
  const base = buildSetup("SOL-USDT", { "15m": up, "1H": up, "4H": up, "1D": up }, defaultPlan(false, []), { agentDecision: "izle" });
  const t = tr.record(base, 0)!;
  assert.ok(t);
  assert.equal(tr.record(base, 1), null, "aynı coin+yön açıkken tekrar kaydedilmez");
  tr.update(new Map([["SOL-USDT", base.target1! + 0.01]]), 10);
  assert.equal(t.hitT1, true);
  tr.update(new Map([["SOL-USDT", base.target2! + 0.01]]), 20);
  assert.equal(t.outcome, "hedef 2");
  const s2 = buildSetup("ETH-USDT", { "15m": up, "1H": up, "4H": up, "1D": up }, defaultPlan(false, []), { agentDecision: "izle" });
  const u = tr.record(s2, 0)!;
  tr.update(new Map([["ETH-USDT", s2.stop! - 0.01]]), 30);
  assert.equal(u.outcome, "stop");
  assert.equal(u.r, -1);
  const st = tr.stats(7, 1000);
  assert.equal(st.setups, 2);
  assert.equal(st.hitPct, 50);
  assert.match(st.text, /^Son 7 gün: 2 kurulum · %50 hedefe ulaştı · ort\. [+-]/);
});

test("Pro L/S tüm SWAP: evren + funding tek çağrı, aranan coin anında, filtrelenebilir tablo", async () => {
  const { SwapLongShort } = await import("../../src/longshort/swapUniverse.js");
  const calls: string[] = [];
  const f = (async (u: string) => {
    calls.push(u);
    const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
    if (u.includes("tickers?instType=SWAP")) return ok({ code: "0", data: [
      { instId: "BTC-USDT-SWAP", last: "100000", volCcy24h: "1000" },
      { instId: "PEPE-USDT-SWAP", last: "0.00001", volCcy24h: "1000000000000" },
      { instId: "ETH-USD-SWAP", last: "3000", volCcy24h: "5" } ] });
    if (u.includes("funding-rate?instId=ANY")) return ok({ code: "0", data: [{ instId: "BTC-USDT-SWAP", fundingRate: "0.0001" }] });
    if (u.includes("rubik")) return ok({ code: "0", data: [["1", "3"]] }); // oran 3 → long %75
    if (u.includes("binance")) return ok([{ longShortRatio: "1" }]); // %50
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const ctx = mkCtx({ AUTONOMOUS: "false" });
  const s = new SwapLongShort(ctx, f, 0, 0);
  await s.loadUniverse();
  assert.equal(s.rows.size, 2, "yalnızca USDT perpetual");
  assert.equal(calls.length, 2);
  assert.equal(s.rows.get("BTC")!.volUsdt24h, 1e8);
  assert.equal(s.rows.get("BTC")!.funding, 0.0001);
  const r = await s.ensureCoin("PEPE");
  assert.equal(r!.okx!.account, 75);
  assert.equal(r!.bn!.general, 50);
  const t = s.table("okx");
  assert.equal(t.total, 2);
  assert.equal(t.filled, 1);
  assert.equal(t.rows[0].base, "BTC"); // hacim sırası
  assert.ok(t.summary.some((x) => x.label === "Top 10"));
  assert.match(t.units.volume, /USDT/);
  assert.equal(await s.ensureCoin("YOK"), null);
});

test("Canlı kapanış: bağlı stop varlığı donduruyorsa önce iptal edilir, sonra gerçek satış yapılır; emir no yoksa kapanmış sayılmaz", async () => {
  const { AtkTradingClient } = await import("../../src/trading/tradingClient.js");
  const { resolveHardLimits } = await import("../../src/trading/hardLimits.js");
  const { SignalLedger } = await import("../../src/ledger/signalLedger.js");
  const calls: string[] = [];
  let algoPending = true, sellOrdId: string | undefined = "S123";
  const atk: any = {
    available: () => true,
    toolNames: () => [],
    call: async (name: string, a: any) => {
      calls.push(name);
      if (name === "account_get_balance") {
        if (a.ccy === "BTC") return [{ details: [{ ccy: "BTC", cashBal: "0.0001", availBal: algoPending ? "0" : "0.0001" }] }];
        return [{ totalEq: "30", details: [{ ccy: "USDT", cashBal: "25", availBal: "25", eqUsd: "25" }, { ccy: "BTC", cashBal: "0.0001", availBal: "0", frozenBal: "0.0001", eqUsd: "8" }] }];
      }
      if (name === "market_get_instruments") return [{ lotSz: "0.00000001", minSz: "0.00001" }];
      if (name === "spot_get_algo_orders") return algoPending ? [{ algoId: "A1" }] : [];
      if (name === "spot_cancel_algo_order") { algoPending = false; return [{}]; }
      if (name === "spot_place_order") return [{ ordId: sellOrdId, sCode: "0" }];
      return [];
    },
  };
  const t = new AtkTradingClient(resolveHardLimits({}), new SignalLedger(), atk, 0);
  await t.refreshBalance(true);
  assert.equal(t.equity(), 30);
  // cüzdan senkronu: izlenmeyen spot BTC pozisyon olarak eklenir (borsadaki stop yoksa %5 altı)
  const added = await t.syncWallet();
  assert.deepEqual(added, ["BTC-USDT"]);
  const adopted = t.listPositions()[0];
  assert.equal(adopted.origin, "cüzdan");
  assert.equal(adopted.qty, 0.0001);
  (t as any).positions.clear();
  assert.ok(t.wallet.some((w) => w.ccy === "BTC" && w.frozen > 0));
  const pos: any = { id: "p1", instId: "BTC-USDT", qty: 0.0001, entryPx: 80000, stopPx: 79000, initialStop: 79000, targetPx: 82000, costUsdt: 8, openedAt: 0, partialDone: false, trailing: false, mode: "CANLI", reason: "", realizedPnl: 0, lastPx: 80000, atr: 1, origin: "test" };
  (t as any).positions.set("p1", pos);
  const r = await t.reducePosition("p1", 1, 80100, "test kapat");
  assert.equal(r!.closed, true);
  assert.ok(calls.includes("spot_cancel_algo_order"));
  assert.ok(calls.lastIndexOf("spot_place_order") > calls.indexOf("spot_cancel_algo_order"), "satış iptalden sonra");
  assert.equal(t.listTrades(1)[0].ordId, "S123");
  // emir numarası dönmezse kapanmış sayılmaz
  algoPending = false; sellOrdId = undefined;
  (t as any).positions.set("p2", { ...pos, id: "p2", qty: 0.0001, costUsdt: 8, realizedPnl: 0 });
  const before = calls.length;
  const rr = await t.reducePosition("p2", 1, 80100, "test").catch((e) => e);
  assert.match(String(rr?.message ?? JSON.stringify(rr) + calls.slice(before).join(",")), /emri numarası dönmedi/);
  assert.ok((t as any).positions.has("p2"));
});

test("Mentor cevabında <cevap_modu> etiketi görünmez", async () => {
  const { stripModeTag } = await import("../../src/mentor/mentorService.js");
  assert.equal(stripModeTag("SOL yukarı trendde. <cevap_modu>kisa</cevap_modu>"), "SOL yukarı trendde.");
  assert.equal(stripModeTag("<cevap_modu>ayrintili</cevap_modu>\nUzun cevap"), "Uzun cevap");
});
