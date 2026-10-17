// .env okuyucu: harici paket yok. Dosya yoksa çökmez, ilgili özellik "kapalı" görünür.
import fs from "node:fs";
import path from "node:path";

export const SECRET_KEYS = [
  "GEMINI_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "OKX_API_KEY",
  "OKX_API_SECRET",
  "OKX_API_PASSPHRASE",
  "ANTHROPIC_API_KEY",
] as const;

export interface AppEnv {
  port: number;
  atkMode: "live" | "mock";
  okxSite: string;
  live: boolean;
  autonomous: boolean;
  scanIntervalSec: number;
  paperBalanceUsdt: number;
  okx: { apiKey: string; secret: string; passphrase: string };
  mentorProvider: "gemini" | "claude" | "rule";
  mentorModel: string;
  claudeModel: string;
  mentorHourlyLimit: number;
  geminiKey: string;
  anthropicKey: string;
  telegramToken: string;
  telegramAllowedUserId: string;
  envFileFound: boolean;
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

const bool = (v: string | undefined, def: boolean) => (v === undefined || v === "" ? def : /^(1|true|yes|evet|on)$/i.test(v));
const num = (v: string | undefined, def: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : def;
};

export function loadEnv(opts: { file?: string; source?: Record<string, string | undefined> } = {}): AppEnv {
  const file = opts.file ?? (process.env.ENV_FILE ? path.resolve(process.env.ENV_FILE) : path.resolve(process.cwd(), ".env"));
  let fromFile: Record<string, string> = {};
  let envFileFound = false;
  try {
    if (fs.existsSync(file)) {
      fromFile = parseEnvFile(fs.readFileSync(file, "utf8"));
      envFileFound = true;
    }
  } catch {
    envFileFound = false;
  }
  const src = opts.source ?? process.env;
  const get = (k: string) => (src[k] !== undefined && src[k] !== "" ? src[k] : fromFile[k]) ?? "";
  const provider = get("MENTOR_PROVIDER").toLowerCase();
  return {
    port: num(get("PORT"), 3000),
    atkMode: get("ATK_MODE") === "mock" ? "mock" : "live",
    okxSite: get("OKX_SITE") || "tr",
    live: bool(get("LIVE"), false),
    autonomous: bool(get("AUTONOMOUS"), true),
    scanIntervalSec: Math.max(10, num(get("SCAN_INTERVAL_SEC"), 30)),
    paperBalanceUsdt: Math.max(1, num(get("PAPER_BALANCE_USDT"), 30)),
    okx: { apiKey: get("OKX_API_KEY"), secret: get("OKX_API_SECRET"), passphrase: get("OKX_API_PASSPHRASE") },
    mentorProvider: provider === "claude" ? "claude" : provider === "rule" ? "rule" : "gemini",
    mentorModel: get("MENTOR_MODEL"),
    claudeModel: get("CLAUDE_MODEL"),
    mentorHourlyLimit: Math.max(1, num(get("MENTOR_HOURLY_LIMIT"), 60)),
    geminiKey: get("GEMINI_API_KEY"),
    anthropicKey: get("ANTHROPIC_API_KEY"),
    telegramToken: get("TELEGRAM_BOT_TOKEN"),
    telegramAllowedUserId: get("TELEGRAM_ALLOWED_USER_ID"),
    envFileFound,
  };
}

/** Bütün sır değerleri (maskelemek için). */
export function secretValues(env: AppEnv): string[] {
  return [env.geminiKey, env.anthropicKey, env.telegramToken, env.okx.apiKey, env.okx.secret, env.okx.passphrase].filter(
    (v) => typeof v === "string" && v.length >= 4,
  );
}

/** Eksik satırları adlarıyla döndürür; değerleri asla döndürmez. */
export function missingEnvLines(env: AppEnv): string[] {
  const m: string[] = [];
  if (!env.geminiKey) m.push("GEMINI_API_KEY");
  if (!env.telegramToken) m.push("TELEGRAM_BOT_TOKEN");
  if (!env.telegramAllowedUserId) m.push("TELEGRAM_ALLOWED_USER_ID");
  if (!env.okx.apiKey) m.push("OKX_API_KEY");
  if (!env.okx.secret) m.push("OKX_API_SECRET");
  if (!env.okx.passphrase) m.push("OKX_API_PASSPHRASE");
  return m;
}

export function hasOkxKeys(env: AppEnv): boolean {
  return Boolean(env.okx.apiKey && env.okx.secret && env.okx.passphrase);
}
