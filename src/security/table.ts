// Güvenlik taraması: çok kaynaklı karşılaştırma tablosu (GoPlus, Honeypot.is, OKX OnchainOS, Timos simülasyonu).
// Hücre = değer + durum (safe/warn/danger/unknown). Kaynak alanı vermiyorsa "–". Logo yok; kaynak adı metin.
import { DEX_CHAINS } from "../discover/dex.js";

export type CellStatus = "safe" | "warn" | "danger" | "unknown";
export interface Cell {
  value: string;
  status: CellStatus;
  raw?: unknown;
}

export const ROWS: { key: string; label: string; why: string }[] = [
  { key: "verified", label: "Kontrat doğrulanmış", why: "Kaynak kodu doğrulanmamış kontratta gizli işlevler denetlenemez." },
  { key: "honeypot", label: "Honeypot", why: "Honeypot tokenı alınabilir ama satılamaz; parayı geri alamazsın." },
  { key: "buyTax", label: "Alım vergisi", why: "Yüksek alım vergisi girişte paranın bir kısmını keser." },
  { key: "sellTax", label: "Satış vergisi", why: "Yüksek satış vergisi çıkışta paranın büyük kısmını alabilir." },
  { key: "proxy", label: "Proxy", why: "Proxy kontrat sonradan değiştirilebilir; kurallar habersiz değişebilir." },
  { key: "mintable", label: "Mintable", why: "Mint yetkisi arzı artırıp fiyatı düşürebilir." },
  { key: "taxModifiable", label: "Vergi değiştirilebilir", why: "Vergi sonradan %100'e çekilip satış engellenebilir." },
  { key: "blacklist", label: "Blacklist", why: "Kara liste ile belirli cüzdanların satışı durdurulabilir." },
  { key: "transferPausable", label: "Transfer durdurulabilir", why: "Sahip tüm transferleri dondurabilir." },
  { key: "hiddenOwner", label: "Gizli/geri alınabilir sahiplik", why: "Sahiplik bırakılmış görünse bile geri alınabilir." },
  { key: "ownerChangeBalance", label: "Sahip bakiye değiştirebilir", why: "Sahip cüzdan bakiyelerini değiştirip tokenları silebilir." },
  { key: "lpLocked", label: "LP kilitli/yakılmış", why: "Kilitsiz likidite bir anda çekilebilir (rug pull)." },
  { key: "holders", label: "Holder sayısı / ilk 10 payı", why: "Az holder ya da yoğun dağılım fiyatı manipülasyona açık yapar. İlk 10 payı LP ve kontrat cüzdanlarını da içerir (etiketli)." },
];

export interface SourceColumn {
  id: "goplus" | "honeypot" | "onchainos" | "timos";
  name: string;
  available: boolean;
  note: string;
  cells: Record<string, Cell>;
  token?: { name: string; symbol: string; holders?: number | null; totalSupply?: string | null };
  liquidityUsd?: number | null;
}

export interface SecurityTable {
  chain: string;
  chainName: string;
  address: string;
  token: { name: string; symbol: string } | null;
  columns: SourceColumn[];
  rows: { key: string; label: string; why: string; timos: Cell; conflict: boolean }[];
  summary: { danger: number; warn: number; neutral: number };
  verdict: "PASS" | "WARN" | "BLOCK";
  reasons: string[];
  liquidityUsd: number | null;
  ts: number;
}

const dash = (): Cell => ({ value: "–", status: "unknown" });
const yn = (v: unknown, dangerIfYes: CellStatus = "warn", invert = false): Cell => {
  if (v === undefined || v === null || v === "") return dash();
  const yes = String(v) === "1" || v === true;
  const bad = invert ? !yes : yes;
  return { value: yes ? "Evet" : "Hayır", status: bad ? dangerIfYes : "safe", raw: v };
};
const tax = (v: unknown, scale = 100): Cell => {
  if (v === undefined || v === null || v === "") return dash();
  const pct = Number(v) * scale;
  if (!Number.isFinite(pct)) return dash();
  return { value: `%${pct.toFixed(pct < 1 ? 2 : 1)}`, status: pct > 10 ? "danger" : pct > 5 ? "warn" : "safe", raw: v };
};

/** GoPlus EVM yanıtını hücrelere çevirir (saf fonksiyon). */
export function goplusCells(r: Record<string, any>): Record<string, Cell> {
  const lp: any[] = Array.isArray(r.lp_holders) ? r.lp_holders : [];
  const lockedPct = lp.filter((h) => String(h.is_locked) === "1" || /^0x0{30,}|dead$/i.test(String(h.address))).reduce((s, h) => s + Number(h.percent || 0), 0);
  const holders: any[] = Array.isArray(r.holders) ? r.holders : [];
  const top10 = holders.slice(0, 10).reduce((s, h) => s + Number(h.percent || 0), 0);
  const tagged = holders.slice(0, 10).filter((h) => String(h.is_contract) === "1" || h.tag).length;
  return {
    verified: yn(r.is_open_source, "danger", true),
    honeypot: yn(r.is_honeypot, "danger"),
    buyTax: tax(r.buy_tax),
    sellTax: tax(r.sell_tax),
    proxy: yn(r.is_proxy, "warn"),
    mintable: yn(r.is_mintable, "warn"),
    taxModifiable: yn(r.slippage_modifiable, "warn"),
    blacklist: yn(r.is_blacklisted, "warn"),
    transferPausable: yn(r.transfer_pausable, "warn"),
    hiddenOwner: r.hidden_owner === undefined && r.can_take_back_ownership === undefined ? dash() : yn(String(r.hidden_owner) === "1" || String(r.can_take_back_ownership) === "1" ? "1" : "0", "danger"),
    ownerChangeBalance: yn(r.owner_change_balance, "danger"),
    lpLocked: lp.length ? { value: `%${(lockedPct * 100).toFixed(0)} kilitli/yakılmış`, status: lockedPct >= 0.9 ? "safe" : lockedPct >= 0.5 ? "warn" : "danger", raw: lp.slice(0, 5) } : dash(),
    holders: r.holder_count !== undefined ? { value: `${Number(r.holder_count).toLocaleString("tr-TR")} · ilk 10: %${(top10 * 100).toFixed(0)}${tagged ? ` (${tagged} etiketli: LP/kontrat)` : ""}`, status: Number(r.holder_count) < 100 || top10 > 0.8 ? "warn" : "safe", raw: { holder_count: r.holder_count, top10 } } : dash(),
  };
}

/** GoPlus Solana yanıtı (farklı alan adları). */
export function goplusSolanaCells(r: Record<string, any>): Record<string, Cell> {
  const st = (o: any) => (o && o.status !== undefined ? o.status : undefined);
  const holders: any[] = Array.isArray(r.holders) ? r.holders : [];
  const top10 = holders.slice(0, 10).reduce((s, h) => s + Number(h.percent || 0), 0);
  const fee = r.transfer_fee && typeof r.transfer_fee === "object" ? Number(r.transfer_fee.fee_rate ?? 0) / 100 : undefined;
  return {
    verified: dash(),
    honeypot: dash(),
    buyTax: fee === undefined ? dash() : tax(fee),
    sellTax: fee === undefined ? dash() : tax(fee),
    proxy: dash(),
    mintable: yn(st(r.mintable), "warn"),
    taxModifiable: yn(st(r.transfer_fee_upgradable), "warn"),
    blacklist: dash(),
    transferPausable: yn(st(r.freezable), "warn"),
    hiddenOwner: dash(),
    ownerChangeBalance: yn(st(r.balance_mutable_authority), "danger"),
    lpLocked: dash(),
    holders: r.holder_count !== undefined ? { value: `${Number(r.holder_count).toLocaleString("tr-TR")} · ilk 10: %${(top10 * 100).toFixed(0)}`, status: top10 > 0.8 ? "warn" : "safe" } : dash(),
  };
}

/** Honeypot.is yanıtını hücrelere çevirir (vergiler yüzde olarak gelir). */
export function honeypotCells(d: Record<string, any>): Record<string, Cell> {
  const sim = d.simulationResult ?? {};
  const cc = d.contractCode ?? {};
  const cells: Record<string, Cell> = Object.fromEntries(ROWS.map((r) => [r.key, dash()]));
  cells.honeypot = d.honeypotResult ? yn(d.honeypotResult.isHoneypot ? "1" : "0", "danger") : dash();
  if (d.simulationSuccess) {
    cells.buyTax = tax(sim.buyTax, 1);
    cells.sellTax = tax(sim.sellTax, 1);
  }
  if (cc.openSource !== undefined) cells.verified = yn(cc.openSource ? "1" : "0", "danger", true);
  if (cc.isProxy !== undefined) cells.proxy = yn(cc.isProxy ? "1" : "0", "warn");
  if (d.token?.totalHolders !== undefined) cells.holders = { value: Number(d.token.totalHolders).toLocaleString("tr-TR"), status: Number(d.token.totalHolders) < 100 ? "warn" : "safe" };
  return cells;
}

const RANK: Record<CellStatus, number> = { unknown: 0, safe: 1, warn: 2, danger: 3 };

/** Timos kararı: satır bazında en kötü bilinen durum; genel karar oylaması. Simülasyon varsa çelişkide o kazanır. */
export function combine(columns: SourceColumn[]): Pick<SecurityTable, "rows" | "summary" | "verdict" | "reasons"> {
  const active = columns.filter((c) => c.available);
  const sim = active.find((c) => c.id === "timos");
  const rows = ROWS.map((r) => {
    const cells = active.map((c) => c.cells[r.key]).filter((x) => x && x.status !== "unknown");
    const statuses = new Set(cells.map((c) => c.status));
    const conflict = statuses.has("danger") && statuses.has("safe") || (statuses.has("warn") && statuses.has("safe") && r.key !== "holders");
    let timos: Cell = dash();
    const simCell = sim?.cells[r.key];
    if (simCell && simCell.status !== "unknown") timos = { ...simCell, value: `${simCell.value} (simülasyon)` };
    else if (cells.length) timos = cells.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a));
    return { key: r.key, label: r.label, why: r.why, timos, conflict };
  });
  const reasons: string[] = [];
  const get = (k: string) => rows.find((x) => x.key === k)!.timos;
  let verdict: SecurityTable["verdict"] = "PASS";
  if (get("honeypot").status === "danger") {
    verdict = "BLOCK";
    reasons.push("Honeypot: satış engelli (en az bir kaynak).");
  } else {
    const warnIf = (k: string, text: string) => {
      if (get(k).status === "danger" || get(k).status === "warn") {
        verdict = "WARN";
        reasons.push(text);
      }
    };
    if (get("buyTax").status === "danger" || get("sellTax").status === "danger") {
      verdict = "WARN";
      reasons.push("Vergi %10'un üzerinde.");
    }
    warnIf("mintable", "Mint yetkisi var.");
    warnIf("ownerChangeBalance", "Sahip bakiyeleri değiştirebiliyor.");
    if (get("lpLocked").status === "danger") {
      verdict = "WARN";
      reasons.push("Likidite büyük ölçüde kilitsiz.");
    }
  }
  if (!active.some((c) => c.id !== "onchainos")) {
    verdict = "WARN";
    reasons.push("Hiçbir güvenlik kaynağına ulaşılamadı (veri yok).");
  }
  if (!reasons.length) reasons.push("Kritik bulgu yok.");
  if (rows.some((r) => r.conflict)) reasons.push("Bazı satırlarda kaynaklar çelişiyor; en kötü bilinen durum esas alındı.");
  const summary = { danger: rows.filter((r) => r.timos.status === "danger").length, warn: rows.filter((r) => r.timos.status === "warn").length, neutral: rows.filter((r) => r.timos.status === "safe" || r.timos.status === "unknown").length };
  return { rows, summary, verdict, reasons };
}

type FetchLike = typeof fetch;

export async function buildSecurityTable(chain: string, address: string, fetchImpl: FetchLike = fetch): Promise<SecurityTable> {
  const ch = DEX_CHAINS[chain];
  if (!ch) throw new Error("Desteklenmeyen zincir.");
  const get = async (url: string) => {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(12_000), headers: { accept: "application/json" } });
    const j: any = await r.json().catch(() => ({}));
    return { ok: r.ok, j };
  };
  const goplus: SourceColumn = { id: "goplus", name: "GoPlus", available: false, note: "", cells: {} };
  try {
    const url = ch.kind === "solana" ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}` : `https://api.gopluslabs.io/api/v1/token_security/${ch.goplus}?contract_addresses=${address}`;
    const { j } = await get(url);
    const res = j?.result?.[address.toLowerCase()] ?? j?.result?.[address] ?? Object.values(j?.result ?? {})[0];
    if (res) {
      goplus.available = true;
      goplus.cells = ch.kind === "solana" ? goplusSolanaCells(res as any) : goplusCells(res as any);
      const r = res as any;
      goplus.token = { name: String(r.token_name ?? r.metadata?.name ?? ""), symbol: String(r.token_symbol ?? r.metadata?.symbol ?? ""), holders: r.holder_count !== undefined ? Number(r.holder_count) : null, totalSupply: r.total_supply ?? null };
      goplus.note = "token_security";
    } else goplus.note = `sonuç yok (${j?.message ?? "bilinmiyor"})`;
  } catch (e) {
    goplus.note = `erişilemedi: ${(e as Error).message}`;
  }
  if (!goplus.available) goplus.cells = Object.fromEntries(ROWS.map((r) => [r.key, dash()]));

  const honeypot: SourceColumn = { id: "honeypot", name: "Honeypot.is", available: false, note: "", cells: Object.fromEntries(ROWS.map((r) => [r.key, dash()])) };
  if (!ch.honeypot) honeypot.note = "desteklenmiyor";
  else {
    try {
      const { ok, j } = await get(`https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${ch.honeypot}`);
      if (ok && (j.honeypotResult || j.token)) {
        honeypot.available = true;
        honeypot.cells = honeypotCells(j);
        honeypot.note = j.simulationSuccess ? "al-sat simülasyonu" : "simülasyon başarısız";
        honeypot.token = j.token ? { name: j.token.name, symbol: j.token.symbol, holders: j.token.totalHolders ?? null } : undefined;
        honeypot.liquidityUsd = Number(j.pair?.liquidity) || null;
      } else honeypot.note = j?.error ? `hata: ${j.error}` : "sonuç yok";
    } catch (e) {
      honeypot.note = `erişilemedi: ${(e as Error).message}`;
    }
  }
  if (honeypot.note === "desteklenmiyor") honeypot.cells = Object.fromEntries(ROWS.map((r) => [r.key, { value: "desteklenmiyor", status: "unknown" as CellStatus }]));

  const onchainos: SourceColumn = { id: "onchainos", name: "OKX OnchainOS", available: false, note: "Web3 API anahtarı gerekli", cells: Object.fromEntries(ROWS.map((r) => [r.key, dash()])) };
  // Timos simülasyonu (anvil fork) bu ortamda yok → sütun gizli (döndürülmez).
  const columns = [goplus, honeypot, onchainos];
  const c = combine(columns);
  const token = goplus.token?.symbol ? { name: goplus.token.name, symbol: goplus.token.symbol } : honeypot.token ? { name: honeypot.token.name, symbol: honeypot.token.symbol } : null;
  return { chain, chainName: ch.name, address, token, columns, ...c, liquidityUsd: honeypot.liquidityUsd ?? null, ts: Date.now() };
}

/** Telegram için metin tablo (monospace). */
export function tableText(t: SecurityTable): string {
  const sym: Record<CellStatus, string> = { safe: "ok", warn: "!", danger: "X", unknown: "-" };
  const cols = t.columns.map((c) => c.name.split(" ")[0].slice(0, 8));
  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s + " ".repeat(n - s.length));
  const lines = [`${pad("Kontrol", 20)} ${cols.map((c) => pad(c, 8)).join(" ")} Timos`];
  for (const r of t.rows) lines.push(`${pad(r.label, 20)} ${t.columns.map((c) => pad(sym[c.cells[r.key]?.status ?? "unknown"], 8)).join(" ")} ${sym[r.timos.status]}${r.conflict ? " (çelişki)" : ""}`);
  return [`Güvenlik taraması: ${t.verdict} · ${t.token ? `${t.token.name} (${t.token.symbol})` : "bilinmeyen token"} · ${t.chainName}`, `Tehlike ${t.summary.danger} · Uyarı ${t.summary.warn} · Nötr ${t.summary.neutral}`, "```", ...lines, "```", ...t.reasons.map((x) => `- ${x}`), "ok güvenli · ! uyarı · X tehlike · - bilgi yok"].join("\n");
}
