// DerivativesData: vadeli piyasa verisi (hesaba değil piyasaya ait; OKX TR'de kaldıraç olmaması okumayı engellemez).
// ATK: funding, open interest, OI geçmişi. OKX global public Trading Statistics (ATK dışı, anahtarsız): genel hesap
// L/S oranı, üst trader L/S (hesap + pozisyon), taker al/sat hacmi. OKX global erişilemezse Binance Futures yedeği.
import type { AtkCaller } from "../atk/mcpClient.js";

export interface DerivSnapshot {
  instId: string;
  swapId: string;
  funding: number | null;
  oiUsd: number | null;
  oiDeltaPct1h: number | null;
  oiDeltaPct4h: number | null;
  oiSeries: { ts: number; oiUsd: number }[];
  lsAccount: number | null; // genel hesap oranı
  lsTopAccount: number | null; // üst trader hesap oranı
  lsTopPosition: number | null; // üst trader pozisyon oranı
  takerBuy: number | null;
  takerSell: number | null;
  publicSource: "OKX" | "Binance" | null;
  ts: number;
  live: boolean;
}

export interface DerivativesData {
  readonly name: string;
  snapshot(instId: string): Promise<DerivSnapshot>;
  stats(): { publicCalls: number; publicErrors: number; source: string };
}

type FetchLike = typeof fetch;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export class LiveDerivativesData implements DerivativesData {
  readonly name = "atk+okx-public";
  private publicCalls = 0;
  private publicErrors = 0;
  private okxDownUntil = 0;
  private cache = new Map<string, { at: number; v: Omit<DerivSnapshot, "funding" | "oiUsd" | "oiDeltaPct1h" | "oiDeltaPct4h" | "oiSeries"> }>();

  constructor(
    private readonly atk: AtkCaller,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly cacheMs = 5 * 60_000,
  ) {}

  stats() {
    return { publicCalls: this.publicCalls, publicErrors: this.publicErrors, source: Date.now() < this.okxDownUntil ? "Binance (yedek)" : "OKX global" };
  }

  private async getJson(url: string): Promise<any> {
    this.publicCalls++;
    try {
      const r = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      this.publicErrors++;
      throw e;
    }
  }

  private async okxPublic(swapId: string) {
    const base = "https://www.okx.com/api/v5/rubik/stat";
    const q = `instId=${encodeURIComponent(swapId)}&period=1H`;
    const [a, ta, tp, tv] = await Promise.all([
      this.getJson(`${base}/contracts/long-short-account-ratio-contract?${q}`),
      this.getJson(`${base}/contracts/long-short-account-ratio-contract-top-trader?${q}`),
      this.getJson(`${base}/contracts/long-short-position-ratio-contract-top-trader?${q}`),
      this.getJson(`${base}/taker-volume-contract?${q}`),
    ]);
    for (const x of [a, ta, tp, tv]) if (x?.code !== "0") throw new Error(`OKX public: ${x?.msg ?? "kod " + x?.code}`);
    // taker-volume-contract: [ts, satış hacmi, alış hacmi]
    return { lsAccount: num(a.data?.[0]?.[1]), lsTopAccount: num(ta.data?.[0]?.[1]), lsTopPosition: num(tp.data?.[0]?.[1]), takerSell: num(tv.data?.[0]?.[1]), takerBuy: num(tv.data?.[0]?.[2]), publicSource: "OKX" as const };
  }

  private async binancePublic(instId: string) {
    const sym = instId.replace("-USDT", "USDT");
    const base = "https://fapi.binance.com/futures/data";
    const q = `symbol=${sym}&period=1h&limit=1`;
    const [a, ta, tp, tv] = await Promise.all([
      this.getJson(`${base}/globalLongShortAccountRatio?${q}`),
      this.getJson(`${base}/topLongShortAccountRatio?${q}`),
      this.getJson(`${base}/topLongShortPositionRatio?${q}`),
      this.getJson(`${base}/takerlongshortRatio?${q}`),
    ]);
    return { lsAccount: num(a?.[0]?.longShortRatio), lsTopAccount: num(ta?.[0]?.longShortRatio), lsTopPosition: num(tp?.[0]?.longShortRatio), takerBuy: num(tv?.[0]?.buyVol), takerSell: num(tv?.[0]?.sellVol), publicSource: "Binance" as const };
  }

  async snapshot(instId: string): Promise<DerivSnapshot> {
    const swapId = `${instId.split("-")[0]}-USDT-SWAP`;
    const [fund, hist] = await Promise.all([
      this.atk.call<any[]>("market_get_funding_rate", { instId: swapId }).catch(() => null),
      this.atk.call<any[]>("market_get_oi_history", { instId: swapId, bar: "1H", limit: 6 }).catch(() => null),
    ]);
    const rows: any[] = (hist?.[0]?.rows ?? []).slice().sort((x: any, y: any) => x.ts - y.ts);
    const series = rows.map((r) => ({ ts: Number(r.ts), oiUsd: Number(r.oiUsd) })).filter((r) => Number.isFinite(r.oiUsd));
    const last = rows.at(-1);
    const oi4 = series.length >= 5 ? ((series.at(-1)!.oiUsd - series.at(-5)!.oiUsd) / series.at(-5)!.oiUsd) * 100 : null;

    let pub = this.cache.get(instId);
    if (!pub || Date.now() - pub.at > this.cacheMs) {
      let v: any = { lsAccount: null, lsTopAccount: null, lsTopPosition: null, takerBuy: null, takerSell: null, publicSource: null };
      try {
        if (Date.now() < this.okxDownUntil) throw new Error("OKX global geçici olarak erişilemez");
        v = await this.okxPublic(swapId);
      } catch {
        this.okxDownUntil = Date.now() + 10 * 60_000;
        v = await this.binancePublic(instId).catch(() => v);
      }
      pub = { at: Date.now(), v: { instId, swapId, ...v, ts: Date.now(), live: true } };
      this.cache.set(instId, pub);
    }
    return {
      ...pub.v,
      funding: num(fund?.[0]?.fundingRate),
      oiUsd: last ? num(last.oiUsd) : null,
      oiDeltaPct1h: last ? num(last.oiDeltaPct) : null,
      oiDeltaPct4h: oi4,
      oiSeries: series,
      live: fund !== null || hist !== null || pub.v.publicSource !== null,
      ts: Date.now(),
    };
  }
}

/** MockDerivativesData: ATK_MODE=mock için deterministik örnek veri (ÖRNEK VERİ). */
export class MockDerivativesData implements DerivativesData {
  readonly name = "mock";
  stats() {
    return { publicCalls: 0, publicErrors: 0, source: "örnek veri" };
  }
  async snapshot(instId: string): Promise<DerivSnapshot> {
    let h = 0;
    for (const ch of instId) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
    const f = ((h % 9) - 3) / 10000;
    return {
      instId,
      swapId: `${instId.split("-")[0]}-USDT-SWAP`,
      funding: f,
      oiUsd: 1e7 + (h % 1000) * 1e5,
      oiDeltaPct1h: ((h % 11) - 4) * 0.6,
      oiDeltaPct4h: ((h % 13) - 5) * 0.9,
      oiSeries: [],
      lsAccount: 0.6 + (h % 17) / 10,
      lsTopAccount: 0.8 + (h % 7) / 10,
      lsTopPosition: 0.7 + (h % 9) / 10,
      takerBuy: 1000 + (h % 500),
      takerSell: 1000 + ((h >> 3) % 500),
      publicSource: null,
      ts: Date.now(),
      live: false,
    };
  }
}
