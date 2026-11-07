// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// PNG read/write with node:zlib only; other images (JPEG, WebP, 16-bit or interlaced PNG) are decoded with ffmpeg.
// Images in memory: { w, h, d } with d an RGBA Uint8ClampedArray, straight alpha.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function readPng(file) {
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error(`not a PNG: ${file}`);
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (interlace) throw new Error(`interlaced PNG not supported: ${file}`);
  if (depth !== 8) throw new Error(`only 8-bit PNG supported (${file} is ${depth}-bit)`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = new Uint8ClampedArray(w * h * 4);
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = row[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * ch;
      if (ctype === 6) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = cur[s + 3]; }
      else if (ctype === 2) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = 255; }
      else if (ctype === 0) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = 255; }
      else if (ctype === 4) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = cur[s + 1]; }
      else { const k = cur[s]; out[o] = palette[3 * k]; out[o + 1] = palette[3 * k + 1]; out[o + 2] = palette[3 * k + 2]; out[o + 3] = trns && k < trns.length ? trns[k] : 255; }
    }
    [prev, cur] = [cur, prev];
  }
  return { w, h, d: out };
}

/** any image: 8-bit non-interlaced PNG directly, everything else through ffmpeg (FFMPEG overrides the binary) */
export function readImage(file) {
  if (!fs.existsSync(file)) throw new Error(`missing image ${file}`);
  try {
    return readPng(file);
  } catch (e) {
    if (!/not a PNG|not supported/.test(e.message)) throw e;
  }
  const r = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 30 });
  if (r.error) throw new Error(`cannot read ${file}: ffmpeg not found (convert it to an 8-bit PNG, or set FFMPEG)`);
  if (r.status !== 0) throw new Error(`cannot read ${file}: ${String(r.stderr).trim().split('\n').slice(-2).join(' ')}`);
  const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(String(r.stderr));
  if (!m) throw new Error(`cannot read the size of ${file}`);
  const w = Number(m[1]), h = Number(m[2]);
  if (r.stdout.length !== w * h * 4) throw new Error(`unexpected pixel count in ${file}`);
  return { w, h, d: new Uint8ClampedArray(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length) };
}

export const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** writes RGBA (straight alpha), filter "up"/"sub" picked per row by a cheap heuristic */
export function writePng(file, im) {
  const stride = im.w * 4, raw = Buffer.alloc((stride + 1) * im.h);
  for (let y = 0; y < im.h; y++) {
    const at = y * (stride + 1), row = im.d.subarray(y * stride, (y + 1) * stride);
    raw[at] = 1; // sub
    for (let i = 0; i < stride; i++) raw[at + 1 + i] = (row[i] - (i >= 4 ? row[i - 4] : 0)) & 255;
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(im.w, 0); head.writeUInt32BE(im.h, 4); head[8] = 8; head[9] = 6;
  fs.writeFileSync(file, Buffer.concat([SIG, chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

/** writes a single-channel mask (0..255) as an 8-bit gray+alpha-free PNG (lossless) */
export function writeGray(file, w, h, m) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = m[y * w + x]; }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 0;
  fs.writeFileSync(file, Buffer.concat([SIG, chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
