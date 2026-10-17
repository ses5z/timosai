// RuleMentor: anahtarsız yedek. Niyet tanır, araçları çağırır, sade Türkçe yanıt üretir. Tavsiye vermez.
import type { AppContext } from "../context.js";
import type { MentorTools } from "./tools.js";
import { normSymbol } from "./tools.js";

const ALIASES: Record<string, string> = {
  bitcoin: "BTC", btc: "BTC", ethereum: "ETH", eth: "ETH", ether: "ETH", solana: "SOL", ripple: "XRP", dogecoin: "DOGE", doge: "DOGE",
  avalanche: "AVAX", cardano: "ADA", polkadot: "DOT", chainlink: "LINK", litecoin: "LTC", toncoin: "TON", tron: "TRX", polygon: "POL", near: "NEAR",
};

export const INJECTION_RE = /(kurallar[ıi]?\s*(yok\s*say|unut|g[öo]rmezden|devre\s*d[ıi][şs])|sistem\s*prompt|system\s*prompt|talimatlar[ıi]n[ıi]\s*(g[öo]ster|yaz|payla)|ignore\s+(all|previous|the)|jailbreak|developer\s*mode|geli[şs]tirici\s*modu|limit(i|leri)?\s*(kald[ıi]r|a[şs]|art[ıi]r|esnet|y[üu]kselt)|rol[üu]n[üu]\s*de[ğg]i[şs]tir|art[ıi]k\s+sen\s+bir)/i;
const ORDER_RE = /(^|\s)(al|alay[ıi]m|alsam|almal[ıi]\s*m[ıi]y[ıi]m|alal[ıi]m|sat|satay[ıi]m|satsam|satmal[ıi]|satal[ıi]m|sat[ıi]n\s*al|emir\s*ver|pozisyon\s*a[çc]|long\s*a[çc]|short\s*a[çc]|buy|sell)(\s|$|[.!?])/i;
const PREDICT_RE = /(y[üu]kselir\s*mi|d[üu][şs]er\s*mi|ka[çc]\s*olur|tahmin|ne\s*olacak|u[çc]ar\s*m[ıi]|patlar\s*m[ıi]|garanti|kesin\s*kazan)/i;

export function detectSymbol(text: string, ctx: AppContext): string | null {
  const bases = new Set(ctx.watchlist.map((w) => w.instId.split("-")[0]));
  for (const raw of text.split(/[^A-Za-zÇĞİÖŞÜçğıöşü0-9]+/)) {
    if (!raw) continue;
    const up = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const low = raw.toLocaleLowerCase("tr");
    const viaAlias = ALIASES[low] ?? ALIASES[low.replace(/(['’]?(yi|yı|yu|yü|i|ı|u|ü|a|e|de|da|ye|ya|nin|nın|un|ün|in|ın))$/u, "")];
    if (viaAlias && bases.has(viaAlias)) return `${viaAlias}-USDT`;
    if (bases.has(up) && up.length >= 2) return `${up}-USDT`;
    const stripped = up.replace(/(YI|YU|I|U|A|E|DE|DA|YE|YA|NIN|UN|IN)$/, "");
    if (raw === raw.toUpperCase() && bases.has(stripped) && stripped.length >= 3) return `${stripped}-USDT`;
  }
  return null;
}

export interface RuleReply {
  text: string;
}

export class RuleMentor {
  readonly name = "kural tabanlı";
  constructor(
    private readonly ctx: AppContext,
    private readonly tools: MentorTools,
  ) {}

  available(): boolean {
    return true;
  }

  /** detail=false: kısa (2-4 cümle); detail=true: bölümlü, sayılarla. */
  async reply(textIn: string, detail = false): Promise<RuleReply> {
    const text = textIn.trim();
    const t = text.toLocaleLowerCase("tr");
    const sym = detectSymbol(text, this.ctx);

    if (INJECTION_RE.test(t)) {
      return { text: "Bunu yapamam. Kurallarım ve sert limitler sabit; talimatlarımı da paylaşmıyorum. İstersen ajanın şu anki adaylarını ya da risk durumunu anlatabilirim." };
    }
    if (ORDER_RE.test(t) || /tavsiye/.test(t)) {
      const base = "Emir veremem ve al/sat tavsiyesi vermem; emirleri yalnızca ajan kendi kuralları ve sert limitler içinde verir.";
      if (sym) {
        const r = await this.tools.call("aday_analizi", { sembol: sym });
        if (r.ok) return { text: `${base} ${detail ? (r.data as any).text : (r.data as any).short}` };
      }
      return { text: `${base} Bir coin adı söylersen ajanın o coin hakkındaki görüşünü açıklarım.` };
    }
    if (PREDICT_RE.test(t)) {
      const base = "Fiyat tahmini yapmam; kimse kesin bilemez. Bunun yerine iki senaryoyu ve riski konuşabiliriz.";
      if (sym) {
        const r = await this.tools.call("aday_analizi", { sembol: sym });
        if (r.ok) {
          const a = r.data as any;
          return { text: `${base} ${a.base} için lehte senaryo: ${a.scenarios.lehte} Aleyhte senaryo: ${a.scenarios.aleyhte}` };
        }
      }
      return { text: base };
    }
    if (/^(merhaba|selam|hey|iyi\s*(g[üu]nler|ak[şs]amlar))/.test(t)) {
      return { text: "Merhaba, ben TimosAI mentoru. Ajanın taradığı adayları, bir coinin risk matematiğini ve portföyünü sade dille anlatabilirim. Örneğin: \"adaylar\", \"SOL analizi\" ya da \"portföyüm\"." };
    }
    if (/(yard[ıi]m|ne\s*yapabilirsin|komut)/.test(t)) {
      return { text: "Şunları yapabilirim: durum, adaylar, bir coinin analizi (ör. \"ETH analizi\"), takip listen, listeye ekle/çıkar, plan oluştur, portföy, risk bütçesi ayarı, bildirim ayarı, ajanı duraklatma ve tarama. Emir veremem; emirleri ajan verir." };
    }
    const num = t.match(/(\d+(?:[.,]\d+)?)/)?.[1]?.replace(",", ".");
    if (/(risk\s*b[üu]t[çc]e|b[üu]t[çc]em)/.test(t) && !num) {
      const pct = this.ctx.store.settings.riskPct;
      const eq = this.ctx.agent.trading.equity();
      const usdt = ((eq * pct) / 100).toFixed(2);
      if (!detail) return { text: `İşlem başına %${pct}, yani yaklaşık ${usdt} USDT.` };
      return { text: `İşlem başına risk bütçen %${pct}: değer ${eq.toFixed(2)} USDT olduğu için yaklaşık ${usdt} USDT.\nAjan boyutu risk tutarı ÷ stop mesafesiyle hesaplar; tek emir en fazla 5 USDT, toplam açık en fazla 15 USDT.\nArt arda 3 zararda boyut yarıya iner (${this.ctx.store.settings.halveAfterLosses ? "açık" : "kapalı"}); şu anki çarpan ${this.ctx.agent.sizeMultiplier()}×.` };
    }
    if (/(risk|b[üu]t[çc]e)/.test(t) && num && /(ayarla|yap|olsun|%)/.test(t)) {
      const r = await this.tools.call("butce_ayarla", { risk_yuzde: Number(num) });
      return { text: r.pending ? `Onayın gerekiyor: ${r.pending.summary} Onaylıyor musun?` : r.error ?? "Tamam." };
    }
    if (/(sessiz|bildirim)/.test(t)) {
      const args: Record<string, unknown> = {};
      if (/sessiz/.test(t)) args.sessiz_dakika = Number(num) || 60;
      if (/kapat/.test(t)) args.gelismeler = false;
      if (/a[çc]/.test(t) && !/kapat/.test(t)) args.gelismeler = true;
      const r = await this.tools.call("bildirim_ayarla", args);
      return { text: r.pending ? `Onayın gerekiyor: ${r.pending.summary} Onaylıyor musun?` : r.error ?? "Tamam." };
    }
    if (/(otonom|duraklat|devam\s*et)/.test(t)) {
      const args: Record<string, unknown> = {};
      if (/otonom/.test(t)) args.otonom = !/kapat/.test(t);
      if (/duraklat/.test(t)) args.duraklat = true;
      if (/devam\s*et/.test(t)) args.duraklat = false;
      const r = await this.tools.call("ajan_modu", args);
      return { text: r.pending ? `Onayın gerekiyor: ${r.pending.summary} Onaylıyor musun?` : r.error ?? "Tamam." };
    }
    if (/(senaryo|demo)/.test(t)) {
      const r = await this.tools.call("senaryo_baslat", {});
      return { text: r.pending ? `Onayın gerekiyor: ${r.pending.summary} Onaylıyor musun?` : r.error ?? "Tamam." };
    }
    const addr = text.match(/0x[0-9a-fA-F]{40}/)?.[0];
    if (addr) {
      const chain = (t.match(/\b(eth|ethereum|bsc|bnb|avax|avalanche|polygon|arbitrum|base|optimism)\b/)?.[1]) ?? "avax";
      const r = await this.tools.call("token_tara", { zincir: chain, adres: addr });
      if (!r.ok) return { text: r.error! };
      const d = r.data as any;
      if (!detail) return { text: `Token tarama: ${d.karar} (${d.token?.symbol ?? "bilinmeyen"}, ${d.zincir}). ${d.gerekceler[0] ?? ""}` };
      return { text: [`Token tarama: ${d.karar} (${d.token?.symbol ?? "bilinmeyen"}, ${d.zincir}).`, ...d.gerekceler.map((g: string) => `- ${g}`), ...d.kaynaklar.filter((k: any) => !k.erisim).map((k: any) => `- ${k.kaynak}: ${k.not ?? "kapalı"}`)].join("\n") };
    }
    if (/(hold|temel\s*analiz|arz|fdv|kilit\s*a[çc][ıi]l)/.test(t) && sym) {
      const r = await this.tools.call("hold_raporu", { sembol: sym });
      const d = r.data as any;
      if (!r.ok) return { text: r.error! };
      if (!detail) return { text: `${d.sembol}: ${d.karar}. ${d.gerekceler[0] ?? ""}` };
      const m = d.olcumler;
      return { text: [`${d.sembol} hold raporu: ${d.karar}.`, ...d.gerekceler.map((g: string) => `- ${g}`), `Dolaşım oranı ${m.circulatingRatio === null ? "-" : "%" + (m.circulatingRatio * 100).toFixed(0)}, FDV/piyasa değeri ${m.fdvToMc === null ? "-" : m.fdvToMc.toFixed(2)}, 90 gün kilit açılımı %${m.unlock90dPct.toFixed(1)} (ÖRNEK VERİ).`, `Cüzdan dağılımı: ${d.cuzdanDagilimi.status}. Kaynak: ${d.kaynak}.`].join("\n") };
    }
    if (/(vadeli|funding|open\s*interest|\boi\b|long\s*short|l\/s|kalabal)/.test(t)) {
      const id = sym ?? "BTC-USDT";
      const r = await this.tools.call("vadeli_durum", { sembol: id });
      if (!r.ok) return { text: r.error! };
      const d = r.data as any;
      if (!detail) return { text: `${d.sembol} vadeli: ${d.ozet}, manipülasyon şüphesi ${d.manipulasyonSuphesi}. ${d.gerekceler[0]}` };
      const f = (v: number | null, k = 2) => (v === null || v === undefined ? "-" : Number(v).toFixed(k));
      return { text: [`${d.sembol} vadeli durum: ${d.ozet}. Kalabalık taraf ${d.kalabalikTaraf}, manipülasyon şüphesi ${d.manipulasyonSuphesi}.`, ...d.gerekceler.map((g: string) => `- ${g}`), `Funding ${d.funding === null ? "-" : (d.funding * 100).toFixed(4) + "%"}, OI 1 sa ${f(d.oiDegisim1sa)}%, genel hesap oranı ${f(d.genelHesapOrani)}, üst trader oranı (pozisyon) ${f(d.ustTraderPozisyonOrani)}.`, `Kaynak: ${d.kaynak}. Vadeli veri yalnızca analiz girdisi; işlem spot.`].join("\n") };
    }
    if (/(listeme\s*ekle|listeye\s*ekle|takibe\s*al|takip\s*et|ekle)/.test(t) && sym) {
      const r = await this.tools.call("listeye_ekle", { sembol: sym });
      const d = r.data as any;
      return { text: r.ok ? `${sym.split("-")[0]} takip listende (${d.toplam} coin). Listeye almak işlem açmak değildir.${d.uyari ? " " + d.uyari : ""}` : r.error! };
    }
    if (/([çc][ıi]kar|b[ıi]rak|sil)/.test(t) && sym) {
      const r = await this.tools.call("listeden_cikar", { sembol: sym });
      return { text: r.ok ? `${sym.split("-")[0]} takip listenden çıktı.` : r.error! };
    }
    if (/(plan|da[ğg][ıi]l[ıi]m|ne\s*kadar)/.test(t)) {
      const r = await this.tools.call("plan_olustur", {});
      if (!r.ok) return { text: r.error! };
      const plan = r.data as any;
      if (!detail) return { text: explainPlanText(plan) };
      return { text: [explainPlanText(plan), ...plan.rows.map((row: any) => `- ${row.instId.split("-")[0]}: giriş ${row.entry}, stop ${row.stop}, R:R ${row.rr}, ${row.included ? `${row.notionalUsdt} USDT (risk ${row.riskUsdt})` : "dahil değil"}. ${row.note}`)].join("\n") };
    }
    if (/(portf[öo]y|bakiye|pozisyon|k[âa]r|zarar|k\/z|param)/.test(t)) {
      const r = await this.tools.call("portfoy", {});
      const d = r.data as any;
      const pos = d.pozisyonlar.length ? d.pozisyonlar.map((p: any) => `${p.sembol} ${p.kz >= 0 ? "+" : ""}${p.kz} USDT`).join(", ") : "açık pozisyon yok";
      if (!detail) return { text: `Değer ${d.deger} USDT, bugün ${d.gunlukKZ >= 0 ? "+" : ""}${d.gunlukKZ} USDT. ${d.pozisyonlar.length ? `Açık: ${pos}.` : "Açık pozisyon yok."}` };
      return { text: [`${d.mod === "PAPER" ? "Paper trade" : "Canlı işlem"} modu. Değer ${d.deger} USDT, nakit ${d.nakit} USDT, bugünkü PnL ${d.gunlukKZ >= 0 ? "+" : ""}${d.gunlukKZ} USDT.`, ...d.pozisyonlar.map((p: any) => `- ${p.sembol}: PnL ${p.kz >= 0 ? "+" : ""}${p.kz} USDT, giriş ${p.giris}, stop ${p.stop}, hedef ${p.hedef}.`)].join("\n") };
    }
    if (/(listem|takip\s*listem|takip\s*ettiklerim)/.test(t)) {
      const r = await this.tools.call("listem", {});
      const d = r.data as any[];
      return { text: d.length ? `Takip listende ${d.length} coin var: ${d.map((x) => `${x.sembol} (${x.karar})`).join(", ")}.` : "Takip listen boş. Keşfet sayfasında kartları sağa kaydırarak ekleyebilirsin." };
    }
    if (/(tara|yenile)/.test(t) && !sym) {
      const r = await this.tools.call("tara", {});
      const d = r.data as any;
      return { text: `Tarama tamamlandı. Öne çıkanlar: ${d.ilkUc.join(", ")}.` };
    }
    if (sym || /(analiz|incele|nas[ıi]l\s*g[öo]r[üu]n)/.test(t)) {
      const id = sym ?? normSymbol(t.split(/\s+/)[0]);
      if (id) {
        const r = await this.tools.call("aday_analizi", { sembol: id });
        if (r.ok) return { text: detail ? (r.data as any).text : (r.data as any).short };
        return { text: r.error! };
      }
    }
    if (/(durum|ajan|nas[ıi]l\s*gidiyor|ne\s*yap[ıi]yor|risk)/.test(t)) {
      const r = await this.tools.call("durum", {});
      const d = r.data as any;
      if (!detail) return { text: `Ajan ${d.ajan}, ${d.mod === "PAPER" ? "paper trade" : "canlı işlem"}; ${d.acikPozisyon} açık pozisyon, risk skoru ${d.riskSkoru} (${d.riskDurumu}).` };
      return { text: `Ajan ${d.ajan}, otonom mod ${d.otonom ? "açık" : "kapalı"}, ${d.mod === "PAPER" ? "paper trade" : "canlı işlem"} modunda.\n${d.taramaSayisi} tarama yaptı, ${d.acikPozisyon} açık pozisyon, takipte ${d.takipSayisi} coin.\nRisk skoru ${d.riskSkoru} (${d.riskDurumu}). ${d.canliVeri ? "Veri canlı (OKX ATK)." : "Canlı veri yok, örnek veri kullanılıyor."}` };
    }
    if (/(aday|f[ıi]rsat|[öo]neri|ke[şs]fet|ne\s*var)/.test(t)) {
      const r = await this.tools.call("adaylar", { adet: detail ? 6 : 3 });
      const d = r.data as any[];
      if (!detail) return { text: `Öne çıkan adaylar: ${d.map((c) => `${c.sembol} (${c.karar})`).join(", ")}. Birinin adını söylersen incelerim.` };
      return { text: ["Ajanın sıraladığı adaylar:", ...d.map((c) => `- ${c.sembol}: ${c.karar}, fırsat ${c.firsat}, risk ${c.risk}. ${c.gerekce}`)].join("\n") };
    }
    return { text: "Tam anlayamadım. \"adaylar\", \"SOL analizi\", \"portföyüm\", \"plan oluştur\" ya da \"durum\" diyebilirsin. Emir veremem; emirleri ajan verir." };
  }
}

export function explainPlanText(plan: { rows: any[]; totalNotional: number; totalRisk: number; notes: string[] }): string {
  const inc = plan.rows.filter((r) => r.included);
  if (!inc.length) return `Şu an limitler içinde anlamlı bir dağılım çıkmıyor. ${plan.rows[0]?.note ?? ""}`;
  const parts = inc.map((r) => `${r.instId.split("-")[0]} ${r.notionalUsdt} USDT (stop olursa ≈ ${r.riskUsdt} USDT)`);
  return `Kodun hesapladığı dağılım: ${parts.join(", ")}. Toplam ${plan.totalNotional} USDT, en kötü durumda ≈ ${plan.totalRisk} USDT kayıp. Bu bir tercih listesi; emri ajan kendi kararıyla ve kapıdan geçirerek verir.`;
}
