// Hold raporu / temel analiz. Vade ayrımı mum süresiyle değil, coinin temel yapısıyla yapılır.
// Arz: CoinGecko public API. Kilit açılımı: config/unlocks.json (ÖRNEK VERİ). Cüzdan dağılımı: OKX OnchainOS (anahtar yoksa veri yok;
// ana zincir coinlerinde uygulanmaz). Ham "ilk 10 cüzdan" kullanılmaz.
import fs from "node:fs";
import path from "node:path";

export const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin", AVAX: "avalanche-2", ADA: "cardano", DOT: "polkadot", TRX: "tron", TON: "the-open-network", NEAR: "near",
  APT: "aptos", SUI: "sui", XRP: "ripple", LTC: "litecoin", BCH: "bitcoin-cash", ARB: "arbitrum", OP: "optimism", POL: "polygon-ecosystem-token", LINK: "chainlink", UNI: "uniswap",
  AAVE: "aave", LDO: "lido-dao", FET: "fetch-ai", RENDER: "render-token", WLD: "worldcoin-wld", DOGE: "dogecoin", PEPE: "pepe", SHIB: "shiba-inu",
};
export const MAIN_CHAIN = new Set(["BTC", "ETH", "SOL", "BNB", "AVAX", "ADA", "DOT", "TRX", "TON", "NEAR", "APT", "SUI", "XRP", "LTC", "BCH", "DOGE"]);

export interface Supply {
  circulating: number | null;
  total: number | null;
  max: number | null;
  marketCap: number | null;
  fdv: number | null;
  source: string;
}

export interface FundamentalsData {
  readonly name: string;
  supply(base: string): Promise<Supply | null>;
}

export class CoinGeckoFundamentals implements FundamentalsData {
  readonly name = "CoinGecko";
  private cache = new Map<string, { at: number; v: Supply | null }>();
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  async supply(base: string): Promise<Supply | null> {
    const id = COINGECKO_IDS[base];
    if (!id) return null;
    const c = this.cache.get(base);
    if (c && Date.now() - c.at < 30 * 60_000) return c.v;
    try {
      const r = await this.fetchImpl(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const m: any = (await r.json())?.market_data ?? {};
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const v: Supply = { circulating: n(m.circulating_supply), total: n(m.total_supply), max: n(m.max_supply), marketCap: n(m.market_cap?.usd), fdv: n(m.fully_diluted_valuation?.usd), source: "CoinGecko" };
      this.cache.set(base, { at: Date.now(), v });
      return v;
    } catch {
      return c?.v ?? null;
    }
  }
}

export class MockFundamentals implements FundamentalsData {
  readonly name = "örnek";
  async supply(base: string): Promise<Supply> {
    const h = [...base].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const circ = 1e9 * (1 + (h % 5));
    return { circulating: circ, total: circ * (1 + (h % 4) * 0.5), max: circ * (1 + (h % 4) * 0.6), marketCap: circ * 2, fdv: circ * 2 * (1 + (h % 4) * 0.5), source: "ÖRNEK VERİ" };
  }
}

export interface UnlockItem {
  coin: string;
  date: string;
  pctOfCirculating: number;
  source: string;
  sample?: boolean;
}

export function loadUnlocks(file = path.resolve(process.cwd(), "config/unlocks.json")): UnlockItem[] {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).unlocks ?? [];
  } catch {
    return [];
  }
}

export type HoldVerdict = "kısa vade trade edilebilir" | "hold profiline uygun" | "ikisi de riskli";

export interface HoldReport {
  base: string;
  verdict: HoldVerdict;
  reasons: string[];
  metrics: { circulatingRatio: number | null; fdvToMc: number | null; outsideSupplyPct: number | null; unlock90dPct: number; marketCap: number | null; fdv: number | null };
  supply: Supply | null;
  unlocks: UnlockItem[];
  distribution: { status: "uygulanmaz" | "veri yok"; note: string };
  news: { status: string };
}

/** Kurallar (saf fonksiyon). */
export function buildHoldReport(base: string, s: Supply | null, unlocks: UnlockItem[], market: { volUsdt24h: number; risk: number }, now = Date.now()): HoldReport {
  const reasons: string[] = [];
  const supplyCap = s?.max ?? s?.total ?? null;
  const circRatio = s?.circulating && supplyCap ? s.circulating / supplyCap : null;
  const fdvMc = s?.fdv && s?.marketCap ? s.fdv / s.marketCap : null;
  const outside = s?.circulating && s?.total ? ((s.total - s.circulating) / s.circulating) * 100 : null;
  const next90 = unlocks.filter((u) => u.coin === base && Date.parse(u.date) > now && Date.parse(u.date) - now <= 90 * 86_400_000);
  const unlock90 = next90.reduce((a, u) => a + u.pctOfCirculating, 0);
  let holdRisk = 0;
  if (fdvMc !== null && fdvMc > 2 && unlock90 > 10) {
    reasons.push(`FDV/piyasa değeri ${fdvMc.toFixed(2)} ve 90 gün içinde dolaşımın %${unlock90.toFixed(1)}'i açılıyor: hold riskli.`);
    holdRisk += 2;
  } else if (fdvMc !== null && fdvMc > 2) {
    reasons.push(`FDV/piyasa değeri ${fdvMc.toFixed(2)}: arzın büyük kısmı henüz dolaşımda değil, uzun vadede satış baskısı olabilir.`);
    holdRisk += 1;
  }
  if (circRatio !== null && circRatio < 0.3) {
    reasons.push(`Dolaşımdaki arz yalnızca %${(circRatio * 100).toFixed(0)}: düşük dolaşım manipülasyona açık.`);
    holdRisk += 1;
  }
  if (unlock90 > 0 && unlock90 <= 10) reasons.push(`90 gün içinde dolaşımın %${unlock90.toFixed(1)}'i kadar kilit açılımı var (ÖRNEK VERİ).`);
  if (fdvMc !== null && fdvMc <= 1.3) reasons.push(`FDV/piyasa değeri ${fdvMc.toFixed(2)}: arzın çoğu dolaşımda.`);
  if (s?.max && s.circulating && s.max > 0) reasons.push(`Maksimum arz sabit (${(s.circulating / s.max * 100).toFixed(0)}% dolaşımda).`);
  const liquid = market.volUsdt24h >= 5_000_000;
  const tradeOk = liquid && market.risk < 55;
  if (!s) reasons.push("Arz verisi alınamadı (veri yok).");
  let verdict: HoldVerdict;
  if (s && holdRisk === 0 && (fdvMc === null || fdvMc <= 1.6)) verdict = "hold profiline uygun";
  else if (tradeOk) verdict = "kısa vade trade edilebilir";
  else verdict = "ikisi de riskli";
  if (tradeOk && verdict !== "kısa vade trade edilebilir") reasons.push("Likidite yeterli; kısa vadeli işlem için de uygun görünüyor.");
  if (!tradeOk) reasons.push(liquid ? `Kısa vadede risk puanı yüksek (${market.risk}).` : "24 saatlik hacim düşük; kısa vadede likidite sınırlı.");
  return {
    base,
    verdict,
    reasons,
    metrics: { circulatingRatio: circRatio, fdvToMc: fdvMc, outsideSupplyPct: outside, unlock90dPct: unlock90, marketCap: s?.marketCap ?? null, fdv: s?.fdv ?? null },
    supply: s,
    unlocks: next90,
    distribution: MAIN_CHAIN.has(base) ? { status: "uygulanmaz", note: "Ana zincir coini: cüzdan dağılımı analizi uygulanmaz (borsa ve kontrat cüzdanları yanıltır)." } : { status: "veri yok", note: "OKX OnchainOS okx-dex-token için Web3 API anahtarı tanımlı değil." },
    news: { status: "ATK news modülü OKX OAuth kimliği istiyor; şu an veri yok." },
  };
}
