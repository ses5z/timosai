// Enstrüman kataloğu: OKX spot pariteleri (ATK market_get_instruments), 1 saat önbellek. Sabit liste yok.
// tickSz ile fiyat formatı, CEX araması ve parite listesi buradan gelir.
import type { AtkCaller } from "../atk/mcpClient.js";
import { log } from "../util/log.js";

export interface Instrument {
  instId: string;
  base: string;
  quote: string;
  tickSz: number;
  lotSz: number;
  minSz: number;
  state: string;
}

export const SEARCH_QUOTES = ["USDT", "USDC", "BTC", "ETH", "SOL", "TRY"] as const;

export const COIN_NAMES: Record<string, string> = {
  BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", BNB: "BNB", AVAX: "Avalanche", ADA: "Cardano", DOT: "Polkadot", TRX: "TRON", TON: "Toncoin", NEAR: "NEAR Protocol",
  APT: "Aptos", SUI: "Sui", XRP: "XRP", LTC: "Litecoin", BCH: "Bitcoin Cash", ARB: "Arbitrum", OP: "Optimism", POL: "Polygon", LINK: "Chainlink", UNI: "Uniswap",
  AAVE: "Aave", LDO: "Lido DAO", FET: "Artificial Superintelligence Alliance", RENDER: "Render", WLD: "Worldcoin", DOGE: "Dogecoin", PEPE: "Pepe", SHIB: "Shiba Inu",
  ATOM: "Cosmos", FIL: "Filecoin", ICP: "Internet Computer", ETC: "Ethereum Classic", XLM: "Stellar", HBAR: "Hedera", INJ: "Injective", TIA: "Celestia", SEI: "Sei",
  ONDO: "Ondo", PENDLE: "Pendle", JUP: "Jupiter", BONK: "Bonk", WIF: "dogwifhat", FLOKI: "Floki", TRUMP: "Official Trump", ENA: "Ethena", STX: "Stacks", IMX: "Immutable",
  SAND: "The Sandbox", MANA: "Decentraland", AXS: "Axie Infinity", GALA: "Gala", CRV: "Curve DAO", MKR: "Maker", COMP: "Compound", SNX: "Synthetix", GRT: "The Graph",
};

export function decimalsFromTick(tick: number): number {
  if (!(tick > 0)) return 4;
  return Math.max(0, Math.min(12, Math.round(-Math.log10(tick))));
}

export class InstrumentCatalog {
  private list: Instrument[] = [];
  private byId = new Map<string, Instrument>();
  private at = 0;
  private loading: Promise<void> | null = null;

  constructor(private readonly atk: AtkCaller | null, private readonly fallback: Instrument[] = []) {}

  async ensure(): Promise<void> {
    if (this.list.length && Date.now() - this.at < 3_600_000) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        if (!this.atk) throw new Error("ATK yok");
        const rows: any[] = await this.atk.call("market_get_instruments", { instType: "SPOT" });
        const list = rows
          .filter((r) => r.state === "live" || !r.state)
          .map((r) => ({ instId: String(r.instId), base: String(r.baseCcy), quote: String(r.quoteCcy), tickSz: Number(r.tickSz) || 0, lotSz: Number(r.lotSz) || 0, minSz: Number(r.minSz) || 0, state: String(r.state ?? "live") }));
        if (list.length) {
          this.list = list;
          this.at = Date.now();
        }
      } catch (e) {
        if (!this.list.length) this.list = this.fallback;
        log.warn(`Enstrüman listesi alınamadı: ${(e as Error).message}`);
      } finally {
        this.byId = new Map(this.list.map((i) => [i.instId, i]));
        this.loading = null;
      }
    })();
    return this.loading;
  }

  get(instId: string): Instrument | undefined {
    return this.byId.get(instId);
  }

  all(): Instrument[] {
    return this.list;
  }

  /** Bir coinin aranabilir pariteleri (yalnızca borsada gerçekten olanlar). */
  pairsOf(base: string): Instrument[] {
    const b = base.toUpperCase();
    return SEARCH_QUOTES.map((q) => this.byId.get(`${b}-${q}`)).filter((x): x is Instrument => Boolean(x));
  }

  /** Sembol/ad araması: önce tam eşleşme, sonra önek, sonra ad içinde geçen. */
  search(q: string, limit = 12): { base: string; name: string; pairs: string[] }[] {
    const s = q.trim().toUpperCase();
    if (!s) return [];
    const bases = new Map<string, string[]>();
    for (const i of this.list) {
      if (!(SEARCH_QUOTES as readonly string[]).includes(i.quote)) continue;
      const arr = bases.get(i.base) ?? [];
      arr.push(i.instId);
      bases.set(i.base, arr);
    }
    const scored: { base: string; name: string; pairs: string[]; score: number }[] = [];
    for (const [base, pairs] of bases) {
      const name = COIN_NAMES[base] ?? "";
      let score = -1;
      if (base === s) score = 100;
      else if (base.startsWith(s)) score = 80 - base.length;
      else if (name.toUpperCase().startsWith(s)) score = 60;
      else if (name.toUpperCase().includes(s) && s.length >= 2) score = 40;
      if (score >= 0) scored.push({ base, name, pairs: SEARCH_QUOTES.map((qq) => `${base}-${qq}`).filter((id) => pairs.includes(id)), score });
    }
    return scored.sort((a, b) => b.score - a.score || a.base.localeCompare(b.base)).slice(0, limit).map(({ score: _s, ...r }) => r);
  }
}

/** ATK_MODE=mock için izleme listesinden türetilen katalog (ÖRNEK). */
export function mockInstruments(bases: string[]): Instrument[] {
  const out: Instrument[] = [];
  for (const b of bases) for (const q of ["USDT", "USDC", "TRY"]) out.push({ instId: `${b}-${q}`, base: b, quote: q, tickSz: 0.0001, lotSz: 0.0001, minSz: 0.0001, state: "live" });
  return out;
}
