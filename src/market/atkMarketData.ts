// AtkMarketData: OKX Agent Trade Kit (stdio MCP) üzerinden gerçek piyasa verisi.
import type { AtkCaller } from "../atk/mcpClient.js";
import type { MarketData, OrderbookSummary, Ticker } from "../ports.js";
import type { Candle } from "../util/math.js";
import { pctChange } from "../util/math.js";

export function parseTicker(t: any): Ticker {
  const last = Number(t.last);
  const open = Number(t.open24h);
  return {
    instId: t.instId,
    last,
    open24h: open,
    high24h: Number(t.high24h),
    low24h: Number(t.low24h),
    change24hPct: pctChange(open, last),
    volUsdt24h: Number(t.volCcy24h) || 0,
    ts: Number(t.ts) || Date.now(),
  };
}

export function parseCandles(rows: any[]): Candle[] {
  // OKX en yeniden eskiye döndürür; eskiden yeniye çeviriyoruz.
  return rows
    .map((r) => ({ ts: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), vol: Number(r[7] ?? r[6]) || 0 }))
    .filter((c) => Number.isFinite(c.close))
    .sort((a, b) => a.ts - b.ts);
}

export class AtkMarketData implements MarketData {
  readonly name = "atk";

  constructor(private readonly atk: AtkCaller) {}

  isLive(): boolean {
    return true;
  }

  async tickers(instIds: string[]): Promise<Map<string, Ticker>> {
    const rows: any[] = await this.atk.call("market_get_tickers", { instType: "SPOT" });
    const want = new Set(instIds);
    const out = new Map<string, Ticker>();
    for (const r of rows) if (want.has(r.instId)) out.set(r.instId, parseTicker(r));
    return out;
  }

  async candles(instId: string, bar: string, limit: number, after?: number): Promise<Candle[]> {
    // after: bu zamandan ÖNCEKİ mumlar (geçmiş yükleme, ATK history=true)
    const rows: any[] = await this.atk.call("market_get_candles", after ? { instId, bar, limit, after: String(after), history: true } : { instId, bar, limit });
    return parseCandles(rows);
  }

  async indicatorRsi(instId: string, bar: string): Promise<number | null> {
    const data: any = await this.atk.call("market_get_indicator", { instId, indicator: "rsi", bar, params: [14] });
    const node = data?.[0]?.data?.[0]?.timeframes?.[bar]?.indicators?.RSI?.[0]?.values;
    const v = node ? Number(Object.values(node)[0]) : NaN;
    return Number.isFinite(v) ? v : null;
  }

  async funding(instId: string): Promise<number | null> {
    const base = instId.split("-")[0];
    const data: any = await this.atk.call("market_get_funding_rate", { instId: `${base}-USDT-SWAP` });
    const v = Number(data?.[0]?.fundingRate);
    return Number.isFinite(v) ? v : null;
  }

  async orderbook(instId: string): Promise<OrderbookSummary | null> {
    const data: any = await this.atk.call("market_get_orderbook", { instId, sz: 50 });
    const book = Array.isArray(data) ? data[0] : data;
    const bids: string[][] = book?.bids ?? [];
    const asks: string[][] = book?.asks ?? [];
    if (!bids.length || !asks.length) return null;
    const bid = Number(bids[0][0]);
    const ask = Number(asks[0][0]);
    const mid = (bid + ask) / 2;
    const depth = (side: string[][], inRange: (p: number) => boolean) =>
      side.reduce((s, [p, q]) => (inRange(Number(p)) ? s + Number(p) * Number(q) : s), 0);
    const depthUsdt = depth(bids, (p) => p >= mid * 0.99) + depth(asks, (p) => p <= mid * 1.01);
    return { bid, ask, spreadPct: ((ask - bid) / mid) * 100, depthUsdt };
  }

  async sentiment(coins: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!coins.length) return out;
    try {
      const data: any = await this.atk.call("news_get_coin_sentiment", { coins: coins.slice(0, 20).join(","), period: "24h" });
      const list: any[] = Array.isArray(data) ? data : data?.list ?? data?.items ?? [];
      for (const it of list) {
        const coin = String(it.ccy ?? it.coin ?? it.symbol ?? "").toUpperCase();
        const bull = Number(it.bullishRatio ?? it.bullish ?? it.positive);
        const bear = Number(it.bearishRatio ?? it.bearish ?? it.negative);
        const score = Number(it.sentimentScore ?? it.score);
        let v: number | null = null;
        if (Number.isFinite(bull) && Number.isFinite(bear) && bull + bear > 0) v = (bull - bear) / (bull + bear);
        else if (Number.isFinite(score)) v = Math.max(-1, Math.min(1, score > 1 ? (score - 50) / 50 : score));
        if (coin && v !== null) out.set(coin, v);
      }
    } catch (e) {
      // Haber modülü OKX OAuth kimliği istiyor; erişilemezse boş döner (arayüzde "veri yok").
      this.lastNewsError = (e as Error).message;
    }
    return out;
  }

  lastNewsError: string | null = null;

  async news(coins: string[]): Promise<{ coin: string; title: string; ts: number }[]> {
    const data: any = await this.atk.call("news_get_latest", { coins: coins.slice(0, 20).join(","), importance: "low", limit: 20 });
    const list: any[] = Array.isArray(data) ? data : data?.list ?? data?.items ?? data?.news ?? [];
    return list.map((n) => ({ coin: String(n.ccy ?? n.coin ?? n.coins?.[0] ?? "").toUpperCase(), title: String(n.title ?? n.headline ?? ""), ts: Number(n.ts ?? n.publishTime ?? Date.now()) })).filter((n) => n.title);
  }
}
