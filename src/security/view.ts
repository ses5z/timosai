import type { AppContext } from "../context.js";
import type { ScanResult } from "./tokenSecurity.js";

export async function scanToken(ctx: AppContext, chain: string, address: string): Promise<ScanResult> {
  const r = await ctx.scanner.scan(chain, address);
  ctx.ledger.append("decision", { tur: "token_tarama", zincir: r.chain, adres: r.address, karar: r.verdict, gerekce: r.reasons.slice(0, 6) });
  ctx.store.addEvent(r.verdict === "BLOCK" ? "uyarı" : "bilgi", `Token tarama ${r.chainName} ${r.address.slice(0, 10)}… (${r.token?.symbol ?? "?"}): ${r.verdict}. ${r.reasons[0] ?? ""}`);
  return r;
}

export function scanText(r: ScanResult): string {
  return [`Token tarama: ${r.verdict} · ${r.token ? `${r.token.name} (${r.token.symbol})` : "bilinmeyen token"} · ${r.chainName}`, r.address, ...r.reasons.map((x) => `- ${x}`), ...r.sources.filter((s) => !s.available).map((s) => `- ${s.source}: ${s.note ?? "kapalı"}`)].join("\n");
}
