// Long/Short tablosu: OKX üst trader (hesap + pozisyon) ve genel hesap oranı (vadeli kartıyla ortak, ATK dışı OKX public)
// + Binance Futures public (anahtarsız): topLongShortAccountRatio, topLongShortPositionRatio, globalLongShortAccountRatio (5m).
// Long yüzdesi = oran / (1 + oran). OKX ve Binance "üst trader" tanımları farklıdır (açıklama balonunda belirtilir).
import fs from "node:fs";
import path from "node:path";
import type { AppContext } from "../context.js";
import { log } from "../util/log.js";

export interface LsConfig {
  refreshMinutes: number;
  categoryLongHighPct: number;
  categoryLongLowPct: number;
  binanceSymbolMap: Record<string, string>;
}

export function loadLsConfig(file = path.resolve(process.cwd(), "config/longshort.json")): LsConfig {
  const def: LsConfig = { refreshMinutes: 5, categoryLongHighPct: 75, categoryLongLowPct: 25, binanceSymbolMap: { PEPE: "1000PEPEUSDT", SHIB: "1000SHIBUSDT" } };
  try {
    return { ...def, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return def;
  }
}

export const longPct = (ratio: number | null | undefined): number | null => (ratio === null || ratio === undefined || !Number.isFinite(ratio) ? null : (ratio / (1 + ratio)) * 100);

export interface LsRow {
  instId: string;
  base: string;
  category: string;
  volUsdt24h: number;
  okxTopAccount: number | null; // long %
  okxTopPosition: number | null;
  okxAccount: number | null;
  bnTopAccount: number | null;
  bnTopPosition: number | null;
  bnGlobal: number | null;
}

export type LsCol = "okxTopAccount" | "okxTopPosition" | "okxAccount" | "bnTopAccount" | "bnTopPosition" | "bnGlobal";
export const LS_COLS: LsCol[] = ["okxTopAccount", "okxTopPosition", "okxAccount", "bnTopAccount", "bnTopPosition", "bnGlobal"];

/** 24 sa USDT hacmine göre ağırlıklı ortalama (değeri olmayanlar hariç). */
export function weighted(rows: LsRow[], col: LsCol): number | null {
  let w = 0;
  let s = 0;
  for (const r of rows) {
    const v = r[col];
    if (v === null || !(r.volUsdt24h > 0)) continue;
    w += r.volUsdt24h;
    s += v * r.volUsdt24h;
  }
  return w > 0 ? s / w : null;
}

export function aggregate(label: string, rows: LsRow[]) {
  return { label, count: rows.length, ...Object.fromEntries(LS_COLS.map((c) => [c, weighted(rows, c)])) } as { label: string; count: number } & Record<LsCol, number | null>;
}

/** Özet satırları (BTC, ETH, Top 10, Top 20, All, Ex Top 20) ve kategori satırları. */
export function summarize(rows: LsRow[]) {
  const byVol = [...rows].sort((a, b) => b.volUsdt24h - a.volUsdt24h);
  const summary = [
    aggregate("BTC", rows.filter((r) => r.base === "BTC")),
    aggregate("ETH", rows.filter((r) => r.base === "ETH")),
    aggregate("Top 10", byVol.slice(0, 10)),
    aggregate("Top 20", byVol.slice(0, 20)),
    aggregate("All", byVol),
    aggregate("Ex Top 20", byVol.slice(20)),
  ];
  const cats = [...new Set(rows.map((r) => r.category))];
  const categories = cats.map((c) => aggregate(c, rows.filter((r) => r.category === c))).sort((a, b) => (b.okxTopAccount ?? -1) - (a.okxTopAccount ?? -1));
  return { summary, categories };
}

export class LongShortService {
  private bn = new Map<string, { at: number; topAccount: number | null; topPosition: number | null; global: number | null }>();
  updatedAt = 0;
  private running = false;
  readonly cfg: LsConfig;
  constructor(
    private readonly ctx: AppContext,
    private readonly fetchImpl: typeof fetch | null = fetch,
    cfg?: LsConfig,
  ) {
    this.cfg = cfg ?? loadLsConfig();
  }

  binanceSymbol(base: string): string {
    return this.cfg.binanceSymbolMap[base] ?? `${base}USDT`;
  }

  private async bnOne(base: string) {
    if (!this.fetchImpl) return;
    const sym = this.binanceSymbol(base);
    const get = async (ep: string) => {
      const r = await this.fetchImpl!(`https://fapi.binance.com/futures/data/${ep}?symbol=${sym}&period=5m&limit=1`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const j: any = await r.json();
      const v = Number(j?.[0]?.longShortRatio);
      return Number.isFinite(v) ? v : null;
    };
    try {
      const [a, p, g] = await Promise.all([get("topLongShortAccountRatio"), get("topLongShortPositionRatio"), get("globalLongShortAccountRatio")]);
      this.bn.set(base, { at: Date.now(), topAccount: a, topPosition: p, global: g });
    } catch {
      /* veri yok */
    }
  }

  /** Binance verisini yeniler (refreshMinutes); OKX verisi ajanın vadeli önbelleğinden gelir. */
  async refresh(force = false): Promise<void> {
    if (this.running) return;
    if (!force && Date.now() - this.updatedAt < this.cfg.refreshMinutes * 60_000) return;
    this.running = true;
    try {
      const bases = this.ctx.watchlist.map((w) => w.instId.split("-")[0]);
      // Binance'e küçük gruplarla (3 coin × 3 uç nokta) ve aralıklı istek
      for (let i = 0; i < bases.length; i += 3) {
        await Promise.all(bases.slice(i, i + 3).map((b) => this.bnOne(b)));
        await new Promise((r) => setTimeout(r, 250));
      }
      this.updatedAt = Date.now();
    } catch (e) {
      log.warn(`L/S yenilenemedi: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  rows(): LsRow[] {
    return this.ctx.watchlist.map((w) => {
      const base = w.instId.split("-")[0];
      const okx = this.ctx.agent.derivSnap.get(w.instId)?.v;
      const okxPublic = okx?.publicSource === "OKX";
      const b = this.bn.get(base);
      return {
        instId: w.instId,
        base,
        category: w.category,
        volUsdt24h: this.ctx.agent.prices.get(w.instId)?.volUsdt24h ?? 0,
        okxTopAccount: okxPublic ? longPct(okx!.lsTopAccount) : null,
        okxTopPosition: okxPublic ? longPct(okx!.lsTopPosition) : null,
        okxAccount: okxPublic ? longPct(okx!.lsAccount) : null,
        bnTopAccount: longPct(b?.topAccount),
        bnTopPosition: longPct(b?.topPosition),
        bnGlobal: longPct(b?.global),
      };
    });
  }

  table() {
    const rows = this.rows();
    const okxTimes = this.ctx.watchlist.map((w) => this.ctx.agent.derivSnap.get(w.instId)?.at ?? 0).filter(Boolean);
    return { rows, ...summarize(rows), updatedAt: { binance: this.updatedAt || null, okx: okxTimes.length ? Math.max(...okxTimes) : null }, notes: { okx: "OKX üst trader: OKX'in en büyük pozisyonlu hesapları (hesap sayısı ve pozisyon büyüklüğü oranları). Genel hesap: tüm hesaplar. Kaynak: OKX vadeli verisi (ATK dışı).", binance: "Binance top trader: Binance'in marjin bakiyesine göre en üst %20 hesabı; tanım OKX'ten farklıdır. Kaynak: Binance Futures public (5 dk)." } };
  }

  /** Kategori long oranı eşiği aşınca (config) tek bildirim. Dönen: yeni aşan kategoriler. */
  categoryAlerts(): { category: string; pct: number; side: "high" | "low" }[] {
    const { categories } = summarize(this.rows());
    const out: { category: string; pct: number; side: "high" | "low" }[] = [];
    for (const c of categories) {
      const v = c.okxTopAccount ?? c.bnTopAccount;
      if (v === null) continue;
      if (v >= this.cfg.categoryLongHighPct) out.push({ category: c.label, pct: v, side: "high" });
      else if (v <= this.cfg.categoryLongLowPct) out.push({ category: c.label, pct: v, side: "low" });
    }
    return out;
  }
}

/** Telegram için monospace tablo (Account / Position sütunları). */
export function lsText(t: ReturnType<LongShortService["table"]>, base?: string): string {
  const f = (v: number | null) => (v === null ? "  -  " : `${v.toFixed(0).padStart(3)}%`);
  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s + " ".repeat(n - s.length));
  if (base) {
    const r = t.rows.find((x) => x.base === base);
    if (!r) return `${base}: izleme listesinde değil.`;
    return [`${base} long oranı (long % = oran/(1+oran))`, "```", `${pad("", 10)} Account Position`, `${pad("OKX üst", 10)} ${f(r.okxTopAccount)}    ${f(r.okxTopPosition)}`, `${pad("OKX genel", 10)} ${f(r.okxAccount)}       -`, `${pad("BN üst", 10)} ${f(r.bnTopAccount)}    ${f(r.bnTopPosition)}`, `${pad("BN genel", 10)} ${f(r.bnGlobal)}       -`, "```", "OKX ve Binance 'üst trader' tanımları farklıdır."].join("\n");
  }
  const lines = [`${pad("", 10)} OKX Acc OKX Pos BN Acc BN Pos`];
  for (const r of [...t.summary, ...t.categories]) lines.push(`${pad(r.label, 10)} ${f(r.okxTopAccount)}   ${f(r.okxTopPosition)}  ${f(r.bnTopAccount)}  ${f(r.bnTopPosition)}`);
  return ["Long/Short (üst trader long %, 24 sa hacim ağırlıklı)", "```", ...lines, "```", `Güncelleme: OKX ${t.updatedAt.okx ? new Date(t.updatedAt.okx).toLocaleTimeString("tr-TR") : "-"} · Binance ${t.updatedAt.binance ? new Date(t.updatedAt.binance).toLocaleTimeString("tr-TR") : "-"}`].join("\n");
}
