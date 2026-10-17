// Scam modülü katman 1 (DEX tokenları; OKX listeli coinlere uygulanmaz).
// GoPlus token_security (anahtarsız). OKX OnchainOS (okx-security / okx-dex-token) Web3 API anahtarı ister;
// anahtar yoksa "kapalı" görünür, sahte sonuç üretilmez.

export const CHAINS: Record<string, { id: string; name: string }> = {
  eth: { id: "1", name: "Ethereum" },
  ethereum: { id: "1", name: "Ethereum" },
  bsc: { id: "56", name: "BNB Chain" },
  bnb: { id: "56", name: "BNB Chain" },
  avax: { id: "43114", name: "Avalanche C-Chain" },
  avalanche: { id: "43114", name: "Avalanche C-Chain" },
  polygon: { id: "137", name: "Polygon" },
  arbitrum: { id: "42161", name: "Arbitrum" },
  base: { id: "8453", name: "Base" },
  optimism: { id: "10", name: "Optimism" },
  "1": { id: "1", name: "Ethereum" },
  "56": { id: "56", name: "BNB Chain" },
  "43114": { id: "43114", name: "Avalanche C-Chain" },
  "137": { id: "137", name: "Polygon" },
  "42161": { id: "42161", name: "Arbitrum" },
  "8453": { id: "8453", name: "Base" },
  "10": { id: "10", name: "Optimism" },
};

export type Verdict = "PASS" | "WARN" | "BLOCK";

export interface SourceResult {
  source: string;
  available: boolean;
  honeypot: boolean | null;
  warnings: string[];
  raw: Record<string, unknown>;
  note?: string;
}

export interface ScanResult {
  chain: string;
  chainName: string;
  address: string;
  token: { name: string; symbol: string } | null;
  verdict: Verdict;
  reasons: string[];
  sources: SourceResult[];
  ts: number;
}

export interface TokenSecurity {
  readonly name: string;
  check(chainId: string, address: string): Promise<SourceResult & { token?: { name: string; symbol: string } }>;
}

const FIELDS = ["is_honeypot", "buy_tax", "sell_tax", "cannot_sell_all", "is_mintable", "hidden_owner", "owner_change_balance", "transfer_pausable", "is_blacklisted", "slippage_modifiable", "is_proxy", "is_open_source", "holder_count", "lp_holder_count", "honeypot_with_same_creator"] as const;

/** GoPlus alanlarından uyarı listesi (saf fonksiyon, test edilir). */
export function goplusFindings(r: Record<string, any>): { honeypot: boolean | null; warnings: string[] } {
  const w: string[] = [];
  const one = (k: string) => String(r[k]) === "1";
  const tax = (k: string) => (r[k] === undefined || r[k] === "" ? null : Number(r[k]));
  const honeypot = r.is_honeypot === undefined || r.is_honeypot === null || r.is_honeypot === "" ? null : one("is_honeypot");
  const bt = tax("buy_tax");
  const st = tax("sell_tax");
  if (bt !== null && bt > 0.1) w.push(`Alış vergisi %${(bt * 100).toFixed(1)} (> %10)`);
  if (st !== null && st > 0.1) w.push(`Satış vergisi %${(st * 100).toFixed(1)} (> %10)`);
  if (one("cannot_sell_all")) w.push("Bakiyenin tamamı satılamıyor");
  if (one("is_mintable")) w.push("Mint yetkisi var (arz artırılabilir)");
  if (one("hidden_owner")) w.push("Gizli sahip");
  if (one("owner_change_balance")) w.push("Sahip bakiyeleri değiştirebiliyor");
  if (one("transfer_pausable")) w.push("Transfer durdurulabiliyor");
  if (one("is_blacklisted")) w.push("Kara liste işlevi var");
  if (one("slippage_modifiable")) w.push("Vergi/slipaj sonradan değiştirilebiliyor");
  if (r.is_open_source !== undefined && String(r.is_open_source) === "0") w.push("Kaynak kodu doğrulanmamış");
  const lp: any[] = Array.isArray(r.lp_holders) ? r.lp_holders : [];
  if (lp.length) {
    const lockedPct = lp.filter((h) => String(h.is_locked) === "1").reduce((s, h) => s + Number(h.percent || 0), 0);
    if (lockedPct < 0.5) w.push(`LP büyük ölçüde kilitsiz (kilitli pay %${(lockedPct * 100).toFixed(0)})`);
  }
  return { honeypot, warnings: w };
}

/** Karar oylaması: herhangi bir kaynak honeypot → BLOCK; uyarı varsa WARN; aksi PASS. Simülasyon (katman 2) varsa o kazanır. */
export function decide(sources: SourceResult[], simulation?: SourceResult): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  const all = simulation ? [simulation] : sources.filter((s) => s.available);
  if (simulation && sources.some((s) => s.available && s.honeypot) && !simulation.honeypot) reasons.push("Kaynaklar çelişiyor; simülasyon sonucu esas alındı.");
  if (!all.length) return { verdict: "WARN", reasons: ["Hiçbir güvenlik kaynağına ulaşılamadı; karar verilemedi (veri yok)."] };
  for (const s of all) if (s.honeypot) reasons.push(`${s.source}: honeypot (satış engelli)`);
  if (reasons.some((r) => r.includes("honeypot"))) return { verdict: "BLOCK", reasons };
  for (const s of all) for (const w of s.warnings) reasons.push(`${s.source}: ${w}`);
  if (reasons.filter((r) => !r.startsWith("Kaynaklar")).length) return { verdict: "WARN", reasons };
  return { verdict: "PASS", reasons: [...reasons, ...all.map((s) => `${s.source}: kritik bulgu yok`)] };
}

export class GoPlusSecurity implements TokenSecurity {
  readonly name = "GoPlus";
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  async check(chainId: string, address: string) {
    try {
      const r = await this.fetchImpl(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`, { signal: AbortSignal.timeout(10_000) });
      const j: any = await r.json();
      const res = j?.result?.[address.toLowerCase()] ?? Object.values(j?.result ?? {})[0];
      if (!res) return { source: this.name, available: false, honeypot: null, warnings: [], raw: {}, note: j?.message ?? "sonuç yok" };
      const f = goplusFindings(res);
      const raw: Record<string, unknown> = {};
      for (const k of FIELDS) raw[k] = (res as any)[k];
      raw.lp_locked = Array.isArray((res as any).lp_holders) ? (res as any).lp_holders.filter((h: any) => String(h.is_locked) === "1").length : null;
      return { source: this.name, available: true, honeypot: f.honeypot, warnings: f.warnings, raw, token: { name: String((res as any).token_name ?? ""), symbol: String((res as any).token_symbol ?? "") } };
    } catch (e) {
      return { source: this.name, available: false, honeypot: null, warnings: [], raw: {}, note: (e as Error).message };
    }
  }
}

/** OKX OnchainOS (okx-security, okx-dex-token): Web3 API anahtarı gerekir; yoksa kapalı. */
export class OnchainOsSecurity implements TokenSecurity {
  readonly name = "OKX OnchainOS";
  async check() {
    return { source: this.name, available: false, honeypot: null, warnings: [], raw: {}, note: "Web3 API anahtarı tanımlı değil; kapalı." };
  }
}

export class MockTokenSecurity implements TokenSecurity {
  readonly name = "Örnek";
  async check(_c: string, address: string) {
    const hp = address.toLowerCase().endsWith("dead");
    return { source: this.name, available: true, honeypot: hp, warnings: hp ? [] : ["ÖRNEK VERİ"], raw: { sample: true }, token: { name: "Örnek", symbol: "ORN" } };
  }
}

export class ScamScanner {
  constructor(private readonly providers: TokenSecurity[]) {}

  async scan(chainKey: string, address: string): Promise<ScanResult> {
    const ch = CHAINS[chainKey.toLowerCase()];
    if (!ch) throw new Error(`Desteklenmeyen zincir: ${chainKey}. Seçenekler: ${[...new Set(Object.keys(CHAINS))].join(", ")}`);
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("Geçersiz kontrat adresi (0x ile başlayan 40 hex karakter).");
    const results = await Promise.all(this.providers.map((p) => p.check(ch.id, address)));
    const token = results.find((r) => r.token?.symbol)?.token ?? null;
    const sources: SourceResult[] = results.map(({ token: _t, ...r }) => r);
    const d = decide(sources);
    return { chain: chainKey.toLowerCase(), chainName: ch.name, address, token, verdict: d.verdict, reasons: d.reasons, sources, ts: Date.now() };
  }
}
