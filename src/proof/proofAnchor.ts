// ProofAnchor: ledger özetini zincire yazmaya hazır arayüz. Avalanche Fuji uygulaması sonraki dilimde.
import type { ProofAnchor } from "../ports.js";

export class NoopProofAnchor implements ProofAnchor {
  readonly name = "noop";
  async anchor(headHash: string, count: number) {
    return { anchored: false, note: `Zincire yazma kapalı (sonraki dilim: Avalanche Fuji). Son özet ${headHash.slice(0, 12)}…, ${count} kayıt.` };
  }
}
