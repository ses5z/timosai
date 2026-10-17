// Keşfet CEX: OKX spot pariteleri (ATK), arama, parite listesi ve herhangi bir parite için analiz görünümü.
// İşlem izin listesi DEĞİŞMEZ: tüm pariteler analiz edilebilir, emirler yalnızca sert limitlerdeki USDT paritelerinde.
import type { AppContext } from "../context.js";
import { parseTicker } from "../market/atkMarketData.js";
import type { Candidate, Ticker } from "../ports.js";
import { COIN_NAMES, type Instrument } from "../market/instruments.js";

export const PAIR_RE = /^[A-Z0-9]{1,15}-(USDT|USDC|BTC|ETH|SOL|TRY)$/;
export const LOW_LIQ_USDT = 500_000;

export class CexService {
  private tick: { at: number; map: Map<string, Ticker & { volBase: number }> } = { at: 0, map: new Map() };
  private viewCache = new Map<string, { at: number; c: Candidate }>();
  constructor(private readonly ctx: AppContext) {}

  /** Tüm spot tickers (ATK market_get_tickers), 30 sn önbellek. */
  async tickers(): Promise<Map<string, Ticker & { volBase: number }>> {
    if (Date.now() - this.tick.at < 30_000 && this.tick.map.size) return this.tick.map;
    const map = new Map<string, Ticker & { volBase: number }>();
    try {
      if (!this.ctx.atk) throw new Error("ATK yok");
      const rows: any[] = await this.ctx.atk.call("market_get_tickers", { instType: "SPOT" });
      for (const r of rows) map.set(r.instId, { ...parseTicker(r), volBase: Number(r.vol24h) || 0 });
    } catch {
      // ATK yoksa (mock) izleme listesi fiyatları
      for (const [k, v] of this.ctx.agent.prices) map.set(k, { ...v, volBase: v.last > 0 ? v.volUsdt24h / v.last : 0 });
    }
    this.tick = { at: Date.now(), map };
    return map;
  }

  /** Kote paranın USDT karşılığı (USDC, BTC, ETH, SOL için X-USDT; TRY için 1/USDT-TRY). */
  quoteInUsdt(quote: string, t: Map<string, Ticker>): number | null {
    if (quote === "USDT") return 1;
    if (quote === "TRY") {
      const u = t.get("USDT-TRY")?.last;
      return u ? 1 / u : null;
    }
    return t.get(`${quote}-USDT`)?.last ?? null;
  }

  async search(q: string) {
    await this.ctx.instruments.ensure();
    return this.ctx.instruments.search(q, 10);
  }

  async pairs(base: string) {
    await this.ctx.instruments.ensure();
    const t = await this.tickers();
    return this.ctx.instruments.pairsOf(base).map((i: Instrument) => {
      const tk = t.get(i.instId);
      const qUsdt = this.quoteInUsdt(i.quote, t);
      const volQuote = tk?.volUsdt24h ?? null; // volCcy24h: kote para cinsinden
      const volUsdt = volQuote !== null && qUsdt !== null ? volQuote * qUsdt : null;
      return {
        instId: i.instId,
        base: i.base,
        quote: i.quote,
        name: COIN_NAMES[i.base] ?? "",
        last: tk?.last ?? null,
        change24hPct: tk ? tk.change24hPct : null,
        volQuote,
        volUsdt,
        tickSz: i.tickSz,
        lowLiquidity: volUsdt !== null && volUsdt < LOW_LIQ_USDT,
        tradable: this.ctx.limits.allowedPairs.includes(i.instId),
      };
    });
  }

  /** Bir paritenin AI analizi: izleme listesinde ise ajanın adayı, değilse aynı karar motoruyla anlık. */
  async analyze(instId: string): Promise<Candidate | null> {
    const fromAgent = this.ctx.agent.candidates.get(instId);
    if (fromAgent) return fromAgent;
    const c = this.viewCache.get(instId);
    if (c && Date.now() - c.at < 60_000) return c.c;
    const t = (await this.tickers()).get(instId);
    if (!t) return null;
    const candles = await this.ctx.market.candles(instId, "15m", 100).catch(() => []);
    if (candles.length < 20) return null;
    const base = instId.split("-")[0];
    const snap = await this.ctx.agent.derivativesFor(`${base}-USDT`).catch(() => null);
    const cand = this.ctx.agent.d.decision.decide({ instId, category: this.ctx.watchlist.find((w) => w.instId.startsWith(base + "-"))?.category ?? "-", ticker: t, candles, rsi: null, funding: snap?.funding ?? null, sentiment: null, orderbook: null, derivSnapshot: snap, live: this.ctx.market.isLive() });
    this.viewCache.set(instId, { at: Date.now(), c: cand });
    return cand;
  }
}
