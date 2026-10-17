// Pro Long/Short: OKX'teki TÜM USDT perpetual (SWAP) coinleri. Evren ve funding tek çağrıyla (tickers SWAP,
// funding-rate?instId=ANY). L/S oranları coin başına (OKX rubik: üst trader hesap + pozisyon, genel hesap; Binance
// futures/data muadilleri) arka planda, 24 sa hacme göre sırayla ve hız sınırına uyarak çekilir; 5 dk önbellek.
// Aranan coin beklemeden anında çekilir. Long % = oran / (1 + oran).
import type { AppContext } from "../context.js";
import { longPct } from "./longShort.js";
import { log } from "../util/log.js";
import { okxRubikSlot } from "../util/okxThrottle.js";

export interface SwapLsRow {
  base: string;
  swapId: string;
  category: string;
  volUsdt24h: number;
  funding: number | null;
  okx: { account: number | null; position: number | null; general: number | null; at: number } | null;
  bn: { account: number | null; position: number | null; general: number | null; at: number } | null;
}

type Fetch = typeof fetch;
const CACHE_MS = 5 * 60_000;

export class SwapLongShort {
  rows = new Map<string, SwapLsRow>();
  universeAt = 0;
  cycleStartedAt = 0;
  cycleDone = 0;
  private loopRunning = false;
  private stopped = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly fetchImpl: Fetch | null,
    private readonly okxGapMs = 420, // rubik: ~5 istek / 2 sn
    private readonly bnGapMs = 120,
  ) {}

  private async json(url: string): Promise<any> {
    const r = await this.fetchImpl!(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  private okxThrottle(): Promise<void> {
    return okxRubikSlot(this.okxGapMs); // vadeli kartıyla ortak kuyruk
  }

  categoryOf(base: string): string {
    return this.ctx.watchlist.find((w) => w.instId.split("-")[0] === base)?.category ?? "Diğer";
  }

  /** Evren + funding: iki çağrı. */
  async loadUniverse(force = false): Promise<void> {
    if (!this.fetchImpl) return;
    if (!force && Date.now() - this.universeAt < CACHE_MS && this.rows.size) return;
    const [t, f] = await Promise.all([this.json("https://www.okx.com/api/v5/market/tickers?instType=SWAP"), this.json("https://www.okx.com/api/v5/public/funding-rate?instId=ANY").catch(() => null)]);
    const fund = new Map<string, number>();
    for (const x of f?.data ?? []) fund.set(x.instId, Number(x.fundingRate));
    for (const x of t?.data ?? []) {
      if (!String(x.instId).endsWith("-USDT-SWAP")) continue;
      const base = x.instId.split("-")[0];
      const prev = this.rows.get(base);
      const fr = fund.get(x.instId);
      this.rows.set(base, { base, swapId: x.instId, category: this.categoryOf(base), volUsdt24h: Number(x.volCcy24h) * Number(x.last) || 0, funding: fr !== undefined && Number.isFinite(fr) ? fr : null, okx: prev?.okx ?? null, bn: prev?.bn ?? null });
    }
    this.universeAt = Date.now();
  }

  async fetchOkx(base: string): Promise<void> {
    const r = this.rows.get(base);
    if (!r || !this.fetchImpl) return;
    const q = `instId=${encodeURIComponent(r.swapId)}&period=5m&limit=1`;
    const b = "https://www.okx.com/api/v5/rubik/stat/contracts";
    const get = async (ep: string) => {
      await this.okxThrottle();
      const j = await this.json(`${b}/${ep}?${q}`).catch(() => null);
      return j?.code === "0" ? longPct(Number(j.data?.[0]?.[1])) : null;
    };
    const account = await get("long-short-account-ratio-contract-top-trader");
    const position = await get("long-short-position-ratio-contract-top-trader");
    const general = await get("long-short-account-ratio-contract");
    r.okx = { account, position, general, at: Date.now() };
  }

  async fetchBinance(base: string): Promise<void> {
    const r = this.rows.get(base);
    if (!r || !this.fetchImpl) return;
    const sym = (this.ctx.extras.ls?.binanceSymbol?.(base) as string | undefined) ?? `${base}USDT`;
    const get = async (ep: string) => {
      await new Promise((res) => setTimeout(res, this.bnGapMs));
      const j = await this.json(`https://fapi.binance.com/futures/data/${ep}?symbol=${sym}&period=5m&limit=1`).catch(() => null);
      return longPct(Number(j?.[0]?.longShortRatio));
    };
    const account = await get("topLongShortAccountRatio");
    const position = await get("topLongShortPositionRatio");
    const general = await get("globalLongShortAccountRatio");
    r.bn = { account, position, general, at: Date.now() };
  }

  /** Aranan coin: önbellekte taze değilse anında çekilir. */
  async ensureCoin(base: string): Promise<SwapLsRow | null> {
    await this.loadUniverse().catch(() => undefined);
    const r = this.rows.get(base);
    if (!r) return null;
    const stale = (x: { at: number } | null) => !x || Date.now() - x.at > CACHE_MS;
    await Promise.all([stale(r.okx) ? this.fetchOkx(base) : null, stale(r.bn) ? this.fetchBinance(base) : null]);
    return r;
  }

  /** Arka plan: hacme göre sırayla tüm coinler; 5 dk'dan eski olanlar yenilenir. */
  start(): void {
    if (this.loopRunning || !this.fetchImpl) return;
    this.loopRunning = true;
    const loop = async () => {
      while (!this.stopped) {
        try {
          await this.loadUniverse();
          this.cycleStartedAt = Date.now();
          this.cycleDone = 0;
          const order = [...this.rows.values()].sort((a, b) => b.volUsdt24h - a.volUsdt24h);
          for (const r of order) {
            if (this.stopped) return;
            if (!r.okx || Date.now() - r.okx.at > CACHE_MS) await this.fetchOkx(r.base);
            if (!r.bn || Date.now() - r.bn.at > CACHE_MS) await this.fetchBinance(r.base);
            this.cycleDone++;
          }
        } catch (e) {
          log.warn(`Tüm SWAP L/S döngüsü: ${(e as Error).message}`);
        }
        await new Promise((r) => setTimeout(r, 30_000));
      }
    };
    void loop();
  }

  stop(): void {
    this.stopped = true;
  }

  table(source: "okx" | "bn" = "okx") {
    const list = [...this.rows.values()].sort((a, b) => b.volUsdt24h - a.volUsdt24h);
    const rows = list.map((r) => {
      const s = source === "okx" ? r.okx : r.bn;
      return { base: r.base, category: r.category, volUsdt24h: r.volUsdt24h, funding: r.funding, account: s?.account ?? null, position: s?.position ?? null, general: s?.general ?? null, at: s?.at ?? null };
    });
    const agg = (label: string, xs: typeof rows) => {
      const w = (k: "account" | "position" | "general") => {
        let tw = 0, s = 0;
        for (const x of xs) if (x[k] !== null && x.volUsdt24h > 0) { tw += x.volUsdt24h; s += x[k]! * x.volUsdt24h; }
        return tw > 0 ? s / tw : null;
      };
      return { label, count: xs.length, account: w("account"), position: w("position"), general: w("general") };
    };
    const summary = [agg("BTC", rows.filter((r) => r.base === "BTC")), agg("ETH", rows.filter((r) => r.base === "ETH")), agg("Top 10", rows.slice(0, 10)), agg("Top 20", rows.slice(0, 20)), agg("All", rows), agg("Ex Top 20", rows.slice(20))];
    const cats = [...new Set(rows.map((r) => r.category))];
    const categories = cats.map((c) => agg(c, rows.filter((r) => r.category === c))).sort((a, b) => b.count - a.count);
    const filled = rows.filter((r) => r.at !== null).length;
    return { source, rows, summary, categories, total: rows.length, filled, cycle: { startedAt: this.cycleStartedAt || null, done: this.cycleDone }, universeAt: this.universeAt || null, units: { volume: "USDT (24 sa, volCcy24h × son fiyat)", funding: "8 saatlik oran" } };
  }
}
