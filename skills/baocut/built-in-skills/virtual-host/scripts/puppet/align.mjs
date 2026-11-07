// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// Registering a whole-image edit to the base: the base point p lands on the edit at c + s*(p - c) + d.
// The cost is measured on a region of interest (roi:
// [x0, y0, x1, y1]) minus the boxes the edit was asked to change (skip), so the patch is registered by what's round it.
import { blank } from './ops.mjs';

function gray(im, step) {
  const w = Math.floor(im.w / step), h = Math.floor(im.h / step), g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let j = 0; j < step; j++) for (let i = 0; i < step; i++) {
      const p = ((y * step + j) * im.w + x * step + i) * 4;
      s += im.d[p] * 0.299 + im.d[p + 1] * 0.587 + im.d[p + 2] * 0.114;
    }
    g[y * w + x] = s / (step * step);
  }
  return { w, h, g, step };
}
const samp = (G, x, y) => {
  if (x < 0 || y < 0 || x > G.w - 1 || y > G.h - 1) return -1;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(G.w - 1, x0 + 1), y1 = Math.min(G.h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const v = (xx, yy) => G.g[yy * G.w + xx];
  return (v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) + (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy;
};
function cost(B, V, s, dx, dy, pts) {
  const cx = B.w / 2, cy = B.h / 2;
  let sum = 0;
  for (const p of pts) {
    const x = p % B.w, y = (p - x) / B.w;
    const v = samp(V, cx + s * (x - cx) + dx, cy + s * (y - cy) + dy);
    sum += v < 0 ? 40 : Math.min(40, Math.abs(B.g[p] - v));
  }
  return sum / pts.length;
}
function points(B, roi, skip, stride) {
  const k = B.step, out = [];
  const [x0, y0, x1, y1] = roi.map((v) => Math.round(v / k));
  for (let y = Math.max(0, y0); y < Math.min(B.h, y1); y += stride) for (let x = Math.max(0, x0); x < Math.min(B.w, x1); x += stride) {
    const X = x * k, Y = y * k;
    if (skip.some((b) => X >= b[0] && X <= b[2] && Y >= b[1] && Y <= b[3])) continue;
    out.push(y * B.w + x);
  }
  return out;
}

export function align(base, edit, o = {}) {
  const roi = o.roi ?? [0, 0, base.w, base.h], skip = o.skip ?? [];
  const range = o.range ?? 32, scales = o.scales ?? [0.96, 0.97, 0.98, 0.99, 1, 1.01, 1.02, 1.03, 1.04];
  const B4 = gray(base, 4), V4 = gray(edit, 4), P4 = points(B4, roi, skip, 1);
  let best = { s: 1, dx: 0, dy: 0, c: cost(B4, V4, 1, 0, 0, P4) };
  const r = Math.round(range / 4);
  for (const s of scales) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const c = cost(B4, V4, s, dx, dy, P4);
    if (c < best.c) best = { s, dx, dy, c };
  }
  const B1 = gray(base, 1), V1 = gray(edit, 1), P1 = points(B1, roi, skip, 2);
  let fine = { s: best.s, dx: best.dx * 4, dy: best.dy * 4, c: cost(B1, V1, best.s, best.dx * 4, best.dy * 4, P1) };
  for (let pass = 0; pass < 2; pass++) {
    const st = fine, step = pass ? 0.25 : 0.5, span = pass ? 1 : 4, ds = pass ? [-0.002, 0, 0.002] : [-0.006, -0.003, 0, 0.003, 0.006];
    for (let dy = -span; dy <= span; dy += step) for (let dx = -span; dx <= span; dx += step) for (const d of ds) {
      const c = cost(B1, V1, st.s + d, st.dx + dx, st.dy + dy, P1);
      if (c < fine.c) fine = { s: st.s + d, dx: st.dx + dx, dy: st.dy + dy, c };
    }
  }
  const identity = cost(B1, V1, 1, 0, 0, P1);
  return { s: +fine.s.toFixed(4), dx: +fine.dx.toFixed(2), dy: +fine.dy.toFixed(2), residual: +fine.c.toFixed(2), identity: +identity.toFixed(2) };
}

/** resample the edit into the base's frame */
export function warp(im, { s, dx, dy }) {
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
