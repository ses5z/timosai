import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AvalancheProofAnchor, type AnchorWriter } from "../../src/proof/avalancheAnchor.js";
import { NoopProofAnchor } from "../../src/proof/proofAnchor.js";
import { loadEnv, secretValues } from "../../src/config/env.js";
import { mask, registerSecrets } from "../../src/util/log.js";

const dep = { network: "fuji" as const, chainId: 43113, address: "0x1111111111111111111111111111111111111111" as const, deployTx: "0xabc", explorer: "https://testnet.snowtrace.io/address/0x111", txUrl: "https://testnet.snowtrace.io/tx/0xabc" };

test("DecisionLog derleme çıktısı anchor/logDecision/logOutcome içerir", () => {
  const art = JSON.parse(fs.readFileSync("avalanche/artifacts/DecisionLog.json", "utf8"));
  const fns = art.abi.filter((x: any) => x.type === "function").map((x: any) => x.name);
  for (const f of ["anchor", "logDecision", "logOutcome", "owner"]) assert.ok(fns.includes(f), f);
  assert.ok(/^0x60[0-9a-f]{2}6040/.test(art.bytecode));
});

test("ProofAnchor: yeni kayıt varsa özet yazar, yoksa yazmaz; Snowtrace linki üretir", async () => {
  const calls: any[] = [];
  const w: AnchorWriter = { anchor: async (h, c) => (calls.push([h, c]), "0xdeadbeef"), logOutcome: async () => "0xfeed" };
  const a = new AvalancheProofAnchor(dep, w);
  const head = "ab".repeat(32);
  const r = await a.anchor(head, 10);
  assert.equal(r.anchored, true);
  assert.deepEqual(calls[0], [`0x${head}`, 10n]);
  assert.equal((await a.anchor(head, 10)).anchored, false);
  await a.outcome("SOL-USDT", -0.0123, head);
  const st = a.status() as any;
  assert.equal(st.total, 2);
  assert.equal(st.last.url, "https://testnet.snowtrace.io/tx/0xfeed");
});

test("ProofAnchor: yazıcı hatası uygulamayı çökertmez", async () => {
  const a = new AvalancheProofAnchor(dep, { anchor: async () => { throw new Error("insufficient funds"); }, logOutcome: async () => "0x0" });
  const r = await a.anchor("cd".repeat(32), 3);
  assert.equal(r.anchored, false);
  assert.match((a.status() as any).lastError, /insufficient funds/);
});

test("Noop: anahtar yoksa kapalı görünür; özel anahtar maskelenir", () => {
  assert.equal((new NoopProofAnchor().status() as any).enabled, false);
  const env = loadEnv({ file: "/yok", source: { AVAX_DEPLOYER_PRIVATE_KEY: "0x" + "9f".repeat(32) } });
  registerSecrets(secretValues(env));
  assert.equal(mask(`anahtar ${"9f".repeat(32)} burada`).includes("9f9f9f9f"), false);
});
