// ProofAnchor: ledger özetini zincire yazmaya hazır arayüz. Avalanche Fuji uygulaması sonraki dilimde.
import type { ProofAnchor } from "../ports.js";

export class NoopProofAnchor implements ProofAnchor {
  readonly name = "noop";
  constructor(private readonly reason = "Avalanche kapalı: AVAX_DEPLOYER_PRIVATE_KEY boş ya da sözleşme dağıtılmadı (npm run deploy:fuji).") {}
  status() {
    return { enabled: false, note: this.reason, last: null, total: 0 };
  }
  async anchor(headHash: string, count: number) {
    return { anchored: false, note: `Zincire yazma kapalı (sonraki dilim: Avalanche Fuji). Son özet ${headHash.slice(0, 12)}…, ${count} kayıt.` };
  }
}
