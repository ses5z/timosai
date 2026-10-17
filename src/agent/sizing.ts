// Boyutlandırma ve plan: ajan, mentor ve panel AYNI fonksiyonları kullanır.
import type { HardLimits } from "../trading/hardLimits.js";
import { round } from "../util/math.js";

export interface SizeInput {
  equityUsdt: number;
  riskPct: number; // işlem başına riske edilen özsermaye yüzdesi
  entry: number;
  stop: number;
  openNotionalUsdt: number;
  limits: HardLimits;
}

export interface SizeResult {
  notionalUsdt: number;
  qty: number;
  riskUsdt: number;
  stopPct: number;
  cappedBy: "risk" | "tek emir limiti" | "toplam açık limit" | "yetersiz";
  explain: string;
}

export const MIN_ORDER_USDT = 1;

export function sizePosition(i: SizeInput): SizeResult {
  const stopPct = i.entry > 0 && i.stop < i.entry ? ((i.entry - i.stop) / i.entry) * 100 : 0;
  if (stopPct <= 0) return { notionalUsdt: 0, qty: 0, riskUsdt: 0, stopPct: 0, cappedBy: "yetersiz", explain: "Stop girişin altında olmalı." };
  const riskBudget = (i.equityUsdt * i.riskPct) / 100;
  let notional = riskBudget / (stopPct / 100);
  let cappedBy: SizeResult["cappedBy"] = "risk";
  if (notional > i.limits.maxOrderNotionalUsdt) {
    notional = i.limits.maxOrderNotionalUsdt;
    cappedBy = "tek emir limiti";
  }
  const room = Math.max(0, i.limits.maxTotalOpenUsdt - i.openNotionalUsdt);
  if (notional > room) {
    notional = room;
    cappedBy = "toplam açık limit";
  }
  if (notional < MIN_ORDER_USDT) {
    return { notionalUsdt: 0, qty: 0, riskUsdt: 0, stopPct: round(stopPct, 2), cappedBy: "yetersiz", explain: `Boyut ${MIN_ORDER_USDT} USDT altına düşüyor; işlem anlamsız.` };
  }
  notional = Math.floor(notional * 100 + 1e-6) / 100;
  const riskUsdt = round(notional * (stopPct / 100), 3);
  return {
    notionalUsdt: notional,
    qty: notional / i.entry,
    riskUsdt,
    stopPct: round(stopPct, 2),
    cappedBy,
    explain: `Risk bütçesi ${round(riskBudget, 3)} USDT (özsermayenin %${i.riskPct}'i). Stop %${stopPct.toFixed(2)} uzakta → ${round(riskBudget / (stopPct / 100), 2)} USDT; ${cappedBy === "risk" ? "limitlerin içinde" : cappedBy + " ile kırpıldı"} → ${notional.toFixed(2)} USDT. Stop olursa kayıp ≈ ${riskUsdt} USDT.`,
  };
}

export interface PlanRow {
  instId: string;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  notionalUsdt: number;
  riskUsdt: number;
  note: string;
  included: boolean;
}

export interface Plan {
  rows: PlanRow[];
  totalNotional: number;
  totalRisk: number;
  notes: string[];
}

/** Listeye alınmış adaylardan dağılım tablosu: limitler içinde, öncelik sırasıyla. Emir değildir. */
export function buildPlan(
  items: { instId: string; entry: number; stop: number; target: number; rr: number; opportunity: number; risk: number }[],
  opts: { equityUsdt: number; riskPct: number; openNotionalUsdt: number; openCount: number; limits: HardLimits },
): Plan {
  const rows: PlanRow[] = [];
  let open = opts.openNotionalUsdt;
  let count = opts.openCount;
  const notes: string[] = [];
  const sorted = [...items].sort((a, b) => b.opportunity - b.risk * 0.5 - (a.opportunity - a.risk * 0.5));
  for (const it of sorted) {
    if (count >= opts.limits.maxOpenPositions) {
      rows.push({ ...pick(it), notionalUsdt: 0, riskUsdt: 0, note: `En fazla ${opts.limits.maxOpenPositions} açık pozisyon; sırada bekler.`, included: false });
      continue;
    }
    const s = sizePosition({ equityUsdt: opts.equityUsdt, riskPct: opts.riskPct, entry: it.entry, stop: it.stop, openNotionalUsdt: open, limits: opts.limits });
    if (s.notionalUsdt <= 0) {
      rows.push({ ...pick(it), notionalUsdt: 0, riskUsdt: 0, note: s.explain, included: false });
      continue;
    }
    open += s.notionalUsdt;
    count++;
    rows.push({ ...pick(it), notionalUsdt: s.notionalUsdt, riskUsdt: s.riskUsdt, note: s.cappedBy === "risk" ? "Risk bütçesine göre." : `${s.cappedBy} ile kırpıldı.`, included: true });
  }
  const inc = rows.filter((r) => r.included);
  const totalNotional = round(inc.reduce((s, r) => s + r.notionalUsdt, 0), 2);
  const totalRisk = round(inc.reduce((s, r) => s + r.riskUsdt, 0), 3);
  notes.push(`Toplam ${totalNotional} USDT, stop olursa en kötü durumda ≈ ${totalRisk} USDT kayıp.`);
  notes.push("Bu bir tercih listesidir; emri ajan kendi kararıyla ve kapıdan geçirerek verir.");
  return { rows, totalNotional, totalRisk, notes };
}

function pick(it: { instId: string; entry: number; stop: number; target: number; rr: number }) {
  return { instId: it.instId, entry: it.entry, stop: it.stop, target: it.target, rr: it.rr };
}
