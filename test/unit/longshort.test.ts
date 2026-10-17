import test from "node:test";
import assert from "node:assert/strict";
import { mkCtx } from "./helpers.js";
import { longPct, summarize, weighted, LongShortService, lsText, type LsRow } from "../../src/longshort/longShort.js";
import { analyzeDerivatives } from "../../src/derivatives/rules.js";
import { NotifyPolicy } from "../../src/telegram/notifyPolicy.js";

const row = (base: string, cat: string, vol: number, okx: number | null, bn: number | null = null): LsRow => ({ instId: `${base}-USDT`, base, category: cat, volUsdt24h: vol, okxTopAccount: okx, okxTopPosition: okx, okxAccount: okx, bnTopAccount: bn, bnTopPosition: bn, bnGlobal: bn });

test("long yüzdesi = oran / (1 + oran)", () => {
  assert.equal(longPct(1), 50);
  assert.equal(longPct(3), 75);
  assert.equal(longPct(null), null);
});

test("özet satırları (BTC, ETH, Top 10, Top 20, All, Ex Top 20) ve kategoriler hacim ağırlıklı", () => {
  const rows = [row("BTC", "Layer 1", 1000, 60), row("ETH", "Layer 1", 500, 70), ...Array.from({ length: 22 }, (_, i) => row(`C${i}`, i % 2 ? "Meme" : "DeFi", 100 - i, 40))];
  const { summary, categories } = summarize(rows);
  assert.deepEqual(summary.map((s) => s.label), ["BTC", "ETH", "Top 10", "Top 20", "All", "Ex Top 20"]);
  assert.equal(summary[0].okxTopAccount, 60);
  assert.equal(summary.find((s) => s.label === "Ex Top 20")!.count, 4);
  assert.ok(Math.abs(weighted([row("A", "x", 3, 80), row("B", "x", 1, 40)], "okxTopAccount")! - 70) < 1e-9);
  assert.ok(categories.some((c) => c.label === "Meme"));
});

test("Binance uç noktaları (5m, sembol eşlemesi), OKX vadeli önbelleğinden; Telegram tablo", async () => {
  const ctx = mkCtx({ AUTONOMOUS: "false" });
  await ctx.agent.scanOnce();
  const urls: string[] = [];
  const f = (async (u: string) => (urls.push(u), new Response(JSON.stringify([{ longShortRatio: "3" }]), { status: 200 }))) as unknown as typeof fetch;
  const ls = new LongShortService(ctx, f);
  await ls.refresh(true);
  assert.ok(urls.some((u) => u.includes("topLongShortAccountRatio?symbol=1000PEPEUSDT&period=5m")));
  assert.ok(urls.some((u) => u.includes("globalLongShortAccountRatio?symbol=BTCUSDT&period=5m")));
  const t = ls.table();
  assert.equal(t.rows.find((r) => r.base === "BTC")!.bnTopAccount, 75);
  assert.ok(t.updatedAt.binance);
  assert.match(lsText(t), /OKX Acc OKX Pos BN Acc BN Pos/);
  assert.match(lsText(t, "SOL"), /Account Position/);
  // kategori eşiği: Binance %75 → yüksek
  assert.ok(ls.categoryAlerts().every((a) => a.side === "high"));
});

test("vadeli kartı: üst trader hesap vs pozisyon ayrışması", () => {
  const s: any = { instId: "SOL-USDT", swapId: "SOL-USDT-SWAP", funding: 0, oiUsd: 1, oiDeltaPct1h: 0, oiDeltaPct4h: 0, oiSeries: [], lsAccount: 1.1, lsTopAccount: 1.5, lsTopPosition: 0.7, takerBuy: 1, takerSell: 1, publicSource: "OKX", ts: 0, live: true };
  const a = analyzeDerivatives(s, { chg1hPct: 0, chg4hPct: 0, spotVolRatio: 1, maxWickPct: 0 });
  assert.ok(a.flags.includes("ust_trader_ayrisma"));
});

test("kategori bildirimi 'market' türü: takip şartı yok, saatlik sınır geçerli", () => {
  const p = new NotifyPolicy(() => 0, { perSymbolMs: 1800_000, perHour: 1, dedupeMs: 3600_000 });
  const st = { developments: true, critical: true, opportunitySummary: false, quietUntil: 0 };
  assert.equal(p.decide({ kind: "market", symbol: "KATEGORI:Meme", text: "a" }, { follows: [], held: [], settings: st }).send, true);
  assert.equal(p.decide({ kind: "market", symbol: "KATEGORI:DeFi", text: "b" }, { follows: [], held: [], settings: st }).reason, "saatlik sınır");
});
