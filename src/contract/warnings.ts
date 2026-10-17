// Uyarı merkezi: bilgilendirir ve uyarır (tek düğme: Tamam). Aynı uyarı 60 sn içinde tekrar çıkmaz.
import crypto from "node:crypto";
import type { ContractItem } from "./contract.js";

export type WarningKind = "ajan_engelledi" | "gunluk_zarar" | "risk_skoru" | "liste_15" | "limite_yakin" | "devre_kesici";

export interface AppWarning {
  id: string;
  kind: WarningKind;
  title: string;
  text: string;
  items: ContractItem[];
  riskScore: number;
  ts: number;
}

export class WarningCenter {
  private last = new Map<string, number>();
  private history: AppWarning[] = [];
  private counts = new Map<WarningKind, number>();
  private listeners: ((w: AppWarning) => void)[] = [];

  constructor(
    private readonly dedupeMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  onWarning(fn: (w: AppWarning) => void): void {
    this.listeners.push(fn);
  }

  /** Uyarı üretir; 60 sn içinde aynı (tür+anahtar) uyarı varsa null döner. Hiçbir şeyi kilitlemez. */
  raise(kind: WarningKind, key: string, title: string, text: string, items: ContractItem[], riskScore: number): AppWarning | null {
    const k = `${kind}:${key}`;
    const t = this.now();
    const prev = this.last.get(k);
    if (prev !== undefined && t - prev < this.dedupeMs) return null;
    this.last.set(k, t);
    const w: AppWarning = { id: crypto.randomUUID().slice(0, 8), kind, title, text, items, riskScore: Math.round(riskScore), ts: t };
    this.history.push(w);
    if (this.history.length > 200) this.history.shift();
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
    for (const l of this.listeners) l(w);
    return w;
  }

  list(limit = 30): AppWarning[] {
    return this.history.slice(-limit).reverse();
  }

  total(): number {
    return this.history.length;
  }

  count(kind: WarningKind): number {
    return this.counts.get(kind) ?? 0;
  }
}
