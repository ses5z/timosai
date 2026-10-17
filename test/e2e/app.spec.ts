import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const PAGES = ["/", "/kesfet", "/mentor", "/panel", "/isi-haritasi", "/telegram", "/hakkimizda"];
const SHOTS = "artifacts/screens";

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function waitForScan(page: Page) {
  await expect.poll(async () => (await (await page.request.get("/api/status")).json()).agent.scanCount, { timeout: 30_000 }).toBeGreaterThan(0);
}

test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));

test("tüm sayfalar 200, konsol hatası yok, 360 ve 1440 px'te yatay kaydırma yok", async ({ page }) => {
  await waitForScan(page);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    for (const p of PAGES) {
      const errors = watchErrors(page);
      const res = await page.goto(p);
      expect(res?.status(), p).toBe(200);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(600);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${p} @${width}px yatay taşma`).toBeLessThanOrEqual(1);
      await expect(page.locator(".site-footer")).toContainText("yatırım tavsiyesi değildir");
      await expect(page.locator("#mode-badge")).toHaveText("Paper trade");
      await page.screenshot({ path: `${SHOTS}/${width}${p === "/" ? "-karsilama" : p.replace("/", "-")}.png`, fullPage: true });
      expect(errors, `${p} konsol hataları`).toEqual([]);
    }
  }
});

test("keşfet: sürükleme, ok tuşları ve geri al akışı", async ({ page }) => {
  await waitForScan(page);
  await page.request.post("/api/queue/reset");
  await page.goto("/kesfet");
  const card = page.locator(".swipe-card:not(.behind)");
  await expect(card).toBeVisible();
  const first = await card.getAttribute("data-inst");
  // sağa sürükle → listeme al + analiz
  await page.locator(".deck").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 120));
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 3, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2 + 240, box.y + box.height / 3, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#analysis h2")).toContainText("mentor analizi");
  await expect(page.locator("#follow-count")).toHaveText("(1)");
  await expect(card).not.toHaveAttribute("data-inst", first!);
  // sol ok → geç
  const second = await card.getAttribute("data-inst");
  await page.keyboard.press("ArrowLeft");
  await expect(card).not.toHaveAttribute("data-inst", second!);
  // geri al (Backspace) → geçilen kart geri gelir
  await page.keyboard.press("Backspace");
  await expect(card).toHaveAttribute("data-inst", second!);
  // sağ ok → listeme al
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#follow-count")).toHaveText("(2)");
  // liste görünümü ve plan
  await page.click("#tab-list");
  await expect(page.locator(".follow-row")).toHaveCount(2);
  await page.click("#btn-plan");
  await expect(page.locator("#plan-box table")).toBeVisible();
  await expect(page.locator("#plan-box")).toContainText("ajan");
});

test("15 coin listeye alınınca uyarı penceresi: odak Tamam'da, Esc kapatır, kilit yok", async ({ page }) => {
  await waitForScan(page);
  await page.goto("/panel");
  await page.waitForTimeout(500);
  const cands = await (await page.request.get("/api/candidates")).json();
  for (const c of cands.slice(0, 15)) await page.request.post("/api/follows", { data: { instId: c.instId } });
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("Takip listen kalabalıklaştı");
  await expect(dlg.getByRole("button")).toHaveCount(2 - 1 + 1); // Tamam + açıklama balonu düğmesi
  await expect(page.getByRole("button", { name: "Tamam" })).toBeFocused();
  await expect(dlg).not.toContainText("Yine de");
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  const r = await page.request.post("/api/follows", { data: { instId: cands[15].instId } });
  expect(r.status()).toBe(200);
});

test("ısı haritası: tıkla → çekmece → URL; Al/Sat düğmesi yok", async ({ page }) => {
  await waitForScan(page);
  await page.goto("/isi-haritasi");
  const tile = page.locator(".tile").first();
  await expect(tile).toBeVisible();
  const id = await tile.getAttribute("data-id");
  await tile.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`\\?s=${id}`));
  await expect(drawer).toContainText("Ajanın görüşü");
  await expect(drawer.getByRole("button", { name: /^(Al|Sat|Satın al|Emir)/ })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: /Ajana öncelik ver/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  // paylaşılabilir URL
  await page.goto(`/isi-haritasi?s=${id}`);
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("kullanıcı emir yolu yok: API'de emir uç noktası bulunmaz, sayfalarda Al/Sat düğmesi yok", async ({ page }) => {
  for (const p of ["/api/order", "/api/orders", "/api/trade", "/api/buy", "/api/sell", "/api/positions/close", "/api/quick", "/api/settings/quick"]) {
    const r = await page.request.post(p, { data: { instId: "SOL-USDT", side: "buy", sz: "5" } });
    expect(r.status(), p).toBe(404);
  }
  await waitForScan(page);
  for (const p of PAGES) {
    await page.goto(p);
    await page.waitForTimeout(300);
    await expect(page.getByRole("button", { name: /^(Al|Sat|Satın al|Emir ver|Yine de gönder)$/ })).toHaveCount(0);
  }
});

test("panel: senaryo uyarı penceresini açar; olay günlüğünde kaydırma canlı yenilemede korunur", async ({ page }) => {
  await waitForScan(page);
  await page.goto("/panel");
  await page.click("#scenario-btn");
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  await expect(dlg).toContainText("sözleşmeye aykırı buldu ve vermedi");
  await page.getByRole("button", { name: "Tamam" }).click();
  await expect(page.locator("#sc-step")).toHaveText("tamamlandı", { timeout: 30_000 });
  for (let i = 0; i < 3; i++) await page.request.post("/api/agent/scan");
  const log = page.locator("#ev-list");
  await expect.poll(async () => log.evaluate((el) => el.scrollHeight > el.clientHeight + 40)).toBe(true);
  await log.evaluate((el) => (el.scrollTop = 60));
  await page.request.post("/api/agent/scan");
  await page.waitForTimeout(1500);
  const top = await log.evaluate((el) => el.scrollTop);
  expect(top).toBeGreaterThan(30);
});

test("mentor: yazılı komut ve onay düğmesi", async ({ page }) => {
  await waitForScan(page);
  await page.goto("/mentor");
  await page.fill("#msg", "risk bütçesini %1.5 yap");
  await page.press("#msg", "Enter");
  await expect(page.locator(".confirm-box")).toBeVisible();
  await page.getByRole("button", { name: "Onayla" }).click();
  await expect(page.locator("#last-convo")).toContainText("yapıldı");
  const st = await (await page.request.get("/api/settings")).json();
  expect(st.riskPct).toBe(1.5);
  await page.fill("#msg", "BTC al");
  await page.press("#msg", "Enter");
  await expect(page.locator("#last-convo")).toContainText("Emir veremem");
});

test("Basic/Pro: iki modda tüm sayfalar düzgün; Basic'te Pro alanları görünmez", async ({ page }) => {
  await waitForScan(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const mode of ["basic", "pro"]) {
    await page.goto("/");
    await page.evaluate((m) => localStorage.setItem("tms-mode", m), mode);
    for (const p of PAGES) {
      const errors = watchErrors(page);
      await page.goto(p);
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => document.body.dataset.mode)).toBe(mode);
      const visiblePro = await page.locator(".pro-only:visible").count();
      if (mode === "basic") expect(visiblePro, `${p} Basic'te görünen Pro alanı`).toBe(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      expect(errors, `${p} (${mode}) konsol hataları`).toEqual([]);
    }
  }
  await page.goto("/panel");
  await page.getByRole("button", { name: "Basic" }).click();
  expect(await page.evaluate(() => localStorage.getItem("tms-mode"))).toBe("basic");
});

test("token tarama kutusu: honeypot BLOCK, geçersiz adres hata verir", async ({ page }) => {
  await waitForScan(page);
  await page.goto("/kesfet");
  await page.selectOption("#scan-chain", "bsc");
  await page.fill("#scan-addr", "0x000000000000000000000000000000000000dEaD");
  await page.getByRole("button", { name: "Tara", exact: true }).click();
  await expect(page.locator("#scan-result")).toContainText("BLOCK");
  await page.fill("#scan-addr", "0x123");
  await page.getByRole("button", { name: "Tara", exact: true }).click();
  await expect(page.locator("#scan-result")).toContainText("Geçersiz");
});

test("ısı haritası çekmecesi: vadeli durum ve hold raporu, Lightweight Charts grafiği", async ({ page }) => {
  await waitForScan(page);
  await page.goto("/isi-haritasi?s=BTC-USDT");
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.locator("#dr-deriv")).not.toBeEmpty();
  await expect(drawer.locator("#dr-hold")).toContainText(/hold profiline uygun|kısa vade trade edilebilir|ikisi de riskli/);
  await expect(drawer.locator(".tv-box canvas").first()).toBeVisible();
});

test("Güncelleme2 madde 2: çekmece AI analizi, Trend çizgisi ve Seviyeler düğmeleri (seviyeler varsayılan kapalı)", async ({ page }) => {
  await waitForScan(page);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.goto("/isi-haritasi?s=TRX-USDT");
    const drawer = page.getByRole("dialog");
    await expect(drawer.locator(".ai-card")).toContainText("AI analizi");
    await expect(drawer.locator(".ai-card")).toContainText("Vadeli");
    await expect(drawer.locator(".ai-card")).toContainText("Hold / arz");
    const lv = drawer.getByRole("button", { name: "Seviyeler" });
    await expect(lv).toHaveAttribute("aria-pressed", "false");
    const tr = drawer.getByRole("button", { name: "Trend çizgisi" });
    await tr.click();
    await expect(drawer.locator(".chart-legend")).toBeVisible();
    await expect(drawer.locator(".chart-legend")).toContainText("TimosAI ATR");
    await expect(drawer).not.toContainText("Follow Line");
    await lv.click();
    await expect(lv).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/g2-madde2-cekmece-${width}.png` });
  }
});

test("Güncelleme2 madde 4: paper istatistik kartı, sıfırlama düğmesi ve PAPER × OTONOM etiketleri", async ({ page }) => {
  await waitForScan(page);
  await page.request.post("/api/scenario/start");
  await page.waitForTimeout(18_000);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.goto("/panel");
    const card = page.locator("#paper-card");
    await expect(card).toContainText("Kazanma oranı");
    await expect(card).toContainText("Ortalama R");
    await expect(card).toContainText("Maks drawdown");
    await expect(card).toContainText("Toplam PnL");
    await expect(card).toContainText("İşlem sayısı");
    await expect(card.getByRole("button", { name: "Sıfırla" })).toBeEnabled();
    await expect(page.locator("#tr-wrap")).toContainText("PAPER");
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/g2-madde4-panel-${width}.png` });
  }
});
