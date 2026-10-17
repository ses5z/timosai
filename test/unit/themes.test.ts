import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync("public/css/app.css", "utf8");
function block(sel: string): Record<string, string> {
  const i = css.indexOf(sel + " {");
  assert.ok(i >= 0, sel);
  const body = css.slice(i, css.indexOf("}", i));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("4 palet (Basic/Pro × gece/gündüz): metin ve durum renkleri AA kontrast (≥ 4.5)", () => {
  const root = block(":root");
  const palettes: Record<string, Record<string, string>> = {
    "Basic gece": root,
    "Basic gündüz": { ...root, ...block('body[data-theme="light"]') },
    "Pro gece": { ...root, ...block('body[data-mode="pro"]') },
    "Pro gündüz": { ...root, ...block('body[data-mode="pro"]'), ...block('body[data-mode="pro"][data-theme="light"]') },
  };
  for (const [name, p] of Object.entries(palettes)) {
    for (const bg of ["ink-900", "ink-800"]) {
      for (const fg of ["cream-100", "cream-300", "cream-500", "safe", "risky", "caution", "amber"]) {
        const r = ratio(p[fg], p[bg]);
        assert.ok(r >= 4.5, `${name}: --${fg} ${p[fg]} / --${bg} ${p[bg]} = ${r.toFixed(2)}`);
      }
    }
    assert.ok(ratio(p["on-accent"] ?? "#0a0f1a", p["amber"]) >= 4.5, `${name}: düğme metni / vurgu`);
  }
  assert.ok(!/--amber: #f2a93b/.test(css.slice(css.indexOf('body[data-mode="pro"] {'))), "Pro'da amber vurgu yok");
});
