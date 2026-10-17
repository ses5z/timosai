// Grafik zaman dilimleri (OKX mum "bar" değerleri). 6H ve üstü için OKX'in "utc" ekli varyantları kullanılır:
// varsayılan (eksiz) değerler Hong Kong saatine (UTC+8) hizalı; utc varyantı gün sınırını 00:00 UTC'ye (03:00 İstanbul) hizalar.
export const BARS = ["1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "6H", "12H", "1D", "3D", "1W", "1M"] as const;
export type Bar = (typeof BARS)[number];
const UTC_BARS = new Set(["6H", "12H", "1D", "3D", "1W", "1M"]);
export const BAR_MS: Record<Bar, number> = { "1m": 60e3, "3m": 180e3, "5m": 300e3, "15m": 900e3, "30m": 1800e3, "1H": 3600e3, "2H": 7200e3, "4H": 14400e3, "6H": 21600e3, "12H": 43200e3, "1D": 86400e3, "3D": 259200e3, "1W": 604800e3, "1M": 2592000e3 };
export function isBar(s: unknown): s is Bar {
  return typeof s === "string" && (BARS as readonly string[]).includes(s);
}
/** OKX isteğinde gönderilecek bar parametresi. */
export function okxBar(b: Bar): string {
  return UTC_BARS.has(b) ? `${b}utc` : b;
}
