// Otonom ajan: Tara → Güvenlik → Karar → Sözleşme kontrolü → Emir → İz.
// Zarar sonrası susmaz, yavaşlamaz, beklemez; yalnızca sözleşmeye ve sert limitlere uyar.
import type { Candidate, DecisionProvider, MarketData, Ticker } from "../ports.js";
import type { SignalLedger } from "../ledger/signalLedger.js";
import type { Store } from "../state/store.js";
import type { WarningCenter } from "../contract/warnings.js";
import { checkAgentEntry, computeRiskScore, type ContractRules, type RiskScore } from "../contract/contract.js";
import type { HardLimits } from "../trading/hardLimits.js";
import { HardLimitError, type EntryRequest, type Position, type TradingClient } from "../trading/tradingClient.js";
import type { Thresholds } from "./thresholds.js";
import { sizePosition } from "./sizing.js";
import { round, roundPrice } from "../util/math.js";
import { log } from "../util/log.js";

export interface WatchPair {
  instId: string;
  category: string;
}

export type DevelopmentKind =
  | "hareket"
  | "karar"
  | "güvenlik"
  | "risk"
  | "stop_yakın"
  | "hedef_yakın"
  | "pozisyon_açıldı"
  | "pozisyon_kapandı"
  | "daha_iyi_giriş"
  | "günlük_zarar";

export interface Development {
  symbol: string;
  kind: DevelopmentKind;
  text: string;
  critical: boolean;
}

export interface AgentDeps {
  market: MarketData;
  trading: TradingClient;
  decision: DecisionProvider;
  ledger: SignalLedger;
  store: Store;
  warnings: WarningCenter;
  limits: HardLimits;
  thresholds: Thresholds;
  contract: ContractRules;
  watchlist: WatchPair[];
  scanIntervalSec: number;
  priceTickSec?: number;
}

const LEVEL_RANK = { iyi: 0, orta: 1, zayıf: 2 } as const;

export class Agent {
  candidates = new Map<string, Candidate>();
  prices = new Map<string, Ticker>();
  equityHistory: { ts: number; equity: number }[] = [];
  scanCount = 0;
  lastScanAt = 0;
  lastScanMs = 0;
  lastError: string | null = null;
  private scanning = false;
  private timers: NodeJS.Timeout[] = [];
  private rsiCache = new Map<string, { v: number | null; at: number }>();
  private fundingCache = new Map<string, { v: number | null; at: number }>();
  private sentimentCache: { map: Map<string, number>; at: number } = { map: new Map(), at: 0 };
  private blockedTimes: number[] = [];
  private lossStreak = 0;
  private baselineDone = false;
  private dailyLossWarnedDay = "";
  private lastRiskScore = 0;
  private notedNear = new Set<string>();
  private devListeners: ((d: Development) => void)[] = [];
  private stopped = true;

  constructor(readonly d: AgentDeps) {}

  onDevelopment(fn: (d: Development) => void): void {
    this.devListeners.push(fn);
  }

  private dev(d: Development): void {
    if (!this.baselineDone && !d.critical && d.kind !== "pozisyon_açıldı" && d.kind !== "pozisyon_kapandı") return; // başlangıçta bildirim yağmuru yok
    for (const l of this.devListeners) l(d);
  }

  get trading(): TradingClient {
    return this.d.trading;
  }

  setTrading(t: TradingClient): void {
    this.d.trading = t;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const scan = () => this.scanOnce().catch((e) => log.error("tarama", e));
    void scan();
    this.timers.push(setInterval(scan, this.d.scanIntervalSec * 1000));
    this.timers.push(setInterval(() => this.priceTick().catch((e) => log.error("fiyat", e)), (this.d.priceTickSec ?? 10) * 1000));
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  status() {
    const s = this.d.store.settings;
    return {
      state: s.paused ? "kullanıcı duraklattı" : this.stopped ? "durdu" : "çalışıyor",
      autonomous: s.autonomous,
      paused: s.paused,
      mode: this.d.trading.mode,
      liveData: this.d.market.isLive(),
      scanCount: this.scanCount,
      lastScanAt: this.lastScanAt,
      lastScanMs: this.lastScanMs,
      scanIntervalSec: this.d.scanIntervalSec,
      decisionProvider: this.d.decision.name,
      lastError: this.lastError,
    };
  }

  /** Tarama sırası: kullanıcı öncelikleri ve plan tercihleri önce. */
  scanOrder(): WatchPair[] {
    const pr = [...this.d.store.priority, ...this.d.store.planPreference];
    return [...this.d.watchlist].sort((a, b) => {
      const ia = pr.indexOf(a.instId);
      const ib = pr.indexOf(b.instId);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
  }

  async scanOnce(): Promise<Candidate[]> {
    if (this.scanning) return [...this.candidates.values()];
    this.scanning = true;
    const t0 = Date.now();
    try {
      const order = this.scanOrder();
      const ids = order.map((w) => w.instId);
      const tickers = await this.d.market.tickers(ids);
      for (const [k, v] of tickers) this.prices.set(k, v);
      const now = Date.now();
      if (now - this.sentimentCache.at > 10 * 60_000) {
        this.sentimentCache = { map: await this.d.market.sentiment(ids.map((i) => i.split("-")[0])), at: now };
      }
      const live = this.d.market.isLive();
      const priorityIds = new Set(this.d.store.priority);
      const results: Candidate[] = [];
      const rotate = this.scanCount % 4;
      const work = order.filter((w) => tickers.has(w.instId));
      const chunk = 6;
      for (let i = 0; i < work.length; i += chunk) {
        const part = work.slice(i, i + chunk);
        const out = await Promise.all(
          part.map(async (w, j) => {
            const idx = i + j;
            try {
              const candles = await this.d.market.candles(w.instId, "15m", 100);
              const rsi = await this.cachedRsi(w.instId, priorityIds.has(w.instId) || idx % 4 === rotate);
              const funding = await this.cachedFunding(w.instId);
              const sent = this.sentimentCache.map.get(w.instId.split("-")[0]);
              return this.d.decision.decide({
                instId: w.instId,
                category: w.category,
                ticker: tickers.get(w.instId)!,
                candles,
                rsi,
                funding,
                sentiment: sent === undefined ? null : sent,
                orderbook: null,
                live,
              });
            } catch (e) {
              log.warn(`${w.instId} taranamadı: ${(e as Error).message}`);
              return this.candidates.get(w.instId) ?? null;
            }
          }),
        );
        for (const c of out) if (c) results.push(c);
      }
      // Güvenlik: en umut verici adaylar için gerçek emir defteri (makas/derinlik)
      const top = [...results].sort((a, b) => b.opportunity - a.opportunity).slice(0, 6);
      await Promise.all(
        top.map(async (c) => {
          const ob = await this.d.market.orderbook(c.instId).catch(() => null);
          if (!ob) return;
          const w = order.find((x) => x.instId === c.instId)!;
          const candles = await this.d.market.candles(c.instId, "15m", 100);
          const re = this.d.decision.decide({
            instId: c.instId,
            category: w.category,
            ticker: tickers.get(c.instId)!,
            candles,
            rsi: this.rsiCache.get(c.instId)?.v ?? null,
            funding: this.fundingCache.get(c.instId)?.v ?? null,
            sentiment: c.sentiment,
            orderbook: ob,
            live,
          });
          results[results.indexOf(c)] = re;
        }),
      );
      this.applyResults(results);
      this.scanCount++;
      this.lastScanAt = Date.now();
      this.lastScanMs = Date.now() - t0;
      this.lastError = null;
      this.d.store.bus.publish("scan", { count: results.length, at: this.lastScanAt, ms: this.lastScanMs, live });
      if (this.d.store.settings.autonomous && !this.d.store.settings.paused) await this.autoTrade();
      await this.managePositions();
      this.checkRisk();
      this.snapshotEquity();
      this.baselineDone = true;
      return results;
    } catch (e) {
      this.lastError = (e as Error).message;
      log.error("tarama hatası", e);
      return [...this.candidates.values()];
    } finally {
      this.scanning = false;
    }
  }

  private async cachedRsi(instId: string, refresh: boolean): Promise<number | null> {
    const c = this.rsiCache.get(instId);
    if (c && !refresh && Date.now() - c.at < 5 * 60_000) return c.v;
    if (c && Date.now() - c.at < 60_000) return c.v;
    const v = await this.d.market.indicatorRsi(instId, "1H").catch(() => null);
    this.rsiCache.set(instId, { v, at: Date.now() });
    return v;
  }

  private async cachedFunding(instId: string): Promise<number | null> {
    const c = this.fundingCache.get(instId);
    if (c && Date.now() - c.at < 10 * 60_000) return c.v;
    const v = await this.d.market.funding(instId).catch(() => null);
    // yenilemeleri zamana yaymak için küçük rastgele kayma
    this.fundingCache.set(instId, { v, at: Date.now() - Math.random() * 120_000 });
    return v;
  }

  private applyResults(results: Candidate[]): void {
    const held = new Set(this.d.trading.listPositions().map((p) => p.instId));
    const watched = new Set(this.d.store.follows);
    for (const c of results) {
      const prev = this.candidates.get(c.instId);
      this.candidates.set(c.instId, c);
      if (!prev) continue;
      const interested = watched.has(c.instId) || held.has(c.instId);
      if (prev.decision !== c.decision) {
        this.d.ledger.append("decision", { instId: c.instId, karar: c.decision, onceki: prev.decision, firsat: c.opportunity, risk: c.risk, gerekce: c.reason });
        if (interested) this.dev({ symbol: c.instId, kind: "karar", text: `${c.base}: ajanın görüşü ${prev.decision} → ${c.decision}. ${c.reason}`, critical: false });
      }
      if (!interested) continue;
      const lastClose = c.spark.at(-1) ?? c.price;
      const prevClose = c.spark.at(-2) ?? lastClose;
      if (c.atr > 0 && Math.abs(lastClose - prevClose) > 2 * c.atr) {
        const pct = ((lastClose - prevClose) / prevClose) * 100;
        this.dev({ symbol: c.instId, kind: "hareket", text: `${c.base} 15 dakikada ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% hareket etti (ATR'nin 2 katından fazla).`, critical: false });
      }
      if (LEVEL_RANK[c.security.level] > LEVEL_RANK[prev.security.level]) {
        this.dev({ symbol: c.instId, kind: "güvenlik", text: `${c.base}: güvenlik özeti ${prev.security.level} → ${c.security.level} (makas/derinlik).`, critical: false });
      }
      if (c.risk - prev.risk >= 15) {
        this.dev({ symbol: c.instId, kind: "risk", text: `${c.base}: risk puanı ${prev.risk} → ${c.risk}.`, critical: false });
      }
      if (!held.has(c.instId) && c.decision === "aç" && prev.decision === "aç" && c.atr > 0 && prev.entry - c.entry > c.atr) {
        this.dev({ symbol: c.instId, kind: "daha_iyi_giriş", text: `${c.base}: giriş noktası ${prev.entry} → ${c.entry}; karar hâlâ "aç".`, critical: false });
      }
    }
    this.d.store.bus.publish("candidates", this.queue().slice(0, 30).map(slim));
  }

  /** Aday kuyruğu: fırsata göre sıralı, "ele" en sonda. */
  queue(): Candidate[] {
    const rank = { aç: 0, izle: 1, ele: 2 } as const;
    return [...this.candidates.values()].sort((a, b) => rank[a.decision] - rank[b.decision] || b.opportunity - a.opportunity);
  }

  riskScore(): RiskScore {
    const t = this.d.trading;
    const L = this.d.limits;
    const now = Date.now();
    this.blockedTimes = this.blockedTimes.filter((x) => now - x < 3_600_000);
    return computeRiskScore({
      dailyPnl: t.dailyPnl(),
      dailyLossWarnUsdt: L.dailyLossWarnUsdt,
      openNotional: t.openNotional(),
      maxTotalOpen: L.maxTotalOpenUsdt,
      ordersLastHour: t.ordersLastHour(),
      maxOrdersPerHour: L.maxOrdersPerHour,
      openCount: t.listPositions().length,
      maxOpen: L.maxOpenPositions,
      blockedLastHour: this.blockedTimes.length,
      lossStreak: this.lossStreak,
    });
  }

  blockedCount(): number {
    return this.blockedTimes.length;
  }

  totalBlocked = 0;

  /** Ajanın bir aday için emir denemesi. Sonuç metni döner (senaryo ve testler için). */
  async tryEnter(c: Candidate, origin: EntryRequest["origin"] = "ajan", opts: { warnKey?: string } = {}): Promise<{ ok: boolean; reason: string; position?: Position }> {
    const t = this.d.trading;
    const equity = t.equity();
    const riskPct = this.d.store.settings.riskPct;
    const size = sizePosition({ equityUsdt: equity, riskPct, entry: c.entry, stop: c.stop, openNotionalUsdt: t.openNotional(), limits: this.d.limits });
    if (size.notionalUsdt <= 0) {
      this.d.store.addEvent("karar", `${c.base}: "aç" kararı var ama boyut yetersiz (${size.explain})`, c.instId);
      return { ok: false, reason: size.explain };
    }
    const rs = this.riskScore();
    const items = checkAgentEntry(c, size, { riskScore: rs.score, equityUsdt: equity, riskPct, rules: this.d.contract });
    if (items.length) {
      this.blockedTimes.push(Date.now());
      this.totalBlocked++;
      const summary = `${c.base} için ${size.notionalUsdt.toFixed(2)} USDT alış (giriş ${c.entry}, stop ${c.stop}, hedef ${c.target})`;
      this.d.ledger.append("decision", { instId: c.instId, karar: "ENGELLENDİ", sebep: items, origin });
      this.d.store.addEvent("uyarı", `Ajan şu emri sözleşmeye aykırı buldu ve vermedi: ${summary}.`, c.instId);
      this.d.warnings.raise("ajan_engelledi", opts.warnKey ?? c.instId, "Ajan bir emri vermedi", `Ajan şu emri sözleşmeye aykırı buldu ve vermedi: ${summary}.`, items, this.riskScore().score);
      return { ok: false, reason: items.map((i) => i.label).join(", ") };
    }
    const req: EntryRequest = { instId: c.instId, notionalUsdt: size.notionalUsdt, entryPx: c.price, stopPx: c.stop, targetPx: c.target, atr: c.atr, reason: c.reason, origin };
    const hard = t.checkEntry(req);
    if (hard.length) {
      this.d.store.addEvent("bilgi", `${c.base}: sert limit nedeniyle emir verilmedi (${hard.join(" ")})`, c.instId);
      this.d.ledger.append("decision", { instId: c.instId, karar: "SERT_LİMİT", sebep: hard, origin });
      return { ok: false, reason: hard.join(" ") };
    }
    try {
      const pos = await t.openPosition(req);
      const msg = `${t.mode === "KURU" ? "KURU" : "GERÇEK"} emir: ${c.base} ${pos.costUsdt.toFixed(2)} USDT @ ${roundPrice(pos.entryPx)}, stop ${pos.stopPx}, hedef ${pos.targetPx}. ${c.reason}`;
      this.d.store.addEvent("emir", msg, c.instId);
      this.d.store.bus.publish("positions", this.positionsView());
      this.dev({ symbol: c.instId, kind: "pozisyon_açıldı", text: msg, critical: false });
      this.checkNearLimits();
      return { ok: true, reason: msg, position: pos };
    } catch (e) {
      const m = e instanceof HardLimitError ? e.violations.join(" ") : (e as Error).message;
      this.d.store.addEvent("hata", `${c.base}: emir gönderilemedi (${m})`, c.instId);
      return { ok: false, reason: m };
    }
  }

  private async autoTrade(): Promise<void> {
    const held = new Set(this.d.trading.listPositions().map((p) => p.instId));
    const pref = [...this.d.store.planPreference, ...this.d.store.priority];
    const opens = this.queue()
      .filter((c) => c.decision === "aç" && !held.has(c.instId) && this.d.limits.allowedPairs.includes(c.instId))
      .sort((a, b) => {
        const pa = pref.includes(a.instId) ? 0 : 1;
        const pb = pref.includes(b.instId) ? 0 : 1;
        return pa - pb || b.opportunity - a.opportunity;
      });
    if (!opens.length) return;
    if (this.d.trading.listPositions().length >= this.d.limits.maxOpenPositions) return;
    // Taramada en fazla bir yeni giriş (sakin tempo); sözleşmeye takılırsa bir sonrakini dener.
    for (const c of opens.slice(0, 2)) {
      const r = await this.tryEnter(c);
      if (r.ok) break;
    }
  }

  async priceTick(): Promise<void> {
    const ids = this.d.watchlist.map((w) => w.instId);
    const tickers = await this.d.market.tickers(ids);
    const px = new Map<string, number>();
    for (const [k, v] of tickers) {
      this.prices.set(k, v);
      px.set(k, v.last);
      const c = this.candidates.get(k);
      if (c) {
        c.price = v.last;
        c.change24hPct = round(v.change24hPct, 2);
      }
    }
    this.d.trading.markPrices(px);
    this.d.store.bus.publish("prices", Object.fromEntries([...tickers.values()].map((t) => [t.instId, { p: t.last, c: round(t.change24hPct, 2) }])));
    await this.managePositions();
  }

  /** Pozisyon yönetimi: stop/hedef, kısmi kâr + breakeven, trailing, süre stopu. */
  async managePositions(): Promise<void> {
    const t = this.d.trading;
    const m = this.d.thresholds.management;
    const px = new Map<string, number>();
    for (const [k, v] of this.prices) px.set(k, v.last);
    t.markPrices(px);
    for (const p of t.listPositions()) {
      const price = p.lastPx;
      const R = p.entryPx - p.initialStop;
      if (R <= 0) continue;
      const rNow = (price - p.entryPx) / R;
      const base = p.instId.split("-")[0];
      if (price <= p.stopPx) {
        await this.close(p, price, p.trailing ? "İz süren stop tetiklendi" : p.stopPx >= p.entryPx ? "Başa baş stop tetiklendi" : "Stop fiyatına gelindi");
        continue;
      }
      if (price >= p.targetPx) {
        await this.close(p, price, "Hedefe ulaşıldı");
        continue;
      }
      if (!p.partialDone && rNow >= m.partialAtR) {
        p.partialDone = true;
        const r = await t.reducePosition(p.id, m.partialFraction, price, `Kısmi kâr (+${m.partialAtR}R)`);
        t.updateStop(p.id, p.entryPx);
        this.d.store.addEvent("emir", `${base}: +${m.partialAtR}R'de %${m.partialFraction * 100} kâr alındı (${r ? r.pnl.toFixed(3) : "?"} USDT), stop başa başa çekildi.`, p.instId);
        this.dev({ symbol: p.instId, kind: "pozisyon_kapandı", text: `${base}: kısmi kâr alındı, stop başa başa (${roundPrice(p.entryPx)}).`, critical: false });
      }
      if (rNow >= m.trailStartR && p.atr > 0) {
        const ns = price - m.trailAtrMult * p.atr;
        if (ns > p.stopPx + 0.25 * R) {
          t.updateStop(p.id, ns, true);
          this.d.store.addEvent("karar", `${base}: iz süren stop ${roundPrice(ns)} fiyatına yükseltildi (+${rNow.toFixed(1)}R).`, p.instId);
        }
      }
      if (Date.now() - p.openedAt > m.timeStopHours * 3_600_000 && rNow < m.timeStopMinR) {
        await this.close(p, price, `Süre stopu (${m.timeStopHours} saatte ilerleme yok)`);
        continue;
      }
      const distStop = (price - p.stopPx) / (p.entryPx - p.initialStop);
      const distTarget = (p.targetPx - price) / (p.targetPx - p.entryPx);
      const keyS = `${p.id}:s`;
      const keyT = `${p.id}:t`;
      if (distStop < 0.25 && !this.notedNear.has(keyS)) {
        this.notedNear.add(keyS);
        this.dev({ symbol: p.instId, kind: "stop_yakın", text: `${base} stopa yaklaştı: fiyat ${roundPrice(price)}, stop ${p.stopPx}.`, critical: false });
      }
      if (distTarget < 0.2 && !this.notedNear.has(keyT)) {
        this.notedNear.add(keyT);
        this.dev({ symbol: p.instId, kind: "hedef_yakın", text: `${base} hedefe yaklaştı: fiyat ${roundPrice(price)}, hedef ${p.targetPx}.`, critical: false });
      }
    }
    this.d.store.bus.publish("positions", this.positionsView());
  }

  private async close(p: Position, price: number, reason: string): Promise<void> {
    const r = await this.d.trading.reducePosition(p.id, 1, price, reason).catch((e) => {
      this.d.store.addEvent("hata", `${p.instId} kapatılamadı: ${(e as Error).message}`, p.instId);
      return null;
    });
    if (!r) return;
    const total = p.realizedPnl;
    this.lossStreak = total < 0 ? this.lossStreak + 1 : 0;
    const msg = `${p.instId.split("-")[0]} pozisyonu kapandı: ${reason}. Sonuç ${total >= 0 ? "+" : ""}${total.toFixed(3)} USDT.`;
    this.d.store.addEvent("emir", msg, p.instId);
    this.dev({ symbol: p.instId, kind: "pozisyon_kapandı", text: msg, critical: true });
  }

  private checkNearLimits(): void {
    const t = this.d.trading;
    const L = this.d.limits;
    const ratio = this.d.contract.nearLimitRatio;
    const items = [];
    if (t.openNotional() >= L.maxTotalOpenUsdt * ratio) items.push({ label: "Toplam açık pozisyon", value: `${t.openNotional().toFixed(2)} USDT`, limit: `${L.maxTotalOpenUsdt} USDT` });
    if (t.listPositions().length >= L.maxOpenPositions) items.push({ label: "Açık pozisyon sayısı", value: String(t.listPositions().length), limit: String(L.maxOpenPositions) });
    if (t.ordersLastHour() >= L.maxOrdersPerHour - 1) items.push({ label: "Son 1 saatteki emir", value: String(t.ordersLastHour()), limit: String(L.maxOrdersPerHour) });
    if (items.length) {
      this.d.warnings.raise("limite_yakin", items.map((i) => i.label).join(","), "Ajan sert limite yaklaştı", "Ajan sert limitlere yaklaştı. Limitler aşılamaz; ajan sınır dolarsa yeni giriş yapmaz, mevcut pozisyonları yönetmeye devam eder.", items, this.riskScore().score);
    }
  }

  checkRisk(): void {
    const t = this.d.trading;
    const L = this.d.limits;
    const rs = this.riskScore();
    const day = new Date().toISOString().slice(0, 10);
    const pnl = t.dailyPnl();
    if (pnl <= -L.dailyLossWarnUsdt && this.dailyLossWarnedDay !== day) {
      this.dailyLossWarnedDay = day;
      this.d.warnings.raise(
        "gunluk_zarar",
        day,
        "Günlük zarar eşiği aşıldı",
        "Bugünkü zarar uyarı eşiğini geçti. Hiçbir şey durdurulmadı; ajan sözleşme ve sert limitler içinde çalışmaya devam ediyor. Her işlemde stop zorunlu.",
        [{ label: "Günlük K/Z", value: `${pnl.toFixed(2)} USDT`, limit: `uyarı eşiği -${L.dailyLossWarnUsdt} USDT` }],
        rs.score,
      );
      this.dev({ symbol: "PORTFÖY", kind: "günlük_zarar", text: `Günlük zarar ${pnl.toFixed(2)} USDT; uyarı eşiği aşıldı. Ajan çalışmaya devam ediyor.`, critical: true });
    }
    if (rs.score >= this.d.contract.riskScoreWarnAt && this.lastRiskScore < this.d.contract.riskScoreWarnAt) {
      this.d.warnings.raise("risk_skoru", "esik", "Risk skoru yükseldi", "Risk skoru eşiği geçti. Ajan yeni girişlerde daha seçici olacak (sözleşme), kimse kilitlenmez.", rs.parts.filter((p) => p.value > 0).map((p) => ({ label: p.label, value: String(p.value), limit: "-" })), rs.score);
    }
    this.lastRiskScore = rs.score;
  }

  snapshotEquity(): void {
    this.equityHistory.push({ ts: Date.now(), equity: round(this.d.trading.equity(), 4) });
    if (this.equityHistory.length > 720) this.equityHistory.shift();
  }

  positionsView() {
    return this.d.trading.listPositions().map((p) => ({
      id: p.id,
      instId: p.instId,
      qty: p.qty,
      entryPx: roundPrice(p.entryPx),
      lastPx: roundPrice(p.lastPx),
      stopPx: p.stopPx,
      targetPx: p.targetPx,
      costUsdt: round(p.costUsdt, 2),
      pnlUsdt: round(p.qty * p.lastPx * 0.999 - p.costUsdt, 4),
      pnlPct: p.costUsdt > 0 ? round(((p.qty * p.lastPx * 0.999 - p.costUsdt) / p.costUsdt) * 100, 2) : 0,
      realizedPnl: round(p.realizedPnl, 4),
      partialDone: p.partialDone,
      trailing: p.trailing,
      mode: p.mode,
      openedAt: p.openedAt,
      reason: p.reason,
    }));
  }
}

export function slim(c: Candidate) {
  return {
    instId: c.instId,
    base: c.base,
    category: c.category,
    price: c.price,
    change24hPct: c.change24hPct,
    volUsdt24h: c.volUsdt24h,
    opportunity: c.opportunity,
    risk: c.risk,
    decision: c.decision,
    direction: c.direction,
    reason: c.reason,
    spark: c.spark.slice(-32),
  };
}
