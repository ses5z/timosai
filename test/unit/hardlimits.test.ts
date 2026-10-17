import test from "node:test";
import assert from "node:assert/strict";
import { mkTrading, req } from "./helpers.js";
import { resolveHardLimits, assertToolAllowed, ToolNotAllowedError } from "../../src/trading/hardLimits.js";
import { HardLimitError, AtkTradingClient } from "../../src/trading/tradingClient.js";
import { SignalLedger } from "../../src/ledger/signalLedger.js";

test("config dosyası limitleri gevşetemez, yalnızca sıkılaştırır", () => {
  const l = resolveHardLimits({ maxOrderNotionalUsdt: 500, maxTotalOpenUsdt: 10, maxOpenPositions: 9, allowedPairs: ["SOL-USDT", "SCAM-USDT"] });
  assert.equal(l.maxOrderNotionalUsdt, 5);
  assert.equal(l.maxTotalOpenUsdt, 10);
  assert.equal(l.maxOpenPositions, 3);
  assert.deepEqual(l.allowedPairs, ["SOL-USDT"]);
  assert.equal(l.requireStop, true);
});

test("tek emir 5 USDT üstü reddedilir", async () => {
  const { t } = mkTrading();
  await assert.rejects(() => t.openPosition(req({ notionalUsdt: 5.5 })), HardLimitError);
  assert.equal(t.listPositions().length, 0);
});

test("stop'suz veya stop >= giriş emir reddedilir", async () => {
  const { t } = mkTrading();
  await assert.rejects(() => t.openPosition(req({ stopPx: 0 })), /stop zorunlu/);
  await assert.rejects(() => t.openPosition(req({ stopPx: 101 })), /stop zorunlu/);
});

test("izin listesi dışı çift ve spot dışı reddedilir", async () => {
  const { t } = mkTrading();
  await assert.rejects(() => t.openPosition(req({ instId: "SCAM-USDT" })), /izin listesinde değil/);
  await assert.rejects(() => t.openPosition(req({ instType: "SWAP" })), /Yalnızca spot/);
});

test("toplam 15 USDT, 3 pozisyon ve saatte 6 emir sınırı", async () => {
  const { t } = mkTrading(100);
  await t.openPosition(req({ instId: "SOL-USDT", notionalUsdt: 5 }));
  await t.openPosition(req({ instId: "ETH-USDT", notionalUsdt: 5 }));
  await t.openPosition(req({ instId: "BTC-USDT", notionalUsdt: 5 }));
  const v = t.checkEntry(req({ instId: "XRP-USDT", notionalUsdt: 1 }));
  assert.ok(v.some((x) => x.includes("Toplam açık")));
  assert.ok(v.some((x) => x.includes("Açık pozisyon sayısı")));
  // saatlik emir sınırı
  const { t: t2 } = mkTrading(100);
  for (let i = 0; i < 6; i++) {
    const p = await t2.openPosition(req({ instId: "SOL-USDT", notionalUsdt: 1 }));
    await t2.reducePosition(p.id, 1, 100, "test");
  }
  assert.ok(t2.checkEntry(req({ instId: "SOL-USDT", notionalUsdt: 1 })).some((x) => x.includes("Son 1 saatte")));
});

test("izin dışı ATK aracı hata fırlatır (çekim, transfer, earn, bot, event)", () => {
  for (const tool of ["account_transfer", "earn_savings_purchase", "grid_create_order", "event_place_order", "swap_place_order", "account_get_max_withdrawal", "dca_create_order"]) {
    assert.throws(() => assertToolAllowed(tool), ToolNotAllowedError);
  }
  assert.doesNotThrow(() => assertToolAllowed("spot_place_order"));
});

test("AtkTradingClient izin dışı aracı ATK'ya iletmez", async () => {
  const calls: string[] = [];
  const fake = { available: () => true, toolNames: () => [], call: async (n: string) => (calls.push(n), []) } as any;
  const c = new AtkTradingClient(resolveHardLimits({}), new SignalLedger(), fake, 30);
  await assert.rejects(() => (c as any).tool("account_transfer", {}), ToolNotAllowedError);
  assert.deepEqual(calls, []);
});

test("kuru modda emir ATK'ya gitmez, günlüğe KURU yazılır", async () => {
  const { t, ledger } = mkTrading();
  await t.openPosition(req());
  assert.equal(t.mode, "KURU");
  const orders = ledger.list(["order"]);
  assert.equal(orders[0].data.durum, "KURU");
  assert.equal(ledger.atkStats().total, 0);
});

test("zarardan sonra emirler hâlâ geçer (dondurma/bekleme yok)", async () => {
  const { t } = mkTrading(30);
  const p = await t.openPosition(req({ notionalUsdt: 5 }));
  await t.reducePosition(p.id, 1, 50, "büyük zarar"); // -%50
  assert.ok(t.dailyPnl() < -2);
  const p2 = await t.openPosition(req({ instId: "ETH-USDT", notionalUsdt: 5 }));
  assert.ok(p2.id);
  assert.deepEqual(t.checkEntry(req({ instId: "BTC-USDT", notionalUsdt: 1 })), []);
});

test("canlı istemci bakiye < 1 USDT iken emir vermez", async () => {
  const fake = { available: () => true, toolNames: () => [], call: async (n: string) => (n === "account_get_balance" ? [{ details: [{ ccy: "USDT", availBal: "0.4" }] }] : []) } as any;
  const c = new AtkTradingClient(resolveHardLimits({}), new SignalLedger(), fake, 0);
  await assert.rejects(() => c.openPosition(req()), /asgari 1 USDT/);
});
