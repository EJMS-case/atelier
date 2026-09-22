// A transparent PNG with an opaque blob in the middle — the shape of a real
// garment cutout — written by hand (node has no canvas). The render walk
// serves it for every storage photo so TrimmedImage's real path runs: a CORS
// <Image> load, the alpha bounding box, the canvas crop, the data URL. An
// empty 200 (the old mock) made every photo an onerror fallback, so a tile
// that never painted could not be told from one that did.
import { deflateSync } from "node:zlib";

export function cutoutPng(W = 300, H = 400) {
  const rows = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 4);
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W * 0.33), dy = (y - H / 2) / (H * 0.38);
      const o = 1 + x * 4;
      row[o] = 120 + ((x * 7) % 80); row[o + 1] = 60 + ((y * 3) % 60); row[o + 2] = 90;
      row[o + 3] = dx * dx + dy * dy < 1 ? 255 : 0;
    }
    rows.push(row);
  }
  const table = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0)),
  ]);
}
