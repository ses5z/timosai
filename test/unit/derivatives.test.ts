import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDerivatives, DEFAULT_DERIV } from "../../src/derivatives/rules.js";
import { LiveDerivativesData, type DerivSnapshot } from "../../src/derivatives/derivativesData.js";

const snap = (o: Partial<DerivSnapshot> = {}): DerivSnapshot => ({ instId: "SOL-USDT", swapId: "SOL-USDT-SWAP", funding: 0.0001, oiUsd: 1e8, oiDeltaPct1h: 0.5, oiDeltaPct4h: 1, oiSeries: [], lsAccount: 1.1, lsTopAccount: 1.05, lsTopPosition: 1.0, takerBuy: 1, takerSell: 1, publicSource: "OKX", ts: 0, live: true, ...o });
const px = (o = {}) => ({ chg1hPct: 0, chg4hPct: 0, spotVolRatio: 1.2, maxWickPct: 0.2, ...o });

test("vadeli: yüksek pozitif funding + yüksek L/S → long kalabalık, long squeeze riski", () => {
  const a = analyzeDerivatives(snap({ funding: 0.0006, lsAccount: 2.3 }), px());
  assert.equal(a.crowded, "long");
  assert.equal(a.badge, "long kalabalık");
  assert.ok(a.reasons.some((r) => r.includes("long squeeze")));
});

test("vadeli: negatif funding + düşük L/S → short squeeze; fiyat↑ + negatif funding → short'lar sıkışıyor", () => {
  const a = analyzeDerivatives(snap({ funding: -0.0005, lsAccount: 0.6 }), px({ chg4hPct: 2 }));
  assert.equal(a.crowded, "short");
  assert.ok(a.flags.includes("short_squeeze"));
  assert.ok(a.flags.includes("shortlar_sikisiyor"));
});

test("vadeli: fiyat↑ + OI sert↑ + zayıf spot hacim → vadeli kaynaklı hareket, şüphe yükselir", () => {
  const a = analyzeDerivatives(snap({ oiDeltaPct1h: 5 }), px({ chg1hPct: 2, spotVolRatio: 0.7 }));
  assert.ok(a.flags.includes("vadeli_kaynakli"));
  assert.notEqual(a.manipulation, "düşük");
  assert.ok(a.riskAdj > 0);
});

test("vadeli: üst trader pozisyon oranı genel hesap oranına zıt → ayrışma; OI düşüşü + uzun fitil → likidasyon kaskadı", () => {
  const a = analyzeDerivatives(snap({ lsAccount: 1.6, lsTopPosition: 0.7, oiDeltaPct1h: -6 }), px({ maxWickPct: 1.8 }));
  assert.ok(a.flags.includes("ayrisma"));
  assert.ok(a.flags.includes("likidasyon_kaskadi"));
  assert.equal(a.manipulation, "orta");
});

test("vadeli: veri yoksa sahte veri üretilmez", () => {
  const a = analyzeDerivatives(snap({ funding: null, lsAccount: null, oiDeltaPct1h: null }), px());
  assert.equal(a.available, false);
  assert.equal(a.badge, "vadeli veri yok");
});

test("vadeli veri: ATK funding/OI + OKX public L/S; OKX erişilemezse Binance yedeği; ATK sayacına public çağrı girmez", async () => {
  const atkCalls: string[] = [];
  const atk = { available: () => true, toolNames: () => [], call: async (n: string) => (atkCalls.push(n), n === "market_get_funding_rate" ? [{ fundingRate: "0.0004" }] : [{ rows: [{ ts: 1, oiUsd: 100, oiDeltaPct: 1 }, { ts: 2, oiUsd: 104, oiDeltaPct: 4 }] }]) } as any;
  const urls: string[] = [];
  const okxFail = (async (u: string) => {
    urls.push(u);
    if (u.includes("okx.com")) return new Response("blocked", { status: 403 });
    return new Response(JSON.stringify([{ longShortRatio: "1.9", buyVol: "10", sellVol: "8" }]), { status: 200 });
  }) as unknown as typeof fetch;
  const d = new LiveDerivativesData(atk, okxFail);
  const s = await d.snapshot("SOL-USDT");
  assert.equal(s.funding, 0.0004);
  assert.equal(s.oiDeltaPct1h, 4);
  assert.equal(s.lsAccount, 1.9);
  assert.equal(s.publicSource, "Binance");
  assert.deepEqual(atkCalls.sort(), ["market_get_funding_rate", "market_get_oi_history"]);
  assert.ok(urls.some((u) => u.includes("rubik/stat/contracts/long-short-account-ratio-contract")));
  assert.ok(d.stats().publicCalls >= 4);
});
