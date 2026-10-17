// Maskeli günlük: kayıtlı sır değerleri hiçbir çıktıya düşmez.
let secrets: string[] = [];

export function registerSecrets(values: string[]): void {
  secrets = [...new Set(values.filter((v) => v && v.length >= 4))].sort((a, b) => b.length - a.length);
}

export function mask(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join("***");
  // Telegram bot URL'si gibi kalıplar için ek güvenlik
  out = out.replace(/bot\d{6,}:[A-Za-z0-9_-]{20,}/g, "bot***");
  out = out.replace(/(key=)[A-Za-z0-9_-]{16,}/gi, "$1***");
  return out;
}

function fmt(args: unknown[]): string {
  return mask(
    args
      .map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a)))
      .join(" "),
  );
}

let quiet = false;
export function setQuiet(q: boolean): void {
  quiet = q;
}

export const log = {
  info: (...a: unknown[]) => {
    if (!quiet) console.log(`[${new Date().toISOString().slice(11, 19)}] ${fmt(a)}`);
  },
  warn: (...a: unknown[]) => {
    if (!quiet) console.warn(`[${new Date().toISOString().slice(11, 19)}] UYARI ${fmt(a)}`);
  },
  error: (...a: unknown[]) => {
    if (!quiet) console.error(`[${new Date().toISOString().slice(11, 19)}] HATA ${fmt(a)}`);
  },
};
