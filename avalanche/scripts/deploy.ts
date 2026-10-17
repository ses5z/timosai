// DecisionLog'u Avalanche'a dağıtır. Kullanım: npm run deploy:fuji (sonra gerekirse deploy:mainnet).
// Anahtar yalnızca .env → AVAX_DEPLOYER_PRIVATE_KEY (yalnızca bu iş için açılmış yeni cüzdan; kişisel cüzdan değil).
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalanche, avalancheFuji } from "viem/chains";
import { loadEnv } from "../../src/config/env.js";

const net = process.argv[2] === "mainnet" ? "mainnet" : "fuji";
const chain = net === "mainnet" ? avalanche : avalancheFuji;
const env = loadEnv();
const pk = env.avaxPrivateKey;
if (!pk) {
  console.error(".env içinde AVAX_DEPLOYER_PRIVATE_KEY boş. Yeni bir cüzdan açıp yalnızca gas'a yetecek AVAX koyun (Fuji: faucet.avax.network).");
  process.exit(1);
}
const rpc = net === "mainnet" ? env.avaxMainnetRpc : env.avaxFujiRpc;
const art = JSON.parse(fs.readFileSync(path.resolve("avalanche/artifacts/DecisionLog.json"), "utf8"));
const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`);
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ account, chain, transport: http(rpc) });
const bal = await pub.getBalance({ address: account.address });
console.log(`Ağ: ${chain.name} (${chain.id}) · dağıtıcı ${account.address} · bakiye ${formatEther(bal)} AVAX`);
if (bal === 0n) {
  console.error("Bakiye 0. Fuji için https://faucet.avax.network adresinden test AVAX alın.");
  process.exit(1);
}
const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args: [] });
console.log(`Dağıtım işlemi: ${hash}`);
const rc = await pub.waitForTransactionReceipt({ hash });
const explorer = net === "mainnet" ? "https://snowtrace.io" : "https://testnet.snowtrace.io";
const out = { network: net, chainId: chain.id, address: rc.contractAddress, deployTx: hash, deployer: account.address, block: Number(rc.blockNumber), explorer: `${explorer}/address/${rc.contractAddress}`, txUrl: `${explorer}/tx/${hash}`, at: new Date().toISOString() };
fs.writeFileSync(path.resolve(`avalanche/deployment.${net}.json`), JSON.stringify(out, null, 2));
console.log(`DecisionLog: ${rc.contractAddress}\n${out.explorer}`);
