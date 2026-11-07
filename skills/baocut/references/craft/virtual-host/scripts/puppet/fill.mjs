// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// Smooth hole filling for soft-shaded art: what is under a removed part (an iris, a mouth, a brow) is painted from the
// colours round it, smooth like a gradient, so moving the part never shows a flat patch or a hard seam.

/**
 * Fill the pixels of `hole` in `im` (RGBA, changed in place) from the pixels of `known`: a push-pull pyramid gives
 * every hole pixel the mean colour of the known pixels round it at the right scale, then a few Jacobi passes smooth the
 * steps. Pixels in neither mask are left as they are. Alpha in the hole becomes 255.
 */
export function smoothFill(im, hole, known, w, h, o = {}) {
  const iters = o.iters ?? 40;
  // work only on the hole's box, padded so its rim's known pixels are inside
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (hole[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return im;
  const pad = Math.max(16, Math.round(0.5 * Math.max(x1 - x0, y1 - y0)));
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  // level 0: known colours with weight 1
  let lw = bw, lh = bh;
  let C = new Float32Array(bw * bh * 3), Wt = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const p = (y + y0) * w + x + x0, q = y * bw + x;
    if (!known[p] || hole[p]) continue;
    Wt[q] = 1; C[3 * q] = im.d[4 * p]; C[3 * q + 1] = im.d[4 * p + 1]; C[3 * q + 2] = im.d[4 * p + 2];
  }
  const levels = [{ C, Wt, lw, lh }];
  while (lw > 1 || lh > 1) {
    const nw = Math.max(1, Math.ceil(lw / 2)), nh = Math.max(1, Math.ceil(lh / 2));
    const nC = new Float32Array(nw * nh * 3), nW = new Float32Array(nw * nh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      const q = y * lw + x, t = (y >> 1) * nw + (x >> 1);
      nW[t] += Wt[q]; nC[3 * t] += C[3 * q]; nC[3 * t + 1] += C[3 * q + 1]; nC[3 * t + 2] += C[3 * q + 2];
    }
    C = nC; Wt = nW; lw = nw; lh = nh;
    levels.push({ C, Wt, lw, lh });
    if (levels.length > 20) break;
  }
  // normalise every level to colours (weight > 0), then pull: an empty pixel takes its parent's colour, bilinear
  for (const L of levels) for (let q = 0; q < L.lw * L.lh; q++) if (L.Wt[q] > 0) for (let k = 0; k < 3; k++) L.C[3 * q + k] /= L.Wt[q];
  for (let i = levels.length - 2; i >= 0; i--) {
    const L = levels[i], U = levels[i + 1];
    for (let y = 0; y < L.lh; y++) for (let x = 0; x < L.lw; x++) {
      const q = y * L.lw + x;
      if (L.Wt[q] > 0) continue;
      const fx = Math.min(U.lw - 1, Math.max(0, (x - 0.5) / 2)), fy = Math.min(U.lh - 1, Math.max(0, (y - 0.5) / 2));
      const ax = Math.floor(fx), ay = Math.floor(fy), bx = Math.min(U.lw - 1, ax + 1), by = Math.min(U.lh - 1, ay + 1);
      const tx = fx - ax, ty = fy - ay;
      for (let k = 0; k < 3; k++) {
        const c00 = U.C[3 * (ay * U.lw + ax) + k], c10 = U.C[3 * (ay * U.lw + bx) + k];
        const c01 = U.C[3 * (by * U.lw + ax) + k], c11 = U.C[3 * (by * U.lw + bx) + k];
        L.C[3 * q + k] = (c00 * (1 - tx) + c10 * tx) * (1 - ty) + (c01 * (1 - tx) + c11 * tx) * ty;
      }
      L.Wt[q] = 1e-6; // filled
    }
  }
  // relax the hole: each hole pixel becomes the mean of its four neighbours (known ones fixed)
  const F = levels[0].C, isHole = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (hole[(y + y0) * w + x + x0]) isHole[y * bw + x] = 1;
  const tmp = new Float32Array(F.length);
  for (let it = 0; it < iters; it++) {
    tmp.set(F);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const q = y * bw + x;
      if (!isHole[q]) continue;
      let n = 0; const s = [0, 0, 0];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= bw || Y >= bh) continue;
        const r = Y * bw + X; n++;
        s[0] += tmp[3 * r]; s[1] += tmp[3 * r + 1]; s[2] += tmp[3 * r + 2];
      }
      if (n) for (let k = 0; k < 3; k++) F[3 * q + k] = s[k] / n;
    }
  }
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const q = y * bw + x;
    if (!isHole[q]) continue;
    const p = (y + y0) * w + x + x0;
    im.d[4 * p] = Math.round(F[3 * q]); im.d[4 * p + 1] = Math.round(F[3 * q + 1]); im.d[4 * p + 2] = Math.round(F[3 * q + 2]); im.d[4 * p + 3] = 255;
  }
  return im;
}
