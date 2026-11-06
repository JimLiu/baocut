#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 定妆照 + 一张张改过嘴、眼、表情的图 → 主播角色包：只取每张图里变了的那一块贴回定妆照。
//   node host-pack.mjs host.json
// 重画某一张后整包重跑（几秒）：同一组的框由所有改图一起定，单独重做一张会让别的补丁对不上。
// 每张改图先和定妆照对齐（模型偶尔整张平移或缩放几个像素），再做差；同一组（嘴、眼、表情）变化最大的区域合成一个框，
// 框边羽化，框里的颜色按框边一圈对回定妆照，存成小补丁。框外变化太大（模型把脸画变了）的标出来重画。
// 写出 <out>/base.png、各补丁 PNG、host-data.js（代码包读）、pack-report.json 与给人核对的 proof.png / proof.txt。
// host.json 的字段见 references/art.md「角色包清单」。只依赖 Node 自带的模块与 ffmpeg。
import fs from 'node:fs';
import path from 'node:path';
import { alphaBox, blank, crop, keyBackground, over, parseColor, readImage, shrink, writePng } from './image-io.mjs';

export const GROUPS = ['mouth', 'eyes', 'face'];
const MOUTH_NAMES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
const EYE_NAMES = new Set(['half', 'closed']);

// ---------- 灰度与对齐 ----------
function gray(im, step) {
  const w = Math.floor(im.w / step), h = Math.floor(im.h / step), g = new Float32Array(w * h), a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, al = 0;
    for (let j = 0; j < step; j++) for (let i = 0; i < step; i++) {
      const p = ((y * step + j) * im.w + x * step + i) * 4;
      s += im.d[p] * 0.299 + im.d[p + 1] * 0.587 + im.d[p + 2] * 0.114;
      al += im.d[p + 3];
    }
    g[y * w + x] = s / (step * step);
    a[y * w + x] = al / (step * step * 255);
  }
  return { w, h, g, a };
}

const sample = (G, x, y) => {
  if (x < 0 || y < 0 || x > G.w - 1 || y > G.h - 1) return -1;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(G.w - 1, x0 + 1), y1 = Math.min(G.h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const v = (xx, yy) => G.g[yy * G.w + xx];
  return (v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) + (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy;
};

// 截断的绝对差：嘴眼那一小块变得再多也只算 30，整体错位才拉高代价
function cost(B, V, s, dx, dy, stride) {
  const cx = B.w / 2, cy = B.h / 2;
  let sum = 0, n = 0;
  for (let y = 0; y < B.h; y += stride) for (let x = 0; x < B.w; x += stride) {
    if (B.a[y * B.w + x] < 0.5) continue;
    const v = sample(V, cx + s * (x - cx) + dx, cy + s * (y - cy) + dy);
    if (v < 0) { sum += 30; n++; continue; }
    sum += Math.min(30, Math.abs(B.g[y * B.w + x] - v));
    n++;
  }
  return n ? sum / n : Infinity;
}

/** 改图相对定妆照的缩放与平移：定妆照的点 p 落在改图的 c + s·(p − c) + d。先在 1/4 尺寸上粗找，再在原尺寸上细调 */
export function align(base, variant, o = {}) {
  const range = o.range ?? 32, scales = o.scales ?? [0.97, 0.98, 0.99, 1, 1.01, 1.02, 1.03];
  const step = 4, B = gray(base, step), V = gray(variant, step);
  let best = { s: 1, dx: 0, dy: 0, c: cost(B, V, 1, 0, 0, 2) };
  const r = Math.round(range / step);
  for (const s of scales) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const c = cost(B, V, s, dx, dy, 2);
    if (c < best.c - 1e-6) best = { s, dx, dy, c };
  }
  const B1 = gray(base, 1), V1 = gray(variant, 1);
  let fine = { s: best.s, dx: best.dx * step, dy: best.dy * step, c: cost(B1, V1, best.s, best.dx * step, best.dy * step, 3) };
  const start = fine;
  for (let dy = -4; dy <= 4; dy += 0.5) for (let dx = -4; dx <= 4; dx += 0.5) {
    for (const ds of [-0.005, 0, 0.005]) {
      const c = cost(B1, V1, start.s + ds, start.dx + dx, start.dy + dy, 3);
      if (c < fine.c - 1e-6) fine = { s: start.s + ds, dx: start.dx + dx, dy: start.dy + dy, c };
    }
  }
  // 整张真的错位时，对齐后的代价会低很多；只低一点点是嘴、眼那块的变化在拉，留在原位
  const identity = cost(B1, V1, 1, 0, 0, 3);
  if (identity <= fine.c * 1.1 + 0.1) fine = { s: 1, dx: 0, dy: 0, c: identity };
  return { s: +fine.s.toFixed(4), dx: +fine.dx.toFixed(2), dy: +fine.dy.toFixed(2), residual: +fine.c.toFixed(2), identity: +identity.toFixed(2) };
}

/** 按 align() 的结果把改图重采样到定妆照的坐标里 */
export function warp(im, { s, dx, dy }) {
  if (s === 1 && dx === 0 && dy === 0) return im;
  const out = blank(im.w, im.h), cx = im.w / 2, cy = im.h / 2;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const sx = cx + s * (x - cx) + dx, sy = cy + s * (y - cy) + dy;
    if (sx < 0 || sy < 0 || sx > im.w - 1 || sy > im.h - 1) continue;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(im.w - 1, x0 + 1), y1 = Math.min(im.h - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
    const t = (y * im.w + x) * 4;
    for (let k = 0; k < 4; k++) {
      const v = (xx, yy) => im.d[(yy * im.w + xx) * 4 + k];
      out.d[t + k] = (v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) + (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy;
    }
  }
  return out;
}

// ---------- 差异 ----------
/** 每个像素的差（0..255）：颜色取三通道最大差，透明度不同也算；再做 radius 的方框模糊 */
export function diffHeat(base, variant, radius = 4) {
  const { w, h } = base, n = w * h, raw = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4, ab = base.d[i + 3] / 255, av = variant.d[i + 3] / 255;
    let c = 0;
    if (ab > 0.5 && av > 0.5) c = Math.max(Math.abs(base.d[i] - variant.d[i]), Math.abs(base.d[i + 1] - variant.d[i + 1]), Math.abs(base.d[i + 2] - variant.d[i + 2]));
    raw[p] = Math.max(c, Math.abs(ab - av) * 255);
  }
  // 积分图做方框模糊
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += raw[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
  }
  const out = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1), y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
    const s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
    out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
  }
  return out;
}

/** 变化最大的那几块的外框：高于峰值 40%（至少 24）的像素连成块，留面积不小于最大块 20% 的，合起来 */
export function changeBox(heat, w, h, o = {}) {
  const sorted = Float32Array.from(heat).sort();
  const peak = sorted[Math.floor(sorted.length * 0.9995)] || 0;
  const thr = Math.max(o.min ?? 24, peak * (o.frac ?? 0.4));
  if (peak < (o.min ?? 24)) return null;
  const mask = new Uint8Array(w * h), label = new Int32Array(w * h).fill(-1);
  for (let p = 0; p < w * h; p++) if (heat[p] >= thr) mask[p] = 1;
  const comps = [], queue = new Int32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (!mask[p] || label[p] >= 0) continue;
    let head = 0, tail = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
    label[p] = comps.length; queue[tail++] = p;
    while (head < tail) {
      const q = queue[head++], x = q % w, y = (q - x) / w;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const r of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1]) {
        if (r >= 0 && mask[r] && label[r] < 0) { label[r] = comps.length; queue[tail++] = r; }
      }
    }
    comps.push({ x0, y0, x1, y1, area });
  }
  const big = Math.max(...comps.map(c => c.area));
  const keep = comps.filter(c => c.area >= big * (o.keep ?? 0.2));
  const box = keep.reduce((b, c) => [Math.min(b[0], c.x0), Math.min(b[1], c.y0), Math.max(b[2], c.x1), Math.max(b[3], c.y1)], [w, h, 0, 0]);
  return { box: [box[0], box[1], box[2] - box[0] + 1, box[3] - box[1] + 1], peak, parts: keep.length };
}

const union = boxes => {
  const b = boxes.reduce((u, [x, y, bw, bh]) => [Math.min(u[0], x), Math.min(u[1], y), Math.max(u[2], x + bw), Math.max(u[3], y + bh)], [Infinity, Infinity, -Infinity, -Infinity]);
  return [b[0], b[1], b[2] - b[0], b[3] - b[1]];
};
const pad = ([x, y, w, h], p, W, H) => {
  const x0 = Math.max(0, Math.floor(x - p)), y0 = Math.max(0, Math.floor(y - p)), x1 = Math.min(W, Math.ceil(x + w + p)), y1 = Math.min(H, Math.ceil(y + h + p));
  return [x0, y0, x1 - x0, y1 - y0];
};
const area = b => b[2] * b[3];

/** 框外（离框 margin 像素以外）变化超过 40 的前景像素占比：模型有没有把框外的东西也画变 */
export function outsideDrift(heat, base, box, margin = 8) {
  const [bx, by, bw, bh] = box;
  let n = 0, bad = 0;
  for (let y = 0; y < base.h; y++) for (let x = 0; x < base.w; x++) {
    if (x >= bx - margin && x < bx + bw + margin && y >= by - margin && y < by + bh + margin) continue;
    if (base.d[(y * base.w + x) * 4 + 3] < 128) continue;
    n++;
    if (heat[y * base.w + x] > 40) bad++;
  }
  return n ? bad / n : 0;
}

/** 补丁：改图在框里的那块，框边 feather 像素内渐隐；颜色按框边一圈（羽化带）的中位差对回定妆照 */
export function makePatch(base, variant, box, feather = 8) {
  const [bx, by, bw, bh] = box;
  const diffs = [[], [], []];
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
    const edge = Math.min(x - bx, y - by, bx + bw - 1 - x, by + bh - 1 - y);
    if (edge >= feather) continue;
    const i = (y * base.w + x) * 4;
    if (base.d[i + 3] < 200 || variant.d[i + 3] < 200) continue;
    for (let k = 0; k < 3; k++) diffs[k].push(variant.d[i + k] - base.d[i + k]);
  }
  const med = l => { if (!l.length) return 0; const s = [...l].sort((a, b) => a - b); return s[s.length >> 1]; };
  const offset = diffs.map(med);
  const usable = offset.every(v => Math.abs(v) <= 24);
  const out = blank(bw, bh);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    const x = bx + i, y = by + j, s = (y * base.w + x) * 4, t = (j * bw + i) * 4;
    const edge = Math.min(i, j, bw - 1 - i, bh - 1 - j);
    const f = Math.min(1, (edge + 0.5) / feather), soft = f * f * (3 - 2 * f);
    for (let k = 0; k < 3; k++) out.d[t + k] = variant.d[s + k] - (usable ? offset[k] : 0);
    out.d[t + 3] = variant.d[s + 3] * soft;
  }
  return { patch: out, offset, colourMatched: usable };
}

// ---------- 嘴的大小 ----------
/**
 * 改图里的嘴有多大：框里和皮肤颜色不同的像素连成块，碰到框边的（鼻子、下巴、脸的轮廓线）和零碎的小点不算，
 * 取剩下的外框宽高与像素数。皮肤颜色取定妆照框边一圈的中位数
 */
export function mouthSize(base, variant, box) {
  const [bx, by, bw, bh] = box;
  const ring = [[], [], []];
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
    if (Math.min(x - bx, y - by, bx + bw - 1 - x, by + bh - 1 - y) >= 3) continue;
    const i = (y * base.w + x) * 4;
    if (base.d[i + 3] < 200) continue;
    for (let k = 0; k < 3; k++) ring[k].push(base.d[i + k]);
  }
  const med = l => { const s = [...l].sort((a, b) => a - b); return s[s.length >> 1] ?? 0; };
  const skin = ring.map(med);
  const mask = new Uint8Array(bw * bh);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    const p = ((by + j) * variant.w + bx + i) * 4;
    if (variant.d[p + 3] < 128) continue;
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(variant.d[p + k] - skin[k]));
    if (d > 60) mask[j * bw + i] = 1;
  }
  const label = new Int32Array(bw * bh).fill(-1), comps = [], queue = new Int32Array(bw * bh);
  for (let p = 0; p < bw * bh; p++) {
    if (!mask[p] || label[p] >= 0) continue;
    let head = 0, tail = 0, x0 = bw, y0 = bh, x1 = -1, y1 = -1, n = 0;
    label[p] = comps.length; queue[tail++] = p;
    while (head < tail) {
      const q = queue[head++], x = q % bw, y = (q - x) / bw;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const r of [x > 0 ? q - 1 : -1, x < bw - 1 ? q + 1 : -1, y > 0 ? q - bw : -1, y < bh - 1 ? q + bw : -1]) {
        if (r >= 0 && mask[r] && label[r] < 0) { label[r] = comps.length; queue[tail++] = r; }
      }
    }
    if (x0 > 0 && y0 > 0 && x1 < bw - 1 && y1 < bh - 1) comps.push({ x0, y0, x1, y1, n });
  }
  if (!comps.length) return null;
  const big = Math.max(...comps.map(c => c.n));
  const keep = comps.filter(c => c.n >= Math.max(4, big * 0.03));
  const x0 = Math.min(...keep.map(c => c.x0)), y0 = Math.min(...keep.map(c => c.y0));
  const x1 = Math.max(...keep.map(c => c.x1)), y1 = Math.max(...keep.map(c => c.y1));
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, area: keep.reduce((n, c) => n + c.n, 0) };
}

/**
 * 嘴成不成梯度：B、C、D 一级比一级开，D 不至于像大笑，E 比 D 窄，F 整体比 E 小又不是一个点。
 * 只给提示（模型不会照比例画），返回英文的说明列表
 */
export function mouthLadder(sizes) {
  const out = [], s = sizes;
  const ratio = (a, b, k) => s[a] && s[b] && s[a][k] / Math.max(1, s[b][k]);
  if (s.B && s.C && ratio('C', 'B', 'h') < 1.15) out.push(`C opens barely more than B (height ${s.C.h} vs ${s.B.h}): draw B as a narrow gap or C more open`);
  if (s.C && s.D && ratio('D', 'C', 'h') < 1.15) out.push(`D opens barely more than C (height ${s.D.h} vs ${s.C.h}): draw D wider open`);
  if (s.C && s.D && ratio('D', 'C', 'h') > 2) out.push(`D opens ${ratio('D', 'C', 'h').toFixed(1)}x as tall as C (a laugh rather than talking?): draw D less open, or C more open`);
  if (s.D && s.E && ratio('E', 'D', 'w') >= 1) out.push(`E is as wide as D (${s.E.w} vs ${s.D.w}): round it into a narrower oval`);
  // 噘嘴连嘴唇一起量，外框可以比 E 宽；整体（宽 × 高）要比 E 小
  if (s.E && s.F && s.F.w * s.F.h >= s.E.w * s.E.h) out.push(`F is not smaller than E (${s.F.w}x${s.F.h} vs ${s.E.w}x${s.E.h}): draw F as a smaller pucker`);
  if (s.D && s.F && ratio('F', 'D', 'w') < 0.3) out.push(`F is only ${Math.round(ratio('F', 'D', 'w') * 100)}% as wide as D (a dot): draw a pucker with visible lips`);
  if (s.C && s.F && ratio('F', 'C', 'area') > 1.2) out.push(`F is larger than C: draw F as a small pucker`);
  return out;
}

// ---------- 头和身体 ----------
// 抠底留下的半透明毛边不算前景，免得把头和肩膀连起来
const SOLID = 64;

/** 第 y 行里包住 x 的那一段前景 [左, 右]；x 处透明时 null */
function runAt(im, x, y) {
  const a = i => im.d[(y * im.w + i) * 4 + 3] > SOLID;
  if (x < 0 || x >= im.w || y < 0 || y >= im.h || !a(x)) return null;
  let l = x, r = x;
  while (l > 0 && a(l - 1)) l--;
  while (r < im.w - 1 && a(r + 1)) r++;
  return [l, r];
}

/**
 * 头和身体从哪里分开：从嘴往下，前景先收窄成脖子，再在肩膀处突然变宽。返回
 * { neck: [ya, yb], pivot: [x, yb] }：ya 以上整个头一起动，ya..yb 的脖子渐渐弯过去，yb 往下是身体；
 * 找不到时 { reason }。补丁落在 ya..yb 里的那几行跟着脖子一起弯
 */
export function findNeck(base, mouthBox) {
  const cx = Math.round(mouthBox[0] + mouthBox[2] / 2);
  const width = y => { const r = runAt(base, cx, y); return r ? r[1] - r[0] + 1 : 0; };
  let face = 0;
  for (let y = mouthBox[1]; y < Math.min(base.h, mouthBox[1] + mouthBox[3]); y++) face = Math.max(face, width(y));
  let min = Infinity, minY = -1, shoulder = -1;
  for (let y = Math.round(mouthBox[1] + mouthBox[3] / 2); y < base.h; y++) {
    const w = width(y);
    if (!w) return { reason: 'the figure has a gap below the mouth' };
    if (w < min) { min = w; minY = y; }
    if (min <= face * 0.8 && w >= min * 1.5) { shoulder = y; break; }
  }
  if (shoulder < 0) return { reason: 'no neck: the figure does not narrow below the face and widen again at the shoulders' };
  const yb = shoulder - 1;
  let top = minY;
  while (top > mouthBox[1] && width(top - 1) <= min * 1.15) top--;
  const band = Math.max(6, Math.round(base.h * 0.015));
  const ya = Math.max(mouthBox[1], Math.min(top, yb - band));
  const r = runAt(base, cx, yb);
  return { neck: [ya, yb], pivot: [r ? (r[0] + r[1]) / 2 : cx, yb] };
}

/**
 * 按 findNeck 的结果把定妆照拆成头和身体两张图：头是 yb 以上、和脸连着的前景，身体是其余部分。
 * 头碰到 yb 以上别的前景（头发搭在肩上）时拆不开，返回 { reason }
 */
export function splitHead(base, rig, seed) {
  const [, yb] = rig.neck;
  const { w } = base, n = w * yb, inHead = new Uint8Array(w * base.h);
  const queue = new Int32Array(n);
  const s = seed[1] * w + seed[0];
  if (seed[1] >= yb || base.d[s * 4 + 3] <= SOLID) return { reason: 'the face is not opaque at the mouth' };
  let head = 0, tail = 0;
  inHead[s] = 1; queue[tail++] = s;
  while (head < tail) {
    const q = queue[head++], x = q % w, y = (q - x) / w;
    for (const r of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < yb - 1 ? q + w : -1]) {
      if (r >= 0 && !inHead[r] && base.d[r * 4 + 3] > SOLID) { inHead[r] = 1; queue[tail++] = r; }
    }
  }
  // 头边上两像素内的半透明毛边归头
  for (let pass = 0; pass < 2; pass++) {
    const grow = [];
    for (let p = 0; p < n; p++) {
      if (inHead[p] || !base.d[p * 4 + 3]) continue;
      const x = p % w, y = (p - x) / w;
      if ((x > 0 && inHead[p - 1]) || (x < w - 1 && inHead[p + 1]) || (y > 0 && inHead[p - w]) || (y < yb - 1 && inHead[p + w])) grow.push(p);
    }
    for (const p of grow) inHead[p] = 1;
  }
  // 头的最下一行只该是脖子；比脖子宽得多说明连到了肩上
  const neckRun = runAt(base, Math.round(rig.pivot[0]), yb - 1);
  let last = 0;
  for (let x = 0; x < w; x++) last += inHead[(yb - 1) * w + x] && base.d[((yb - 1) * w + x) * 4 + 3] > SOLID ? 1 : 0;
  if (!neckRun || last > (neckRun[1] - neckRun[0] + 1) * 1.3) return { reason: 'the head touches the shoulders above the neck (hair over the shoulders?)' };
  // 身体往上多留几行脖子垫在头的切边下面：两张图的切边各自抗锯齿，正好碰在一起时会透出一道浅线。
  // 这几行跟着头动得极少（几乎不动），叠着看不出来
  const lap = Math.max(4, Math.round(base.h * 0.006));
  const headIm = blank(base.w, base.h), bodyIm = blank(base.w, base.h);
  for (let p = 0; p < w * base.h; p++) {
    const px = base.d.subarray(p * 4, p * 4 + 4);
    if (inHead[p]) headIm.d.set(px, p * 4);
    if (!inHead[p] || p >= (yb - lap) * w) bodyIm.d.set(px, p * 4);
  }
  return { head: headIm, body: bodyIm };
}

// ---------- 主流程 ----------
// 嘴：A–G 是口型；别的名字（smile、grin）是同名表情不说话时的嘴
const groupOf = (group, name) => {
  if (group === 'mouth' && !MOUTH_NAMES.has(name) && name.length < 2) throw new Error(`mouth variant ${name}: use A–G (upper case), or an expression name such as smile`);
  if (group === 'eyes' && !EYE_NAMES.has(name)) throw new Error(`eyes variant ${name}: use half or closed`);
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) throw new Error(`variant name ${name}: letters, digits and dashes only`);
};

export function run(manifestPath) {
  const dir = path.dirname(path.resolve(manifestPath));
  const M = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const at = p => path.resolve(dir, p);
  if (!M.base) throw new Error('host.json needs base: the chosen portrait');
  const outDir = at(M.out ?? 'pack');
  const srcBase = M.srcBase ?? `${path.basename(outDir)}/`;
  const variants = [];
  for (const group of GROUPS) {
    for (const [name, file] of Object.entries(M.variants?.[group] ?? {})) {
      groupOf(group, name);
      variants.push({ group, name, file: at(file) });
    }
  }
  if (!variants.length) throw new Error('host.json lists no variants (variants.mouth / eyes / face)');
  fs.mkdirSync(outDir, { recursive: true });
  const raw = readImage(at(M.base));
  const keyed = M.key === false ? null : keyBackground(raw, M.key && M.key !== 'auto' ? { key: parseColor(M.key) } : {});
  const base = keyed ?? raw;
  const keyOpt = keyed ? { key: keyed.key } : null;
  // 每张改图：读进来缩放到定妆照尺寸、同样抠底、对齐、做差、找变化的框
  for (const v of variants) {
    const im = readImage(v.file, { w: raw.w, h: raw.h });
    const k = keyOpt ? keyBackground(im, keyOpt) : im;
    v.align = align(base, k);
    v.im = warp(k, v.align);
    v.heat = diffHeat(base, v.im);
    v.change = changeBox(v.heat, base.w, base.h);
    if (!v.change) v.warn = 'no visible change: the model returned the portrait unchanged';
  }
  // 同一组共用一个框：清单里给了就用它，不然把各张的变化框合起来（面积超过中位数 3 倍的那张不算，标出来重画）
  const boxes = {};
  const report = { base: M.base, key: keyed ? `#${keyed.key.map(c => c.toString(16).padStart(2, '0')).join('')}` : null, groups: {}, variants: [] };
  for (const group of GROUPS) {
    const vs = variants.filter(v => v.group === group);
    if (!vs.length) continue;
    let box = M.boxes?.[group];
    if (box) {
      if (!Array.isArray(box) || box.length !== 4) throw new Error(`boxes.${group} must be [x, y, w, h] in portrait pixels`);
    } else {
      const found = vs.filter(v => v.change).map(v => v.change.box);
      if (!found.length) throw new Error(`no ${group} variant changed anything; check the images or give boxes.${group}`);
      const areas = found.map(area).sort((a, b) => a - b), medArea = areas[areas.length >> 1];
      const ok = vs.filter(v => v.change && area(v.change.box) <= medArea * 3);
      for (const v of vs) if (v.change && !ok.includes(v)) v.warn = `changed a much larger area than the other ${group} images (${v.change.box.join(',')}): redraw it`;
      const u = union(ok.map(v => v.change.box));
      box = pad(u, Math.max(10, Math.round(Math.max(u[2], u[3]) * 0.12)), base.w, base.h);
    }
    boxes[group] = box;
    report.groups[group] = { box, auto: !M.boxes?.[group] };
  }
  // 嘴的大小梯度：只提示，不算要重画
  const mouths = variants.filter(v => v.group === 'mouth' && MOUTH_NAMES.has(v.name));
  if (boxes.mouth && mouths.length) {
    report.mouthSizes = {};
    for (const v of mouths) {
      const m = mouthSize(base, v.im, boxes.mouth);
      if (m) report.mouthSizes[v.name] = { w: m.w, h: m.h, area: m.area };
    }
    report.mouthLadder = mouthLadder(report.mouthSizes);
  }
  // 头和身体：从脖子处分开，说话时只动头。host.json 的 neck 可以给 [ya, yb]（定妆照的行），false 不拆
  let rig = null, split = null;
  if (M.neck !== false && boxes.mouth) {
    if (Array.isArray(M.neck)) {
      if (M.neck.length !== 2 || !(M.neck[0] < M.neck[1])) throw new Error('neck must be [ya, yb] in portrait rows, ya above yb');
      const yb = Math.round(M.neck[1]), r = runAt(base, Math.round(boxes.mouth[0] + boxes.mouth[2] / 2), yb);
      rig = { neck: [Math.round(M.neck[0]), yb], pivot: [r ? (r[0] + r[1]) / 2 : base.w / 2, yb] };
    } else rig = findNeck(base, boxes.mouth);
    if (rig.neck) {
      split = splitHead(base, rig, [Math.round(boxes.mouth[0] + boxes.mouth[2] / 2), Math.round(boxes.mouth[1] + boxes.mouth[3] / 2)]);
      if (split.reason) rig = { reason: split.reason };
    }
    report.rig = rig.neck ? { neck: rig.neck, pivot: rig.pivot.map(v => +v.toFixed(1)) } : { reason: rig.reason };
  } else report.rig = { reason: M.neck === false ? 'neck: false in host.json' : 'no mouth variants to find the face by' };
  // 定妆照裁到主体外框（留 8 像素），补丁坐标跟着换
  const fg = alphaBox(base) ?? [0, 0, base.w, base.h];
  const frame = pad(fg, 8, base.w, base.h);
  const scale = M.scale ?? 1;
  if (!(scale > 0 && scale <= 1)) throw new Error('scale must be in (0, 1]');
  const sz = (im, w, h) => (scale === 1 ? im : shrink(im, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))));
  const baseOut = sz(crop(base, ...frame), frame[2], frame[3]);
  writePng(path.join(outDir, 'base.png'), baseOut);
  const data = { version: 1, w: baseOut.w, h: baseOut.h, base: `${srcBase}base.png`, mouth: {}, eyes: {}, face: {}, boxes: {} };
  const place = b => [b[0] - frame[0], b[1] - frame[1], b[2], b[3]].map(v => Math.round(v * scale));
  for (const [g, b] of Object.entries(boxes)) data.boxes[g] = place(b);
  if (rig?.neck) {
    // 头和身体按整张缩放后再裁，和 base.png 逐像素对得上
    const body = sz(crop(split.body, ...frame), frame[2], frame[3]);
    const headFull = sz(crop(split.head, ...frame), frame[2], frame[3]);
    const hb = alphaBox(headFull, 0);
    writePng(path.join(outDir, 'body.png'), body);
    writePng(path.join(outDir, 'head.png'), crop(headFull, ...hb));
    const row = v => Math.round((v - frame[1]) * scale);
    data.rig = {
      body: `${srcBase}body.png`,
      head: { src: `${srcBase}head.png`, x: hb[0], y: hb[1], w: hb[2], h: hb[3] },
      neck: rig.neck.map(row),
      pivot: [+((rig.pivot[0] - frame[0]) * scale).toFixed(1), row(rig.pivot[1])],
    };
  }
  const feather = M.feather ?? 8;
  for (const v of variants) {
    const box = boxes[v.group];
    const { patch, offset, colourMatched } = makePatch(base, v.im, box, feather);
    const file = `${v.group}-${v.name}.png`;
    const out = sz(patch, box[2], box[3]);
    writePng(path.join(outDir, file), out);
    const [x, y] = place(box);
    data[v.group][v.name] = { src: `${srcBase}${file}`, x, y, w: out.w, h: out.h };
    v.composite = over(crop(base, 0, 0, base.w, base.h), patch, box[0], box[1]);
    const drift = outsideDrift(v.heat, base, box);
    const flags = [];
    if (v.warn) flags.push(v.warn);
    if (drift > 0.03) flags.push(`${(drift * 100).toFixed(1)}% of the picture outside the ${v.group} box changed too: redraw it, or give a larger boxes.${v.group}`);
    if (!colourMatched) flags.push(`colour around the box is off by ${offset.join('/')} (RGB): redraw it`);
    if (Math.abs(v.align.s - 1) > 0.025 || Math.hypot(v.align.dx, v.align.dy) > 24) flags.push(`moved a lot against the portrait (scale ${v.align.s}, shift ${v.align.dx},${v.align.dy}): check the proof`);
    v.flags = flags;
    report.variants.push({ name: `${v.group}-${v.name}`, file: path.relative(dir, v.file), align: v.align, change: v.change?.box ?? null, outsideChanged: +drift.toFixed(4), colourOffset: offset, ok: !flags.length, flags });
  }
  fs.writeFileSync(path.join(outDir, 'host-data.js'), `// virtual host pack built by host-pack.mjs from ${path.basename(manifestPath)}; positions are in base.png pixels\nwindow.${M.var ?? 'HOST_PACK'} = ${JSON.stringify(data)};\n`);
  fs.writeFileSync(path.join(outDir, 'pack-report.json'), JSON.stringify(report, null, 2));
  proof(outDir, base, variants, boxes, rig?.neck ? { ...rig, head: split.head } : null);
  return { outDir, data, report };
}

/** 核对用：头的部分染上蓝色，脖子弯曲的一段上下各画一条线（黄的在上、红的在下） */
function rigView(base, rig) {
  const im = crop(base, 0, 0, base.w, base.h), [ya, yb] = rig.neck;
  for (let p = 0; p < base.w * base.h; p++) {
    if (!rig.head.d[p * 4 + 3]) continue;
    for (const [k, c] of [[0, 60], [1, 120], [2, 255]]) im.d[p * 4 + k] = im.d[p * 4 + k] * 0.6 + c * 0.4;
  }
  for (const [y, c] of [[ya, [240, 200, 0, 255]], [yb, [220, 40, 40, 255]]]) {
    for (let t = -1; t <= 1; t++) for (let x = 0; x < base.w; x++) if (y + t >= 0 && y + t < base.h) im.d.set(c, ((y + t) * base.w + x) * 4);
  }
  return im;
}

// 核对图：每格是一张改图贴回定妆照后的脸部（框画在上面：绿的没问题，红的要重画），第一格是定妆照本身
function proof(outDir, base, variants, boxes, rig) {
  const all = union(Object.values(boxes));
  // 有头和身体的拆分时视野往下放到肩膀，最后一格给它
  const want = rig ? union([all, [all[0], all[1], all[2], rig.neck[1] + 12 - all[1]]]) : all;
  const view = pad(want, Math.round(Math.max(want[2], want[3]) * 0.25), base.w, base.h);
  const cell = 256, ch = Math.round((cell * view[3]) / view[2]), cols = Math.min(4, variants.length + 1 + (rig ? 1 : 0));
  const cells = [{ name: 'portrait', im: base, ok: true, box: null }, ...variants.map(v => ({ name: `${v.group}-${v.name}`, im: v.composite, ok: !v.flags.length, box: boxes[v.group] }))];
  if (rig) cells.push({ name: 'head (tinted: moves when nodding and turning; yellow to red: the neck bends)', im: rigView(base, rig), ok: true, box: null });
  const rows = Math.ceil(cells.length / cols), sheet = blank(cols * (cell + 8) + 8, rows * (ch + 8) + 8);
  for (let p = 0; p < sheet.w * sheet.h; p++) sheet.d.set([235, 235, 235, 255], p * 4);
  const lines = ['proof.png cells, left to right, top to bottom (green frame = usable, red = redraw):'];
  cells.forEach((c, i) => {
    const x = 8 + (i % cols) * (cell + 8), y = 8 + Math.floor(i / cols) * (ch + 8);
    const face = crop(c.im, ...view);
    if (c.box) {
      const col = c.ok ? [40, 170, 60, 255] : [220, 40, 40, 255];
      const [bx, by, bw, bh] = [c.box[0] - view[0], c.box[1] - view[1], c.box[2], c.box[3]];
      for (let t = 0; t < 3; t++) {
        for (let i2 = bx; i2 < bx + bw; i2++) for (const yy of [by + t, by + bh - 1 - t]) if (i2 >= 0 && i2 < face.w && yy >= 0 && yy < face.h) face.d.set(col, (yy * face.w + i2) * 4);
        for (let j2 = by; j2 < by + bh; j2++) for (const xx of [bx + t, bx + bw - 1 - t]) if (xx >= 0 && xx < face.w && j2 >= 0 && j2 < face.h) face.d.set(col, (j2 * face.w + xx) * 4);
      }
    }
    const small = shrink(face, cell, ch);
    const bg = blank(cell, ch);
    for (let p = 0; p < cell * ch; p++) bg.d.set([255, 255, 255, 255], p * 4);
    over(bg, small, 0, 0);
    over(sheet, bg, x, y);
    lines.push(`${i + 1}. ${c.name}${c.ok ? '' : '  <- redraw'}`);
  });
  writePng(path.join(outDir, 'proof.png'), sheet);
  fs.writeFileSync(path.join(outDir, 'proof.txt'), `${lines.join('\n')}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [manifest, ...rest] = process.argv.slice(2);
  if (!manifest || rest.length) throw new Error('usage: host-pack.mjs host.json');
  const { outDir, report } = run(manifest);
  for (const g of Object.keys(report.groups)) console.log(`${g} box ${report.groups[g].box.join(',')}${report.groups[g].auto ? ' (found from the changes)' : ' (from host.json)'}`);
  for (const v of report.variants) {
    console.log(`${v.ok ? 'ok  ' : 'FIX '} ${v.name.padEnd(14)} shift ${v.align.dx},${v.align.dy} scale ${v.align.s}  outside ${(v.outsideChanged * 100).toFixed(1)}%  colour ${v.colourOffset.join('/')}${v.flags.length ? `\n       ${v.flags.join('\n       ')}` : ''}`);
  }
  if (report.mouthSizes) {
    console.log(`mouth sizes (w x h px): ${Object.entries(report.mouthSizes).map(([n, m]) => `${n} ${m.w}x${m.h}`).join('  ')}`);
    for (const l of report.mouthLadder) console.log(`size ${l}`);
  }
  console.log(report.rig.neck ? `head/body split: the head moves above row ${report.rig.neck[0]}, the neck bends down to row ${report.rig.neck[1]} (portrait pixels)` : `head/body: not split (${report.rig.reason}); the whole figure moves together`);
  console.log(`${path.relative(process.cwd(), outDir)}/: base.png, ${report.variants.length} patches, host-data.js, pack-report.json, proof.png (check it)`);
}
