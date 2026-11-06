// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 读写图片与纯色底抠图，给 host-pack.mjs 用。图片在内存里是 {w, h, d}，d 是 RGBA 的 Uint8ClampedArray。
// 只依赖 Node 自带的模块与 ffmpeg。
import fs from 'node:fs';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';

/** 读一张图；给了 size 时缩放到正好 size.w × size.h */
export function readImage(file, size = null) {
  if (!fs.existsSync(file)) throw new Error(`missing image ${file}`);
  const vf = size ? ['-vf', `scale=${size.w}:${size.h}:flags=bicubic`] : [];
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-frames:v', '1', ...vf, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`cannot read ${file}: ${String(r.stderr).split('\n').slice(-3).join(' ')}`);
  let w, h;
  if (size) ({ w, h } = size);
  else {
    const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(String(r.stderr));
    if (!m) throw new Error(`cannot read the size of ${file}`);
    w = Number(m[1]); h = Number(m[2]);
  }
  if (r.stdout.length !== w * h * 4) throw new Error(`unexpected pixel count in ${file}`);
  return { w, h, d: new Uint8ClampedArray(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length) };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function writePng(file, im) {
  const raw = Buffer.alloc((im.w * 4 + 1) * im.h);
  for (let y = 0; y < im.h; y++) {
    const at = y * (im.w * 4 + 1);
    raw[at] = 0;
    Buffer.from(im.d.buffer, im.d.byteOffset + y * im.w * 4, im.w * 4).copy(raw, at + 1);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(im.w, 0);
  head.writeUInt32BE(im.h, 4);
  head[8] = 8;
  head[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

export const blank = (w, h) => ({ w, h, d: new Uint8ClampedArray(w * h * 4) });

export function crop(im, x, y, w, h) {
  const out = blank(w, h);
  for (let j = 0; j < h; j++) {
    const sy = y + j;
    if (sy < 0 || sy >= im.h) continue;
    for (let i = 0; i < w; i++) {
      const sx = x + i;
      if (sx < 0 || sx >= im.w) continue;
      const s = (sy * im.w + sx) * 4, t = (j * w + i) * 4;
      out.d[t] = im.d[s]; out.d[t + 1] = im.d[s + 1]; out.d[t + 2] = im.d[s + 2]; out.d[t + 3] = im.d[s + 3];
    }
  }
  return out;
}

/** 缩放（面积平均，缩小用） */
export function shrink(im, w, h) {
  const out = blank(w, h), sx = im.w / w, sy = im.h / h;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x0 = Math.floor(i * sx), x1 = Math.max(x0 + 1, Math.floor((i + 1) * sx));
    const y0 = Math.floor(j * sy), y1 = Math.max(y0 + 1, Math.floor((j + 1) * sy));
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const p = (y * im.w + x) * 4, al = im.d[p + 3];
      r += im.d[p] * al; g += im.d[p + 1] * al; b += im.d[p + 2] * al; a += al; n++;
    }
    const t = (j * w + i) * 4;
    if (a) { out.d[t] = r / a; out.d[t + 1] = g / a; out.d[t + 2] = b / a; }
    out.d[t + 3] = a / n;
  }
  return out;
}

/** src 叠到 dst 的 (x, y) 上（普通 alpha 混合，就地改 dst） */
export function over(dst, src, x, y) {
  for (let j = 0; j < src.h; j++) {
    const dy = y + j;
    if (dy < 0 || dy >= dst.h) continue;
    for (let i = 0; i < src.w; i++) {
      const dx = x + i;
      if (dx < 0 || dx >= dst.w) continue;
      const s = (j * src.w + i) * 4, t = (dy * dst.w + dx) * 4, a = src.d[s + 3] / 255;
      if (!a) continue;
      const b = dst.d[t + 3] / 255, oa = a + b * (1 - a);
      for (let k = 0; k < 3; k++) dst.d[t + k] = (src.d[s + k] * a + dst.d[t + k] * b * (1 - a)) / oa;
      dst.d[t + 3] = oa * 255;
    }
  }
  return dst;
}

const median = list => { const s = [...list].sort((a, b) => a - b); return s[s.length >> 1] ?? 0; };
const hexOf = c => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

export function parseColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
}

/** 边框一圈的中位色，当作纯色底 */
export function borderColor(im) {
  const r = [], g = [], b = [];
  const push = (x, y) => { const i = (y * im.w + x) * 4; r.push(im.d[i]); g.push(im.d[i + 1]); b.push(im.d[i + 2]); };
  for (let x = 0; x < im.w; x += 2) { push(x, 0); push(x, im.h - 1); }
  for (let y = 0; y < im.h; y += 2) { push(0, y); push(im.w - 1, y); }
  return [median(r), median(g), median(b)];
}

function keyChannels(key) {
  const top = Math.max(...key);
  const hi = [0, 1, 2].filter(i => key[i] >= top * 0.65);
  const lo = [0, 1, 2].filter(i => !hi.includes(i));
  if (!lo.length) throw new Error(`key colour ${hexOf(key)} is not saturated; regenerate on a solid saturated background`);
  return { hi, lo };
}

/**
 * 纯色底抠图：与底色接近、底色通道占优、并且连到边框的像素是底；被包住的只认非常接近的纯底色。
 * 边缘两个像素渐变，压掉溢上去的底色。返回新图，另带 key（用的底色）与 touches（主体碰到了画框）
 */
export function keyBackground(src, o = {}) {
  const key = o.key ?? borderColor(src), { hi, lo } = keyChannels(key);
  const { w, h, d } = src, n = w * h;
  const near = o.dist ?? 110, nearEnclosed = o.distEnclosed ?? 62, dom = o.dominance ?? 40;
  const cand = new Uint8Array(n), dist = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4, c = [d[i], d[i + 1], d[i + 2]];
    const e = Math.hypot(c[0] - key[0], c[1] - key[1], c[2] - key[2]);
    dist[p] = e;
    if (Math.min(...hi.map(k => c[k])) - Math.max(...lo.map(k => c[k])) > dom && e < near) cand[p] = 1;
  }
  const bg = new Uint8Array(n), queue = new Int32Array(n);
  let head = 0, tail = 0;
  const seed = p => { if (cand[p] && !bg[p]) { bg[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (head < tail) {
    const p = queue[head++], x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < n - w) seed(p + w);
  }
  for (let p = 0; p < n; p++) if (cand[p] && dist[p] < nearEnclosed) bg[p] = 1;
  const df = new Float32Array(n).fill(1e6);
  for (let p = 0; p < n; p++) if (bg[p]) df[p] = 0;
  const step = (p, q, cost) => { if (df[q] + cost < df[p]) df[p] = df[q] + cost; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (x > 0) step(p, p - 1, 1);
    if (y > 0) { step(p, p - w, 1); if (x > 0) step(p, p - w - 1, 1.414); if (x < w - 1) step(p, p - w + 1, 1.414); }
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const p = y * w + x;
    if (x < w - 1) step(p, p + 1, 1);
    if (y < h - 1) { step(p, p + w, 1); if (x < w - 1) step(p, p + w + 1, 1.414); if (x > 0) step(p, p + w - 1, 1.414); }
  }
  const out = new Uint8ClampedArray(n * 4);
  let touches = false;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (bg[p]) continue;
    const x = p % w, y = (p - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
    out[i] = d[i]; out[i + 1] = d[i + 1]; out[i + 2] = d[i + 2];
    out[i + 3] = Math.min(1, df[p] / 2) * 255 * (d[i + 3] / 255);
    if (df[p] < 3) {
      const limit = Math.max(...lo.map(k => d[i + k])) + 6;
      for (const k of hi) if (out[i + k] > limit) out[i + k] = limit;
    }
  }
  return { w, h, d: out, touches, key };
}

/** 不透明像素的外框 [x, y, w, h]；全透明时 null */
export function alphaBox(im, threshold = 8) {
  let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    if (im.d[(y * im.w + x) * 4 + 3] <= threshold) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
