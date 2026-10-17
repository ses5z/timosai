// Bildirim politikası (kesin): bot kendiliğinden aday yağdırmaz.
// (1) takip edilen/elde tutulan coin gelişmeleri: sembol başına 30 dk'da 1, saatte en fazla 6, aynı içerik tekrar yok
// (2) sohbet  (3) kritik (stop/hedef, günlük zarar). Uyarı penceresinin karşılığı: tek kısa mesaj.
import crypto from "node:crypto";
import type { NotifyMessage } from "../ports.js";
import type { NotificationSettings } from "../state/store.js";

export interface PolicyContext {
  follows: string[];
  held: string[];
  settings: NotificationSettings;
}

export interface PolicyDecision {
  send: boolean;
  reason: string;
}

export class NotifyPolicy {
  private perSymbol = new Map<string, number>();
  private sentTimes: number[] = [];
  private seen = new Map<string, number>();

  constructor(
    private readonly now: () => number = Date.now,
    readonly limits = { perSymbolMs: 30 * 60_000, perHour: 6, dedupeMs: 6 * 3_600_000 },
  ) {}

  private hash(m: NotifyMessage): string {
    return crypto.createHash("sha1").update(`${m.kind}|${m.symbol ?? ""}|${m.text}`).digest("hex");
  }

  decide(m: NotifyMessage, c: PolicyContext): PolicyDecision {
    const t = this.now();
    if (m.kind === "chat") return { send: true, reason: "sohbet" };
    const h = this.hash(m);
    const seenAt = this.seen.get(h);
    if (seenAt !== undefined && t - seenAt < this.limits.dedupeMs) return { send: false, reason: "aynı içerik" };
    const quiet = c.settings.quietUntil > t;
    if (m.kind === "critical") {
      if (!c.settings.critical) return { send: false, reason: "kritik bildirimler kapalı" };
      this.seen.set(h, t);
      return { send: true, reason: "kritik" };
    }
    if (quiet) return { send: false, reason: "sessiz mod" };
    if (m.kind === "warning") {
      this.seen.set(h, t);
      return { send: true, reason: "uyarı" };
    }
    if (m.kind === "market") {
      // Genel piyasa bildirimi (ör. kategori long oranı): takip şartı yok, normal saatlik sınır geçerli.
      if (!c.settings.developments) return { send: false, reason: "gelişme bildirimleri kapalı" };
      this.sentTimes = this.sentTimes.filter((x) => t - x < 3_600_000);
      if (this.sentTimes.length >= this.limits.perHour) return { send: false, reason: "saatlik sınır" };
      this.sentTimes.push(t);
      this.seen.set(h, t);
      return { send: true, reason: "piyasa" };
    }
    // gelişme
    if (!c.settings.developments) return { send: false, reason: "gelişme bildirimleri kapalı" };
    if (!m.symbol || (!c.follows.includes(m.symbol) && !c.held.includes(m.symbol))) return { send: false, reason: "takip dışı coin" };
    const last = this.perSymbol.get(m.symbol);
    if (last !== undefined && t - last < this.limits.perSymbolMs) return { send: false, reason: "sembol başına 30 dk sınırı" };
    this.sentTimes = this.sentTimes.filter((x) => t - x < 3_600_000);
    if (this.sentTimes.length >= this.limits.perHour) return { send: false, reason: "saatlik sınır" };
    this.perSymbol.set(m.symbol, t);
    this.sentTimes.push(t);
    this.seen.set(h, t);
    return { send: true, reason: "gelişme" };
  }
}
