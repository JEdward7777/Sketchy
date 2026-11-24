#!/usr/bin/env node
/**
 * Write the placeholder PWA icons (stage 1.5) into src/client/public/icons/.
 * Solid-colour PNGs drawn pixel by pixel so no image tooling is needed; the
 * real artwork replaces them in polish (phase 12).
 *
 *   node scripts/make-placeholder-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const OUT = join(import.meta.dirname, '..', 'src', 'client', 'public', 'icons');

const ACCENT = [0xff, 0x4f, 0x5e];
const PAPER = [0xff, 0xf8, 0xec];
const INK = [0x1d, 0x1b, 0x3a];

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A lens: paper disc with an ink pupil, centred, inside the maskable safe zone. */
function pixel(x, y, size) {
  const c = size / 2;
  const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
  if (d < size * 0.12) return INK;
  if (d < size * 0.3) return PAPER;
  return ACCENT;
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      for (const v of pixel(x, y, size)) raw[o++] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['icon-512-maskable.png', 512]]) {
  writeFileSync(join(OUT, name), png(size));
  console.log(`wrote ${name} (${size}x${size})`);
}
