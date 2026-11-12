import { deflateSync } from 'node:zlib';

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

const GLYPHS = [
  ['#####', '##..#', '##..#', '##..#', '####.', '##..#', '##..#', '##..#', '##..#', '##..#', '##..#', '#####'],
  ['#####', '##..#', '##..#', '##..#', '####.', '##.#.', '##..#', '##..#', '##..#', '##..#', '##..#', '##..#'],
  ['#####', '##..#', '##..#', '##..#', '##..#', '##..#', '##..#', '##..#', '##..#', '##..#', '##..#', '#####'],
];

const SIZE = 22;
const RADIUS = 5;
const WARNING = { r: 251, g: 191, b: 36 };

function coverage(x: number, y: number): number {
  const px = x + 0.5;
  const py = y + 0.5;
  const dx = px < RADIUS ? RADIUS - px : px > SIZE - RADIUS ? px - (SIZE - RADIUS) : 0;
  const dy = py < RADIUS ? RADIUS - py : py > SIZE - RADIUS ? py - (SIZE - RADIUS) : 0;
  if (dx === 0 && dy === 0) return 1;
  return Math.max(0, Math.min(1, RADIUS + 0.5 - Math.hypot(dx, dy)));
}

function paint(alert: boolean): Buffer {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  const set = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const index = y * (SIZE * 4 + 1) + 1 + x * 4;
    raw[index] = r;
    raw[index + 1] = g;
    raw[index + 2] = b;
    raw[index + 3] = a;
  };
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const alpha = Math.round(coverage(x, y) * 255);
      if (alpha > 0) set(x, y, 255, 255, 255, alpha);
    }
  }
  const glyphW = 5;
  const gap = 1;
  const ox = 1;
  const oy = 6;
  GLYPHS.forEach((glyph, index) => {
    const left = ox + index * (glyphW + gap);
    glyph.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] === '#' && coverage(left + x, oy + y) >= 1) set(left + x, oy + y, 20, 20, 20, 255);
      }
    });
  });
  if (alert) {
    const cx = 18;
    const cy = 7;
    for (let y = cy - 3; y <= cy + 3; y += 1) {
      for (let x = cx - 3; x <= cx + 3; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= 10 && coverage(x, y) >= 1) set(x, y, WARNING.r, WARNING.g, WARNING.b, 255);
      }
    }
  }
  return raw;
}

export function trayPng(alert: boolean): Buffer {
  const size = SIZE;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(paint(alert))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
