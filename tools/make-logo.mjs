/**
 * Logo generator.
 *
 * Draws the TrustPaste mark once, in code, and emits both the inline SVG used
 * on the site and the PNG sizes the extension manifest needs. No opaque binary
 * assets in the repository: every pixel is reproducible from this file.
 *
 *   node tools/make-logo.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ICON_DIR = resolve(import.meta.dirname, '..', 'extension', 'icons');
const ASSET_DIR = resolve(import.meta.dirname, '..', 'assets');
const PNG_SIZES = [16, 32, 48, 128, 256];

/**
 * The mark: three stacked text lines inside a bracket, with the middle line
 * broken by a gap - text with something taken out of it. Drawn on a 24x24
 * grid so it stays crisp at small sizes.
 */
const GEOMETRY = {
  // Bracket: an open square missing its right edge, suggesting a container.
  bracket: { x: 3.6, y: 3.2, w: 16.8, h: 17.6, r: 2.6, stroke: 1.9 },
  lines: [
    { y: 9.2, x1: 7.6, x2: 16.4, gap: null },
    { y: 12.4, x1: 7.6, x2: 16.4, gap: [11.4, 13.0] },
    { y: 15.6, x1: 7.6, x2: 13.6, gap: null },
  ],
  lineWidth: 1.7,
};

function buildSvg({ mono = false } = {}) {
  const { bracket: b, lines, lineWidth } = GEOMETRY;
  const fg = mono ? 'currentColor' : 'var(--logo-fg, currentColor)';

  const segments = [];
  for (const line of lines) {
    if (!line.gap) {
      segments.push(
        `<path d="M${line.x1} ${line.y}H${line.x2}" stroke="${fg}" stroke-width="${lineWidth}" stroke-linecap="round"/>`
      );
    } else {
      const [gapStart, gapEnd] = line.gap;
      segments.push(
        `<path d="M${line.x1} ${line.y}H${gapStart}" stroke="${fg}" stroke-width="${lineWidth}" stroke-linecap="round"/>`,
        `<path d="M${gapEnd} ${line.y}H${line.x2}" stroke="${fg}" stroke-width="${lineWidth}" stroke-linecap="round"/>`
      );
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">`,
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.r}" stroke="${fg}" stroke-width="${b.stroke}"/>`,
    `<path d="M9.4 3.2h5.2" stroke="${fg}" stroke-width="${b.stroke}" stroke-linecap="round"/>`,
    ...segments,
    `</svg>`,
  ].join('');
}

/* ---------------------------------------------------------------- PNG ---- */

const INK = [38, 38, 38];
const PAPER = [254, 249, 237];
const SAMPLES = 4;

function insideRoundedRect(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius);
  const dy = Math.abs(y - cy) - (halfH - radius);
  const outer = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outer + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Distance to a horizontal capsule, used for the text lines. */
function insideCapsule(x, y, x1, x2, cy, halfThick) {
  const cx = (x1 + x2) / 2;
  const halfLen = (x2 - x1) / 2;
  const dx = Math.max(Math.abs(x - cx) - halfLen, 0);
  const dy = Math.abs(y - cy);
  return Math.hypot(dx, dy) - halfThick;
}

/** Sample the mark in 24-unit space, returning a colour or null. */
function sample(u, v) {
  const { bracket: b, lines, lineWidth } = GEOMETRY;

  // Rounded app-tile background.
  if (insideRoundedRect(u, v, 12, 12, 12, 12, 5.4) > 0) return null;

  const half = b.stroke / 2;
  const outline = insideRoundedRect(
    u,
    v,
    b.x + b.w / 2,
    b.y + b.h / 2,
    b.w / 2,
    b.h / 2,
    b.r
  );
  if (Math.abs(outline) <= half) return PAPER;

  // Tab across the top edge.
  if (insideCapsule(u, v, 9.4, 14.6, b.y, half) <= 0) return PAPER;

  for (const line of lines) {
    if (insideCapsule(u, v, line.x1, line.x2, line.y, lineWidth / 2) <= 0) {
      if (line.gap && u > line.gap[0] - 0.35 && u < line.gap[1] + 0.35) {
        return INK;
      }
      return PAPER;
    }
  }
  return INK;
}

function render(size) {
  const rows = [];
  for (let py = 0; py < size; py += 1) {
    const row = Buffer.alloc(size * 4 + 1);
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let bl = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const u = ((px + (sx + 0.5) / SAMPLES) / size) * 24;
          const v = ((py + (sy + 0.5) / SAMPLES) / size) * 24;
          const colour = sample(u, v);
          if (colour) {
            r += colour[0];
            g += colour[1];
            bl += colour[2];
            a += 255;
          }
        }
      }
      const total = SAMPLES * SAMPLES;
      const alpha = a / total;
      const scale = a > 0 ? 255 / a : 0;
      const o = 1 + px * 4;
      row[o] = Math.round(r * scale);
      row[o + 1] = Math.round(g * scale);
      row[o + 2] = Math.round(bl * scale);
      row[o + 3] = Math.round(alpha);
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

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
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(ICON_DIR, { recursive: true });
mkdirSync(ASSET_DIR, { recursive: true });

writeFileSync(join(ASSET_DIR, 'logo.svg'), `${buildSvg({ mono: true })}\n`);
console.log('logo.svg');

for (const size of PNG_SIZES) {
  const png = toPng(size, render(size));
  if (size <= 128) writeFileSync(join(ICON_DIR, `icon-${size}.png`), png);
  writeFileSync(join(ASSET_DIR, `icon-${size}.png`), png);
  console.log(`icon-${size}.png  ${png.length} bytes`);
}
