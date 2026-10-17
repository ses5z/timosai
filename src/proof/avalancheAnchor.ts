// AvalancheProofAnchor: SignalLedger özetini (sha256 baş + kayıt sayısı) DecisionLog sözleşmesine yazar;
// kapanan işlemlerin sonucunu değiştirilemez sicil olarak işler. Anahtar ve dağıtım yoksa no-op kalır.
import fs from "node:fs";
import path from "node:path";
import type { ProofAnchor } from "../ports.js";
import { log } from "../util/log.js";

export interface AnchorWriter {
  anchor(head: `0x${string}`, count: bigint): Promise<`0x${string}`>;
  logOutcome(symbol: string, pnlMicro: bigint, hash: `0x${string}`): Promise<`0x${string}`>;
}

export interface Deployment {
  network: "fuji" | "mainnet";
  chainId: number;
  address: `0x${string}`;
  deployTx: string;
  explorer: string;
  txUrl: string;
}

export interface AnchorRecord {
  kind: "anchor" | "outcome";
  txHash: string;
  url: string;
  at: number;
  head?: string;
  count?: number;
  symbol?: string;
}

export function loadDeployment(net: "fuji" | "mainnet", dir = path.resolve(process.cwd(), "avalanche")): Deployment | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, `deployment.${net}.json`), "utf8"));
  } catch {
    return null;
  }
}

export class AvalancheProofAnchor implements ProofAnchor {
  readonly name: string;
  records: AnchorRecord[] = [];
  private lastCount = 0;
  private busy = false;
  lastError: string | null = null;

  constructor(
    readonly deployment: Deployment,
    private readonly writer: AnchorWriter,
  ) {
    this.name = `avalanche-${deployment.network}`;
  }

  private explorerTx(h: string): string {
    return `${this.deployment.network === "mainnet" ? "https://snowtrace.io" : "https://testnet.snowtrace.io"}/tx/${h}`;
  }

  status() {
    const last = this.records.at(-1) ?? null;
    return { enabled: true, network: this.deployment.network, chainId: this.deployment.chainId, contract: this.deployment.address, contractUrl: this.deployment.explorer, deployTxUrl: this.deployment.txUrl, last, total: this.records.length, lastError: this.lastError, note: last ? `Son sabitleme ${new Date(last.at).toLocaleTimeString("tr-TR")}` : "Henüz sabitleme yok; ilk özet birkaç dakika içinde yazılır." };
  }

  async anchor(headHash: string, count: number) {
    if (this.busy) return { anchored: false, note: "Önceki sabitleme sürüyor." };
    if (count <= this.lastCount) return { anchored: false, note: "Yeni kayıt yok." };
    this.busy = true;
    try {
      const tx = await this.writer.anchor(`0x${headHash}` as `0x${string}`, BigInt(count));
      this.lastCount = count;
      this.records.push({ kind: "anchor", txHash: tx, url: this.explorerTx(tx), at: Date.now(), head: headHash, count });
      this.lastError = null;
      return { anchored: true, ref: tx, note: `Özet zincire yazıldı: ${this.explorerTx(tx)}` };
    } catch (e) {
      this.lastError = (e as Error).message.slice(0, 160);
      log.warn(`Avalanche sabitleme başarısız: ${this.lastError}`);
      return { anchored: false, note: `Sabitleme başarısız: ${this.lastError}` };
    } finally {
      this.busy = false;
    }
  }

  async outcome(symbol: string, pnlUsdt: number, hash: string): Promise<void> {
    try {
      const tx = await this.writer.logOutcome(symbol, BigInt(Math.round(pnlUsdt * 1e6)), `0x${hash}` as `0x${string}`);
      this.records.push({ kind: "outcome", txHash: tx, url: this.explorerTx(tx), at: Date.now(), symbol });
    } catch (e) {
      this.lastError = (e as Error).message.slice(0, 160);
      log.warn(`Avalanche sonuç kaydı başarısız: ${this.lastError}`);
    }
  }
}

/** viem ile gerçek yazıcı (yalnızca anahtar + dağıtım varsa). */
export async function makeViemWriter(pk: string, rpc: string, d: Deployment): Promise<AnchorWriter> {
  const { createPublicClient, createWalletClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { avalanche, avalancheFuji } = await import("viem/chains");
  const art = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "avalanche/artifacts/DecisionLog.json"), "utf8"));
  const chain = d.network === "mainnet" ? avalanche : avalancheFuji;
  const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });
  const pub = createPublicClient({ chain, transport: http(rpc) });
  const send = async (functionName: string, args: unknown[]) => {
    const hash = await wallet.writeContract({ address: d.address, abi: art.abi, functionName, args } as any);
    await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    return hash;
  };
  return {
    anchor: (head, count) => send("anchor", [head, count]),
    logOutcome: (symbol, pnl, hash) => send("logOutcome", [symbol, pnl, hash]),
  };
}
