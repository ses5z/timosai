// Bağımlılıksız PNG çizgi grafik: RGBA piksel tamponu + node:zlib (deflate) + CRC32.
// Koyu mürekkep zemin, amber çizgi ve alan dolgusu, giriş/stop/hedef yatay kesikli çizgileri.
import zlib from "node:zlib";

type RGB = [number, number, number];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** RGBA tamponunu PNG'ye kodlar (filtre 0, renk tipi 6). */
export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit derinliği
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

class Canvas {
  readonly px: Buffer;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = Buffer.alloc(w * h * 4);
  }

  blend(x: number, y: number, c: RGB, a: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4;
    const al = Math.min(1, a);
    this.px[i] = this.px[i] + (c[0] - this.px[i]) * al;
    this.px[i + 1] = this.px[i + 1] + (c[1] - this.px[i + 1]) * al;
    this.px[i + 2] = this.px[i + 2] + (c[2] - this.px[i + 2]) * al;
    this.px[i + 3] = 255;
  }

  background(top: RGB, bottom: RGB): void {
    for (let y = 0; y < this.h; y++) {
      const t = y / (this.h - 1);
      const c: RGB = [top[0] + (bottom[0] - top[0]) * t, top[1] + (bottom[1] - top[1]) * t, top[2] + (bottom[2] - top[2]) * t];
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        this.px[i] = c[0];
        this.px[i + 1] = c[1];
        this.px[i + 2] = c[2];
        this.px[i + 3] = 255;
      }
    }
  }

  hline(y: number, x0: number, x1: number, c: RGB, thick: number, dash?: [number, number], a = 1): void {
    for (let x = Math.round(x0); x <= x1; x++) {
      if (dash && (x - x0) % (dash[0] + dash[1]) >= dash[0]) continue;
      for (let k = 0; k < thick; k++) this.blend(x, y - Math.floor(thick / 2) + k, c, a);
    }
  }

  /** Yumuşak kenarlı fırça ile kalın çizgi. */
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, r: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, c, 0.55);
    }
  }

  disc(cx: number, cy: number, r: number, c: RGB, a = 1): void {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.hypot(x - cx, y - cy);
        const cov = Math.max(0, Math.min(1, r + 0.5 - d));
        if (cov > 0) this.blend(x, y, c, cov * a);
      }
    }
  }
}

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const CHART_COLORS = { ink: hex("#0d1320"), ink2: hex("#151d2f"), grid: hex("#26324a"), amber: hex("#f2a93b"), coral: hex("#ef7d5e"), cream: hex("#d3c9b8"), stop: hex("#f06a66"), target: hex("#62c98f") };

export interface ChartLevel {
  v: number;
  kind: "entry" | "stop" | "target";
}

/** Kapanış fiyatlarından çizgi grafik PNG'si (varsayılan 800x450). */
export function renderLineChartPng(closes: number[], levels: ChartLevel[] = [], width = 800, height = 450): Buffer {
  const C = CHART_COLORS;
  const cv = new Canvas(width, height);
  cv.background(C.ink2, C.ink);
  const pad = { l: 28, r: 40, t: 30, b: 30 };
  const pw = width - pad.l - pad.r;
  const ph = height - pad.t - pad.b;
  for (let i = 0; i <= 4; i++) cv.hline(pad.t + (ph * i) / 4, pad.l, width - pad.r, C.grid, 1, undefined, 0.6);
  const data = closes.filter((v) => Number.isFinite(v));
  if (data.length < 2) return encodePng(width, height, cv.px);
  const vals = data.concat(levels.map((l) => l.v).filter((v) => Number.isFinite(v) && v > 0));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const span = hi - lo;
  lo -= span * 0.06;
  hi += span * 0.06;
  const X = (i: number) => pad.l + (i / (data.length - 1)) * pw;
  const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * ph;
  const bottom = pad.t + ph;
  // alan dolgusu (yukarıdan aşağı sönen amber)
  for (let x = Math.ceil(X(0)); x <= Math.floor(X(data.length - 1)); x++) {
    const f = ((x - pad.l) / pw) * (data.length - 1);
    const i = Math.min(data.length - 2, Math.floor(f));
    const y = Y(data[i] + (data[i + 1] - data[i]) * (f - i));
    for (let yy = Math.ceil(y); yy <= bottom; yy++) cv.blend(x, yy, C.amber, 0.32 * (1 - (yy - y) / Math.max(1, bottom - y)));
  }
  // seviye çizgileri
  const levelColor = { entry: C.cream, stop: C.stop, target: C.target } as const;
  for (const l of levels) {
    if (!(l.v > 0)) continue;
    const y = Y(l.v);
    cv.hline(y, pad.l, width - pad.r, levelColor[l.kind], 2, [14, 9], 0.9);
    cv.disc(width - pad.r + 18, y, 6, levelColor[l.kind]);
  }
  // fiyat çizgisi
  for (let i = 1; i < data.length; i++) cv.line(X(i - 1), Y(data[i - 1]), X(i), Y(data[i]), C.amber, 1.9);
  cv.disc(X(data.length - 1), Y(data[data.length - 1]), 7, C.coral);
  cv.disc(X(data.length - 1), Y(data[data.length - 1]), 3, C.ink);
  return encodePng(width, height, cv.px);
}
