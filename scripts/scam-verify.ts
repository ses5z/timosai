// config/demo-tokens.json içindeki adresleri GoPlus ile doğrular.
import fs from "node:fs";
import { GoPlusSecurity, ScamScanner, OnchainOsSecurity } from "../src/security/tokenSecurity.js";
const cfg = JSON.parse(fs.readFileSync("config/demo-tokens.json", "utf8"));
const s = new ScamScanner([new GoPlusSecurity(), new OnchainOsSecurity()]);
for (const t of [...cfg.tokens, ...(cfg.honeypot ? [{ label: "honeypot", ...cfg.honeypot }] : [])]) {
  const r = await s.scan(t.chain, t.address);
  console.log(`${t.label}: ${r.verdict} (${r.token?.symbol ?? "?"}) - ${r.reasons.join(" | ")}`);
}
if (!cfg.honeypot) console.log("Honeypot yuvası boş.");
