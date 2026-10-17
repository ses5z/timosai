// ResilientMarketData: ATK başarısız olursa nazikçe örnek veriye düşer ve "canlı veri yok" bayrağını kaldırır.
import type { MarketData, OrderbookSummary, Ticker } from "../ports.js";
import type { Candle } from "../util/math.js";
import { log } from "../util/log.js";

export class ResilientMarketData implements MarketData {
  readonly name = "resilient";
  private live = true;
  private failures = 0;
  private retryAt = 0;

  constructor(
    private readonly primary: MarketData,
    private readonly fallback: MarketData,
  ) {}

  isLive(): boolean {
    return this.live;
  }

  private async run<T>(fn: (m: MarketData) => Promise<T>, critical = false): Promise<T> {
    if (!this.live && Date.now() < this.retryAt) return fn(this.fallback);
    try {
      const v = await fn(this.primary);
      if (!this.live && critical) log.info("Canlı piyasa verisi geri geldi.");
      if (critical) {
        this.live = true;
        this.failures = 0;
      }
      return v;
    } catch (e) {
      if (critical) {
        this.failures++;
        if (this.failures >= 2 && this.live) {
          this.live = false;
          log.warn(`Canlı veri alınamıyor, örnek veriye geçildi: ${(e as Error).message}`);
        }
        this.retryAt = Date.now() + 60_000;
      }
      return fn(this.fallback);
    }
  }

  tickers(ids: string[]): Promise<Map<string, Ticker>> {
    return this.run((m) => m.tickers(ids), true);
  }
  candles(id: string, bar: string, limit: number): Promise<Candle[]> {
    return this.run((m) => m.candles(id, bar, limit));
  }
  indicatorRsi(id: string, bar: string): Promise<number | null> {
    return this.run((m) => m.indicatorRsi(id, bar)).catch(() => null);
  }
  funding(id: string): Promise<number | null> {
    return this.primary.funding(id).catch(() => null);
  }
  orderbook(id: string): Promise<OrderbookSummary | null> {
    return this.run((m) => m.orderbook(id)).catch(() => null);
  }
  news(coins: string[]): Promise<{ coin: string; title: string; ts: number }[]> {
    if (!this.primary.news) return Promise.reject(new Error("haber kaynağı yok"));
    return this.primary.news(coins);
  }
  sentiment(coins: string[]): Promise<Map<string, number>> {
    // duygu verisi uydurulmaz: canlı yoksa boş döner
    return this.live ? this.primary.sentiment(coins).catch(() => new Map()) : Promise.resolve(new Map());
  }
}
