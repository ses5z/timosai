// Keşfet DEX: zincir + kontrat adresi (CA) doğrulaması ve token bilgisi.
// OKX OnchainOS (okx-dex-token, token arama) Web3 API anahtarı ister; yoksa "anahtar gerekli" döner, sahte veri yok.
export const DEX_CHAINS: Record<string, { name: string; kind: "evm" | "solana"; goplus: string; honeypot: string | null }> = {
  "1": { name: "Ethereum", kind: "evm", goplus: "1", honeypot: "1" },
  "56": { name: "BNB Chain", kind: "evm", goplus: "56", honeypot: "56" },
  "8453": { name: "Base", kind: "evm", goplus: "8453", honeypot: "8453" },
  "43114": { name: "Avalanche C-Chain", kind: "evm", goplus: "43114", honeypot: null },
  "42161": { name: "Arbitrum", kind: "evm", goplus: "42161", honeypot: null },
  "137": { name: "Polygon", kind: "evm", goplus: "137", honeypot: null },
  "10": { name: "Optimism", kind: "evm", goplus: "10", honeypot: null },
  solana: { name: "Solana", kind: "solana", goplus: "solana", honeypot: null },
};

export const CHAIN_ALIASES: Record<string, string> = { eth: "1", ethereum: "1", bsc: "56", bnb: "56", base: "8453", avax: "43114", avalanche: "43114", arbitrum: "42161", polygon: "137", optimism: "10", sol: "solana", solana: "solana" };

export function resolveChain(c: string): string | null {
  const k = c.toLowerCase();
  if (DEX_CHAINS[k]) return k;
  return CHAIN_ALIASES[k] ?? null;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Adres biçimi zincire göre: EVM 0x + 40 hex, Solana base58 (32-44). */
export function validateAddress(chain: string, address: string): { ok: boolean; error?: string } {
  const c = DEX_CHAINS[chain];
  if (!c) return { ok: false, error: "Desteklenmeyen zincir." };
  if (c.kind === "evm") return /^0x[0-9a-fA-F]{40}$/.test(address) ? { ok: true } : { ok: false, error: "EVM adresi 0x ile başlayan 40 hex karakter olmalı." };
  return BASE58.test(address) ? { ok: true } : { ok: false, error: "Solana adresi base58 (32-44 karakter) olmalı." };
}

export interface OnchainOsStatus {
  available: boolean;
  note: string;
}

export function onchainOsStatus(): OnchainOsStatus {
  return { available: false, note: "OKX OnchainOS token arama ve okx-dex-token Web3 API anahtarı (OK-ACCESS-KEY) ya da x402 ödemesi istiyor; tanımlı değil." };
}
