// Generates the PWA icons (no dependencies): a clock with a highlighted time-box.
// Run `npm run icons` after changing the artwork; the PNGs are committed.
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(out, { recursive: true });

const BG = [0x4b, 0x2e, 0x83];
const WHITE = [255, 255, 255];
const APRICOT = [0xf0, 0x8a, 0x5d];

// Signed-distance helpers in unit coordinates (0..1).
const capsule = (x, y, ax, ay, bx, by, r) => {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * t, py - dy * t) - r;
};

function colorAt(x, y) {
  const cx = 0.5, cy = 0.5;
  const dist = Math.hypot(x - cx, y - cy);
  const ang = Math.atan2(y - cy, x - cx); // 0 = 3 o'clock, -π/2 = 12 o'clock
  let c = BG;
  // Clock ring (white) with the first quarter-hour highlighted in apricot.
  if (dist <= 0.3 && dist >= 0.25) c = ang >= -Math.PI / 2 && ang <= 0 ? APRICOT : WHITE;
  // Hands.
  if (capsule(x, y, cx, cy, cx, cy - 0.17, 0.02) <= 0) c = WHITE; // minute hand → 12
  if (capsule(x, y, cx, cy, cx + 0.115, cy, 0.02) <= 0) c = WHITE; // hour hand → 3
  if (dist <= 0.032) c = WHITE;
  return c;
}

function render(size) {
  const SS = 3; // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // PNG filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          r += c[0]; g += c[1]; b += c[2];
        }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = Math.round(r / SS ** 2);
      raw[o + 1] = Math.round(g / SS ** 2);
      raw[o + 2] = Math.round(b / SS ** 2);
      raw[o + 3] = 255;
    }
  }
  return raw;
}

function png(size) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(render(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Full-bleed artwork inside the maskable safe zone, so one image serves "any" and "maskable".
for (const [name, size] of [['pwa-192x192.png', 192], ['pwa-512x512.png', 512], ['pwa-maskable-512x512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(join(out, name), png(size));
  console.log('wrote', name);
}

writeFileSync(
  join(out, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#4B2E83"/><circle cx="50" cy="50" r="27.5" fill="none" stroke="#fff" stroke-width="5"/><path d="M50 22.5A27.5 27.5 0 0 1 77.5 50" fill="none" stroke="#F08A5D" stroke-width="5"/><path d="M50 50V33M50 50h11.5" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="50" r="3.2" fill="#fff"/></svg>\n`,
);
console.log('wrote favicon.svg');
