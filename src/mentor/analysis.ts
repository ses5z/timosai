// Aday analizi: teknik tablo, giriş/stop/hedef, R:R, risk bütçesine göre örnek boyut, dikkat edilecekler.
// Boyutu KOD hesaplar; mentor yalnızca açıklar. Yatırım tavsiyesi içermez.
import type { AppContext } from "../context.js";
import { sizePosition, type SizeResult } from "../agent/sizing.js";
import type { Candidate } from "../ports.js";
import { round } from "../util/math.js";

export interface Analysis {
  instId: string;
  base: string;
  decision: Candidate["decision"];
  direction: string;
  headline: string;
  table: { label: string; value: string; note: string }[];
  levels: { entry: number; stop: number; target: number; rr: number; stopPct: number; targetPct: number };
  size: SizeResult;
  cautions: string[];
  scenarios: { lehte: string; aleyhte: string };
  security: Candidate["security"];
  /** Kısa (varsayılan): karar, giriş/stop/hedef, R:R, tek uyarı. */
  short: string;
  /** Ayrıntılı: bölümlü, sayılarla. */
  text: string;
  live: boolean;
}

const DECISION_TEXT = {
  aç: "ajanın kuralları giriş koşullarının sağlandığını gösteriyor",
  izle: "ajan izlemede tutuyor; koşulların bir kısmı eksik",
  ele: "ajan şimdilik eledi; koşullar zayıf",
} as const;

export function analyzeCandidate(ctx: AppContext, instId: string, override?: Candidate | null): Analysis | null {
  const c = override ?? ctx.agent.candidates.get(instId);
  if (!c) return null;
  const t = ctx.agent.trading;
  const size = sizePosition({ equityUsdt: t.equity(), riskPct: ctx.store.settings.riskPct, entry: c.entry, stop: c.stop, openNotionalUsdt: t.openNotional(), limits: ctx.limits });
  const stopPct = round(((c.entry - c.stop) / c.entry) * 100, 2);
  const targetPct = round(((c.target - c.entry) / c.entry) * 100, 2);
  const table = [
    { label: "Fırsat skoru", value: `${c.opportunity}/100`, note: "ivme, trend, hacim, RSI, oynaklık, funding, duygu" },
    { label: "Risk puanı", value: `${c.risk}/100`, note: c.risk >= 55 ? "yüksek" : c.risk >= 35 ? "orta" : "düşük" },
    { label: "Trend", value: c.direction, note: `trend bileşeni ${c.parts.trend}` },
    { label: "RSI (1 sa)", value: c.rsi === null ? "veri yok" : String(c.rsi), note: c.rsi === null ? "" : c.rsi >= 70 ? "aşırı alım bölgesi" : c.rsi <= 30 ? "aşırı satım bölgesi" : "dengeli" },
    { label: "Oynaklık (ATR)", value: `%${c.atrPct}`, note: "15 dakikalık mum başına tipik hareket" },
    { label: "Funding", value: c.funding === null ? "veri yok" : `${(c.funding * 100).toFixed(4)}%`, note: c.funding !== null && Math.abs(c.funding) > 0.0003 ? "kalabalık taraf işareti" : "nötr" },
    { label: "24 sa değişim", value: `${c.change24hPct >= 0 ? "+" : ""}${c.change24hPct}%`, note: "" },
    { label: "Makas", value: c.security.spreadPct === null ? "ölçülmedi" : `%${c.security.spreadPct}`, note: "gerçek emir defterinden" },
  ];
  const cautions: string[] = [];
  if (c.rsi !== null && c.rsi >= 70) cautions.push("RSI aşırı alım bölgesinde; geri çekilme riski artar.");
  if (c.atrPct > 0.8) cautions.push("Oynaklık yüksek; stop mesafesi geniş, boyut küçük tutulur.");
  if (c.funding !== null && c.funding > 0.0003) cautions.push("Funding pozitif ve yüksek; kalabalık long pozisyon olabilir.");
  if (c.security.level !== "iyi") cautions.push(`Güvenlik özeti "${c.security.level}" (ÖRNEK VERİ + gerçek makas).`);
  if (c.rr < ctx.contract.minRR) cautions.push(`R:R ${c.rr}; sözleşmedeki en az ${ctx.contract.minRR} şartını karşılamıyor.`);
  if (size.cappedBy !== "risk" && size.notionalUsdt > 0) cautions.push(`Boyut ${size.cappedBy} ile sınırlandı.`);
  if (size.notionalUsdt === 0) cautions.push(size.explain);
  cautions.push("Her girişte stop zorunlu; ajan stopsuz emir vermez.");
  const scenarios = {
    lehte: `Fiyat ${c.target} hedefine ulaşırsa yaklaşık %${targetPct} hareket; örnek boyutla ≈ ${round(size.notionalUsdt * (targetPct / 100), 3)} USDT.`,
    aleyhte: `Fiyat ${c.stop} stopuna inerse yaklaşık %${stopPct} kayıp; örnek boyutla ≈ ${size.riskUsdt} USDT.`,
  };
  const headline = `${c.base}: ${DECISION_TEXT[c.decision]}.`;
  const shortWarn = cautions.find((x) => !x.startsWith("Her girişte stop")) ?? null;
  const short = [
    `${c.base}: ajan "${c.decision}" diyor (${c.direction.toLocaleLowerCase("tr")}).`,
    `Giriş ${c.entry}, stop ${c.stop} (-%${stopPct}), hedef ${c.target}, R:R ${c.rr}.`,
    shortWarn ? `Dikkat: ${shortWarn}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const text = [
    `Karar: ${headline} Fırsat ${c.opportunity}, risk ${c.risk}.`,
    `Teknik: ${c.direction}; RSI ${c.rsi ?? "-"}; ATR fiyatın %${c.atrPct}'i${c.atrTrend ? `; ATR trend ${c.atrTrend.dir === 1 ? "yükseliş" : "düşüş"} yönünde` : ""}.`,
    c.derivatives?.available ? `Vadeli: ${c.derivatives.badge}. ${c.derivatives.reasons[0]}` : "",
    `Fiyat noktaları: giriş ${c.entry}, stop ${c.stop} (%${stopPct}), hedef ${c.target} (%${targetPct}), R:R ${c.rr}.`,
    size.notionalUsdt > 0 ? `Risk bütçene göre örnek boyut ${size.notionalUsdt.toFixed(2)} USDT; stop olursa kayıp ≈ ${size.riskUsdt} USDT.` : `Şu an anlamlı bir boyut çıkmıyor: ${size.explain}`,
    `Senaryolar: lehte ${scenarios.lehte} Aleyhte ${scenarios.aleyhte}`,
    cautions.length ? `Dikkat: ${cautions.slice(0, 3).join(" ")}` : "",
    "Yatırım tavsiyesi değildir; emri ajan kendi kuralları ve sert limitler içinde verir.",
  ]
    .filter(Boolean)
    .join("\n");
  return { instId, base: c.base, decision: c.decision, direction: c.direction, headline, table, levels: { entry: c.entry, stop: c.stop, target: c.target, rr: c.rr, stopPct, targetPct }, size, cautions, scenarios, security: c.security, short, text, live: c.live };
}
