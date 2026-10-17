// Trading planı: planı ve limitleri kullanıcı yapar; ajan yalnızca bu plana göre otonom işlem açar ve her adımı
// plana referansla açıklar. Kodda kalan tek sabit kural: canlı modda girilen tutarlar hesap bakiyesini aşamaz;
// çekim/transfer araçları her koşulda yasak (hardLimits.ts araç izin listesi).
export interface TradingPlan {
  coins: string[];
  direction: "long" | "longshort";
  horizon: "scalp" | "swing" | "pozisyon";
  riskPct: number;
  maxOrderUsdt: number;
  maxTotalUsdt: number;
  maxPositions: number;
  maxOrdersPerHour: number;
  maxLeverage: number;
  minRR: number;
  minOpportunity: number;
  followLine: boolean;
  avoidCrowded: boolean;
  partialPct: number;
  trailMode: "atrTrend" | "atr";
  maxHoldHours: number;
  dailyLossWarnUsdt: number;
  requireStop: boolean;
}

export function defaultPlan(live: boolean, coins: string[]): TradingPlan {
  const common = { coins: [...coins], direction: "long" as const, horizon: "swing" as const, maxOrdersPerHour: 6, maxLeverage: 5, minRR: 2, minOpportunity: 60, followLine: true, avoidCrowded: true, partialPct: 50, trailMode: "atrTrend" as const, maxHoldHours: 24, requireStop: true };
  // Canlı mod ilk açılış: muhafazakâr varsayılanlar (kullanıcı plandan değiştirebilir).
  if (live) return { ...common, riskPct: 0.5, maxOrderUsdt: 5, maxTotalUsdt: 15, maxPositions: 3, dailyLossWarnUsdt: 5 };
  return { ...common, riskPct: 1, maxOrderUsdt: 100, maxTotalUsdt: 400, maxPositions: 4, dailyLossWarnUsdt: 50 };
}

const num = (v: unknown, lo: number, hi: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

/** Kullanıcı girdisini doğrular. Canlıda tutarlar bakiyeyi aşamaz (tek sabit kural). */
export function sanitizePlan(input: Partial<TradingPlan>, base: TradingPlan, opts: { live: boolean; balance: number | null; validCoins: string[] }): { plan: TradingPlan; notes: string[] } {
  const notes: string[] = [];
  const p: TradingPlan = { ...base };
  if (Array.isArray(input.coins)) {
    const c = input.coins.map(String).filter((x) => opts.validCoins.includes(x));
    if (c.length) p.coins = [...new Set(c)];
  }
  if (input.direction === "long" || input.direction === "longshort") p.direction = input.direction;
  if (input.horizon === "scalp" || input.horizon === "swing" || input.horizon === "pozisyon") p.horizon = input.horizon;
  p.riskPct = num(input.riskPct, 0.1, 10, p.riskPct);
  p.maxOrderUsdt = num(input.maxOrderUsdt, 1, 1e9, p.maxOrderUsdt);
  p.maxTotalUsdt = num(input.maxTotalUsdt, 1, 1e9, p.maxTotalUsdt);
  p.maxPositions = Math.round(num(input.maxPositions, 1, 50, p.maxPositions));
  p.maxOrdersPerHour = Math.round(num(input.maxOrdersPerHour, 1, 120, p.maxOrdersPerHour));
  p.maxLeverage = num(input.maxLeverage, 1, 50, p.maxLeverage);
  p.minRR = num(input.minRR, 0.5, 10, p.minRR);
  p.minOpportunity = num(input.minOpportunity, 0, 100, p.minOpportunity);
  if (typeof input.followLine === "boolean") p.followLine = input.followLine;
  if (typeof input.avoidCrowded === "boolean") p.avoidCrowded = input.avoidCrowded;
  p.partialPct = num(input.partialPct, 0, 100, p.partialPct);
  if (input.trailMode === "atr" || input.trailMode === "atrTrend") p.trailMode = input.trailMode;
  p.maxHoldHours = num(input.maxHoldHours, 1, 24 * 30, p.maxHoldHours);
  p.dailyLossWarnUsdt = num(input.dailyLossWarnUsdt, 0.1, 1e9, p.dailyLossWarnUsdt);
  if (typeof input.requireStop === "boolean") p.requireStop = input.requireStop;
  if (p.maxOrderUsdt > p.maxTotalUsdt) {
    p.maxOrderUsdt = p.maxTotalUsdt;
    notes.push("Tek işlem tutarı toplam açık tutarı aşamaz; eşitlendi.");
  }
  if (opts.live && opts.balance !== null) {
    if (p.maxTotalUsdt > opts.balance) {
      p.maxTotalUsdt = Math.floor(opts.balance * 100) / 100;
      notes.push(`Canlı modda toplam açık tutar bakiyeyi (${opts.balance.toFixed(2)} USDT) aşamaz; kırpıldı.`);
    }
    if (p.maxOrderUsdt > p.maxTotalUsdt) p.maxOrderUsdt = p.maxTotalUsdt;
  }
  return { plan: p, notes };
}

/** Emir günlüğü için plana referans: "Plan: risk %1 · R:R ≥ 2 · Follow Line uyumlu ✓". */
export function planRef(p: TradingPlan, checks: { followLine?: boolean } = {}): string {
  const fl = p.followLine ? ` · Follow Line uyumlu ${checks.followLine === false ? "✗" : "✓"}` : "";
  return `Plan: risk %${p.riskPct} · R:R ≥ ${p.minRR}${fl}`;
}

/** Vade tercihine göre zaman dilimi rolleri: yön belirleyen üst dilimler ve giriş dilimi. */
export function horizonFrames(h: TradingPlan["horizon"]): { trend: ["1H" | "4H" | "1D", "4H" | "1D"]; entry: "15m" | "1H" | "4H"; label: string } {
  if (h === "scalp") return { trend: ["1H", "4H"], entry: "15m", label: "scalp" };
  if (h === "pozisyon") return { trend: ["4H", "1D"], entry: "4H", label: "pozisyon" };
  return { trend: ["4H", "1D"], entry: "1H", label: "swing" };
}
