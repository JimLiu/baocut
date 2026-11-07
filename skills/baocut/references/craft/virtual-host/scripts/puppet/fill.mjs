// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// Smooth hole filling for soft-shaded art: what is under a removed part (an iris, a mouth, a brow) is painted from the
// colours round it, smooth like a gradient, so moving the part never shows a flat patch or a hard seam.
import { blur } from './ops.mjs';

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

/**
 * Fill the pixels of `hole` in hair along its strands (a brow drawn across the bangs, say): each hole pixel takes the
 * colours where its strand comes out of the hole on either side, mixed by distance, so the strands' light and dark
 * lines run on through instead of blurring into a soft patch. The strands run the way the picture round the hole does
 * (its structure tensor; the edges where strands meet the skin between them count too). A pixel whose strand leaves
 * the hole on neither side within `reach` onto `known` (it runs off the hair, onto the face), or where the picture has
 * no clear direction, keeps smoothFill's colour. So does flat hair with no strand lines near: its faint shading has a
 * direction too, which can run along the hole to a line far off. Changes `im` in place; alpha in the hole becomes 255.
 */
export function strandFill(im, hole, known, w, h, o = {}) {
  smoothFill(im, hole, known, w, h);
  const reach = o.reach ?? 40, r = o.r ?? 8;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (hole[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return im;
  x0 = Math.max(0, x0 - reach); y0 = Math.max(0, y0 - reach); x1 = Math.min(w - 1, x1 + reach); y1 = Math.min(h - 1, y1 + reach);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, n = bw * bh, at = (x, y) => (y + y0) * w + x + x0;
  const lum = new Float32Array(n);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = 4 * at(x, y);
    lum[y * bw + x] = 0.299 * im.d[i] + 0.587 * im.d[i + 1] + 0.114 * im.d[i + 2];
  }
  // the structure tensor from the picture outside the hole, spread over it (normalised: an average of what is there)
  const J = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], M = new Float32Array(n);
  for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
    let near = false;
    for (let j = -1; j <= 1 && !near; j++) for (let i = -1; i <= 1; i++) if (hole[at(x + i, y + j)]) { near = true; break; }
    if (near) continue;
    // Sobel: smoothed across, so a line at a slant reads at its slant and not as the steps of the pixel grid
    const q = y * bw + x, L = (i, j) => lum[q + j * bw + i];
    const gx = L(1, -1) + 2 * L(1, 0) + L(1, 1) - L(-1, -1) - 2 * L(-1, 0) - L(-1, 1);
    const gy = L(-1, 1) + 2 * L(0, 1) + L(1, 1) - L(-1, -1) - 2 * L(0, -1) - L(1, -1);
    J[0][q] = gx * gx; J[1][q] = gx * gy; J[2][q] = gy * gy; M[q] = 1;
  }
  const Mb = blur(M, bw, bh, r), Jb = J.map((f) => blur(f, bw, bh, r));
  // bilinear over the known hair pixels round (X, Y); null where they are less than half of it
  const sample = (X, Y) => {
    const ax = Math.floor(X), ay = Math.floor(Y), fx = X - ax, fy = Y - ay, c = [0, 0, 0];
    let wt = 0;
    for (const [i, j, f] of [[ax, ay, (1 - fx) * (1 - fy)], [ax + 1, ay, fx * (1 - fy)], [ax, ay + 1, (1 - fx) * fy], [ax + 1, ay + 1, fx * fy]]) {
      if (i < 0 || j < 0 || i >= w || j >= h || f <= 0) continue;
      const e = j * w + i;
      if (!known[e] || hole[e]) continue;
      wt += f; c[0] += f * im.d[4 * e]; c[1] += f * im.d[4 * e + 1]; c[2] += f * im.d[4 * e + 2];
    }
    return wt >= 0.5 ? c.map((v) => v / wt) : null;
  };
  const out = [];
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const p = at(x, y);
    if (!hole[p]) continue;
    const q = y * bw + x;
    if (Mb[q] <= 0) continue;
    const a = Jb[0][q] / Mb[q], b = Jb[1][q] / Mb[q], c = Jb[2][q] / Mb[q];
    const coh = Math.hypot(a - c, 2 * b) / (a + c + 1e-6);
    // how sure the way is: the gradients agree on it (coherence), and they are lines, not a faint shading (by this
    // measure a 2 px line 40 levels dark in the window gives about 75, a shading of a level a pixel 8)
    const en = Math.sqrt(a + c);
    const sure = Math.min(1, Math.max(0, (coh - 0.2) / 0.3)) * Math.min(1, Math.max(0, (en - 12) / 20));
    if (sure <= 0) continue;
    // the gradient's way is the dominant one; the strands run across it
    const th = 0.5 * Math.atan2(2 * b, a - c), dx = -Math.sin(th), dy = Math.cos(th);
    const ends = [];
    for (const s of [1, -1]) {
      let found = null;
      for (let t = 0.5; t <= reach; t += 0.5) {
        const X = Math.round(x + x0 + s * t * dx), Y = Math.round(y + y0 + s * t * dy);
        if (X < 0 || Y < 0 || X >= w || Y >= h) break;
        const e = Y * w + X;
        if (hole[e]) continue;
        if (!known[e]) break;
        // the strand's colour where it comes out: the first few hair pixels past the hole, sampled between pixels (a
        // thin line at a slant would break up into steps)
        const acc = [0, 0, 0];
        let k = 0;
        for (let u = 0; u < 3; u++) {
          const c2 = sample(x + x0 + s * (t + u) * dx, y + y0 + s * (t + u) * dy);
          if (!c2) break;
          acc[0] += c2[0]; acc[1] += c2[1]; acc[2] += c2[2]; k++;
        }
        if (k) found = { c: acc.map((v) => v / k), t };
        break;
      }
      if (found) ends.push(found);
    }
    if (!ends.length) continue;
    const along = ends.length === 1 ? ends[0].c : ends[0].c.map((v, k) => (v * ends[1].t + ends[1].c[k] * ends[0].t) / (ends[0].t + ends[1].t));
    out.push([p, along, sure]);
  }
  for (const [p, along, sure] of out) {
    for (let k = 0; k < 3; k++) im.d[4 * p + k] = Math.round(sure * along[k] + (1 - sure) * im.d[4 * p + k]);
  }
  return im;
}

