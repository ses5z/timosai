import test from "node:test";
import assert from "node:assert/strict";
import { goplusCells, honeypotCells, combine, buildSecurityTable, tableText, ROWS, type SourceColumn } from "../../src/security/table.js";

const col = (id: any, cells: Record<string, any>, available = true): SourceColumn => ({ id, name: id, available, note: "", cells: Object.fromEntries(ROWS.map((r) => [r.key, cells[r.key] ?? { value: "–", status: "unknown" }])) });

test("tablo satırları: belgedeki 13 kontrol", () => {
  assert.deepEqual(ROWS.map((r) => r.label), ["Kontrat doğrulanmış", "Honeypot", "Alım vergisi", "Satış vergisi", "Proxy", "Mintable", "Vergi değiştirilebilir", "Blacklist", "Transfer durdurulabilir", "Gizli/geri alınabilir sahiplik", "Sahip bakiye değiştirebilir", "LP kilitli/yakılmış", "Holder sayısı / ilk 10 payı"]);
  assert.ok(ROWS.every((r) => r.why.length > 10));
});

test("GoPlus ve Honeypot.is hücreleri: değer + durum; alan yoksa '–'", () => {
  const g = goplusCells({ is_open_source: "0", is_honeypot: "0", buy_tax: "0.12", sell_tax: "0", is_mintable: "1", lp_holders: [{ is_locked: 0, percent: "0.9" }], holder_count: "50", holders: [{ percent: "0.6", is_contract: 1 }] });
  assert.deepEqual([g.verified.status, g.buyTax.status, g.mintable.status, g.lpLocked.status, g.holders.status, g.proxy.value], ["danger", "danger", "warn", "danger", "warn", "–"]);
  assert.match(g.holders.value, /etiketli/);
  const h = honeypotCells({ honeypotResult: { isHoneypot: true }, simulationSuccess: true, simulationResult: { buyTax: 2, sellTax: 99 }, contractCode: { openSource: true, isProxy: true } });
  assert.equal(h.honeypot.status, "danger");
  assert.equal(h.sellTax.value, "%99.0");
  assert.equal(h.proxy.status, "warn");
  assert.equal(h.mintable.value, "–");
});

test("oylama: herhangi bir kaynak honeypot → BLOCK; çelişki işaretlenir", () => {
  const c = combine([col("goplus", { honeypot: { value: "Hayır", status: "safe" } }), col("honeypot", { honeypot: { value: "Evet", status: "danger" } })]);
  assert.equal(c.verdict, "BLOCK");
  assert.equal(c.rows.find((r) => r.key === "honeypot")!.conflict, true);
  assert.equal(c.rows.find((r) => r.key === "honeypot")!.timos.status, "danger");
  assert.ok(c.summary.danger >= 1);
});

test("oylama: vergi > %10, mint, sahip bakiye, kilitsiz LP → WARN; temiz → PASS; simülasyon çelişkide kazanır", () => {
  assert.equal(combine([col("goplus", { sellTax: { value: "%25", status: "danger" } })]).verdict, "WARN");
  assert.equal(combine([col("goplus", { mintable: { value: "Evet", status: "warn" } })]).verdict, "WARN");
  assert.equal(combine([col("goplus", { lpLocked: { value: "%0", status: "danger" } })]).verdict, "WARN");
  assert.equal(combine([col("goplus", { honeypot: { value: "Hayır", status: "safe" } })]).verdict, "PASS");
  const sim = combine([col("goplus", { honeypot: { value: "Evet", status: "danger" } }), col("timos", { honeypot: { value: "Hayır", status: "safe" } })]);
  assert.equal(sim.verdict, "PASS");
  assert.match(sim.rows.find((r) => r.key === "honeypot")!.timos.value, /simülasyon/);
});

test("Avalanche: Honeypot.is 'desteklenmiyor'; OnchainOS 'anahtar gerekli'; Telegram metin tablosu", async () => {
  const addr = "0x" + "ab".repeat(20);
  const urls: string[] = [];
  const f = (async (u: string) => (urls.push(u), new Response(JSON.stringify({ code: 1, result: { [addr]: { token_name: "T", token_symbol: "T", is_honeypot: "0", is_open_source: "1" } } }), { status: 200 }))) as unknown as typeof fetch;
  const t = await buildSecurityTable("43114", addr, f);
  assert.equal(urls.some((u) => u.includes("honeypot.is")), false);
  assert.equal(t.columns.find((c) => c.id === "honeypot")!.note, "desteklenmiyor");
  assert.equal(t.columns.find((c) => c.id === "onchainos")!.available, false);
  assert.equal(t.columns.some((c) => c.id === "timos"), false);
  const txt = tableText(t);
  assert.match(txt, /```/);
  assert.match(txt, /Timos/);
  assert.match(txt, /Kontrat doğrulanmış/);
});
