// Emir defteri (Basic): her emir tek satır — saat · coin · yön · fiyat · tutar · durum · PnL.
// Ayrıntılı günlük (Pro): olayları emir / uyarı / bildirim / zincir olarak sınıflar.
import type { Trade } from "./tradingClient.js";
import type { AppEvent } from "../state/store.js";

export type OrderStatus = "açıldı" | "hedef 1" | "stop" | "süre doldu" | "kapandı";

export interface OrderRow {
  ts: number;
  coin: string;
  side: "AL" | "SAT";
  px: number;
  usdt: number;
  status: OrderStatus;
  pnl: number | null;
  mode: string;
  ordId?: string;
}

export function orderStatus(t: Pick<Trade, "side" | "reason">): OrderStatus {
  if (t.side === "buy") return "açıldı";
  if (/kısmi kâr|hedef 1/i.test(t.reason)) return "hedef 1";
  if (/süre/i.test(t.reason)) return "süre doldu";
  if (/stop/i.test(t.reason)) return "stop";
  return "kapandı";
}

export function orderRows(trades: Trade[]): OrderRow[] {
  return trades.map((t) => ({ ts: t.ts, coin: t.instId.split("-")[0], side: t.side === "buy" ? "AL" : "SAT", px: t.px, usdt: t.notionalUsdt, status: orderStatus(t), pnl: t.pnl ?? null, mode: t.mode, ordId: t.ordId }));
}

export type LogKind = "emir" | "uyarı" | "bildirim" | "zincir" | "diğer";

export function logKind(e: Pick<AppEvent, "level" | "text">): LogKind {
  if (/avalanche|zincir|snowtrace|fuji|kanıt/i.test(e.text)) return "zincir";
  if (/telegram|bildirim/i.test(e.text)) return "bildirim";
  if (e.level === "emir") return "emir";
  if (e.level === "uyarı" || e.level === "hata") return "uyarı";
  return "diğer";
}
