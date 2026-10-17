// DecisionLog.sol'u solc-js ile derler → avalanche/artifacts/DecisionLog.json (ABI + bytecode).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const solc = require("solc");
const dir = path.resolve(process.cwd(), "avalanche");
const source = fs.readFileSync(path.join(dir, "contracts/DecisionLog.sol"), "utf8");
const input = {
  language: "Solidity",
  sources: { "DecisionLog.sol": { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter((e: any) => e.severity === "error");
if (errors.length) {
  console.error(errors.map((e: any) => e.formattedMessage).join("\n"));
  process.exit(1);
}
const c = out.contracts["DecisionLog.sol"].DecisionLog;
fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
fs.writeFileSync(path.join(dir, "artifacts/DecisionLog.json"), JSON.stringify({ contractName: "DecisionLog", compiler: solc.version(), abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2));
console.log(`DecisionLog derlendi (${solc.version()}), bytecode ${c.evm.bytecode.object.length / 2} bayt.`);
