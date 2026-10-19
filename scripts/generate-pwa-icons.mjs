#!/usr/bin/env node
/**
 * StreamPulse PWA icon generator.
 *
 * Pure Node — no image libraries. Encodes PNGs by hand (zlib + CRC32) and
 * rasterises the brand mark with 4x supersampling so the edges are smooth.
 *
 * Outputs:
 *   public/icons/icon-192.png           — any purpose
 *   public/icons/icon-512.png           — any purpose
 *   public/icons/icon-maskable-512.png  — maskable (glyph inside the 80% safe zone)
 *   public/icons/apple-touch-icon.png   — 180x180 for iOS home screen
 *
 * Run with: node scripts/generate-pwa-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

/* -------------------------------------------------------------------------- */
/* PNG encoding                                                                */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour + alpha
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Drawing                                                                     */
/* -------------------------------------------------------------------------- */

const hex = (value) => {
  const n = parseInt(value.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const BG_TOP = hex("#0f172a");
const BG_BOTTOM = hex("#020617");
const GLOW = hex("#06b6d4");
const TILE_STOPS = [hex("#22d3ee"), hex("#6366f1"), hex("#a855f7")];
const WHITE = [1, 1, 1];

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Signed distance to a rounded rectangle centred at the origin. */
function roundedRectDistance(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px) - halfW + radius;
  const qy = Math.abs(py) - halfH + radius;
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Point-in-triangle test (barycentric sign method). */
function inTriangle(px, py, a, b, c) {
  const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
  const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]);
  const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Sample the icon at normalised coordinates (0..1).
 * Returns straight (non-premultiplied) RGB in 0..1 — the icon is full-bleed.
 */
function sampleIcon(x, y, { maskable }) {
  // Background: diagonal navy gradient + cyan glow toward the top-left.
  const t = clamp01((x + y) / 2);
  let color = mix(BG_TOP, BG_BOTTOM, t);
  const glowDistance = Math.hypot(x - 0.3, y - 0.26);
  const glow = Math.max(0, 1 - glowDistance / 0.72) * 0.34;
  color = mix(color, GLOW, glow);

  // Brand tile: rounded square with the cyan → indigo → purple gradient.
  const tileHalf = (maskable ? 0.275 : 0.31) * 1; // fractions of the icon
  const tileRadius = tileHalf * 0.62;
  const tileDistance = roundedRectDistance(x - 0.5, y - 0.5, tileHalf, tileHalf, tileRadius);
  if (tileDistance <= 0) {
    const localX = (x - (0.5 - tileHalf)) / (tileHalf * 2);
    const localY = (y - (0.5 - tileHalf)) / (tileHalf * 2);
    const g = clamp01((localX + localY) / 2);
    const tileColor =
      g < 0.5 ? mix(TILE_STOPS[0], TILE_STOPS[1], g * 2) : mix(TILE_STOPS[1], TILE_STOPS[2], (g - 0.5) * 2);
    color = tileColor;

    // Play triangle, centred on the tile.
    const a = [0.5 - tileHalf + tileHalf * 0.72, 0.5 - tileHalf + tileHalf * 0.52];
    const b = [0.5 - tileHalf + tileHalf * 0.72, 0.5 - tileHalf + tileHalf * 1.48];
    const c = [0.5 - tileHalf + tileHalf * 1.5, 0.5 - tileHalf + tileHalf * 1.0];
    if (inTriangle(x, y, a, b, c)) color = WHITE;
  }

  return color;
}

function renderIcon(size, options) {
  const SS = 4;
  const samples = SS * SS;
  const rgba = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const [cr, cg, cb] = sampleIcon(x, y, options);
          r += cr;
          g += cg;
          b += cb;
        }
      }
      const offset = (py * size + px) * 4;
      rgba[offset] = Math.round((r / samples) * 255);
      rgba[offset + 1] = Math.round((g / samples) * 255);
      rgba[offset + 2] = Math.round((b / samples) * 255);
      rgba[offset + 3] = 255;
    }
  }

  return encodePng(size, size, rgba);
}

/* -------------------------------------------------------------------------- */
/* Emit                                                                        */
/* -------------------------------------------------------------------------- */

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ["icon-192.png", 192, { maskable: false }],
  ["icon-512.png", 512, { maskable: false }],
  ["icon-maskable-512.png", 512, { maskable: true }],
  ["apple-touch-icon.png", 180, { maskable: true }],
];

for (const [name, size, options] of targets) {
  const png = renderIcon(size, options);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`wrote public/icons/${name} (${size}x${size}, ${png.length} bytes)`);
}
