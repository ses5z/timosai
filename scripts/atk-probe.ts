// ATK adım 0: resmi stdio MCP sunucusunu alt süreç olarak başlatıp okuma araçlarını dener.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve("@okx_ai/okx-trade-mcp/package.json"));
const bin = path.join(pkgDir, "dist/index.js");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [bin, "--modules", "market,news,smartmoney", "--site", "tr", "--read-only", "--no-log"],
  env: { ...(process.env as Record<string, string>), OKX_UPDATE_CHECK: "0" },
  stderr: "pipe",
});
const client = new Client({ name: "timosai-probe", version: "0.1.0" });
await client.connect(transport);
const tools = await client.listTools();
console.log("araç sayısı:", tools.tools.length);
console.log(tools.tools.map((t) => t.name).join(", "));
for (const [name, args] of [
  ["market_get_ticker", { instId: "SOL-USDT" }],
  ["market_get_candles", { instId: "SOL-USDT", bar: "15m", limit: 3 }],
  ["market_get_indicator", { instId: "SOL-USDT", indicator: "rsi", bar: "1H" }],
  ["news_get_coin_sentiment", { coins: "SOL" }],
] as const) {
  try {
    const r: any = await client.callTool({ name, arguments: args as any });
    console.log("\n#", name, "->", JSON.stringify(r.content?.[0]?.text ?? r).slice(0, 400));
  } catch (e: any) {
    console.log("\n#", name, "HATA", e.message);
  }
}
await client.close();
