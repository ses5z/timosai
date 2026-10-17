import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

const PAGES = ["/", "/kesfet", "/mentor", "/panel", "/isi-haritasi", "/telegram", "/hakkimizda", "/terminal"];
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
      await page.evaluate(() => { try { localStorage.setItem("tms-mode", "basic"); } catch {} });
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

test("15 coin listeye alınınca uyarı toast olur (pencere yok), kilit yok", async ({ page }) => {
  await waitForScan(page);
  await page.goto("/panel");
  await page.waitForTimeout(500);
  const cands = await (await page.request.get("/api/candidates")).json();
  for (const c of cands.slice(0, 15)) await page.request.post("/api/follows", { data: { instId: c.instId } });
  await expect(page.locator(".toast").filter({ hasText: /coin var|kalabalık/ }).first()).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  const r = await page.request.post("/api/follows", { data: { instId: cands[15].instId } });
  expect(r.status()).toBe(200);
});

test("G3 madde 5: kritik uyarı (devre kesici) pencere açar: odak Tamam'da, Esc kapatır", async ({ page }) => {
  await waitForScan(page);
  await page.goto("/panel");
  await page.evaluate(() => (window as any).TimosAI.showWarning({ critical: true, title: "Devre kesici açıldı", text: "Teknik arıza", items: [], riskScore: 10 }));
  const dlg = page.getByRole("alertdialog");
  await expect(dlg).toBeVisible();
  await expect(page.getByRole("button", { name: "Tamam" })).toBeFocused();
  await expect(dlg).not.toContainText("Yine de");
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await page.evaluate(() => (window as any).TimosAI.showWarning({ critical: false, title: "Limit doluluğu", text: "Limit doluluğu: açık tutar 13/15 · pozisyon 3/3. Yeni işlem açılmayacak, mevcutlar yönetiliyor.", items: [], riskScore: 10 }));
  await expect(page.locator(".toast").last()).toContainText("Limit doluluğu: açık tutar 13/15 · pozisyon 3/3");
  await expect(dlg).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("tms-mode", "pro"));
  await page.setViewportSize({ width: 360, height: 780 });
  await page.reload();
  await page.evaluate(() => (window as any).TimosAI.toast("Limit doluluğu: açık tutar 13/15 · pozisyon 3/3. Yeni işlem açılmayacak, mevcutlar yönetiliyor.", 8000));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360); // Pro + mobil: taşma yok
  const tb = (await page.locator(".toast").last().boundingBox())!;
  expect(tb.x + tb.width).toBeLessThanOrEqual(360);
  await page.screenshot({ path: `${SHOTS}/g3-madde5-toast-360.png` });
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
  await expect(drawer).toContainText("AI analizi");
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

test("panel: senaryo plana referanslı engel toast'ı gösterir; Pro günlükte kaydırma canlı yenilemede korunur", async ({ page }) => {
  await waitForScan(page);
  await page.addInitScript(() => { try { localStorage.setItem("tms-mode", "pro"); } catch {} });
  await page.goto("/panel");
  await page.click("#scenario-btn");
  await expect(page.locator(".toast").filter({ hasText: "long planına uymadı" }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
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
      expect(await page.evaluate(() => document.body.dataset.mode)).toBe(p === "/terminal" ? "pro" : mode);
      if (p === "/terminal") await page.evaluate((m) => localStorage.setItem("tms-mode", m), mode);
      const visiblePro = await page.locator(".pro-only:visible").count();
      if (mode === "basic" && p !== "/terminal") expect(visiblePro, `${p} Basic'te görünen Pro alanı`).toBe(0);
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
  await page.goto("/kesfet?tab=dex");
  await page.selectOption("#scan-chain", "56");
  await page.fill("#scan-addr", "0x000000000000000000000000000000000000dEaD");
  await page.getByRole("button", { name: "Tara", exact: true }).click();
  await expect(page.locator("#scan-result")).toContainText("BLOCK");
  await page.fill("#scan-addr", "0x123");
  await page.getByRole("button", { name: "Tara", exact: true }).click();
  await expect(page.locator("#scan-result")).toContainText("40 hex");
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

test("Güncelleme2 madde 2 (+G3): çekmece AI analizi, Trend çizgisi ve Mentor işlemi düğmeleri (varsayılan kapalı)", async ({ page }) => {
  await waitForScan(page);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.goto("/isi-haritasi?s=TRX-USDT");
    const drawer = page.getByRole("dialog");
    await expect(drawer.locator(".ai-card")).toContainText("AI analizi");
    await expect(drawer.locator(".ai-card")).toContainText("Vadeli");
    await expect(drawer.locator(".ai-card")).toContainText("Hold / arz");
    const lv = drawer.getByRole("button", { name: "Mentor işlemi" });
    await expect(lv).toHaveAttribute("aria-pressed", "false");
    await expect(drawer.getByRole("button", { name: "Seviyeler" })).toHaveCount(0);
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

test("Güncelleme2 madde 5: CEX araması (öneri, klavye, / odak), parite sekmeleri ve URL; DEX adres doğrulaması", async ({ page }) => {
  await waitForScan(page);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.goto("/kesfet");
    await page.keyboard.press("/");
    await expect(page.locator("#cex-q")).toBeFocused();
    await page.keyboard.type("so");
    await expect(page.locator("#cex-list li").first()).toContainText("SOL");
    await page.keyboard.press("Enter");
    await expect(page.locator(".pair-tabs")).toContainText("SOL-USDT");
    await page.locator('.pair-tabs [data-pair="SOL-USDC"]').click();
    await expect(page).toHaveURL(/tab=cex&s=SOL-USDC/);
    await expect(page.locator("#cex-view")).toContainText("işlem izin listesinde değil");
    await expect(page.locator("#cex-view .ai-card")).toContainText("AI analizi");
    await expect(page.locator("#cex-view")).toContainText("USDT karşılığı");
    await page.screenshot({ path: `${SHOTS}/g2-madde5-cex-${width}.png`, fullPage: true });
  }
  await page.goto("/kesfet?tab=cex&s=SOL-USDT");
  await expect(page.locator("#cex-view")).toContainText("işlem izin listesinde");
  await page.goto("/kesfet?tab=dex");
  await page.selectOption("#scan-chain", "solana");
  await page.fill("#scan-addr", "0x123");
  await page.getByRole("button", { name: "Tara", exact: true }).click();
  await expect(page.locator("#scan-result")).toContainText("base58");
  await page.fill("#dex-name", "PEPE");
  await page.getByRole("button", { name: "Ada göre ara" }).click();
  await expect(page.locator("#dex-name-result")).toContainText("Aynı isimli sahte tokenlar olabilir");
  await page.screenshot({ path: `${SHOTS}/g2-madde5-dex-1440.png` });
});

test("Güncelleme2 madde 6: güvenlik tablosu (kaynak sütunları, özet filtreleri, BLOCK, Timos kararı, ham değerler)", async ({ page }) => {
  await waitForScan(page);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.goto("/kesfet?tab=dex&chain=56&ca=0x000000000000000000000000000000000000dEaD");
    const box = page.locator("#scan-result");
    await expect(box.locator(".verdict")).toHaveText("BLOCK");
    for (const h of ["GoPlus", "Honeypot.is", "OKX OnchainOS", "Timos kararı"]) await expect(box.locator("thead")).toContainText(h);
    await expect(box).toContainText("Tehlike (");
    await expect(box.locator(".sec-row")).toHaveCount(13);
    await box.getByRole("button", { name: /^Tehlike/ }).click();
    const visible = await box.locator(".sec-row:visible").count();
    expect(visible).toBeLessThan(13);
    await box.getByRole("button", { name: /^Tehlike/ }).click();
    const first = box.locator(".sec-row").first();
    await first.locator("td").first().click();
    await expect(box.locator('[data-raw="0"]')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/g2-madde6-guvenlik-${width}.png`, fullPage: true });
  }
  await expect(page).toHaveURL(/tab=dex&chain=56&ca=0x/);
});

test("Güncelleme2 madde 7: arz dedektörü Keşfet CEX görünümünde ve ısı haritası çekmecesinde", async ({ page }) => {
  await waitForScan(page);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.goto("/kesfet?tab=cex&s=AVAX-USDT");
    const sup = page.locator("#cex-supply");
    await expect(sup).toContainText("Arz baskısı");
    await expect(sup).toContainText("tahmini (MC/fiyat)");
    await expect(sup).toContainText("30 / 90 gün açılım");
    await expect(sup.locator(".supply-chart canvas").first()).toBeVisible();
    await sup.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/g2-madde7-arz-${width}.png` });
  }
  await page.goto("/isi-haritasi?s=ARB-USDT");
  await expect(page.getByRole("dialog").locator("#dr-supply")).toContainText("Arz baskısı");
});

test("Güncelleme2 madde 8: Long/Short kartı (Özet/Kategori/Coin, kaynak etiketleri, güncelleme zamanı)", async ({ page }) => {
  await waitForScan(page);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.goto("/isi-haritasi");
    const box = page.locator("#ls-box");
    for (const g of ["BTC", "ETH", "Top 10", "Top 20", "All", "Ex Top 20"]) await expect(box.locator("tbody")).toContainText(g);
    await expect(box.locator("thead")).toContainText("Binance üst · hesap");
    await expect(box).toContainText("Güncelleme:");
    await box.getByRole("tab", { name: "Kategori" }).click();
    await expect(box.locator("tbody")).toContainText("Layer 1");
    await box.getByRole("tab", { name: "Coin" }).click();
    await expect(box.locator("tbody tr")).toHaveCount(28);
    await box.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/g2-madde8-ls-${width}.png` });
  }
});

test("Güncelleme2 madde 9: Pro Terminal düzeni ve gündüz/gece (4 palet, tercih saklanır)", async ({ page }) => {
  await waitForScan(page);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.goto("/terminal");
    expect(await page.evaluate(() => document.body.dataset.mode)).toBe("pro");
    await expect(page.locator("#tw-body tr").first()).toBeVisible();
    await expect(page.locator("#tc-chart .tv-box canvas").first()).toBeVisible();
    await expect(page.locator("#ob-box")).toContainText("Fiyat");
    await expect(page.locator("#ls2-box")).toContainText("OKX hesap");
    for (const t of ["Pozisyonlar", "Emir geçmişi", "Paper istatistikleri", "Güvenlik taraması", "ATK çağrı günlüğü"]) await expect(page.getByRole("tab", { name: t })).toBeVisible();
    await page.getByRole("tab", { name: "Paper istatistikleri" }).click();
    await expect(page.locator("#tb-box")).toContainText("Kazanma oranı");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${SHOTS}/g2-madde9-terminal-${width}.png`, fullPage: width === 1440 });
  }
  // gündüz/gece
  const before = await page.evaluate(() => document.body.dataset.theme);
  await page.getByRole("button", { name: /moduna geç/ }).click();
  const theme = before === "light" ? "dark" : "light";
  await expect.poll(() => page.evaluate(() => document.body.dataset.theme)).toBe(theme);
  expect(await page.evaluate(() => localStorage.getItem("tms-theme"))).toBe(theme);
  await page.reload();
  expect(await page.evaluate(() => document.body.dataset.theme)).toBe(theme);
  await page.screenshot({ path: `${SHOTS}/g2-madde9-terminal-${theme}.png` });
  // Terminal'de Basic → Panel
  await page.getByRole("button", { name: "Basic" }).click();
  await expect(page).toHaveURL(/\/panel$/);
  await page.screenshot({ path: `${SHOTS}/g2-madde9-basic-${theme}.png` });
});

// ---------------- GÜNCELLEME 3 ----------------
test("G3 EK 1b: favoriler + Diğer ▾ + yıldız + ?tf= kalıcılığı + Pro 1-7 + sola kaydırma + rozetler değişmez", async ({ page, context }) => {
  await waitForScan(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => { try { localStorage.setItem("tms-mode", "basic"); } catch {} });
  await page.goto("/kesfet?tab=cex&s=AVAX-USDT");
  const bars = page.locator(".tf-bars [data-bar]");
  await expect(bars).toHaveText(["15dk", "1s", "4s", "1g", "1h"]); // Basic favorileri
  await bars.filter({ hasText: "15dk" }).click();
  await expect(page).toHaveURL(/tf=15m/);
  await bars.filter({ hasText: "4s" }).click();
  await expect(page).toHaveURL(/tf=4H/);
  await page.locator("[data-layer=setup]").click();
  await expect(page.locator(".setup-card .mtf-b")).toHaveCount(4);
  const badges = await page.locator(".setup-card .mtf-b").allTextContents();
  await page.locator("[data-more]").click();
  await expect(page.locator(".tf-menu")).toBeVisible();
  await page.locator('[data-pick="1M"]').click();
  await expect(page).toHaveURL(/tf=1M/);
  await expect(page.locator("[data-more]")).toContainText("1a");
  await expect(page.locator(".chart-note")).toContainText("1Mutc");
  await expect(page.locator(".setup-card .mtf-b")).toHaveText(badges); // MTF analizi grafik aralığından bağımsız
  await page.locator("[data-more]").click();
  await page.locator('[data-star="2H"]').click();
  await expect(bars).toHaveText(["15dk", "1s", "2s", "4s", "1g", "1h"]);
  await page.screenshot({ path: `${SHOTS}/g3-1b-diger-1440.png` });
  // yeni sekme: ?tf=4H açılır, sonra başka sayfaya geçince seçim korunur
  const p2 = await context.newPage();
  await p2.goto("/terminal?s=AVAX-USDT&tf=4H");
  await expect(p2.locator('.tf-bars [data-bar="4H"]')).toHaveAttribute("aria-pressed", "true");
  await p2.goto("/kesfet");
  expect(await p2.evaluate(() => (window as any).TimosAI.currentTf())).toBe("4H");
  await p2.close();
  // Pro: 7 favori ve 1-7 tuşları
  await page.evaluate(() => localStorage.setItem("tms-mode", "pro"));
  await page.addInitScript(() => { try { localStorage.setItem("tms-mode", "pro"); } catch {} });
  await page.goto("/terminal?s=AVAX-USDT");
  await expect(bars).toHaveText(["1dk", "5dk", "15dk", "1s", "4s", "1g", "1h"]); // Pro favorileri (ayrı kayıt)
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("1");
  await expect(page).toHaveURL(/tf=1m/);
  await page.keyboard.press("5");
  await expect(page).toHaveURL(/tf=4H/);
  // sola kaydırma: eski mumlar yüklenir
  const before = await page.evaluate(() => (window as any).TimosAI.activeChart().count);
  const box = (await page.locator(".tv-box").boundingBox())!;
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
  }
  await expect.poll(() => page.evaluate(() => (window as any).TimosAI.activeChart().count)).toBeGreaterThan(before);
});

test("G3 madde 1: Mentor işlemi kartı (360/1440), sabit ibare, Plana ekle", async ({ page }) => {
  await waitForScan(page);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.goto("/terminal?s=SOL-USDT&tf=1H");
    await page.locator("[data-layer=setup]").click();
    const card = page.locator(".setup-card");
    await expect(card).toContainText("Mentor işlemi");
    await expect(card).toContainText("Ajan kurulum taslağı; yatırım tavsiyesi değildir.");
    await expect(card).not.toContainText(/Seviyeler/);
    await expect(page.locator("[data-layer=levels]")).toHaveCount(0);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/g3-madde1-mentor-islemi-${width}.png` });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(sw).toBeLessThanOrEqual(width);
  }
  const s = await (await page.request.get("/api/setup/SOL-USDT")).json();
  expect(s.disclaimer).toBe("Ajan kurulum taslağı; yatırım tavsiyesi değildir.");
  expect(s.frames.map((f: any) => f.tf)).toEqual(["15m", "1H", "4H", "1D"]);
  const add = await page.request.post("/api/trading-plan/add", { data: { instId: "SOL-USDT" } });
  expect((await add.json()).plan.coins).toContain("SOL-USDT");
});

test("G3 madde 3: Planım (Basic sade / Pro tam), kaydet → limitler plana göre", async ({ page }) => {
  await waitForScan(page);
  for (const [mode, width] of [["basic", 360], ["pro", 1440]] as const) {
    await page.addInitScript((m) => { try { localStorage.setItem("tms-mode", m); } catch {} }, mode);
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.goto("/panel");
    const card = page.locator("#planim");
    await expect(card.locator("#plan-coin-list .plan-coin").first()).toBeVisible();
    await expect(card.locator('[name="maxLeverage"]')).toBeVisible({ visible: mode === "pro" });
    await card.screenshot({ path: `${SHOTS}/g3-madde3-planim-${mode}-${width}.png` });
  }
  const card = page.locator("#planim");
  await card.locator("#plan-coin-q").fill("SOL");
  await expect(card.locator(".plan-coin")).toHaveCount(1);
  await card.locator('[name="maxPositions"]').fill("2");
  await card.locator('[name="maxOrderUsdt"]').fill("60");
  await card.locator('button[type="submit"]').click();
  await expect(page.locator(".toast").last()).toContainText("Plan kaydedildi");
  const c = await (await page.request.get("/api/contract")).json();
  expect(c.limits.maxOpenPositions).toBe(2);
  expect(c.limits.maxOrderNotionalUsdt).toBe(60);
  expect(JSON.stringify(c)).not.toMatch(/maxOrderNotionalUsdt":5,/);
});

test("G3 madde 4: Basic emir defteri, Pro filtreli ayrıntılı günlük", async ({ page }) => {
  await waitForScan(page);
  await page.addInitScript(() => { try { localStorage.setItem("tms-mode", "basic"); } catch {} });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/panel");
  await expect(page.locator("#order-log-card")).toBeVisible();
  await expect(page.locator("#ev-h")).toBeHidden();
  await page.locator("#order-log-card").screenshot({ path: `${SHOTS}/g3-madde4-emir-defteri-360.png` });
  await page.addInitScript(() => { try { localStorage.setItem("tms-mode", "pro"); } catch {} });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/panel");
  await expect(page.locator("#order-log-card")).toBeHidden();
  await page.locator('[data-ev="uyarı"]').click();
  await expect(page.locator('[data-ev="uyarı"]')).toHaveAttribute("aria-pressed", "true");
  const kinds = await page.locator("#ev-list li[data-kind]:not([hidden])").evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
  expect(kinds.filter((k) => k !== "uyarı")).toEqual([]);
  await page.locator("#ev-list").screenshot({ path: `${SHOTS}/g3-madde4-pro-gunluk-1440.png` });
});

test("G3 madde 6: 7 gün kurulum özeti ve 'Bu planı son 30 günde test et'", async ({ page }) => {
  await waitForScan(page);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.goto("/panel");
    await expect(page.locator("#setup-stats")).toContainText(/Son 7 gün: \d+ kurulum · %\d+ hedefe ulaştı · ort\./);
    await page.locator("#bt-run").click();
    await expect(page.locator("#bt-out")).toContainText("Geçmiş performans geleceği garanti etmez.");
    await expect(page.locator("#bt-out")).toContainText("ileriye bakış yok");
    await page.locator(".plan-perf").screenshot({ path: `${SHOTS}/g3-madde6-backtest-${width}.png` });
  }
});
