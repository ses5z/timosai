// Canlı sunucudan (localhost:3000) G3 ekran görüntüleri: npx tsx scripts/shots-live.ts /long-short pro g3-madde7-ls
import { chromium } from "@playwright/test";
const [path = "/", mode = "basic", name = "shot"] = process.argv.slice(2);
const b = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });
for (const width of [360, 1440]) {
  const p = await b.newPage({ viewport: { width, height: width === 360 ? 780 : 900 } });
  await p.addInitScript((m) => { try { localStorage.setItem("tms-mode", m); } catch {} }, mode);
  await p.goto(`http://localhost:3000${path}`);
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `artifacts/screens/${name}-${width}.png` });
  console.log(width, "scrollWidth", await p.evaluate(() => document.documentElement.scrollWidth));
  await p.close();
}
await b.close();
