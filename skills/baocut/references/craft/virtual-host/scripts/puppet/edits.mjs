// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// Parts cut from whole-image edits (an open mouth, closed eyes): registered to the portrait, then the strokes that
// differ from the skin inside a zone are taken with an antialiased edge (unmixed against the edit's own skin).
import { blank, components, compMask, dilate, distTo, not, and, bbox, medianColor, count, grow, minus } from './ops.mjs';
import { unmix } from './seg.mjs';
import { align, warp } from './align.mjs';
import { softEdge, rgb, fillHoles } from './layers.mjs';

const dist = (c, s) => Math.hypot(c[0] - s[0], c[1] - s[1], c[2] - s[2]);

/**
 * Where an edit drew the glasses' frame further off than `margin` (the portrait's frame grown a few pixels): pixels of
 * `band` whose colour in the edit is one of the frame's colours `cols` (its fill, its line colour) over the portrait's
 * colour there (at least `min` of it, within `tol` of that mix, and nearer it than to any of `others` over the same
 * colour: a brow or the hair drawn up to the frame), joined to the margin through such pixels, at most `reach` steps past
 * it; then any trace of them round those, a line's width `lw` out (the antialiased edge of that frame's outline). Only
 * in `area` and never in a lens the margin closes round: there a lash or a lid is as dark as the frame. A pixel the edit
 * left as it was (within `tol`) is none of the frame
 */
export function editFrame({ E, im, margin, area, cols, others = [], reach, lw, w, h, tol = 24, min = 0.4 }) {
  const band = minus(and(dilate(margin, w, h, reach), area), fillHoles(margin, w, h));
  // how far colour c is from K laid over u (Infinity where it is less than lo of K)
  const off = (c, u, K, lo) => { const t = unmix(c, K, u); return t >= lo ? dist(c, u.map((v, k) => v + t * (K[k] - v))) : Infinity; };
  const like = (lo) => {
    const m = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      if (!band[p]) continue;
      // the edit changed it by more than the tolerance: where the portrait is as dark as the frame already (its outline,
      // a lash's corner) any colour there reads as the frame laid over it
      const c = rgb(E, p), u = rgb(im, p);
      if (dist(c, u) < tol) continue;
      const d = Math.min(...cols.map((K) => off(c, u, K, lo)));
      if (d < tol && others.every((Q) => off(c, u, Q, lo) > d)) m[p] = 1;
    }
    return m;
  };
  const body = minus(grow(margin, like(min), w, h, reach), margin);
  return count(body) ? minus(grow(body, like(min / 2), w, h, lw + 1), margin) : body;
}

/** register an edit to the base on roi (skip: boxes the edit was asked to change) and resample it into the base frame */
export function registered(base, edit, roi, skip) {
  const A = align(base, edit, { roi, skip });
  return { A, im: warp(edit, A) };
}

/**
 * The strokes of `im` (already in the base frame) inside `zone` that are not skin. Returns a full-canvas layer with
 * antialiased edges, its core mask, and the skin colour measured round it. o.minArea: drop specks; o.keep(c): which
 * components to keep; o.thresh: how far from the skin a pixel must be to count (default 45).
 */
export function strokes(im, zone, w, h, o = {}) {
  const n = w * h, thresh = o.thresh ?? 45;
  // the edit's own skin round the zone
  const skinM = new Uint8Array(n);
  const ref = o.skin;
  for (let p = 0; p < n; p++) if (zone[p] && im.d[4 * p + 3] > 250 && dist(rgb(im, p), ref) < 30) skinM[p] = 1;
  const S = count(skinM) > 50 ? medianColor(im, skinM) : ref;
  const feat = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (zone[p] && im.d[4 * p + 3] > 128 && dist(rgb(im, p), S) > thresh) feat[p] = 1;
  const cc = components(feat, w, h);
  const keepIds = cc.comps.filter((c) => c.area >= (o.minArea ?? 30) && (!o.keep || o.keep(c))).map((c) => c.id);
  const core = compMask(cc.lab, keepIds);
  const L = blank(w, h);
  for (let p = 0; p < n; p++) if (core[p]) { L.d.set([im.d[4 * p], im.d[4 * p + 1], im.d[4 * p + 2], 255], 4 * p); }
  const under = blank(w, h);
  for (let p = 0; p < n; p++) under.d.set([S[0], S[1], S[2], 255], 4 * p);
  const keyed = { alpha: new Float32Array(n).fill(1), fg: im };
  softEdge(L, core, im, under, keyed, w, h, { r: 2.5, allow: zone, minSep: 30 });
  return { L, core, skin: S, comps: cc.comps.filter((c) => keepIds.includes(c.id)) };
}
