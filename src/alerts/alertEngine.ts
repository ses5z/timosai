// Haber + hacim + OI bildirim motoru (ATK news + market). Bot kendiliğinden aday yağdırmaz:
// olumlu gelişmeler yalnızca takip edilenler için, kritikler eldeki coinler için; BTC sert düşüşte tek "genel piyasa" mesajı.
import fs from "node:fs";
import path from "node:path";
import type { AppContext } from "../context.js";
import type { Candidate } from "../ports.js";
import { log } from "../util/log.js";

export interface AlertConfig {
  volSpikeMult1h: number;
  volSpikeMult15m: number;
  dropAtrMult15m: number;
  sentimentJump: number;
  oiFilterTopN: number;
  oiFilterMinPct: number;
  btcDropPct1h: number;
  eventHoursAhead: number;
  repeatHours: number;
  newsPollMinutes: number;
  positiveNewsRe: string;
  criticalNewsRe: string;
}

export const DEFAULT_ALERTS: AlertConfig = { volSpikeMult1h: 3, volSpikeMult15m: 3, dropAtrMult15m: 2, sentimentJump: 0.4, oiFilterTopN: 30, oiFilterMinPct: 5, btcDropPct1h: 2.5, eventHoursAhead: 24, repeatHours: 2, newsPollMinutes: 10, positiveNewsRe: "(listing|partnership)", criticalNewsRe: "(hack|exploit|delist|unlock)" };

export function loadAlertConfig(file = path.resolve(process.cwd(), "config/alerts.json")): AlertConfig {
  try {
    return { ...DEFAULT_ALERTS, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return DEFAULT_ALERTS;
  }
}

export interface EventItem {
  coin: string;
  date: string;
  title: string;
  source?: string;
  sample?: boolean;
}

export function loadEvents(file = path.resolve(process.cwd(), "config/events.json")): EventItem[] {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).events ?? [];
  } catch {
    return [];
  }
}

export interface NewsItem {
  coin: string;
  title: string;
  ts: number;
}

export interface Alert {
  symbol: string;
  rule: string;
  text: string;
  critical: boolean;
}

export class AlertEngine {
  private fired = new Map<string, number>();
  private prevSentiment = new Map<string, number>();
  private oiTop = new Map<string, number>();
  private oiAt = 0;
  private news: NewsItem[] = [];
  private newsAt = 0;
  private newsDisabledUntil = 0;
  newsStatus = "denenmedi";
  readonly cfg: AlertConfig;
  private events: EventItem[];

  constructor(
    private readonly ctx: AppContext,
    opts: { cfg?: AlertConfig; events?: EventItem[]; now?: () => number } = {},
  ) {
    this.cfg = opts.cfg ?? loadAlertConfig();
    this.events = opts.events ?? loadEvents();
    this.now = opts.now ?? Date.now;
  }
  private now: () => number;

  /** Tek kural için tekrar sınırı (aynı uyarı `repeatHours` içinde bir kez). */
  private once(key: string): boolean {
    const t = this.now();
    const last = this.fired.get(key);
    if (last !== undefined && t - last < this.cfg.repeatHours * 3_600_000) return false;
    this.fired.set(key, t);
    return true;
  }

  /** ATK: OI değişim filtresi ve haber akışı (kimlik yoksa nazikçe kapalı). */
  async refreshSources(): Promise<void> {
    const atk = this.ctx.atk;
    if (!atk) return;
    const t = this.now();
    if (t - this.oiAt > 10 * 60_000) {
      this.oiAt = t;
      try {
        const rows: any[] = await atk.call("market_filter_oi_change", { instType: "SWAP", bar: "1H", limit: this.cfg.oiFilterTopN });
        this.oiTop = new Map(rows.map((r) => [String(r.instId).replace("-SWAP", ""), Number(r.oiDeltaPct)] as [string, number]).filter(([, v]) => Number.isFinite(v)));
      } catch (e) {
        log.warn(`OI değişim filtresi alınamadı: ${(e as Error).message}`);
      }
    }
    // Haberler ajanın her tarama turunda çektiği listeden gelir (ATK news_get_latest).
    this.news = this.ctx.agent.news.slice();
    this.newsStatus = this.ctx.agent.newsStatus;
  }

  /** Haberleri dışarıdan beslemek için (test ve ileride OAuth'lu kaynak). */
  setNews(items: NewsItem[]): void {
    this.news = items;
  }

  evaluate(candidates: Candidate[]): Alert[] {
    const out: Alert[] = [];
    const st = this.ctx.store;
    const follows = new Set(st.follows);
    const held = new Set(this.ctx.agent.trading.listPositions().map((p) => p.instId));
    const posRe = new RegExp(this.cfg.positiveNewsRe, "i");
    const critRe = new RegExp(this.cfg.criticalNewsRe, "i");
    const t = this.now();
    const push = (a: Alert) => {
      if (this.once(`${a.symbol}:${a.rule}`)) out.push(a);
    };

    for (const c of candidates) {
      const isHeld = held.has(c.instId);
      const isFollowed = follows.has(c.instId);
      const coinNews = this.news.filter((n) => n.coin === c.base);
      if (isHeld) {
        const last = c.spark.at(-1) ?? c.price;
        const prev = c.spark.at(-2) ?? last;
        if (c.atr > 0 && prev - last >= this.cfg.dropAtrMult15m * c.atr && (c.vol15mRatio ?? 0) >= this.cfg.volSpikeMult15m) {
          push({ symbol: c.instId, rule: "olagandisi_dusus", critical: true, text: `${c.base}: olağandışı düşüş. 15 dakikada ${(((last - prev) / prev) * 100).toFixed(2)}% (ATR'nin ${this.cfg.dropAtrMult15m} katından fazla) ve hacim normalin ${(c.vol15mRatio ?? 0).toFixed(1)} katı.` });
        }
        for (const n of coinNews) if (critRe.test(n.title)) push({ symbol: c.instId, rule: `haber_kritik:${n.title.slice(0, 40)}`, critical: true, text: `${c.base} için kritik haber: "${n.title.slice(0, 160)}". Elindeki pozisyonu ajan yönetiyor; stop yerinde.` });
      }
      if (isFollowed || isHeld) {
        if ((c.vol1hRatio ?? 0) >= this.cfg.volSpikeMult1h) push({ symbol: c.instId, rule: "hacim_1sa", critical: false, text: `${c.base}: son 1 saatlik hacim 20 saatlik ortalamanın ${(c.vol1hRatio ?? 0).toFixed(1)} katı.` });
        const oi = this.oiTop.get(c.instId);
        if (oi !== undefined && Math.abs(oi) >= this.cfg.oiFilterMinPct) push({ symbol: c.instId, rule: "oi_filtre", critical: false, text: `${c.base}: OI değişim filtresinde öne çıktı (1 saatte ${oi >= 0 ? "+" : ""}${oi.toFixed(1)}%).` });
        if (c.sentiment !== null) {
          const prev = this.prevSentiment.get(c.instId);
          if (prev !== undefined && Math.abs(c.sentiment - prev) >= this.cfg.sentimentJump) push({ symbol: c.instId, rule: "duygu", critical: false, text: `${c.base}: haber duyarlılığı sert değişti (${(prev * 100).toFixed(0)} → ${(c.sentiment * 100).toFixed(0)}).` });
          this.prevSentiment.set(c.instId, c.sentiment);
        }
        for (const n of coinNews) if (posRe.test(n.title) && !critRe.test(n.title)) push({ symbol: c.instId, rule: `haber_olumlu:${n.title.slice(0, 40)}`, critical: false, text: `${c.base} haberi: "${n.title.slice(0, 160)}".` });
        for (const e of this.events) {
          const dt = Date.parse(e.date) - t;
          if (e.coin.toUpperCase() === c.base && dt > 0 && dt <= this.cfg.eventHoursAhead * 3_600_000) push({ symbol: c.instId, rule: `etkinlik:${e.title}`, critical: false, text: `${c.base}: ${Math.round(dt / 3_600_000)} saat sonra "${e.title}"${e.sample ? " (ÖRNEK VERİ)" : ""}.` });
        }
      }
    }
    // Genel piyasa: BTC sert düşüşte tek mesaj (eldeki pozisyon varsa kritik)
    const btc = candidates.find((c) => c.instId === "BTC-USDT");
    if (btc) {
      const sp = btc.spark;
      const p1 = sp[Math.max(0, sp.length - 5)] ?? btc.price;
      const chg = ((btc.price - p1) / p1) * 100;
      if (chg <= -this.cfg.btcDropPct1h) push({ symbol: "PİYASA", rule: "btc_dusus", critical: held.size > 0, text: `Genel piyasa: BTC 1 saatte ${chg.toFixed(2)}% düştü. Ajan stoplarla pozisyonları yönetiyor.` });
    }
    return out;
  }
}
