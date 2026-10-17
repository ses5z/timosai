// Arz dedektörü (borsada listeli coinler). Kaynak: CoinGecko /coins/{id} (arz yapısı) ve /market_chart (365 gün):
// her gün dolaşımdaki arz ≈ market_cap / price ("tahmini (MC/fiyat)"). Kilit açılımı: DefiLlama ücretli (402) →
// config/unlocks.json (ÖRNEK VERİ). Önbellek 1 saat; rate limit/erişim hatasında "veri yok", sahte veri yok.
import { COINGECKO_IDS, loadUnlocks, type Supply, type UnlockItem } from "./holdReport.js";

export interface SupplyPoint {
  t: number; // ms
  circ: number;
}

export interface SupplyReport {
  base: string;
  available: boolean;
  note?: string;
  source: string;
  structure: { max: number | null; total: number | null; circulating: number | null; circulatingPct: number | null; fdvToMc: number | null; capped: boolean | null } | null;
  change: { d1: number | null; m1: number | null; y1: number | null; annualInflationPct: number | null; deflationary: boolean; estimated: true } | null;
  jumps: { t: number; pct: number }[];
  jumpNote: string;
  unlocks: { next: (UnlockItem & { amountTokens: number | null }) | null; total30dPct: number; total90dPct: number; items: UnlockItem[]; source: string };
  pressure: { level: "düşük" | "orta" | "yüksek"; score: number; reasons: string[] };
  series: { time: number; value: number }[];
}

type FetchLike = typeof fetch;

/** Saf fonksiyon: arz serisinden değişim, sıçrama ve baskı skoru. */
export function analyzeSupply(base: string, s: Supply | null, history: SupplyPoint[], unlocks: UnlockItem[], now = Date.now(), source = "CoinGecko"): SupplyReport {
  const capSup = s?.max ?? s?.total ?? null;
  const structure = s
    ? { max: s.max, total: s.total, circulating: s.circulating, circulatingPct: s.circulating && capSup ? (s.circulating / capSup) * 100 : null, fdvToMc: s.fdv && s.marketCap ? s.fdv / s.marketCap : null, capped: s.max === null ? false : true }
    : null;
  const h = history.filter((p) => p.circ > 0).sort((a, b) => a.t - b.t);
  const at = (daysAgo: number) => {
    const target = now - daysAgo * 86_400_000;
    let best: SupplyPoint | null = null;
    for (const p of h) if (p.t <= target) best = p;
    return best;
  };
  const last = h.at(-1) ?? null;
  const pct = (a: SupplyPoint | null) => (a && last && a.circ > 0 ? ((last.circ - a.circ) / a.circ) * 100 : null);
  const d1 = pct(at(1));
  const m1 = pct(at(30));
  const y1 = pct(at(365)) ?? (h.length > 30 ? pct(h[0]) : null);
  const spanDays = h.length > 1 ? (h.at(-1)!.t - h[0].t) / 86_400_000 : 0;
  const annual = y1 !== null && spanDays >= 300 ? y1 : y1 !== null && spanDays > 30 ? (y1 * 365) / spanDays : null;
  const change = h.length > 1 ? { d1, m1, y1, annualInflationPct: annual, deflationary: annual !== null && annual < -0.1, estimated: true as const } : null;
  const jumps: { t: number; pct: number }[] = [];
  for (let i = 1; i < h.length; i++) {
    const p = ((h[i].circ - h[i - 1].circ) / h[i - 1].circ) * 100;
    if (Math.abs(p) > 1) jumps.push({ t: h[i].t, pct: p });
  }
  const mine = unlocks.filter((u) => u.coin === base && Date.parse(u.date) > now).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const within = (d: number) => mine.filter((u) => Date.parse(u.date) - now <= d * 86_400_000).reduce((a, u) => a + u.pctOfCirculating, 0);
  const next = mine[0] ? { ...mine[0], amountTokens: s?.circulating ? (s.circulating * mine[0].pctOfCirculating) / 100 : null } : null;
  const t30 = within(30);
  const t90 = within(90);
  // Arz baskısı: yıllık enflasyon + 90 gün açılım/dolaşım + FDV/MC
  const reasons: string[] = [];
  let score = 0;
  if (annual !== null) {
    if (annual > 10) (score += 2), reasons.push(`Yıllık arz artışı yüksek (tahmini %${annual.toFixed(1)}).`);
    else if (annual > 3) (score += 1), reasons.push(`Yıllık arz artışı orta (tahmini %${annual.toFixed(1)}).`);
    else if (annual < -0.1) reasons.push(`Arz azalıyor (tahmini %${annual.toFixed(1)}): deflasyonist (yakım).`);
    else reasons.push(`Yıllık arz değişimi düşük (tahmini %${annual.toFixed(1)}).`);
  }
  if (t90 > 10) (score += 2), reasons.push(`90 gün içinde dolaşımın %${t90.toFixed(1)}'i açılıyor (ÖRNEK VERİ).`);
  else if (t90 > 2) (score += 1), reasons.push(`90 gün içinde dolaşımın %${t90.toFixed(1)}'i açılıyor (ÖRNEK VERİ).`);
  const fm = structure?.fdvToMc ?? null;
  if (fm !== null && fm > 2) (score += 2), reasons.push(`FDV/MC ${fm.toFixed(2)}: arzın büyük kısmı henüz dolaşımda değil.`);
  else if (fm !== null && fm > 1.3) (score += 1), reasons.push(`FDV/MC ${fm.toFixed(2)}.`);
  if (!reasons.length) reasons.push("Arz verisi sınırlı.");
  const level = score >= 4 ? "yüksek" : score >= 2 ? "orta" : "düşük";
  return {
    base,
    available: Boolean(s) || h.length > 0,
    source,
    structure,
    change,
    jumps,
    jumpNote: "Günlük %1'den büyük sıçramalar olay olarak işaretlenir; CoinGecko'nun dolaşım tanımı değişikliği de sıçrama gibi görünebilir.",
    unlocks: { next, total30dPct: t30, total90dPct: t90, items: mine.slice(0, 6), source: "config/unlocks.json (ÖRNEK VERİ; DefiLlama emisyon verisi ücretli)" },
    pressure: { level, score, reasons },
    series: h.map((p) => ({ time: Math.floor(p.t / 1000), value: p.circ })),
  };
}

export class SupplyService {
  private cache = new Map<string, { at: number; v: SupplyReport }>();
  constructor(
    private readonly supplyOf: (base: string) => Promise<Supply | null>,
    private readonly fetchImpl: FetchLike | null = fetch,
    private readonly mock = false,
  ) {}

  private async history(base: string): Promise<SupplyPoint[] | null> {
    if (this.mock) {
      // ATK_MODE=mock: deterministik ÖRNEK seri
      const out: SupplyPoint[] = [];
      const now = Date.now();
      const g = 1 + ([...base].reduce((a, c) => a + c.charCodeAt(0), 0) % 7) / 100;
      for (let i = 365; i >= 0; i--) out.push({ t: now - i * 86_400_000, circ: 1e9 * Math.pow(g, (365 - i) / 365) });
      return out;
    }
    const id = COINGECKO_IDS[base];
    if (!id || !this.fetchImpl) return null;
    try {
      const r = await this.fetchImpl(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=365&interval=daily`, { signal: AbortSignal.timeout(12_000), headers: { accept: "application/json" } });
      if (!r.ok) return null;
      const j: any = await r.json();
      const mcs: [number, number][] = j.market_caps ?? [];
      const prices: [number, number][] = j.prices ?? [];
      const out: SupplyPoint[] = [];
      for (let i = 0; i < Math.min(mcs.length, prices.length); i++) if (prices[i][1] > 0 && mcs[i][1] > 0) out.push({ t: mcs[i][0], circ: mcs[i][1] / prices[i][1] });
      return out;
    } catch {
      return null;
    }
  }

  async report(base: string): Promise<SupplyReport> {
    const b = base.toUpperCase();
    const c = this.cache.get(b);
    if (c && Date.now() - c.at < 3_600_000) return c.v;
    const [s, h] = await Promise.all([this.supplyOf(b).catch(() => null), this.history(b)]);
    const v = analyzeSupply(b, s, h ?? [], loadUnlocks(), Date.now(), this.mock ? "ÖRNEK VERİ" : "CoinGecko");
    if (!s && !h) v.note = COINGECKO_IDS[b] ? "veri yok (CoinGecko'ya ulaşılamadı ya da rate limit)" : "veri yok (CoinGecko eşlemesi yok)";
    if (s || h) this.cache.set(b, { at: Date.now(), v });
    return v;
  }
}
