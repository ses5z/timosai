import test from "node:test";
import assert from "node:assert/strict";
import { mkCtx, req } from "./helpers.js";
import { MockTradingClient, DEFAULT_PAPER } from "../../src/trading/tradingClient.js";
import { SignalLedger } from "../../src/ledger/signalLedger.js";
import { resolveHardLimits } from "../../src/trading/hardLimits.js";
import { PaperFutures, liquidationPrice, futuresPnl } from "../../src/trading/paperFutures.js";
import { loadEnv } from "../../src/config/env.js";
import { installExtensions } from "../../src/extensions.js";

test("paper: market alış en iyi ask + slipaj, satış en iyi bid − slipaj; komisyon config'ten", async () => {
  const quote = async () => ({ bid: 99.9, ask: 100.1 });
  const t = new MockTradingClient(resolveHardLimits({}), new SignalLedger(), 1000, quote, { ...DEFAULT_PAPER, slippagePct: 0.1, feeRate: 0.002 });
  const p = await t.openPosition(req({ entryPx: 100, stopPx: 98, targetPx: 104, notionalUsdt: 5 }));
  assert.ok(Math.abs(p.entryPx - 100.1 * 1.001) < 1e-9);
  assert.ok(Math.abs(p.qty - (5 * 0.998) / (100.1 * 1.001)) < 1e-12);
  const r = await t.reducePosition(p.id, 1, 100, "test");
  assert.ok(Math.abs(r!.px - 99.9 * 0.999) < 1e-9);
  assert.equal(t.startEquity, 1000);
});

test("paper istatistikleri: kazanma oranı, ortalama R, maks drawdown, toplam PnL, işlem sayısı", async () => {
  const t = new MockTradingClient(resolveHardLimits({}), new SignalLedger(), 1000);
  const a = await t.openPosition(req({ instId: "SOL-USDT", entryPx: 100, stopPx: 98, notionalUsdt: 5 }));
  await t.reducePosition(a.id, 1, 104, "hedef"); // ≈ +2R
  const b = await t.openPosition(req({ instId: "ETH-USDT", entryPx: 100, stopPx: 98, notionalUsdt: 5 }));
  await t.reducePosition(b.id, 1, 98, "stop"); // ≈ -1R
  const s = t.stats([{ equity: 1000 }, { equity: 1000.2 }, { equity: 999.9 }]);
  assert.equal(s.trades, 2);
  assert.equal(s.winRate, 0.5);
  assert.ok(s.avgR > 0.3 && s.avgR < 0.6, String(s.avgR));
  assert.ok(s.maxDrawdownPct > 0);
  assert.ok(Math.abs(s.totalPnl - (t.equity() - 1000)) < 1e-9);
});

test("QUICK_COMMANDS: paper'da varsayılan açık; LIVE=true iken varsayılan kapalı, yalnızca açıkça true ise açık", () => {
  assert.equal(loadEnv({ file: "/yok", source: {} }).quickCommands, true);
  assert.equal(loadEnv({ file: "/yok", source: { LIVE: "true" } }).quickCommands, false);
  assert.equal(loadEnv({ file: "/yok", source: { LIVE: "true", QUICK_COMMANDS: "true" } }).quickCommands, true);
  assert.equal(loadEnv({ file: "/yok", source: { QUICK_COMMANDS: "false" } }).quickCommands, false);
  assert.equal(loadEnv({ file: "/yok", source: {} }).paperBalanceUsdt, 0); // 0 → config/paper.json (1000)
});

test("paper futures: isolated likidasyon fiyatı, kaldıraç tavanı, 8 saatlik funding ve likidasyonda teminat kaybı", async () => {
  const ctx = mkCtx({ AUTONOMOUS: "false" });
  await ctx.agent.scanOnce();
  const f = new PaperFutures(ctx);
  const sol = ctx.agent.prices.get("SOL-USDT")!.last;
  const r = await f.open({ instId: "SOL-USDT", side: "long", leverage: 50, marginUsdt: 20, origin: "hızlı" });
  assert.equal(r.ok, true);
  const p = r.pos!;
  assert.equal(p.leverage, ctx.paper.maxLeverage);
  assert.match(r.text, /Kaldıraç tavanı/);
  assert.ok(Math.abs(p.liqPx - liquidationPrice("long", sol, ctx.paper.maxLeverage, ctx.paper.maintenanceMarginRate)) / p.liqPx < 1e-3);
  assert.ok(liquidationPrice("short", 100, 5) > 100);
  // funding: 2 periyot × notional × 0.0001 (long öder)
  f.tick(p.openedAt + 16 * 3_600_000 + 1000, () => 0.0001);
  assert.ok(Math.abs(p.fundingPaid - 2 * p.notionalUsdt * 0.0001) < 1e-9);
  // likidasyon
  ctx.mock.setPrice("SOL-USDT", p.liqPx * 0.99);
  await ctx.agent.priceTick();
  f.tick();
  assert.ok(p.closed);
  assert.equal(p.closed!.pnl, -20);
  assert.ok(futuresPnl({ side: "short", notionalUsdt: 100, entryPx: 100 }, 90) > 0);
  assert.equal(ctx.agent.trading.listPositions().length, 0); // gerçek/paper spot pozisyon açılmadı
});

test("paper sıfırlama uç noktası ve /api/paper istatistikleri", async () => {
  const ctx = mkCtx({ AUTONOMOUS: "false" });
  await installExtensions(ctx, { fetchImpl: (async () => new Response("{}", { status: 500 })) as any });
  await ctx.agent.scanOnce();
  await ctx.extras.quick.run("/al SOL 5", "t");
  assert.equal(ctx.agent.trading.listPositions().length, 1);
  const { createApp } = await import("../../src/app.js");
  const srv = createApp(ctx).listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${(srv.address() as any).port}`;
  const st: any = await (await fetch(base + "/api/paper")).json();
  assert.equal(st.mode, "PAPER");
  assert.ok("winRate" in st.stats && "maxDrawdownPct" in st.stats);
  const r: any = await (await fetch(base + "/api/paper/reset", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
  srv.close();
  assert.equal(r.ok, true);
  assert.equal(ctx.agent.trading.listPositions().length, 0);
});
