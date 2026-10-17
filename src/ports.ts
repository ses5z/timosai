// Portlar: her biri için Atk* (gerçek) ve Mock* uygulaması vardır.
import type { Candle } from "./util/math.js";
import type { DerivSnapshot } from "./derivatives/derivativesData.js";
import type { DerivAnalysis } from "./derivatives/rules.js";

export interface Ticker {
  instId: string;
  last: number;
  open24h: number;
  high24h: number;
  low24h: number;
  change24hPct: number;
  volUsdt24h: number;
  ts: number;
}

export interface OrderbookSummary {
  bid: number;
  ask: number;
  spreadPct: number;
  depthUsdt: number; // ±%1 içindeki toplam derinlik
}

export interface MarketData {
  readonly name: string;
  /** Son çağrılar gerçek veriden mi geldi? */
  isLive(): boolean;
  tickers(instIds: string[]): Promise<Map<string, Ticker>>;
  candles(instId: string, bar: string, limit: number, after?: number): Promise<Candle[]>;
  indicatorRsi(instId: string, bar: string): Promise<number | null>;
  funding(instId: string): Promise<number | null>;
  orderbook(instId: string): Promise<OrderbookSummary | null>;
  /** -1..1 arası duygu; erişilemezse boş harita. */
  sentiment(coins: string[]): Promise<Map<string, number>>;
  /** Son haberler (ATK news_get_latest); erişilemezse hata fırlatır. */
  news?(coins: string[]): Promise<{ coin: string; title: string; ts: number }[]>;
}

export type DecisionKind = "aç" | "izle" | "ele";

export interface ScoreParts {
  momentum: number;
  trend: number;
  volume: number;
  rsi: number;
  volatility: number;
  funding: number;
  sentiment: number | null; // veri yoksa null ("veri yok"), 50 değil
}

export interface SecuritySummary {
  sample: true; // ÖRNEK VERİ
  label: string;
  contractAudit: "var" | "yok" | "bilinmiyor";
  unlockNext30d: string;
  concentration: string;
  spreadPct: number | null; // gerçek (emir defteri)
  depthUsdt: number | null; // gerçek
  level: "iyi" | "orta" | "zayıf";
}

export interface Candidate {
  instId: string;
  base: string;
  category: string;
  price: number;
  change24hPct: number;
  volUsdt24h: number;
  spark: number[];
  atr: number;
  atrPct: number;
  vol1hRatio?: number; // son 1 saat hacmi / önceki 20 saatin ortalaması
  vol15mRatio?: number; // son 15 dk hacmi / önceki 20 mumun ortalaması
  rsi: number | null;
  funding: number | null;
  sentiment: number | null;
  parts: ScoreParts;
  opportunity: number;
  risk: number;
  decision: DecisionKind;
  direction: string;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  reason: string;
  whyBullets: string[];
  security: SecuritySummary;
  derivatives: DerivAnalysis | null;
  atrTrend: { dir: 1 | -1; line: number; lines: number[] } | null;
  updatedAt: number;
  live: boolean;
}

export interface DecisionInput {
  instId: string;
  category: string;
  ticker: Ticker;
  candles: Candle[];
  rsi: number | null;
  funding: number | null;
  sentiment: number | null;
  orderbook: OrderbookSummary | null;
  derivSnapshot?: DerivSnapshot | null;
  live: boolean;
}

export interface DecisionProvider {
  readonly name: string;
  decide(input: DecisionInput): Candidate;
}

export type NotifyKind = "development" | "chat" | "critical" | "warning" | "market";

export interface NotifyMessage {
  kind: NotifyKind;
  symbol?: string;
  text: string;
  buttons?: { text: string; data: string }[];
}

export interface Notifier {
  readonly name: string;
  enabled(): boolean;
  notify(msg: NotifyMessage): Promise<boolean>;
}

export interface ProofAnchor {
  readonly name: string;
  anchor(headHash: string, count: number): Promise<{ anchored: boolean; ref?: string; note: string }>;
  status(): Record<string, unknown>;
}
