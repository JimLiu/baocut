// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// Layer canvases: full-canvas RGBA images that are cut to their box when written. Every layer's edge is made
// antialiased against what's drawn under it (unmixing the original pixel into the layer's colour over the under colour).
import { blank, distTo, not, or, minus, grow, bbox, crop, over } from './ops.mjs';
import { unmix } from './seg.mjs';

/** m plus the holes it encloses */
export function fillHoles(m, w, h) {
  const out = not(m), seed = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) { seed[x] = out[x]; seed[(h - 1) * w + x] = out[(h - 1) * w + x]; }
  for (let y = 0; y < h; y++) { seed[y * w] = out[y * w]; seed[y * w + w - 1] = out[y * w + w - 1]; }
  return not(grow(seed, out, w, h));
}

/** for every pixel within r of a set pixel of `src`, the index of a nearby set pixel (multi-source BFS) */
export function nearestIndex(src, w, h, r) {
  const n = w * h, idx = new Int32Array(n).fill(-1), dist = new Float32Array(n).fill(Infinity), q = new Int32Array(n * 2);
  let head = 0, tail = 0;
  for (let p = 0; p < n; p++) if (src[p]) { idx[p] = p; dist[p] = 0; q[tail++] = p; }
  while (head < tail) {
    const p = q[head++], x = p % w, y = (p - x) / w, s = idx[p], sx = s % w, sy = (s - sx) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy;
      if ((!dx && !dy) || X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const k = Y * w + X, d = Math.hypot(X - sx, Y - sy);
      if (d <= r && d < dist[k] - 1e-6) { dist[k] = d; idx[k] = s; if (tail < q.length) q[tail++] = k; }
    }
  }
  return idx;
}

export const rgb = (im, p) => [im.d[4 * p], im.d[4 * p + 1], im.d[4 * p + 2]];
export function setPx(im, p, c, a) { im.d[4 * p] = c[0]; im.d[4 * p + 1] = c[1]; im.d[4 * p + 2] = c[2]; im.d[4 * p + 3] = Math.round(255 * a); }

/** a layer from a mask: the source's colours (and keyed alpha) under the mask */
export function fromMask(src, alpha, m, w, h) {
  const L = blank(w, h);
  for (let p = 0; p < w * h; p++) if (m[p]) setPx(L, p, rgb(src, p), alpha ? alpha[p] : 1);
  return L;
}

/**
 * Antialias a layer's edge against the layers under it. core: the layer's hard mask (already painted in `L`);
 * orig: the picture the layer was cut from; under: the composite of the layers below; keyed: {alpha, fg} of `orig`,
 * used where nothing is under (the background). Pixels just outside the core (within r, where `allow`) and the core's
 * own rim get alpha = unmix(orig, K, U): K the colour of the nearest core-interior pixel, U the under colour.
 * o.asIs: core pixels of another colour (a rivet, a highlight) left as painted, and never the K of the edge round them;
 * o.reach: how far the edge looks for K (default r + 4; past an as-is piece the core's interior can be further)
 */
export function softEdge(L, core, orig, under, keyed, w, h, o = {}) {
  const r = o.r ?? 2.5, allow = o.allow, minSep = o.minSep ?? 40, asIs = o.asIs;
  const dOut = distTo(core, w, h), dIn = distTo(not(core), w, h);
  const interior = Uint8Array.from(dIn, (v, p) => (v >= 2 && !asIs?.[p] ? 1 : 0));
  const nI = nearestIndex(interior, w, h, o.reach ?? r + 4), nC = nearestIndex(asIs ? minus(core, asIs) : core, w, h, r + 1);
  for (let p = 0; p < w * h; p++) {
    const ring = !core[p] && dOut[p] <= r && (!allow || allow[p]);
    const rim = core[p] && dIn[p] <= 1.5 && !asIs?.[p];
    if (!ring && !rim) continue;
    const s = nI[p] >= 0 ? nI[p] : nC[p];
    if (s < 0) continue;
    const K = rgb(orig, s), P = rgb(orig, p);
    const ua = under.d[4 * p + 3] / 255, ka = keyed.alpha[p];
    let a, col = K;
    if (ka < 0.98 && (rim || ua < 0.5)) {
      // on the background's edge: the key decides
      a = ka; col = a > 0.02 ? rgb(keyed.fg, p) : K;
    } else if (ua < 0.5) {
      if (ring) continue;
      a = 1; col = P;
    } else {
      const U = rgb(under, p);
      const sep = Math.hypot(K[0] - U[0], K[1] - U[1], K[2] - U[2]);
      if (sep < minSep) a = rim ? 1 : 0;
      else a = unmix(P, K, U);
      if (rim && a > 0.97) { a = 1; col = P; }
    }
    if (ring && a < 0.03) continue;
    setPx(L, p, col, a);
  }
  return L;
}

/** composite a list of full-canvas layers (straight alpha) */
export function composite(layers, w, h) {
  const out = blank(w, h);
  for (const L of layers) if (L) over(out, L.im ?? L, L.x ?? 0, L.y ?? 0, L.alpha ?? 1);
  return out;
}

/** the box (x, y, w, h) of a layer's visible pixels, padded and kept in the canvas */
export function alphaBox(L, w, h, pad = 2) {
  const m = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (L.d[4 * p + 3] > 0) m[p] = 1;
  const b = bbox(m, w, h);
  if (!b) return null;
  const x0 = Math.max(0, b[0] - pad), y0 = Math.max(0, b[1] - pad), x1 = Math.min(w - 1, b[2] + pad), y1 = Math.min(h - 1, b[3] + pad);
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
export const unionBox = (bs) => {
  const v = bs.filter(Boolean);
  const x0 = Math.min(...v.map((b) => b[0])), y0 = Math.min(...v.map((b) => b[1]));
  const x1 = Math.max(...v.map((b) => b[0] + b[2])), y1 = Math.max(...v.map((b) => b[1] + b[3]));
  return [x0, y0, x1 - x0, y1 - y0];
};
export const cut = (L, box) => crop(L, box[0], box[1], box[2], box[3]);

/** transparent pixels' colour: bleed the nearest visible colour out (so filtering at the edge never pulls in black) */
export function bleed(im, r = 3) {
  const { w, h } = im, vis = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (im.d[4 * p + 3] > 0) vis[p] = 1;
  const nI = nearestIndex(vis, w, h, r);
  for (let p = 0; p < w * h; p++) if (!vis[p] && nI[p] >= 0) { const s = nI[p]; im.d[4 * p] = im.d[4 * s]; im.d[4 * p + 1] = im.d[4 * s + 1]; im.d[4 * p + 2] = im.d[4 * s + 2]; }
  return im;
}
