import { defineConfig } from "@playwright/test";

// Varsayılan olarak bilgisayarda kurulu Microsoft Edge kullanılır (tarayıcı indirmeye gerek yok).
// Playwright'ın kendi Chromium'u için: PW_CHANNEL=chromium npx playwright install chromium
const channel = process.env.PW_CHANNEL ?? "msedge";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3123", headless: true, ...(channel === "chromium" ? {} : { channel }) },
  webServer: {
    command: "npx tsx src/server.ts",
    url: "http://127.0.0.1:3123/api/status",
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PORT: "3123", ATK_MODE: "mock", ENV_FILE: "/nonexistent/.env", SCAN_INTERVAL_SEC: "15", AUTONOMOUS: "false", QUICK_COMMANDS: "false" },
  },
});
