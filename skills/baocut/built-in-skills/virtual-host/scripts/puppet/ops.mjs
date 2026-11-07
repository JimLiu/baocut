// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// Mask and image helpers for the puppet builder. A mask is a Uint8Array (0/1) of w*h; soft masks are Float32Array 0..1.

export const blank = (w, h) => ({ w, h, d: new Uint8ClampedArray(w * h * 4) });
export const clone = (im) => ({ w: im.w, h: im.h, d: new Uint8ClampedArray(im.d) });

/** Chamfer (1, 1.414) distance from every pixel to the nearest pixel where mask is set (0 on the mask) */
export function distTo(mask, w, h) {
  const n = w * h, df = new Float32Array(n).fill(1e6);
  for (let p = 0; p < n; p++) if (mask[p]) df[p] = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; let v = df[p];
    if (x > 0 && df[p - 1] + 1 < v) v = df[p - 1] + 1;
    if (y > 0) {
      if (df[p - w] + 1 < v) v = df[p - w] + 1;
      if (x > 0 && df[p - w - 1] + 1.4142 < v) v = df[p - w - 1] + 1.4142;
      if (x < w - 1 && df[p - w + 1] + 1.4142 < v) v = df[p - w + 1] + 1.4142;
    }
    df[p] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const p = y * w + x; let v = df[p];
    if (x < w - 1 && df[p + 1] + 1 < v) v = df[p + 1] + 1;
    if (y < h - 1) {
      if (df[p + w] + 1 < v) v = df[p + w] + 1;
      if (x < w - 1 && df[p + w + 1] + 1.4142 < v) v = df[p + w + 1] + 1.4142;
      if (x > 0 && df[p + w - 1] + 1.4142 < v) v = df[p + w - 1] + 1.4142;
    }
    df[p] = v;
  }
  return df;
}
export const not = (m) => m.map((v) => (v ? 0 : 1));
export const and = (a, b) => a.map((v, i) => (v && b[i] ? 1 : 0));
export const or = (a, b) => a.map((v, i) => (v || b[i] ? 1 : 0));
export const minus = (a, b) => a.map((v, i) => (v && !b[i] ? 1 : 0));
export function dilate(m, w, h, r) { const d = distTo(m, w, h); return Uint8Array.from(d, (v) => (v <= r ? 1 : 0)); }
export function erode(m, w, h, r) { const d = distTo(not(m), w, h); return Uint8Array.from(d, (v) => (v > r ? 1 : 0)); }
export const open = (m, w, h, r) => dilate(erode(m, w, h, r), w, h, r);
export const close = (m, w, h, r) => erode(dilate(m, w, h, r), w, h, r);
export const count = (m) => { let c = 0; for (const v of m) if (v) c++; return c; };

/** connected components (8-connected); returns { lab: Int32Array (0 = none), comps: [{id, area, x0,y0,x1,y1, cx, cy}] } */
export function components(m, w, h) {
  const lab = new Int32Array(w * h), comps = [], q = new Int32Array(w * h);
  let id = 0;
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || lab[s]) continue;
    id++;
    let head = 0, tail = 0, area = 0, x0 = w, y0 = h, x1 = -1, y1 = -1, sx = 0, sy = 0;
    q[tail++] = s; lab[s] = id;
    while (head < tail) {
      const p = q[head++], x = p % w, y = (p - x) / w;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const k = Y * w + X;
        if (m[k] && !lab[k]) { lab[k] = id; q[tail++] = k; }
      }
    }
    comps.push({ id, area, x0, y0, x1, y1, cx: sx / area, cy: sy / area });
  }
  return { lab, comps };
}
export const compMask = (lab, ids) => { const s = new Set(ids); return Uint8Array.from(lab, (v) => (s.has(v) ? 1 : 0)); };

/** pixels of `allowed` reachable from `seed` through `allowed`, at most r steps (geodesic dilation) */
export function grow(seed, allowed, w, h, r = Infinity) {
  const n = w * h, dist = new Float32Array(n).fill(Infinity), q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let p = 0; p < n; p++) if (seed[p]) { dist[p] = 0; q[tail++] = p; }
  while (head < tail) {
    const p = q[head++], x = p % w, y = (p - x) / w, d = dist[p] + 1;
    if (d > r) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const k = Y * w + X;
      if (allowed[k] && dist[k] > d) { dist[k] = d; q[tail++] = k; }
    }
  }
  return Uint8Array.from(dist, (v) => (v < Infinity ? 1 : 0));
}

export function bbox(m, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

/** separable box blur of a float field, radius r (whole pixels: a fractional radius is rounded, it would index between pixels) */
export function blur(f, w, h, r) {
  r = Math.round(r);
  if (r <= 0) return Float32Array.from(f);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += f[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / k;
      s += f[y * w + Math.min(w - 1, x + r + 1)] - f[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / k;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

export const px = (im, x, y) => { const i = (y * im.w + x) * 4; return [im.d[i], im.d[i + 1], im.d[i + 2], im.d[i + 3]]; };

/** median colour of the pixels of im under mask */
export function medianColor(im, m) {
  const ch = [[], [], []];
  for (let p = 0; p < im.w * im.h; p++) if (m[p]) for (let k = 0; k < 3; k++) ch[k].push(im.d[p * 4 + k]);
  return ch.map((a) => { a.sort((x, y) => x - y); return a[a.length >> 1] ?? 0; });
}

/** crop an RGBA image to [x, y, w, h] (outside: transparent) */
export function crop(im, x, y, w, h) {
  const out = blank(w, h);
  for (let j = 0; j < h; j++) {
    const sy = y + j; if (sy < 0 || sy >= im.h) continue;
    for (let i = 0; i < w; i++) {
      const sx = x + i; if (sx < 0 || sx >= im.w) continue;
      const s = (sy * im.w + sx) * 4, t = (j * w + i) * 4;
      for (let k = 0; k < 4; k++) out.d[t + k] = im.d[s + k];
    }
  }
  return out;
}

/** src over dst at (x, y), straight alpha, in place */
export function over(dst, src, x = 0, y = 0, alpha = 1) {
  for (let j = 0; j < src.h; j++) {
    const dy = y + j; if (dy < 0 || dy >= dst.h) continue;
    for (let i = 0; i < src.w; i++) {
      const dx = x + i; if (dx < 0 || dx >= dst.w) continue;
      const s = (j * src.w + i) * 4, t = (dy * dst.w + dx) * 4, a = (src.d[s + 3] / 255) * alpha;
      if (!a) continue;
      const b = dst.d[t + 3] / 255, oa = a + b * (1 - a);
      for (let k = 0; k < 3; k++) dst.d[t + k] = (src.d[s + k] * a + dst.d[t + k] * b * (1 - a)) / oa;
      dst.d[t + 3] = oa * 255;
    }
  }
  return dst;
}

/** bilinear sample of an RGBA image at (x, y); outside: transparent */
export function sample(im, x, y, out) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  out[0] = out[1] = out[2] = out[3] = 0;
  let wsum = 0;
  for (const [X, Y, wt] of [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]]) {
    if (X < 0 || Y < 0 || X >= im.w || Y >= im.h || wt === 0) continue;
    const i = (Y * im.w + X) * 4, a = im.d[i + 3] * wt;
    out[0] += im.d[i] * a; out[1] += im.d[i + 1] * a; out[2] += im.d[i + 2] * a; out[3] += a; wsum += wt;
  }
  if (out[3] > 0) { out[0] /= out[3]; out[1] /= out[3]; out[2] /= out[3]; }
  return out;
}
