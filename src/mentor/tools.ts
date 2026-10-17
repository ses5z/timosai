// Mentor araç katmanı. Mentor EMİR VEREMEZ: emir aracı yoktur. Ayar değiştiren araçlar onay ister.
import crypto from "node:crypto";
import type { AppContext } from "../context.js";
import { followWarning, makePlan, validInstId } from "../app.js";
import { analyzeCandidate } from "./analysis.js";
import { round } from "../util/math.js";
import { derivAnalysisFor } from "../derivatives/view.js";

export interface ToolDef {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, { type: string; description: string; items?: { type: string } }>; required?: string[] };
  needsConfirm?: boolean;
  quickOnly?: boolean;
}

export const TOOL_DEFS: ToolDef[] = [
  { name: "durum", description: "Ajanın, işlem modunun (KURU/GERÇEK), risk skorunun ve verinin canlı olup olmadığının özeti.", parameters: { type: "object", properties: {} } },
  { name: "adaylar", description: "Ajanın sıraladığı aday coinler (karar, fırsat, risk, gerekçe).", parameters: { type: "object", properties: { adet: { type: "number", description: "kaç aday (varsayılan 5)" } } } },
  { name: "aday_analizi", description: "Bir coin için teknik tablo, giriş/stop/hedef, R:R, risk bütçesine göre örnek boyut ve dikkat edilecekler.", parameters: { type: "object", properties: { sembol: { type: "string", description: "ör. SOL veya SOL-USDT" } }, required: ["sembol"] } },
  { name: "vadeli_durum", description: "Bir coinin vadeli piyasa durumu: funding, open interest, genel hesap ve üst trader L/S oranları, kalabalık taraf, manipülasyon şüphesi ve gerekçeler. Vadeli veri yalnızca analiz girdisidir.", parameters: { type: "object", properties: { sembol: { type: "string", description: "ör. BTC" } }, required: ["sembol"] } },
  { name: "listem", description: "Kullanıcının takip listesi.", parameters: { type: "object", properties: {} } },
  { name: "listeye_ekle", description: "Bir coini takip listesine ekler (işlem açmaz).", parameters: { type: "object", properties: { sembol: { type: "string", description: "ör. SOL" } }, required: ["sembol"] } },
  { name: "listeden_cikar", description: "Bir coini takip listesinden çıkarır.", parameters: { type: "object", properties: { sembol: { type: "string", description: "ör. SOL" } }, required: ["sembol"] } },
  { name: "plan_olustur", description: "Takip listesinden (veya verilen sembollerden) limitler içinde dağılım tablosu hesaplar. Emir değildir.", parameters: { type: "object", properties: { semboller: { type: "array", items: { type: "string" }, description: "isteğe bağlı semboller" } } } },
  { name: "portfoy", description: "Değer, nakit, açık pozisyonlar ve günlük K/Z.", parameters: { type: "object", properties: {} } },
  { name: "butce_ayarla", description: "İşlem başına risk yüzdesini ayarlar (0.25-2). Onay gerekir.", parameters: { type: "object", properties: { risk_yuzde: { type: "number", description: "ör. 1" } }, required: ["risk_yuzde"] }, needsConfirm: true },
  { name: "bildirim_ayarla", description: "Telegram bildirimlerini ayarlar. Onay gerekir.", parameters: { type: "object", properties: { gelismeler: { type: "boolean", description: "takip edilen coin gelişmeleri" }, sessiz_dakika: { type: "number", description: "şu kadar dakika sessiz" } } }, needsConfirm: true },
  { name: "ajan_modu", description: "Otonom modu açar/kapatır veya ajanı duraklatır/devam ettirir. Onay gerekir.", parameters: { type: "object", properties: { otonom: { type: "boolean", description: "otonom mod" }, duraklat: { type: "boolean", description: "duraklat" } } }, needsConfirm: true },
  { name: "tara", description: "Ajana hemen yeni bir tarama yaptırır.", parameters: { type: "object", properties: {} } },
  { name: "hizli_islem", description: "YALNIZCA kullanıcı açıkça alım/kapatma komutu verdiyse (ör. 'SOL için 5 USDT al', 'SOL pozisyonunu kapat'). Kendiliğinden asla çağırma. Sert limitler ve zorunlu stop geçerli.", parameters: { type: "object", properties: { komut: { type: "string", description: "al | kapat" }, sembol: { type: "string", description: "ör. SOL" }, tutar: { type: "number", description: "USDT (al için)" } }, required: ["komut", "sembol"] }, quickOnly: true },
  { name: "senaryo_baslat", description: "Deterministik demo senaryosunu başlatır. Onay gerekir.", parameters: { type: "object", properties: {} }, needsConfirm: true },
];

export const TOOL_NAMES = new Set(TOOL_DEFS.map((t) => t.name));

/** Modele gösterilen araçlar: hizli_islem yalnızca QUICK_COMMANDS=true iken. */
export function activeToolDefs(tools: MentorTools): ToolDef[] {
  return TOOL_DEFS.filter((d) => !d.quickOnly || tools.quickEnabled());
}

export function normSymbol(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const up = s.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const id = up.includes("-") ? up : `${up}-USDT`;
  return validInstId(id) ? id : null;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  pending?: { id: string; summary: string };
}

export class MentorTools {
  /** Son çağrıda oluşan onay bekleyen eylem (arayüz düğmesi için). */
  lastPending: { id: string; summary: string } | null = null;
  /** Kullanıcının son mesajı: hizli_islem yalnızca açık komutla çalışır. */
  currentUserText = "";
  constructor(private readonly ctx: AppContext) {}

  quickEnabled(): boolean {
    return this.ctx.env.quickCommands;
  }

  describePending(name: string, args: Record<string, any>): string {
    switch (name) {
      case "butce_ayarla":
        return `İşlem başına risk bütçesini %${args.risk_yuzde} yap.`;
      case "bildirim_ayarla":
        return `Bildirimler: ${args.gelismeler === undefined ? "" : args.gelismeler ? "gelişmeler açık" : "gelişmeler kapalı"}${args.sessiz_dakika ? `, ${args.sessiz_dakika} dk sessiz` : ""}.`;
      case "ajan_modu":
        return `Ajan: ${args.otonom === undefined ? "" : args.otonom ? "otonom mod açık" : "otonom mod kapalı"}${args.duraklat === undefined ? "" : args.duraklat ? ", duraklat" : ", devam et"}.`;
      case "senaryo_baslat":
        return "Deterministik demo senaryosunu başlat.";
      default:
        return name;
    }
  }

  /** Model veya kural motoru bir aracı çağırdığında. Onay isteyenler bekleyen eyleme dönüşür. */
  async call(name: string, args: Record<string, any> = {}): Promise<ToolResult> {
    const def = TOOL_DEFS.find((d) => d.name === name);
    if (def?.quickOnly && !this.ctx.env.quickCommands) return { ok: false, error: "Hızlı komutlar kapalı; emirleri yalnızca ajan verir." };
    if (!def) return { ok: false, error: `Böyle bir araç yok: ${name}. Mentor emir veremez; emirleri yalnızca ajan verir.` };
    if (def.needsConfirm) {
      const id = crypto.randomUUID().slice(0, 8);
      const summary = this.describePending(name, args);
      this.ctx.store.pending.set(id, { id, tool: name, args, summary, createdAt: Date.now() });
      this.ctx.store.bus.publish("pending", { id, summary });
      this.lastPending = { id, summary };
      return { ok: true, pending: { id, summary }, data: { durum: "onay bekliyor", ozet: summary } };
    }
    return this.execute(name, args);
  }

  async confirm(id: string, yes: boolean): Promise<ToolResult> {
    const p = this.ctx.store.pending.get(id);
    if (!p) return { ok: false, error: "Bekleyen işlem bulunamadı ya da süresi doldu." };
    this.ctx.store.pending.delete(id);
    if (!yes || Date.now() - p.createdAt > 10 * 60_000) return { ok: true, data: { durum: "vazgeçildi", ozet: p.summary } };
    return this.execute(p.tool, p.args);
  }

  async execute(name: string, args: Record<string, any>): Promise<ToolResult> {
    const { ctx } = this;
    const a = ctx.agent;
    switch (name) {
      case "durum": {
        const s = a.status();
        const rs = a.riskScore();
        return { ok: true, data: { ajan: s.state, otonom: s.autonomous, mod: s.mode, canliVeri: s.liveData, taramaSayisi: s.scanCount, riskSkoru: rs.score, riskDurumu: rs.level, acikPozisyon: a.trading.listPositions().length, takipSayisi: ctx.store.follows.length } };
      }
      case "adaylar": {
        const n = Math.max(1, Math.min(10, Number(args.adet) || 5));
        return { ok: true, data: a.queue().slice(0, n).map((c) => ({ sembol: c.base, karar: c.decision, firsat: c.opportunity, risk: c.risk, yon: c.direction, gerekce: c.reason })) };
      }
      case "aday_analizi": {
        const id = normSymbol(args.sembol);
        if (!id) return { ok: false, error: "Geçersiz sembol." };
        const an = analyzeCandidate(ctx, id);
        if (!an) return { ok: false, error: `${id} izleme listesinde değil ya da henüz taranmadı.` };
        return { ok: true, data: { ...an, security: { ...an.security, not: "güvenlik alanları ÖRNEK VERİ, makas gerçek" } } };
      }
      case "vadeli_durum": {
        const id = normSymbol(args.sembol);
        if (!id) return { ok: false, error: "Geçersiz sembol." };
        const d = await derivAnalysisFor(ctx, id);
        if (!d || !d.available) return { ok: false, error: `${id} için vadeli veri yok.` };
        const s = d.snapshot;
        return { ok: true, data: { sembol: id.split("-")[0], ozet: d.badge, kalabalikTaraf: d.crowded, manipulasyonSuphesi: d.manipulation, gerekceler: d.reasons, funding: s.funding, oiUsd: s.oiUsd, oiDegisim1sa: s.oiDeltaPct1h, genelHesapOrani: s.lsAccount, ustTraderHesapOrani: s.lsTopAccount, ustTraderPozisyonOrani: s.lsTopPosition, takerAlis: s.takerBuy, takerSatis: s.takerSell, kaynak: s.publicSource ? `${s.publicSource} vadeli verisi (ATK dışı) + ATK` : "ATK" } };
      }
      case "listem":
        return { ok: true, data: ctx.store.follows.map((id) => ({ sembol: id.split("-")[0], karar: a.candidates.get(id)?.decision ?? "taranmadı" })) };
      case "listeye_ekle": {
        const id = normSymbol(args.sembol);
        if (!id || !ctx.watchlist.some((w) => w.instId === id)) return { ok: false, error: "Bu coin ajanın izleme listesinde değil." };
        const r = ctx.store.follow(id);
        const w = followWarning(ctx, r.count);
        return { ok: true, data: { eklendi: r.added, toplam: r.count, uyari: w ? w.text : null } };
      }
      case "listeden_cikar": {
        const id = normSymbol(args.sembol);
        if (!id) return { ok: false, error: "Geçersiz sembol." };
        return { ok: true, data: { cikarildi: ctx.store.unfollow(id), toplam: ctx.store.follows.length } };
      }
      case "plan_olustur": {
        const ids = Array.isArray(args.semboller) && args.semboller.length ? (args.semboller.map(normSymbol).filter(Boolean) as string[]) : ctx.store.follows;
        if (!ids.length) return { ok: false, error: "Takip listen boş; önce Keşfet'te birkaç coini listene al." };
        return { ok: true, data: makePlan(ctx, ids) };
      }
      case "portfoy": {
        const t = a.trading;
        return { ok: true, data: { mod: t.mode, deger: round(t.equity(), 3), nakit: round(t.cashUsdt(), 3), gunlukKZ: round(t.dailyPnl(), 3), pozisyonlar: a.positionsView().map((p) => ({ sembol: p.instId.split("-")[0], kz: p.pnlUsdt, giris: p.entryPx, stop: p.stopPx, hedef: p.targetPx })) } };
      }
      case "butce_ayarla": {
        const v = Number(args.risk_yuzde);
        if (!Number.isFinite(v) || v < 0.25 || v > 2) return { ok: false, error: "Risk yüzdesi 0.25 ile 2 arasında olmalı." };
        ctx.store.settings.riskPct = round(v, 2);
        ctx.store.addEvent("bilgi", `Mentor üzerinden risk bütçesi %${ctx.store.settings.riskPct} yapıldı.`);
        return { ok: true, data: { riskYuzde: ctx.store.settings.riskPct } };
      }
      case "bildirim_ayarla": {
        const n = ctx.store.settings.notifications;
        if (typeof args.gelismeler === "boolean") n.developments = args.gelismeler;
        if (typeof args.sessiz_dakika === "number") n.quietUntil = args.sessiz_dakika > 0 ? Date.now() + Math.min(args.sessiz_dakika, 1440) * 60_000 : 0;
        return { ok: true, data: { gelismeler: n.developments, sessizBitis: n.quietUntil } };
      }
      case "ajan_modu": {
        const s = ctx.store.settings;
        if (typeof args.otonom === "boolean") s.autonomous = args.otonom;
        if (typeof args.duraklat === "boolean") s.paused = args.duraklat;
        ctx.store.addEvent("bilgi", `Mentor üzerinden ajan ayarı: otonom ${s.autonomous ? "açık" : "kapalı"}, ${s.paused ? "duraklatıldı" : "çalışıyor"}.`);
        ctx.store.bus.publish("agent", a.status());
        return { ok: true, data: { otonom: s.autonomous, duraklatildi: s.paused } };
      }
      case "tara": {
        await a.scanOnce();
        return { ok: true, data: { tarama: a.scanCount, ilkUc: a.queue().slice(0, 3).map((c) => `${c.base} (${c.decision})`) } };
      }
      case "hizli_islem": {
        const q = ctx.extras.quick;
        const explicit = /(\bal\b|alım|satın|kapat|\/al|\/kapat|\/sat)/i.test(this.currentUserText);
        if (!q || !explicit) return { ok: false, error: "Hızlı işlem yalnızca kullanıcının açık komutuyla yapılır." };
        const sym = normSymbol(args.sembol);
        if (!sym) return { ok: false, error: "Geçersiz sembol." };
        const r = args.komut === "kapat" ? await q.run(`/kapat ${sym.split("-")[0]}`, "mentor") : await q.run(`/al ${sym.split("-")[0]}${args.tutar ? " " + Number(args.tutar) : ""}`, "mentor");
        return { ok: r.ok, data: r.text, error: r.ok ? undefined : r.text };
      }
      case "senaryo_baslat": {
        if (!ctx.extras.scenario) return { ok: false, error: "Senaryo modülü yüklü değil." };
        void ctx.extras.scenario.start();
        return { ok: true, data: { basladi: true } };
      }
      default:
        return { ok: false, error: "Bilinmeyen araç." };
    }
  }
}
