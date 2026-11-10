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
  ['######', '##..##', '##..##', '#####.', '##..##', '##..##', '######'],
  ['######', '##..##', '##..##', '#####.', '##.#..', '##..#.', '##...#'],
  ['######', '##..##', '##..##', '##..##', '##..##', '##..##', '######'],
];

function paint(alert: boolean): Buffer {
  const size = 22;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const set = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const index = y * (size * 4 + 1) + 1 + x * 4;
    raw[index] = r;
    raw[index + 1] = g;
    raw[index + 2] = b;
    raw[index + 3] = a;
  };
  const glyphW = 6;
  const gap = 1;
  const ox = 1;
  const oy = 14;
  GLYPHS.forEach((glyph, index) => {
    const left = ox + index * (glyphW + gap);
    glyph.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        if (row[x] === '#') set(left + x, oy + y, 25, 25, 25, 255);
      }
    });
  });
  if (alert) {
    const cx = 16;
    const cy = 5;
    for (let y = cy - 4; y <= cy + 4; y += 1) {
      for (let x = cx - 4; x <= cx + 4; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= 13) set(x, y, 245, 180, 20, 255);
      }
    }
  }
  return raw;
}

export function trayPng(alert: boolean): Buffer {
  const size = 22;
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
