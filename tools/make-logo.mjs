/**
 * Logo generator.
 *
 * Draws the TruePaste mark and emits the PNG sizes the extension manifest and
 * the site need. No opaque binary assets in the repository: every pixel here is
 * reproducible from this file.
 *
 * The mark: a shield holding a paragraph. One line is broken, with the removed
 * character marked in red; a green tick sweeps across the whole shield. Text is
 * cut wherever it comes within the tick's clearance band, so the tick can never
 * be crossed by a line - the clearance is computed, not eyeballed.
 *
 *   node tools/make-logo.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ICON_DIR = resolve(import.meta.dirname, '..', 'extension', 'icons');
const ASSET_DIR = resolve(import.meta.dirname, '..', 'assets');
const PNG_SIZES = [16, 32, 48, 128, 256];

/* Palette ---------------------------------------------------------------- */

const TILE = [44, 36, 24]; // #2c2418  the rounded tile behind the mark
const SHIELD = [253, 246, 233]; // #fdf6e9  the shield itself
const LINES = [44, 36, 24]; // text knocked out of the shield
const FLAG = [194, 65, 12]; // #c2410c  the removed character
const GOOD = [77, 156, 90]; // #4d9c5a  the tick

/* Geometry, in a 32-unit square ------------------------------------------- */

/** The rounded tile the header sets the mark on. */
const TILE_RADIUS = 9.2;

/**
 * Shield outline, matching the SVG path:
 *   M16 2.2 L27.4 6.4 V15.7 C..16 30.7.. C..4.6 15.7 V6.4 Z
 * Scaled slightly inside the tile so it has a margin.
 */
const SHIELD_PATH = {
  apex: [16, 5.6],
  shoulderRight: [24.6, 8.8],
  waistRight: [24.6, 15.8],
  point: [16, 27.1],
  waistLeft: [7.4, 15.8],
  shoulderLeft: [7.4, 8.8],
  ctrlRight: [
    [24.6, 21.2],
    [21, 25.2],
  ],
  ctrlLeft: [
    [11, 25.2],
    [7.4, 21.2],
  ],
};

const TICK = {
  points: [
    [9.8, 15.9],
    [14.2, 20.7],
    [22.2, 10.8],
  ],
  width: 2.3,
  clearance: 5.0,
};

/**
 * Text lines inside the shield, positioned clear of the tick's path.
 * `minSize` drops the finer lines from the small icons, where they would
 * otherwise blur into the shield and muddy the mark.
 */
const TEXT_LINES = [
  { y: 11.2, x1: 10.2, x2: 17.9, colour: LINES, width: 1.5, minSize: 0 },
  { y: 13.9, x1: 10.2, x2: 15.0, colour: LINES, width: 1.5, minSize: 48 },
  { y: 18.4, x1: 18.2, x2: 20.5, colour: FLAG, width: 1.7, minSize: 0 },
  { y: 21.2, x1: 16.2, x2: 19.8, colour: LINES, width: 1.5, minSize: 48 },
];

const SAMPLES = 4; // supersampling per axis

/* Shield as a polygon ------------------------------------------------------ */

function cubicAt(t, p0, c0, c1, p1) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * c0[0] + 3 * u * t * t * c1[0] + t * t * t * p1[0],
    u * u * u * p0[1] + 3 * u * u * t * c0[1] + 3 * u * t * t * c1[1] + t * t * t * p1[1],
  ];
}

function buildShieldPolygon(steps = 48) {
  const s = SHIELD_PATH;
  const pts = [s.apex, s.shoulderRight, s.waistRight];
  for (let i = 1; i <= steps; i += 1) {
    pts.push(cubicAt(i / steps, s.waistRight, s.ctrlRight[0], s.ctrlRight[1], s.point));
  }
  for (let i = 1; i <= steps; i += 1) {
    pts.push(cubicAt(i / steps, s.point, s.ctrlLeft[0], s.ctrlLeft[1], s.waistLeft));
  }
  pts.push(s.shoulderLeft);
  return pts;
}

const SHIELD_POLY = buildShieldPolygon();

/** Standard ray-casting point-in-polygon test. */
function insideShield(x, y) {
  let inside = false;
  for (let i = 0, j = SHIELD_POLY.length - 1; i < SHIELD_POLY.length; j = i, i += 1) {
    const [xi, yi] = SHIELD_POLY[i];
    const [xj, yj] = SHIELD_POLY[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/* Distance helpers --------------------------------------------------------- */

/** Distance to a horizontal capsule - a stroked line with round caps. */
function distCapsule(x, y, x1, x2, cy, halfThick) {
  const cx = (x1 + x2) / 2;
  const halfLen = (x2 - x1) / 2;
  const dx = Math.max(Math.abs(x - cx) - halfLen, 0);
  return Math.hypot(dx, y - cy) - halfThick;
}

function distSegment(px, py, [ax, ay], [bx, by]) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function distTick(x, y) {
  const [a, b, c] = TICK.points;
  return Math.min(distSegment(x, y, a, b), distSegment(x, y, b, c));
}

/** Distance to a rounded rectangle covering the whole square. */
function insideTile(x, y) {
  const half = 16 - 0.4;
  const r = TILE_RADIUS;
  const dx = Math.abs(x - 16) - (half - r);
  const dy = Math.abs(y - 16) - (half - r);
  const outer = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outer + Math.min(Math.max(dx, dy), 0) - r <= 0;
}

/**
 * Sample the mark at a point in 32-unit space. Returns a colour or null.
 *
 * The text lines inside the shield cannot hold their shape below 128px, so the
 * small icons drop them and show the shield with the tick alone. The shield
 * itself stays at every size: it is one solid form, and it is what makes the
 * mark ours rather than a generic tick.
 */
function sample(x, y, size) {
  if (!insideTile(x, y)) return null;
  if (!insideShield(x, y)) return TILE;

  const small = size < 128;
  const tickDist = distTick(x, y);
  const tickWidth = small ? TICK.width * 1.3 : TICK.width;

  if (tickDist <= tickWidth / 2) return GOOD;
  if (small) return SHIELD;

  if (tickDist > TICK.clearance / 2) {
    for (const line of TEXT_LINES) {
      if (size < line.minSize) continue;
      if (distCapsule(x, y, line.x1, line.x2, line.y, line.width / 2) <= 0) {
        return line.colour;
      }
    }
  }

  return SHIELD;
}

/* Rasteriser --------------------------------------------------------------- */

function render(size) {
  const rows = [];
  for (let py = 0; py < size; py += 1) {
    const row = Buffer.alloc(size * 4 + 1);
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = ((px + (sx + 0.5) / SAMPLES) / size) * 32;
          const y = ((py + (sy + 0.5) / SAMPLES) / size) * 32;
          const colour = sample(x, y, size);
          if (colour) {
            r += colour[0];
            g += colour[1];
            b += colour[2];
            a += 255;
          }
        }
      }
      const total = SAMPLES * SAMPLES;
      const alpha = a / total;
      const scale = a > 0 ? 255 / a : 0; // un-premultiply so edges keep colour
      const o = 1 + px * 4;
      row[o] = Math.round(r * scale);
      row[o + 1] = Math.round(g * scale);
      row[o + 2] = Math.round(b * scale);
      row[o + 3] = Math.round(alpha);
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

/* PNG encoder -------------------------------------------------------------- */

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* Output ------------------------------------------------------------------- */

mkdirSync(ICON_DIR, { recursive: true });
mkdirSync(ASSET_DIR, { recursive: true });

for (const size of PNG_SIZES) {
  const png = toPng(size, render(size));
  if (size <= 128) writeFileSync(join(ICON_DIR, `icon-${size}.png`), png);
  writeFileSync(join(ASSET_DIR, `icon-${size}.png`), png);
  console.log(`icon-${size}.png  ${png.length} bytes`);
}
