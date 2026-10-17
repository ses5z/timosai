// SignalLedger: sha256 zincirli karar/emir/ATK çağrı kaydı.
import crypto from "node:crypto";
import { mask } from "../util/log.js";

export type LedgerKind = "atk" | "decision" | "order" | "position" | "warning" | "event" | "plan";

export interface LedgerEntry {
  seq: number;
  ts: number;
  kind: LedgerKind;
  data: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface AtkCallRecord {
  tool: string;
  params: string;
  result: string;
  ok: boolean;
  ms: number;
  ts: number;
}

const GENESIS = "0".repeat(64);

export function hashEntry(seq: number, ts: number, kind: string, data: unknown, prevHash: string): string {
  return crypto.createHash("sha256").update(`${seq}|${ts}|${kind}|${JSON.stringify(data)}|${prevHash}`).digest("hex");
}

export class SignalLedger {
  private entries: LedgerEntry[] = [];
  private head = GENESIS;
  private seq = 0;
  private atkTotal = 0;
  private atkErrors = 0;
  private atkByTool = new Map<string, number>();
  private atkRecent: AtkCallRecord[] = [];
  private listeners: ((e: LedgerEntry) => void)[] = [];

  constructor(private readonly cap = 4000) {}

  onAppend(fn: (e: LedgerEntry) => void): void {
    this.listeners.push(fn);
  }

  append(kind: LedgerKind, data: Record<string, unknown>): LedgerEntry {
    const clean = JSON.parse(mask(JSON.stringify(data))) as Record<string, unknown>;
    const seq = ++this.seq;
    const ts = Date.now();
    const hash = hashEntry(seq, ts, kind, clean, this.head);
    const entry: LedgerEntry = { seq, ts, kind, data: clean, prevHash: this.head, hash };
    this.head = hash;
    this.entries.push(entry);
    if (this.entries.length > this.cap) this.entries.splice(0, this.entries.length - this.cap);
    for (const l of this.listeners) l(entry);
    return entry;
  }

  recordAtk(rec: Omit<AtkCallRecord, "ts">): void {
    const full = { ...rec, ts: Date.now() };
    this.atkTotal++;
    if (!rec.ok) this.atkErrors++;
    this.atkByTool.set(rec.tool, (this.atkByTool.get(rec.tool) ?? 0) + 1);
    this.atkRecent.push(full);
    if (this.atkRecent.length > 200) this.atkRecent.shift();
    this.append("atk", { ...full });
  }

  atkStats() {
    return {
      total: this.atkTotal,
      errors: this.atkErrors,
      byTool: Object.fromEntries([...this.atkByTool.entries()].sort((a, b) => b[1] - a[1])),
      recent: this.atkRecent.slice(-40).reverse(),
    };
  }

  headHash(): string {
    return this.head;
  }

  count(): number {
    return this.seq;
  }

  list(kinds?: LedgerKind[], limit = 100): LedgerEntry[] {
    const src = kinds ? this.entries.filter((e) => kinds.includes(e.kind)) : this.entries;
    return src.slice(-limit).reverse();
  }

  /** Bellekteki penceredeki zinciri doğrular. */
  verify(): boolean {
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (i > 0 && e.prevHash !== this.entries[i - 1].hash) return false;
      if (hashEntry(e.seq, e.ts, e.kind, e.data, e.prevHash) !== e.hash) return false;
    }
    return true;
  }
}
