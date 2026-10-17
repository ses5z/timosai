// Bellek içi durum + olay veri yolu (SSE). Web ve Telegram aynı takip listesini/kuyruğu/sohbeti paylaşır.
import { EventEmitter } from "node:events";

export interface AppEvent {
  id: number;
  ts: number;
  level: "bilgi" | "karar" | "emir" | "uyarı" | "hata";
  text: string;
  symbol?: string;
}

export interface ChatMessage {
  role: "user" | "mentor";
  text: string;
  ts: number;
  via: "web" | "telegram" | "ses";
  provider?: string;
  pendingId?: string;
}

export interface NotificationSettings {
  developments: boolean;
  critical: boolean;
  opportunitySummary: boolean;
  quietUntil: number;
}

export interface PendingAction {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  createdAt: number;
}

export class Bus extends EventEmitter {
  publish(type: string, data: unknown): void {
    this.emit("sse", { type, data });
  }
}

export class Store {
  readonly bus = new Bus();
  private eventSeq = 0;
  events: AppEvent[] = [];
  follows: string[] = [];
  passed = new Set<string>();
  swipeHistory: { instId: string; action: "like" | "pass" }[] = [];
  priority: string[] = [];
  planPreference: string[] = [];
  chat: ChatMessage[] = [];
  pending = new Map<string, PendingAction>();
  settings = {
    riskPct: 1,
    paused: false,
    halveAfterLosses: true,
    autonomous: true,
    notifications: { developments: true, critical: true, opportunitySummary: false, quietUntil: 0 } as NotificationSettings,
  };

  constructor() {
    this.bus.setMaxListeners(100);
  }

  addEvent(level: AppEvent["level"], text: string, symbol?: string): AppEvent {
    const e: AppEvent = { id: ++this.eventSeq, ts: Date.now(), level, text, symbol };
    this.events.push(e);
    if (this.events.length > 500) this.events.shift();
    this.bus.publish("event", e);
    return e;
  }

  /** Takibe al. Dönen değer: yeni eklendi mi ve toplam sayı. */
  follow(instId: string): { added: boolean; count: number } {
    if (this.follows.includes(instId)) return { added: false, count: this.follows.length };
    this.follows.push(instId);
    this.bus.publish("follows", this.follows);
    return { added: true, count: this.follows.length };
  }

  unfollow(instId: string): boolean {
    const i = this.follows.indexOf(instId);
    if (i < 0) return false;
    this.follows.splice(i, 1);
    this.bus.publish("follows", this.follows);
    return true;
  }

  swipe(instId: string, action: "like" | "pass"): void {
    this.swipeHistory.push({ instId, action });
    if (action === "pass") this.passed.add(instId);
    else this.passed.delete(instId);
  }

  undoSwipe(): { instId: string; action: "like" | "pass" } | null {
    const last = this.swipeHistory.pop();
    if (!last) return null;
    this.passed.delete(last.instId);
    if (last.action === "like") this.unfollow(last.instId);
    return last;
  }

  resetQueue(): void {
    this.passed.clear();
    this.swipeHistory = [];
  }

  addPriority(instId: string): void {
    this.priority = [instId, ...this.priority.filter((p) => p !== instId)].slice(0, 10);
    this.bus.publish("priority", this.priority);
  }

  addChat(m: Omit<ChatMessage, "ts">): ChatMessage {
    const msg = { ...m, ts: Date.now() };
    this.chat.push(msg);
    if (this.chat.length > 120) this.chat.shift();
    this.bus.publish("chat", msg);
    return msg;
  }
}
