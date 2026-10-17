// Cevap modu: kısa (varsayılan) ya da ayrıntılı. Modele yalnızca güvenilmez; bayrak kodda hesaplanır ve uygulanır.
export const DETAIL_RE = /(detay|ayr[ıi]nt|a[çc][ıi]kla|neden|niye|ad[ıi]m\s*ad[ıi]m|derinlemesine|daha\s*fazla|anlat)/i;

export interface DetailOpts {
  detail?: boolean; // arayüzde/Telegram'da "Ayrıntı" düğmesi
  mode?: "basic" | "pro"; // Pro modunda ayrıntılı
}

export function wantsDetail(text: string, opts: DetailOpts = {}): boolean {
  return opts.detail === true || opts.mode === "pro" || DETAIL_RE.test(text.toLocaleLowerCase("tr"));
}

export const SHORT_MAX_TOKENS = 220;
export const DETAIL_MAX_TOKENS = 800;
export const SHORT_WORD_LIMIT = 120;

/** Cümlelere böler: yalnızca noktalama + boşluk + büyük harf cümle sonu sayılır (105.02 gibi sayılar bölünmez). */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…])\s+(?=[A-ZÇĞİÖŞÜ0-9"'(])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Kısa modda cevap 120 kelimeyi aşarsa yeniden özetleme çağrısı yapılmaz; ilk 4 cümle gönderilir. */
export function enforceShort(text: string): { text: string; trimmed: boolean } {
  if (wordCount(text) <= SHORT_WORD_LIMIT) return { text, trimmed: false };
  return { text: splitSentences(text).slice(0, 4).join(" "), trimmed: true };
}
