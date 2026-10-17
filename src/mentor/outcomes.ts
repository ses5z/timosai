// Kurulum sonuç takibi: Mentor işlemi kartında gösterilen her kurulumun sonucu (hedef 1 / hedef 2 / stop / süre doldu)
// sonraki fiyatlarla izlenir. "Son 7 gün: n kurulum · %x hedefe ulaştı · ort. R".
import type { Setup } from "./setup.js";

export interface TrackedSetup {
  id: string;
  instId: string;
  direction: "LONG" | "SHORT";
  entry: number;
  stop: number;
  target1: number;
  target2: number;
  rr2: number;
  openedAt: number;
  expiresAt: number;
  hitT1: boolean;
  outcome: "açık" | "hedef 1" | "hedef 2" | "stop" | "süre doldu";
  r: number | null;
  closedAt: number | null;
}

const EXPIRY_H: Record<string, number> = { scalp: 12, swing: 72, pozisyon: 240 };

export class SetupTracker {
  list: TrackedSetup[] = [];

  /** Seviyeli kurulumu kaydeder; aynı coin ve yönde açık kurulum varsa tekrar eklemez. */
  record(s: Setup, now = Date.now()): TrackedSetup | null {
    if (!s.showLevels || !s.direction || !s.entryZone || s.stop === null || s.target1 === null || s.target2 === null) return null;
    if (this.list.some((t) => t.instId === s.instId && t.direction === s.direction && t.outcome === "açık")) return null;
    const t: TrackedSetup = { id: `${s.instId}:${now}`, instId: s.instId, direction: s.direction, entry: (s.entryZone[0] + s.entryZone[1]) / 2, stop: s.stop, target1: s.target1, target2: s.target2, rr2: s.rr2 ?? 2.5, openedAt: now, expiresAt: now + (EXPIRY_H[s.horizon] ?? 72) * 3_600_000, hitT1: false, outcome: "açık", r: null, closedAt: null };
    this.list.push(t);
    if (this.list.length > 500) this.list.shift();
    return t;
  }

  /** Fiyat güncellemesi: sonuçları çözer. Dönen dizi: bu güncellemede kapanan kurulumlar. */
  update(prices: Map<string, number>, now = Date.now()): TrackedSetup[] {
    const closed: TrackedSetup[] = [];
    for (const t of this.list) {
      if (t.outcome !== "açık") continue;
      const px = prices.get(t.instId);
      if (px === undefined) continue;
      const sign = t.direction === "LONG" ? 1 : -1;
      const R = Math.abs(t.entry - t.stop);
      if (sign * (px - t.stop) <= 0) this.close(t, t.hitT1 ? "hedef 1" : "stop", t.hitT1 ? 1.5 : -1, now);
      else if (sign * (px - t.target2) >= 0) this.close(t, "hedef 2", t.rr2, now);
      else {
        if (!t.hitT1 && sign * (px - t.target1) >= 0) t.hitT1 = true;
        if (now >= t.expiresAt) this.close(t, t.hitT1 ? "hedef 1" : "süre doldu", t.hitT1 ? 1.5 : Math.round(((sign * (px - t.entry)) / R) * 100) / 100, now);
      }
      if (t.outcome !== "açık") closed.push(t);
    }
    return closed;
  }

  private close(t: TrackedSetup, o: TrackedSetup["outcome"], r: number, now: number): void {
    t.outcome = o;
    t.r = r;
    t.closedAt = now;
  }

  stats(days = 7, now = Date.now()): { setups: number; closed: number; hitPct: number; avgR: number; open: number; text: string } {
    const xs = this.list.filter((t) => t.openedAt >= now - days * 86_400_000);
    const done = xs.filter((t) => t.outcome !== "açık");
    const hit = done.filter((t) => t.outcome === "hedef 1" || t.outcome === "hedef 2").length;
    const hitPct = done.length ? Math.round((hit / done.length) * 100) : 0;
    const avgR = done.length ? Math.round((done.reduce((s, t) => s + (t.r ?? 0), 0) / done.length) * 100) / 100 : 0;
    const text = `Son ${days} gün: ${xs.length} kurulum · %${hitPct} hedefe ulaştı · ort. ${avgR >= 0 ? "+" : ""}${avgR}R${done.length < xs.length ? ` (${xs.length - done.length} açık)` : ""}`;
    return { setups: xs.length, closed: done.length, hitPct, avgR, open: xs.length - done.length, text };
  }
}
