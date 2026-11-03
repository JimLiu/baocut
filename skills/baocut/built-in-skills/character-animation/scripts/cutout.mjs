#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 把生成的图变成绑定用的部件：纯色底抠图（只认连到边框的底色，不会漏进深色衣服）、头从脖子切开并补上缺口、
// 量肩窝、眼睛、衣摆与腿，量场景底图上的空白牌子，写出部件 PNG、rig-data.js 与一张给人核对的 rig-proof.png。
// 只依赖 Node 自带的模块与 ffmpeg。
//
//   node cutout.mjs art.json [--only name,name]
//
// art.json 的字段见 references/art.md「清单」。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';

// ---------- image io ----------
export function readImage(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`cannot read ${file}: ${String(r.stderr).split('\n').slice(-3).join(' ')}`);
  const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(String(r.stderr));
  if (!m) throw new Error(`cannot read the size of ${file}`);
  const w = Number(m[1]), h = Number(m[2]);
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
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}

// ---------- masks ----------
const hexOf = (r, g, b) => `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const median = list => { const s = [...list].sort((a, b) => a - b); return s[s.length >> 1] ?? 0; };
const alphaAt = (im, x, y) => im.d[(y * im.w + x) * 4 + 3];
function cloneImage(im) { return { w: im.w, h: im.h, d: new Uint8ClampedArray(im.d) }; }

function borderMedian(im) {
  const r = [], g = [], b = [];
  const push = (x, y) => { const i = (y * im.w + x) * 4; r.push(im.d[i]); g.push(im.d[i + 1]); b.push(im.d[i + 2]); };
  for (let x = 0; x < im.w; x += 2) { push(x, 0); push(x, im.h - 1); }
  for (let y = 0; y < im.h; y += 2) { push(0, y); push(im.w - 1, y); }
  return [median(r), median(g), median(b)];
}

// 底色里偏高的通道与偏低的通道。绿 #00B140：G 高、R 与 B 低；品红 #FF00FF：R 与 B 高、G 低。
function keyChannels(key) {
  const top = Math.max(...key);
  const hi = [0, 1, 2].filter(i => key[i] >= top * 0.65);
  const lo = [0, 1, 2].filter(i => !hi.includes(i));
  if (!lo.length) throw new Error(`key colour ${hexOf(...key)} is not saturated; regenerate on a solid saturated background`);
  return { hi, lo };
}

// 底色：与边框中位色接近、并且底色通道占优的像素里，连到边框的那些；被包住的只认非常接近的纯底色。
export function keySheet(src, o = {}) {
  const key = o.key ?? borderMedian(src), { hi, lo } = keyChannels(key);
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

  // 两遍倒角距离变换：离底色的距离，单位约等于像素。
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
    out[i + 3] = Math.min(1, df[p] / 2) * 255;
    // 边缘两三个像素里压掉溢上去的底色。
    if (df[p] < 3) {
      const limit = Math.max(...lo.map(k => d[i + k])) + 6;
      for (const k of hi) if (out[i + k] > limit) out[i + k] = limit;
    }
  }
  return { w, h, d: out, touches, key };
}

export function trim(im, pad = 4) {
  let x0 = im.w, x1 = -1, y0 = im.h, y1 = -1;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    if (alphaAt(im, x, y) > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) throw new Error('nothing left after keying: is the background the colour the sheet says?');
  x0 = Math.max(x0 - pad, 0); y0 = Math.max(y0 - pad, 0); x1 = Math.min(x1 + pad, im.w - 1); y1 = Math.min(y1 + pad, im.h - 1);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) d.set(im.d.subarray(((y + y0) * im.w + x0) * 4, ((y + y0) * im.w + x0 + w) * 4), y * w * 4);
  return { w, h, d, x0, y0 };
}

const rowWidths = im => { const a = new Int32Array(im.h); for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (alphaAt(im, x, y) > 128) a[y]++; return a; };
function rowSpan(im, y) {
  let a = -1, b = -1;
  for (let x = 0; x < im.w; x++) if (alphaAt(im, x, y) > 128) { if (a < 0) a = x; b = x; }
  return [a, b];
}
function sample(im, x, y, r = 6) {
  const R = [], G = [], B = [];
  for (let j = Math.max(Math.round(y) - r, 0); j < Math.min(Math.round(y) + r, im.h); j++) {
    for (let i = Math.max(Math.round(x) - r, 0); i < Math.min(Math.round(x) + r, im.w); i++) {
      const p = (j * im.w + i) * 4;
      if (im.d[p + 3] > 200) { R.push(im.d[p]); G.push(im.d[p + 1]); B.push(im.d[p + 2]); }
    }
  }
  return R.length ? hexOf(median(R), median(G), median(B)) : '#888888';
}

// 脖子：眼睛往下的第一个谷。宽度从谷底回升 15% 就是肩膀，不再往下找，腰和腿再窄也不算。
// 没有点眼的风格从头顶往下找；披长发、围巾盖住脖子的角色算不准，看 rig-proof.png，清单里给 neck 覆盖。
export function neckRow(im) {
  const w = rowWidths(im), h = im.h, eyes = findEyes(im, Math.floor(h * 0.5));
  const start = eyes.length ? Math.floor(Math.max(...eyes.map(e => e.y)) + 0.045 * h) : Math.floor(h * 0.12);
  let best = start;
  for (let y = start; y < Math.floor(h * 0.6); y++) {
    if (w[y] < w[best]) best = y;
    else if (w[y] > w[best] * 1.15) break;
  }
  return best;
}

function components(mask, w, h, conn8 = false) {
  const lab = new Int32Array(w * h), stats = [];
  const stack = [];
  for (let p0 = 0; p0 < w * h; p0++) {
    if (!mask[p0] || lab[p0]) continue;
    const id = stats.length + 1, s = { id, x0: w, x1: -1, y0: h, y1: -1, area: 0, sx: 0, sy: 0 };
    lab[p0] = id;
    stack.push(p0);
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      s.area++; s.sx += x; s.sy += y;
      if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x; if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || (!conn8 && dx && dy)) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && !lab[q]) { lab[q] = id; stack.push(q); }
      }
    }
    s.cx = s.sx / s.area; s.cy = s.sy / s.area;
    stats.push(s);
  }
  return { lab, stats };
}

// 接近纯黑的小圆点当眼睛；风格不是点眼时找不到，这时不做眨眼。
export function findEyes(im, yLimit) {
  const mask = new Uint8Array(im.w * im.h);
  for (let y = 0; y < yLimit; y++) for (let x = 0; x < im.w; x++) {
    const i = (y * im.w + x) * 4;
    if (Math.max(im.d[i], im.d[i + 1], im.d[i + 2]) < 62 && im.d[i + 3] > 200) mask[y * im.w + x] = 1;
  }
  const { stats } = components(mask, im.w, im.h, true), out = [], h = im.h;
  for (const s of stats) {
    const bw = s.x1 - s.x0 + 1, bh = s.y1 - s.y0 + 1;
    if (!(0.006 * h < bw && bw < 0.05 * h && 0.006 * h < bh && bh < 0.05 * h)) continue;
    if (!(bw / bh > 0.6 && bw / bh < 1.6) || s.area / (bw * bh) < 0.6) continue;
    out.push({ x: s.cx, y: s.cy, r: Math.max(bw, bh) / 2 });
  }
  return out;
}

// 用最近的实心像素的颜色填上 region，透明像素不当来源，底色进不来；转头时不露缺口。
function fillFromNearest(im, region) {
  const n = im.w * im.h, from = new Int32Array(n).fill(-1), queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let p = 0; p < n; p++) if (!region[p] && im.d[p * 4 + 3] > 200) { from[p] = p; queue[tail++] = p; }
  while (head < tail) {
    const p = queue[head++], x = p % im.w;
    for (const q of [x > 0 ? p - 1 : -1, x < im.w - 1 ? p + 1 : -1, p >= im.w ? p - im.w : -1, p < n - im.w ? p + im.w : -1]) {
      if (q >= 0 && from[q] < 0) { from[q] = from[p]; queue[tail++] = q; }
    }
  }
  for (let p = 0; p < n; p++) {
    if (!region[p] || from[p] < 0) continue;
    const s = from[p] * 4, i = p * 4;
    im.d[i] = im.d[s]; im.d[i + 1] = im.d[s + 1]; im.d[i + 2] = im.d[s + 2]; im.d[i + 3] = 255;
  }
}

const blankRows = (im, a, b) => { for (let y = Math.max(a, 0); y < Math.min(b, im.h); y++) im.d.fill(0, y * im.w * 4, (y + 1) * im.w * 4); };

export function splitHead(rgba, neck) {
  const ny = neck ?? neckRow(rgba), [x0, x1] = rowSpan(rgba, ny);
  if (x0 < 0) throw new Error(`empty neck row ${ny}; set "neck" in the manifest`);
  const head = cloneImage(rgba), body = cloneImage(rgba);
  blankRows(head, ny, rgba.h);
  blankRows(body, 0, ny);
  const stump = Math.floor(0.03 * rgba.h), region = new Uint8Array(rgba.w * rgba.h);
  for (let y = Math.max(ny - stump, 0); y <= ny; y++) for (let x = x0 + 1; x < x1; x++) region[y * rgba.w + x] = 1;
  fillFromNearest(body, region);
  return { head, body, neckY: ny, neckX: (x0 + x1) / 2 };
}

function headMeta(rgba, neckY, neckX) {
  const eyes = findEyes(rgba, neckY);
  const m = { neckY, neckX, eyes, skin: sample(rgba, neckX, neckY - 8, 5) };
  m.face = eyes.length ? sample(rgba, eyes[0].x, eyes[0].y + eyes[0].r * 2.6, 3) : m.skin;
  return m;
}

// 从下往上第一行：外套比腿明显宽的地方就是衣摆。
function hemRow(im) {
  const w = rowWidths(im), h = im.h, legs = median(Array.from(w.subarray(Math.floor(h * 0.86), Math.floor(h * 0.92))));
  for (let y = Math.floor(h * 0.86); y > Math.floor(h * 0.5); y--) if (w[y] > legs * 1.22) return y + 1;
  throw new Error('no coat hem found: walkers need a hem wider than the legs, or set "hem" in the manifest');
}

// ---------- sprite kinds ----------
function frontSprite(rgba, o) {
  const { head, body, neckY, neckX } = splitHead(rgba, o.neck);
  const y = Math.floor(neckY + 0.075 * rgba.h), [a, b] = rowSpan(rgba, y), inset = 0.018 * rgba.h;
  const shoulders = o.shoulders ?? { y, lx: a + inset, rx: b - inset };
  return {
    pieces: { head, body },
    meta: { kind: 'front', w: rgba.w, h: rgba.h, ...headMeta(rgba, neckY, neckX), shoulders, sleeve: o.sleeve ?? sample(rgba, shoulders.lx + 4, shoulders.y, 8) },
  };
}
function sideSprite(rgba, o) {
  const { head, body, neckY, neckX } = splitHead(rgba, o.neck);
  const meta = { kind: 'side', w: rgba.w, h: rgba.h, facing: o.facing ?? 'right', ...headMeta(rgba, neckY, neckX) };
  const pieces = { head, body };
  if (o.handBox) {
    // 能动的手这一块比缝隙多压一点袖子，来回动不露缝。
    const [fx0, fy0, fx1, fy1] = o.handBox, x0 = Math.floor(fx0 * rgba.w), y0 = Math.floor(fy0 * rgba.h), x1 = Math.floor(fx1 * rgba.w), y1 = Math.floor(fy1 * rgba.h);
    const overlap = Math.floor(0.016 * rgba.h), hand = { w: rgba.w, h: rgba.h, d: new Uint8ClampedArray(rgba.w * rgba.h * 4) };
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * rgba.w + x) * 4;
      hand.d.set(body.d.subarray(i, i + 4), i);
      if (meta.facing === 'left' ? x < x1 - overlap : x >= x0 + overlap) body.d[i + 3] = 0;
    }
    pieces.hand = hand;
    meta.hand = { x0, y0, x1, y1 };
  } else {
    const y = Math.floor(neckY + 0.09 * rgba.h), [a, b] = rowSpan(rgba, y);
    meta.shoulder = o.shoulder ?? { y, x: (a + b) / 2 };
    meta.sleeve = o.sleeve ?? sample(rgba, meta.shoulder.x, meta.shoulder.y + 0.1 * rgba.h, 8);
  }
  return { pieces, meta };
}
function walkSprite(rgba, o) {
  const { head, body, neckY, neckX } = splitHead(rgba, o.neck);
  const hem = o.hem ?? hemRow(rgba), up = Math.floor(0.05 * rgba.h), [x0, x1] = rowSpan(rgba, hem + 2);
  const legs = cloneImage(rgba);
  blankRows(legs, 0, hem);
  // 胯在衣摆里面：用腿自己的颜色往上接一段。
  for (let y = hem - up; y < hem + 2; y++) for (let x = x0; x <= x1; x++) {
    const from = ((hem + 2) * rgba.w + x) * 4;
    legs.d.set(rgba.d.subarray(from, from + 4), (y * rgba.w + x) * 4);
  }
  blankRows(body, hem, rgba.h);
  const dark = cloneImage(legs);
  for (let i = 0; i < dark.d.length; i += 4) { dark.d[i] *= 0.82; dark.d[i + 1] *= 0.82; dark.d[i + 2] *= 0.82; }
  const legY = Math.floor(hem - up + (rgba.h - hem + up) * 0.5);
  let legW = 0;
  for (let x = 0; x < rgba.w; x++) if (alphaAt(legs, x, legY) > 128) legW++;
  const trouser = o.trouser ?? sample(rgba, (x0 + x1) / 2, hem + 12, 6), n = parseInt(trouser.slice(1), 16);
  return {
    pieces: { head, body, legs, legs_dark: dark },
    meta: {
      kind: 'walk', w: rgba.w, h: rgba.h, ...headMeta(rgba, neckY, neckX), hemY: hem, hipUp: up, legX: (x0 + x1) / 2, legW, trouser,
      trouserDark: hexOf(((n >> 16) & 255) * 0.82, ((n >> 8) & 255) * 0.82, (n & 255) * 0.82),
    },
  };
}
function plainSprite(rgba, o) {
  const { head, body, neckY, neckX } = splitHead(rgba, o.neck);
  return { pieces: { head, body }, meta: { kind: 'plain', w: rgba.w, h: rgba.h, ...headMeta(rgba, neckY, neckX) } };
}
// 分开的物体：先膨胀一点把一件东西的碎块连起来，每块按重心归到格子或从左到右排。
function objectsOf(rgba, grow = 7) {
  const { w, h } = rgba, solid = new Uint8Array(w * h), grown = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) solid[p] = rgba.d[p * 4 + 3] > 128 ? 1 : 0;
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let run = 0; for (let x = 0; x < w; x++) { run = solid[y * w + x] ? grow + 1 : Math.max(run - 1, 0); if (run) tmp[y * w + x] = 1; } run = 0; for (let x = w - 1; x >= 0; x--) { run = solid[y * w + x] ? grow + 1 : Math.max(run - 1, 0); if (run) tmp[y * w + x] = 1; } }
  for (let x = 0; x < w; x++) { let run = 0; for (let y = 0; y < h; y++) { run = tmp[y * w + x] ? grow + 1 : Math.max(run - 1, 0); if (run) grown[y * w + x] = 1; } run = 0; for (let y = h - 1; y >= 0; y--) { run = tmp[y * w + x] ? grow + 1 : Math.max(run - 1, 0); if (run) grown[y * w + x] = 1; } }
  const { lab, stats } = components(grown, w, h), min = 0.0008 * w * h;
  return { lab, items: stats.filter(s => s.area > min) };
}
function pickObject(rgba, lab, ids) {
  const set = new Set(ids), one = { w: rgba.w, h: rgba.h, d: new Uint8ClampedArray(rgba.d) };
  for (let p = 0; p < rgba.w * rgba.h; p++) if (!set.has(lab[p])) one.d.fill(0, p * 4, p * 4 + 4);
  return trim(one);
}

// 只留最大的一块：模型在主体旁边写的字、画的小东西不要。
function largestOnly(rgba) {
  const { lab, items } = objectsOf(rgba);
  if (items.length <= 1) return { im: rgba, dropped: 0 };
  const big = items.reduce((a, b) => (a.area > b.area ? a : b));
  return { im: pickObject(rgba, lab, [big.id]), dropped: items.length - 1 };
}

// ---------- plates ----------
function openMask(mask, w, h, r = 2) {
  const erode = (src, dx, dy) => {
    const out = new Uint8Array(w * h);
    for (let y = r * dy; y < h - r * dy; y++) for (let x = r * dx; x < w - r * dx; x++) {
      let all = 1;
      for (let k = -r; k <= r && all; k++) if (!src[(y + k * dy) * w + x + k * dx]) all = 0;
      out[y * w + x] = all;
    }
    return out;
  };
  const dilate = (src, dx, dy) => {
    const out = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      if (!src[p]) continue;
      for (let k = -r; k <= r; k++) {
        const q = p + k * (dy ? w : 1);
        if (q >= 0 && q < w * h) out[q] = 1;
      }
    }
    return out;
  };
  return dilate(dilate(erode(erode(mask, 1, 0), 0, 1), 1, 0), 0, 1);
}
// 底图上的空白牌子：白牌、白屏找亮而不饱和的大块；黑板这类找暗的（board: "dark"，只取最大一块）。
export function measureBoards(im, mode = 'light') {
  const { w, h, d } = im, mask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4, mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]), g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    mask[p] = mode === 'dark' ? (g < 70 ? 1 : 0) : (g > 228 && mx - mn < 22 ? 1 : 0);
  }
  const { stats } = components(openMask(mask, w, h), w, h, true);
  const rect = s => ({ x: s.x0 / w, y: s.y0 / h, w: (s.x1 - s.x0 + 1) / w, h: (s.y1 - s.y0 + 1) / h, fill: s.area / ((s.x1 - s.x0 + 1) * (s.y1 - s.y0 + 1)) });
  if (mode === 'dark') return stats.length ? [rect(stats.reduce((a, b) => (a.area > b.area ? a : b)))] : [];
  return stats.filter(s => s.area >= 0.006 * w * h && s.area / ((s.x1 - s.x0 + 1) * (s.y1 - s.y0 + 1)) >= 0.72).map(rect).sort((a, b) => a.x - b.x);
}

// ---------- proof sheet ----------
function proofSheet(file, tiles) {
  const cell = 340, cols = Math.min(tiles.length, 6), rows = Math.ceil(tiles.length / cols);
  const W = cols * cell, H = rows * cell, d = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) { const on = ((p % W) >> 4) + ((p / W) >> 4) & 1; d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = on ? 150 : 110; d[p * 4 + 3] = 255; }
  const dot = (x, y, r, col) => { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const X = Math.round(x + i), Y = Math.round(y + j); if (X >= 0 && Y >= 0 && X < W && Y < H) d.set(col, (Y * W + X) * 4); } };
  tiles.forEach((t, n) => {
    const ox = (n % cols) * cell, oy = Math.floor(n / cols) * cell, s = Math.min((cell - 20) / t.im.w, (cell - 20) / t.im.h);
    const px = ox + (cell - t.im.w * s) / 2, py = oy + (cell - t.im.h * s) / 2;
    for (let y = 0; y < t.im.h * s; y++) for (let x = 0; x < t.im.w * s; x++) {
      const i = (Math.floor(y / s) * t.im.w + Math.floor(x / s)) * 4, a = t.im.d[i + 3] / 255;
      if (!a) continue;
      const q = (Math.round(py + y) * W + Math.round(px + x)) * 4;
      for (let k = 0; k < 3; k++) d[q + k] = d[q + k] * (1 - a) + t.im.d[i + k] * a;
    }
    const m = t.meta;
    const hline = (y, col) => { for (let x = 0; x < t.im.w * s; x++) dot(px + x, py + y * s, 0, col); };
    if (m.neckY) hline(m.neckY, [255, 0, 0, 255]);
    if (m.hemY) hline(m.hemY, [0, 220, 0, 255]);
    if (m.shoulders) { dot(px + m.shoulders.lx * s, py + m.shoulders.y * s, 3, [0, 90, 255, 255]); dot(px + m.shoulders.rx * s, py + m.shoulders.y * s, 3, [0, 90, 255, 255]); }
    if (m.shoulder) dot(px + m.shoulder.x * s, py + m.shoulder.y * s, 3, [0, 90, 255, 255]);
    for (const e of m.eyes ?? []) dot(px + e.x * s, py + e.y * s, 2, [255, 230, 0, 255]);
  });
  writePng(file, { w: W, h: H, d });
}

// ---------- manifest ----------
const parseKey = v => (typeof v === 'string' ? [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16)) : v);
const round2 = o => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)));

export function run(manifestPath, only) {
  const cfg = JSON.parse(fs.readFileSync(manifestPath, 'utf8')), root = path.dirname(path.resolve(manifestPath));
  const at = p => path.resolve(root, p), out = at(cfg.out ?? 'shared/img');
  const dataFile = at(cfg.data ?? 'shared/rig-data.js');
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const rig = { plates: {}, sprites: {} }, tiles = [], warnings = [];
  const prevJson = `${dataFile}.json`;
  if (only && fs.existsSync(prevJson)) Object.assign(rig, JSON.parse(fs.readFileSync(prevJson, 'utf8')));
  const wanted = n => !only || only.includes(n);
  const warn = (name, msg) => warnings.push(`${name}: ${msg}`);
  const savePieces = (name, r) => { for (const [k, im] of Object.entries(r.pieces)) writePng(path.join(out, `${name}_${k}.png`), im); };

  for (const p of cfg.plates ?? []) {
    if (!wanted(p.name)) continue;
    const im = readImage(at(p.file)), file = `${p.name}.jpg`;
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', at(p.file), '-q:v', '2'];
    if (p.width && p.width !== im.w) args.push('-vf', `scale=${p.width}:-2:flags=lanczos`);
    const r = spawnSync(FFMPEG, [...args, path.join(out, file)]);
    if (r.status !== 0) throw new Error(`cannot write plate ${p.name}`);
    const boards = p.boards ?? (p.board === 'none' ? [] : measureBoards(im, p.board === 'dark' ? 'dark' : 'light'));
    rig.plates[p.name] = { file, w: p.width ?? im.w, h: p.width ? Math.round((p.width * im.h) / im.w) : im.h, boards, fx: p.fx ?? 0.5, fy: p.fy ?? 0.5 };
    if (p.board !== 'none' && !boards.length) warn(p.name, 'no blank board measured; give "boards" as fractions, or "board": "none"');
  }

  for (const s of cfg.sprites ?? []) {
    const names = s.names ?? [s.name];
    if (!names.some(wanted)) continue;
    const keyed = keySheet(readImage(at(s.file)), { key: s.key ? parseKey(s.key) : undefined, dist: s.dist, distEnclosed: s.distEnclosed, dominance: s.dominance });
    const label = s.name ?? names.join(',');
    if (keyed.touches && !s.bleed) warn(label, 'the subject touches the image edge: something is probably cropped; regenerate with more margin');
    const clean = s.kind === 'grid' || s.kind === 'row' || s.keepFragments ? { im: keyed, dropped: 0 } : largestOnly(keyed);
    if (clean.dropped) warn(label, `dropped ${clean.dropped} piece(s) not connected to the subject; check for stray text`);
    if (s.kind === 'grid' || s.kind === 'row') {
      const { lab, items } = objectsOf(keyed);
      const groups = [];
      if (s.kind === 'grid') {
        const rows = s.rows ?? 3, cols = s.cols ?? 3, cells = new Map();
        for (const it of items) {
          const k = Math.min(Math.floor((it.cy / keyed.h) * rows), rows - 1) * cols + Math.min(Math.floor((it.cx / keyed.w) * cols), cols - 1);
          cells.set(k, [...(cells.get(k) ?? []), it.id]);
        }
        names.forEach((n, i) => groups.push([n, cells.get(i)]));
      } else {
        const sorted = [...items].sort((a, b) => a.cx - b.cx);
        if (sorted.length !== names.length) warn(label, `found ${sorted.length} figures for ${names.length} names`);
        names.forEach((n, i) => groups.push([n, sorted[i] ? [sorted[i].id] : undefined]));
      }
      for (const [n, ids] of groups) {
        if (!ids) { warn(n, 'missing from the sheet'); continue; }
        if (!wanted(n)) continue;
        const piece = pickObject(keyed, lab, ids);
        if (s.kind === 'grid') {
          writePng(path.join(out, `${n}.png`), piece);
          rig.sprites[n] = { kind: 'prop', w: piece.w, h: piece.h };
          tiles.push({ im: piece, meta: {} });
        } else {
          const r = plainSprite(piece, {});
          if (r.meta.neckY > 0.45 * piece.h) warn(n, `neck row ${r.meta.neckY} looks wrong; check the proof sheet and split this figure with "neck"`);
          savePieces(n, r);
          rig.sprites[n] = r.meta;
          tiles.push({ im: piece, meta: r.meta });
        }
      }
      continue;
    }
    const rgba = trim(clean.im);
    if (s.kind === 'prop') {
      writePng(path.join(out, `${s.name}.png`), rgba);
      rig.sprites[s.name] = { kind: 'prop', w: rgba.w, h: rgba.h };
      tiles.push({ im: rgba, meta: {} });
      continue;
    }
    const build = { front: frontSprite, side: sideSprite, walk: walkSprite, plain: plainSprite }[s.kind];
    if (!build) throw new Error(`${s.name}: unknown kind ${s.kind}`);
    const r = build(rgba, s);
    savePieces(s.name, r);
    rig.sprites[s.name] = { ...r.meta, ...(s.meta ?? {}) };
    tiles.push({ im: rgba, meta: r.meta });
    if (!r.meta.eyes.length) warn(s.name, 'no dot eyes found, so this character will not blink');
    const [a, b] = rowSpan(rgba, r.meta.neckY);
    if (s.neck === undefined && (b - a > 0.55 * rgba.w || r.meta.neckY > 0.45 * rgba.h)) warn(s.name, `neck row ${r.meta.neckY} looks wrong; check the proof sheet and set "neck"`);
  }

  const clean = round2(rig);
  fs.writeFileSync(prevJson, JSON.stringify(clean));
  fs.writeFileSync(dataFile, `window.RIG = ${JSON.stringify(clean)};\n`);
  if (tiles.length) proofSheet(at(cfg.proof ?? 'rig-proof.png'), tiles);
  for (const [k, v] of Object.entries(clean.plates)) console.log(`plate ${k}: ${v.w}x${v.h}, ${v.boards.length} board(s)`);
  for (const [k, v] of Object.entries(clean.sprites)) console.log(`sprite ${k}: ${v.kind} ${v.w}x${v.h}${v.neckY ? ` neck ${v.neckY} eyes ${v.eyes.length}` : ''}`);
  for (const w of warnings) console.warn(`warn ${w}`);
  return { rig: clean, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node cutout.mjs art.json [--only a,b]'); process.exit(2); }
  const i = process.argv.indexOf('--only');
  run(file, i > 0 ? process.argv[i + 1].split(',') : null);
}
