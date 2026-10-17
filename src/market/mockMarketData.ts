// MockMarketData: deterministik örnek veri (canlı veri yoksa veya ATK_MODE=mock).
import type { MarketData, OrderbookSummary, Ticker } from "../ports.js";
import type { Candle } from "../util/math.js";
import { pctChange, rsi } from "../util/math.js";

const BASE_PRICES: Record<string, number> = {
  BTC: 81000, ETH: 3100, SOL: 105, BNB: 640, AVAX: 21, ADA: 0.52, DOT: 4.1, TRX: 0.27, TON: 3.2, NEAR: 2.6,
  APT: 5.2, SUI: 2.9, XRP: 2.1, LTC: 88, BCH: 410, ARB: 0.38, OP: 0.62, POL: 0.21, LINK: 14.2, UNI: 7.4,
  AAVE: 210, LDO: 1.05, FET: 0.62, RENDER: 3.6, WLD: 1.1, DOGE: 0.17, PEPE: 0.0000095, SHIB: 0.0000135,
};

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function hash(str: string): number {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export class MockMarketData implements MarketData {
  readonly name = "mock";
  private series = new Map<string, Candle[]>();
  private tick = 0;

  constructor(private readonly fixedNow?: number) {}

  isLive(): boolean {
    return false;
  }

  private gen(instId: string): Candle[] {
    let s = this.series.get(instId);
    if (!s) {
      const base = instId.split("-")[0];
      const rnd = seeded(hash(instId));
      const p0 = BASE_PRICES[base] ?? 1;
      const drift = (rnd() - 0.45) * 0.004;
      const vol = 0.004 + rnd() * 0.01;
      const now = this.fixedNow ?? Date.now();
      const start = Math.floor(now / 900_000) * 900_000 - 99 * 900_000;
      s = [];
      let p = p0 * (0.94 + rnd() * 0.08);
      for (let i = 0; i < 100; i++) {
        const o = p;
        p = Math.max(p0 * 0.2, p * (1 + drift + (rnd() - 0.5) * vol));
        const hi = Math.max(o, p) * (1 + rnd() * vol * 0.4);
        const lo = Math.min(o, p) * (1 - rnd() * vol * 0.4);
        s.push({ ts: start + i * 900_000, open: o, high: hi, low: lo, close: p, vol: (5e5 + rnd() * 5e6) * (base === "BTC" ? 20 : 1) });
      }
      this.series.set(instId, s);
    }
    return s;
  }

  /** Demo/test için fiyatı sürer (senaryo ve birim testleri). */
  nudge(instId: string, pct: number): void {
    const s = this.gen(instId);
    const last = s[s.length - 1];
    const p = last.close * (1 + pct / 100);
    s.push({ ts: last.ts + 900_000, open: last.close, high: Math.max(last.close, p), low: Math.min(last.close, p), close: p, vol: last.vol });
    s.shift();
  }

  setPrice(instId: string, price: number): void {
    const s = this.gen(instId);
    const last = s[s.length - 1];
    this.nudge(instId, pctChange(last.close, price));
  }

  async tickers(instIds: string[]): Promise<Map<string, Ticker>> {
    this.tick++;
    const out = new Map<string, Ticker>();
    for (const id of instIds) {
      const s = this.gen(id);
      const last = s[s.length - 1];
      const open = s[Math.max(0, s.length - 96)].open;
      const window = s.slice(-96);
      out.set(id, {
        instId: id,
        last: last.close,
        open24h: open,
        high24h: Math.max(...window.map((c) => c.high)),
        low24h: Math.min(...window.map((c) => c.low)),
        change24hPct: pctChange(open, last.close),
        volUsdt24h: window.reduce((a, c) => a + c.vol, 0),
        ts: Date.now(),
      });
    }
    return out;
  }

  async candles(instId: string, _bar: string, limit: number, after?: number): Promise<Candle[]> {
    const s = this.gen(instId);
    if (after) {
      const have = s.filter((c) => c.ts < after);
      if (have.length) return have.slice(-limit);
      // Örnek veri: geçmiş istenirse deterministik eski mumlar üretilir (sola kaydırma testi için; en fazla 30 gün geri).
      if (after < s[0].ts - 30 * 86_400_000) return [];
      const rnd = seeded(hash(instId) ^ Math.floor(after / 900_000));
      const out: Candle[] = [];
      let p = s[0].open;
      for (let i = 1; i <= limit; i++) {
        const c = p;
        p = p * (1 + (rnd() - 0.5) * 0.01);
        out.unshift({ ts: after - i * 900_000, open: p, high: Math.max(p, c) * 1.002, low: Math.min(p, c) * 0.998, close: c, vol: 1e6 });
      }
      return out;
    }
    return s.slice(-limit);
  }

  async indicatorRsi(instId: string): Promise<number | null> {
    return rsi(this.gen(instId).map((c) => c.close));
  }

  async funding(instId: string): Promise<number | null> {
    return ((hash(instId) % 100) - 40) / 1e6;
  }

  async orderbook(instId: string): Promise<OrderbookSummary | null> {
    const last = this.gen(instId).at(-1)!.close;
    const spread = 0.0002 + (hash(instId) % 10) / 20000;
    return { bid: last * (1 - spread / 2), ask: last * (1 + spread / 2), spreadPct: spread * 100, depthUsdt: 50_000 + (hash(instId) % 500_000) };
  }

  async sentiment(coins: string[]): Promise<Map<string, number>> {
    return new Map(coins.map((c) => [c, ((hash(c) % 200) - 100) / 250]));
  }
}
