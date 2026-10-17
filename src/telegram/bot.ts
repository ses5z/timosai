// Telegram botu: long polling (fetch), yalnızca izinli kullanıcı, 4096 bölme, 429 retry_after.
// Bot emir vermez. Takip listesi, kuyruk ve sohbet web ile ortaktır.
import type { AppContext } from "../context.js";
import type { Notifier, NotifyMessage } from "../ports.js";
import type { MentorService } from "../mentor/mentorService.js";
import { analyzeCandidate } from "../mentor/analysis.js";
import { derivAnalysisFor, derivText } from "../derivatives/view.js";
import { holdReportFor, holdText } from "../fundamentals/view.js";
import { scanToken, scanText } from "../security/view.js";
import { normSymbol } from "../mentor/tools.js";
import { NotifyPolicy } from "./notifyPolicy.js";
import { log, mask } from "../util/log.js";
import { sparkline } from "../util/math.js";
import type { Candidate } from "../ports.js";
import { renderLineChartPng } from "./chartPng.js";

const HEART = "❤️";
const BROKEN = "💔";

export interface PreviewMsg {
  dir: "in" | "out";
  text: string;
  photo?: string; // önizleme için grafik adresi
  buttons?: string[];
  ts: number;
  sent: boolean;
}

export function splitMessage(text: string, max = 4096): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest) out.push(rest);
  return out;
}

type Btn = { text: string; data: string };

export const CAPTION_MAX = 1024;

export function clampCaption(text: string, max = CAPTION_MAX): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

/** Aday kartı başlığı: sembol, fiyat, 24 sa, fırsat/risk, tek cümle gerekçe. */
export function candidateCaption(c: Candidate, lead?: string): string {
  const lines = [
    ...(lead ? [lead, ""] : []),
    `${c.base} · ${c.category}`,
    `Fiyat ${c.price} (${c.change24hPct >= 0 ? "+" : ""}${c.change24hPct}% 24 sa)`,
    `Fırsat ${c.opportunity} · Risk ${c.risk} · ajan: ${c.decision}`,
    ...(c.derivatives?.available ? [`Vadeli: ${c.derivatives.badge}`] : []),
    `Giriş ${c.entry} · Stop ${c.stop} · Hedef ${c.target}`,
    c.reason,
  ];
  return clampCaption(lines.join("\n"));
}

export function candidateChart(c: Candidate, width = 800, height = 450): Buffer {
  return renderLineChartPng(c.spark.slice(-60), [
    { v: c.entry, kind: "entry" },
    { v: c.stop, kind: "stop" },
    { v: c.target, kind: "target" },
  ], width, height);
}

export class TelegramBot implements Notifier {
  readonly name = "telegram";
  private offset = 0;
  private running = false;
  private connected = false;
  private username = "";
  private lastError: string | null = null;
  private sent = 0;
  readonly policy: NotifyPolicy;
  readonly preview: PreviewMsg[] = [];
  private summaryTimer: NodeJS.Timeout | null = null;
  /** "Ayrıntı" düğmesi için son soruların kısa kimlikleri. */
  private questions = new Map<string, string>();
  private qSeq = 0;

  constructor(
    private readonly ctx: AppContext,
    private readonly mentor: MentorService,
    private readonly opts: { token: string; allowedUserId: string; fetchImpl?: typeof fetch; policy?: NotifyPolicy; pollTimeoutSec?: number },
  ) {
    this.policy = opts.policy ?? new NotifyPolicy();
  }

  enabled(): boolean {
    return Boolean(this.opts.token);
  }

  status() {
    return { enabled: this.enabled(), connected: this.connected, username: this.username ? `@${this.username}` : "", allowedUserSet: Boolean(this.opts.allowedUserId), sent: this.sent, lastError: this.lastError };
  }

  private get f(): typeof fetch {
    return this.opts.fetchImpl ?? fetch;
  }

  /** Telegram Bot API çağrısı; 429'da retry_after kadar bekleyip bir kez yeniden dener. */
  async api(method: string, body: Record<string, unknown> | FormData = {}, attempt = 0): Promise<any> {
    const multipart = body instanceof FormData;
    const res = await this.f(`https://api.telegram.org/bot${this.opts.token}/${method}`, {
      method: "POST",
      // multipart'ta sınır (boundary) başlığını fetch kendisi koyar
      headers: multipart ? undefined : { "content-type": "application/json" },
      body: multipart ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(((this.opts.pollTimeoutSec ?? 25) + 10) * 1000),
    });
    const data: any = await res.json().catch(() => ({}));
    if (res.status === 429 && attempt < 2) {
      const ra = Number(data?.parameters?.retry_after);
      const wait = Number.isFinite(ra) ? Math.min(60, Math.max(0, ra)) : 1;
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.api(method, body, attempt + 1);
    }
    if (!data.ok) throw new Error(mask(`Telegram ${method}: ${data.description ?? res.status}`));
    return data.result;
  }

  private pushPreview(p: Omit<PreviewMsg, "ts">): void {
    const m = { ...p, ts: Date.now() };
    this.preview.push(m);
    if (this.preview.length > 40) this.preview.shift();
    this.ctx.store.bus.publish("telegram", m);
  }

  async send(text: string, buttons?: Btn[][]): Promise<boolean> {
    const flat = buttons?.flat().map((b) => b.text);
    if (!this.enabled() || !this.opts.allowedUserId) {
      this.pushPreview({ dir: "out", text, buttons: flat, sent: false });
      return false;
    }
    try {
      const parts = splitMessage(text);
      for (let i = 0; i < parts.length; i++) {
        const last = i === parts.length - 1;
        await this.api("sendMessage", {
          chat_id: this.opts.allowedUserId,
          text: parts[i],
          disable_web_page_preview: true,
          ...(last && buttons?.length ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } } : {}),
        });
      }
      this.sent++;
      this.pushPreview({ dir: "out", text, buttons: flat, sent: true });
      return true;
    } catch (e) {
      this.lastError = (e as Error).message;
      log.warn(this.lastError);
      this.pushPreview({ dir: "out", text, buttons: flat, sent: false });
      return false;
    }
  }

  /**
   * Grafik fotoğrafı + başlık + satır içi düğmeler tek mesajda (sendPhoto, multipart).
   * Başarısız olursa nedeni (maskeli) loglanır ve aynı içerik sparkline'lı metin olarak gider.
   */
  async sendPhoto(png: Buffer, caption: string, buttons: Btn[][] | undefined, fallbackText: string, previewUrl?: string): Promise<boolean> {
    const cap = clampCaption(caption);
    const flat = buttons?.flat().map((b) => b.text);
    if (!this.enabled() || !this.opts.allowedUserId) {
      this.pushPreview({ dir: "out", text: cap, photo: previewUrl, buttons: flat, sent: false });
      return false;
    }
    try {
      const form = new FormData();
      form.append("chat_id", String(this.opts.allowedUserId));
      form.append("caption", cap);
      if (buttons?.length) form.append("reply_markup", JSON.stringify({ inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) }));
      form.append("photo", new Blob([new Uint8Array(png)], { type: "image/png" }), "grafik.png");
      await this.api("sendPhoto", form);
      this.sent++;
      this.pushPreview({ dir: "out", text: cap, photo: previewUrl, buttons: flat, sent: true });
      return true;
    } catch (e) {
      this.lastError = (e as Error).message;
      log.warn(`Telegram sendPhoto başarısız, metne düşülüyor: ${this.lastError}`);
      return this.send(fallbackText, buttons);
    }
  }

  /** Aday için grafikli mesaj; grafik üretilemezse metin. */
  async sendCandidatePhoto(c: Candidate, buttons: Btn[][] | undefined, lead?: string): Promise<boolean> {
    const caption = candidateCaption(c, lead);
    const fallback = clampCaption(`${caption}\n${sparkline(c.spark, 16)}`, 4096);
    let png: Buffer;
    try {
      png = candidateChart(c);
    } catch (e) {
      log.warn(`Grafik üretilemedi (${c.instId}), metin gönderiliyor: ${(e as Error).message}`);
      return this.send(fallback, buttons);
    }
    return this.sendPhoto(png, caption, buttons, fallback, `/api/telegram/chart/${c.instId}.png`);
  }

  /** Notifier portu: politika izin verirse gönderir. */
  async notify(msg: NotifyMessage): Promise<boolean> {
    const d = this.policy.decide(msg, {
      follows: this.ctx.store.follows,
      held: this.ctx.agent.trading.listPositions().map((p) => p.instId),
      settings: this.ctx.store.settings.notifications,
    });
    if (!d.send) return false;
    const buttons = msg.buttons?.length ? [msg.buttons.slice(0, 2)] : undefined;
    // Takip edilen coin gelişmelerinde mini grafik eklenir.
    const c = msg.symbol ? this.ctx.agent.candidates.get(msg.symbol) : undefined;
    if (c && msg.kind !== "chat" && msg.kind !== "warning" && this.ctx.store.follows.includes(c.instId)) return this.sendCandidatePhoto(c, buttons, msg.text);
    return this.send(msg.text, buttons);
  }

  async start(): Promise<void> {
    if (!this.enabled() || this.running) return;
    this.running = true;
    try {
      const me = await this.api("getMe");
      this.username = me.username ?? "";
      this.connected = true;
      // Başlangıçta eski mesaj yağmuru olmasın: bekleyen güncellemeleri atla.
      const pend = await this.api("getUpdates", { offset: -1, timeout: 0 });
      if (Array.isArray(pend) && pend.length) this.offset = pend[pend.length - 1].update_id + 1;
      log.info(`Telegram bağlandı: @${this.username}`);
    } catch (e) {
      this.lastError = (e as Error).message;
      this.connected = false;
      log.warn(`Telegram başlatılamadı: ${this.lastError}`);
    }
    void this.loop();
    this.summaryTimer = setInterval(() => void this.opportunitySummary(), 60 * 60_000);
  }

  stop(): void {
    this.running = false;
    if (this.summaryTimer) clearInterval(this.summaryTimer);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const updates: any[] = await this.api("getUpdates", { offset: this.offset, timeout: this.opts.pollTimeoutSec ?? 25, allowed_updates: ["message", "callback_query"] });
        this.connected = true;
        for (const u of updates) {
          this.offset = u.update_id + 1;
          await this.handleUpdate(u).catch((e) => log.warn(`Telegram güncellemesi işlenemedi: ${(e as Error).message}`));
        }
      } catch (e) {
        this.lastError = (e as Error).message;
        this.connected = false;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  private allowed(fromId: unknown): boolean {
    return Boolean(this.opts.allowedUserId) && String(fromId) === String(this.opts.allowedUserId);
  }

  async handleUpdate(u: any): Promise<void> {
    if (u.callback_query) {
      const q = u.callback_query;
      if (!this.allowed(q.from?.id)) return;
      await this.api("answerCallbackQuery", { callback_query_id: q.id }).catch(() => undefined);
      await this.handleCallback(String(q.data ?? ""));
      return;
    }
    const m = u.message;
    if (!m?.text) return;
    const text: string = m.text.trim();
    if (!this.allowed(m.from?.id)) {
      // İzinli kullanıcı henüz ayarlanmadıysa yalnızca /id kurulum için cevaplanır.
      if (!this.opts.allowedUserId && /^\/id\b/.test(text)) await this.api("sendMessage", { chat_id: m.chat.id, text: `Kullanıcı kimliğin: ${m.from?.id}. Bunu .env içindeki TELEGRAM_ALLOWED_USER_ID satırına yaz.` });
      return;
    }
    this.pushPreview({ dir: "in", text, sent: true });
    if (text.startsWith("/")) await this.handleCommand(text);
    else {
      await this.askMentor(text, false);
    }
  }

  async handleCommand(text: string): Promise<void> {
    const [cmdRaw, ...args] = text.split(/\s+/);
    const cmd = cmdRaw.replace(/@.*$/, "").toLowerCase();
    const a = this.ctx.agent;
    const st = this.ctx.store;
    switch (cmd) {
      case "/start":
      case "/yardim":
        return void (await this.send(
          [
            "TimosAI botu. Sessiz çalışırım: yalnızca takip ettiğin coinlerdeki anlamlı gelişmeleri, kritik durumları ve sohbeti yazarım.",
            "/kesfet - sıradaki aday kartı (kalp: takibe al, kırık kalp: geç)",
            "/takip - takip listen",
            "/birak SOL - takibi bırak",
            "/vadeli SOL - vadeli durum (funding, OI, L/S)",
            "/coin AVAX [BTC] - CEX özeti (parite seçilebilir)",
            "/hold ARB - hold raporu (arz, FDV, kilit açılımı)",
            "/tara avax 0x... - DEX token güvenlik taraması (PASS/WARN/BLOCK)",
            "/durum - ajan durumu",
            "/portfoy - değer ve pozisyonlar",
            "/bildirim - bildirim ayarları",
            "/sessiz 60 - 60 dakika sessiz",
            "/ozet - kısa özet",
            "/id - kullanıcı kimliğin",
            ...(this.ctx.env.quickCommands ? ["/al SOL 5 · /sat SOL · /kapat SOL - hızlı komut (komut = onay, sert limitler geçerli)", "/l SOL 5x 20 · /s ETH 3x 10 - kaldıraçlı SİMÜLASYON (gerçek emre dönüşmez)"] : []),
            this.ctx.env.quickCommands ? "Komut dışındaki her mesaj mentora gider." : "Komut dışındaki her mesaj mentora gider. Emirleri yalnızca ajan verir (hızlı komutlar kapalı).",
          ].join("\n"),
        ));
      case "/id":
        return void (await this.send(`Kullanıcı kimliğin: ${this.opts.allowedUserId}`));
      case "/kesfet":
        return this.sendNextCandidate();
      case "/al":
      case "/sat":
      case "/kapat":
      case "/l":
      case "/s": {
        const q = this.ctx.extras.quick;
        const r = q ? await q.run(text, "telegram") : { text: "Hızlı komutlar kapalı." };
        return void (await this.send(r.text));
      }
      case "/coin": {
        const base = (args[0] ?? "").toUpperCase();
        const quote = (args[1] ?? "USDT").toUpperCase();
        if (!/^[A-Z0-9]{1,15}$/.test(base)) return void (await this.send("Kullanım: /coin AVAX ya da /coin AVAX BTC"));
        const cex = this.ctx.extras.cex;
        const pairs: any[] = cex ? await cex.pairs(base) : [];
        const p = pairs.find((x) => x.quote === quote);
        if (!p) return void (await this.send(`${base}-${quote} paritesi borsada yok.${pairs.length ? ` Mevcut: ${pairs.map((x) => x.instId).join(", ")}` : ""}`));
        const c = cex ? await cex.analyze(p.instId) : null;
        const an = c ? analyzeCandidate(this.ctx, p.instId, c) : null;
        const vol = p.volUsdt === null ? "-" : `${(p.volUsdt / 1e6).toFixed(2)} Mn USDT`;
        return void (await this.send([`${p.instId} · ${p.name || base}`, `Son ${p.last} (${p.change24hPct >= 0 ? "+" : ""}${(p.change24hPct ?? 0).toFixed(2)}% 24 sa) · hacim ${vol}${p.lowLiquidity ? " · likidite düşük" : ""}`, an ? an.short : "Analiz için yeterli mum yok.", p.tradable ? "İşlem izin listesinde." : "Analiz için; işlem izin listesinde değil.", `Pariteler: ${pairs.map((x) => x.quote).join(" · ")}`].join("\n")));
      }
      case "/hold": {
        const id = normSymbol(args[0] ?? "");
        if (!id) return void (await this.send("Kullanım: /hold ARB"));
        return void (await this.send(holdText(await holdReportFor(this.ctx, id))));
      }
      case "/tara": {
        if (args.length < 2) return void (await this.send("Kullanım: /tara avax 0x... (zincirler: eth, bsc, avax, polygon, arbitrum, base, optimism)"));
        try {
          return void (await this.send(scanText(await scanToken(this.ctx, args[0], args[1]))));
        } catch (e) {
          return void (await this.send((e as Error).message));
        }
      }
      case "/vadeli": {
        const id = normSymbol(args[0] ?? "BTC");
        if (!id) return void (await this.send("Kullanım: /vadeli SOL"));
        const d = await derivAnalysisFor(this.ctx, id);
        return void (await this.send(d ? derivText(d, id.split("-")[0]) : `${id.split("-")[0]}: vadeli veri yok.`));
      }
      case "/takip": {
        if (!st.follows.length) return void (await this.send("Takip listen boş. /kesfet ile kalp vererek ekleyebilirsin."));
        const lines = st.follows.map((id) => {
          const c = a.candidates.get(id);
          return c ? `${c.base}: ${c.price} (${c.change24hPct >= 0 ? "+" : ""}${c.change24hPct}%) · ajan: ${c.decision}` : id;
        });
        return void (await this.send(`Takip listen (${st.follows.length}):\n${lines.join("\n")}`));
      }
      case "/birak": {
        const id = normSymbol(args[0]);
        if (!id) return void (await this.send("Kullanım: /birak SOL"));
        return void (await this.send(st.unfollow(id) ? `${id.split("-")[0]} takipten çıktı.` : `${id.split("-")[0]} zaten takipte değil.`));
      }
      case "/durum": {
        const s = a.status();
        const rs = a.riskScore();
        return void (await this.send(`Ajan ${s.state}, otonom ${s.autonomous ? "açık" : "kapalı"}, ${s.mode === "PAPER" ? "Paper trade" : "CANLI İŞLEM"}.\n${s.scanCount} tarama, ${a.trading.listPositions().length} açık pozisyon.\nRisk skoru ${rs.score} (${rs.level}). ${s.liveData ? "Veri canlı." : "Canlı veri yok."}`));
      }
      case "/portfoy": {
        const t = a.trading;
        const pos = a.positionsView();
        const lines = pos.map((p) => `${p.instId.split("-")[0]} ${p.pnlUsdt >= 0 ? "+" : ""}${p.pnlUsdt} USDT · stop ${p.stopPx} · hedef ${p.targetPx}`);
        return void (await this.send(`Değer ${t.equity().toFixed(2)} USDT · nakit ${t.cashUsdt().toFixed(2)} · bugün ${t.dailyPnl() >= 0 ? "+" : ""}${t.dailyPnl().toFixed(3)} USDT\n${lines.join("\n") || "Açık pozisyon yok."}`));
      }
      case "/bildirim": {
        const n = st.settings.notifications;
        return void (await this.send(
          `Bildirimler:\nGelişmeler: ${n.developments ? "açık" : "kapalı"}\nKritik: ${n.critical ? "açık" : "kapalı"}\nFırsat özeti: ${n.opportunitySummary ? "açık" : "kapalı"}\nSessiz: ${n.quietUntil > Date.now() ? new Date(n.quietUntil).toLocaleTimeString("tr-TR") + "'e kadar" : "hayır"}`,
          [[{ text: n.developments ? "Gelişmeleri kapat" : "Gelişmeleri aç", data: `ntf:dev:${n.developments ? "0" : "1"}` }, { text: n.opportunitySummary ? "Özeti kapat" : "Özeti aç", data: `ntf:sum:${n.opportunitySummary ? "0" : "1"}` }]],
        ));
      }
      case "/sessiz": {
        const min = Math.max(1, Math.min(1440, Number(args[0]) || 60));
        st.settings.notifications.quietUntil = Date.now() + min * 60_000;
        return void (await this.send(`${min} dakika sessizim. Yalnızca kritik durumlar (stop/hedef, günlük zarar) gelir.`));
      }
      case "/ozet": {
        const t = a.trading;
        const top = a.queue().slice(0, 3).map((c) => `${c.base} (${c.decision}, fırsat ${c.opportunity})`);
        return void (await this.send(`Özet: değer ${t.equity().toFixed(2)} USDT, bugün ${t.dailyPnl() >= 0 ? "+" : ""}${t.dailyPnl().toFixed(3)} USDT, risk skoru ${a.riskScore().score}.\nÖne çıkan adaylar: ${top.join(", ")}.\nTakip: ${st.follows.length} coin.`));
      }
      default:
        return void (await this.send("Bu komutu tanımıyorum. /yardim yazabilirsin."));
    }
  }

  /** Web ile ortak kuyruktan sıradaki aday kartı. */
  async sendNextCandidate(): Promise<void> {
    const st = this.ctx.store;
    const c = this.ctx.agent.queue().find((x) => !st.passed.has(x.instId) && !st.follows.includes(x.instId) && x.decision !== "ele") ?? this.ctx.agent.queue().find((x) => !st.passed.has(x.instId) && !st.follows.includes(x.instId));
    if (!c) return void (await this.send("Şimdilik bakılacak yeni aday kalmadı."));
    await this.sendCandidatePhoto(c, [[{ text: `${BROKEN} Geç`, data: `pass:${c.instId}` }, { text: `${HEART} Takibe al`, data: `like:${c.instId}` }]]);
  }

  /** Mentora sor; kısa cevabın altına tek düğme: "Ayrıntı" (aynı soru detail=true ile). */
  async askMentor(text: string, detail: boolean): Promise<void> {
    const r = await this.mentor.chat(text, "telegram", { detail });
    let buttons: Btn[][] | undefined;
    if (r.pending) buttons = [[{ text: "Onayla", data: `cf:${r.pending.id}:y` }, { text: "Vazgeç", data: `cf:${r.pending.id}:n` }]];
    else if (r.canDetail) {
      const id = (++this.qSeq).toString(36);
      this.questions.set(id, text);
      if (this.questions.size > 50) this.questions.delete(this.questions.keys().next().value as string);
      buttons = [[{ text: "Ayrıntı", data: `dt:${id}` }]];
    }
    await this.send(r.text, buttons);
  }

  async handleCallback(data: string): Promise<void> {
    const [kind, a1, a2] = data.split(":");
    const st = this.ctx.store;
    if (kind === "like" || kind === "pass") {
      const id = normSymbol(a1);
      if (!id) return;
      st.swipe(id, kind);
      if (kind === "like") {
        const r = st.follow(id);
        const an = analyzeCandidate(this.ctx, id);
        await this.send(`${HEART} ${id.split("-")[0]} takipte (${r.count} coin).\n${an ? an.short : ""}`, an ? [[{ text: "Ayrıntı", data: `an:${id}` }]] : undefined);
        if (r.count >= this.ctx.contract.softWatchlistWarnAt) await this.send(`Listende ${r.count} coin var. Listeye almak işlem açmak değildir; ajan en fazla ${this.ctx.limits.maxOpenPositions} pozisyon tutar.`);
      }
      return this.sendNextCandidate();
    }
    if (kind === "dt") {
      const q = this.questions.get(a1);
      return void (q ? await this.askMentor(q, true) : await this.send("Bu sorunun süresi doldu; tekrar sorar mısın?"));
    }
    if (kind === "an") {
      const id = normSymbol(a1);
      const an = id ? analyzeCandidate(this.ctx, id) : null;
      return void (await this.send(an ? an.text : "Analiz hazır değil."));
    }
    if (kind === "unf") {
      const id = normSymbol(a1);
      if (id) st.unfollow(id);
      return void (await this.send(`${a1.split("-")[0]} takipten çıktı.`));
    }
    if (kind === "cf") {
      const r = await this.mentor.confirm(a1, a2 === "y", "telegram");
      return void (await this.send(r.text));
    }
    if (kind === "ntf") {
      const n = st.settings.notifications;
      if (a1 === "dev") n.developments = a2 === "1";
      if (a1 === "sum") n.opportunitySummary = a2 === "1";
      return this.handleCommand("/bildirim");
    }
  }

  private async opportunitySummary(): Promise<void> {
    if (!this.ctx.store.settings.notifications.opportunitySummary) return;
    const top = this.ctx.agent.queue().filter((c) => c.decision !== "ele").slice(0, 3);
    if (!top.length) return;
    await this.notify({ kind: "warning", text: `Saatlik fırsat özeti: ${top.map((c) => `${c.base} (${c.decision}, fırsat ${c.opportunity})`).join(", ")}. Bu bir öneri değil, ajanın sıralaması.` });
  }
}

/** Telegram kapalıyken: mesajları yalnızca önizlemeye ve günlüğe yazar. */
export class MockNotifier implements Notifier {
  readonly name = "mock";
  readonly sent: NotifyMessage[] = [];
  enabled(): boolean {
    return false;
  }
  async notify(msg: NotifyMessage): Promise<boolean> {
    this.sent.push(msg);
    return false;
  }
}
