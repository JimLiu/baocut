// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// The eyes an expression edit drew, for both builds (puppet-build.mjs and the part-map build): cut out of the
// expression's patch into layers of their own (roles expr_eye_L and expr_eye_R, a BaoCut extension). The BaoCut player
// squashes them in a blink like the neutral eyes, over that side's closed lid, so a character that smiles or frowns
// still blinks; the patch was opaque over the eyes, and every expression of a talking host hid every blink. Under them
// the patch and its talking copy are the bare face. The LivLiv package keeps the patch whole: LivLiv draws a role it
// does not know as a plain layer, always on.
import { blank, clone, dilate, minus, count, bbox, blur, components } from './ops.mjs';
import { setPx, rgb } from './layers.mjs';
import { writePng } from './png.mjs';

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** a white of an eye: light, grey and not the skin (a pale skin is light and grey too) */
const whiteOf = (skin) => (c) => Math.min(...c) > 190 && Math.max(...c) - Math.min(...c) < 45 && dist3(c, skin) > 25;

/**
 * The whites of `im` in the box (pixels that pass `ok` and are whites): their mask `m`, count `n` and box `b`. Only the
 * eye's own: the pieces (joined across 2 px, the iris splits the whites in two) at least a fifth the size of the largest,
 * so a light fleck in the hair or a brow does not stretch the eye up to it.
 */
function whites(im, [x0, y0, x1, y1], ok, white, w, h) {
  const m = new Uint8Array(w * h);
  for (let y = Math.max(0, Math.round(y0)); y <= Math.min(h - 1, Math.round(y1)); y++) {
    for (let x = Math.max(0, Math.round(x0)); x <= Math.min(w - 1, Math.round(x1)); x++) {
      const p = y * w + x;
      if (ok(p) && white(rgb(im, p))) m[p] = 1;
    }
  }
  const { lab, comps } = components(dilate(m, w, h, 2), w, h);
  const big = Math.max(0, ...comps.map((c) => c.area));
  const keep = new Set(comps.filter((c) => c.area >= 0.2 * big).map((c) => c.id));
  let n = 0, b = null;
  for (let p = 0; p < w * h; p++) {
    if (!m[p]) continue;
    if (!keep.has(lab[p])) { m[p] = 0; continue; }
    const x = p % w, y = (p - x) / w;
    n++;
    b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y];
  }
  return { n, b, m };
}

/** the low end of a list of numbers (its 20th percentile), for a line's usual thickness */
const low = (v) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(0.2 * (v.length - 1))] : 0);

/**
 * How far the neutral eye's lines reach past its whites, up, down, left and right: per column (per row) from the
 * edge of the eye layer to its first white, the low end over the columns (rows) that have whites, so the columns
 * where the iris reaches up to the lash do not count. At least 2 px.
 */
function lineMargins(im, drawn, b, white, w) {
  const up = [], down = [], left = [], right = [];
  for (let x = b[0]; x <= b[2]; x++) {
    let a0 = -1, a1 = -1, w0 = -1, w1 = -1;
    for (let y = b[1]; y <= b[3]; y++) {
      const p = y * w + x;
      if (!drawn[p]) continue;
      if (a0 < 0) a0 = y;
      a1 = y;
      if (white(rgb(im, p))) { if (w0 < 0) w0 = y; w1 = y; }
    }
    if (w0 >= 0) { up.push(w0 - a0); down.push(a1 - w1); }
  }
  for (let y = b[1]; y <= b[3]; y++) {
    let a0 = -1, a1 = -1, w0 = -1, w1 = -1;
    for (let x = b[0]; x <= b[2]; x++) {
      const p = y * w + x;
      if (!drawn[p]) continue;
      if (a0 < 0) a0 = x;
      a1 = x;
      if (white(rgb(im, p))) { if (w0 < 0) w0 = x; w1 = x; }
    }
    if (w0 >= 0) { left.push(w0 - a0); right.push(a1 - w1); }
  }
  return [left, up, right, down].map((v) => Math.max(2, low(v)));
}

/** the skin, or close to it: a line of the eye ends where this starts */
const SKIN_NEAR = 40;

/**
 * Where each eye the edit `E` drew is, found before its brows: the brows are looked for outside it, so a lash is never
 * taken for a brow, and a brow drawn down to the eye loses at most the tip that touches it. The eye is placed by its
 * whites. The box round them, grown on each side by as thick as the neutral eye's lines are there (a wide-open eye
 * reaches above the neutral one, a narrowed one stays below its brow) and never narrower than the neutral eye, bounds
 * it; inside the box, each column runs from its whites (where the iris hides them, from between the next columns'
 * whites) up and down through the eye's lines until the skin, so a brow drawn just above the lid, apart from it by
 * skin, stays out. `eyes` per side (image left first): { drawn: the neutral eye layer's pixels, hit: whether the edit
 * changed that eye }. `patch`: the expression patch (its pixels with alpha); `changed`: the strokes the edit changed.
 * Returns { R: [mask or null per side], shut: the sides the edit drew shut (no whites, nothing to blink: they stay in
 * the patch), any: both masks together }.
 */
export function expressionEyeRegions({ E, im, patch, eyes, changed, skin, w, h }) {
  const N = w * h, white = whiteOf(skin), R = [null, null], shut = [], any = new Uint8Array(N);
  const notSkin = (p) => dist3(rgb(E, p), skin) > SKIN_NEAR;
  eyes.forEach((e, s) => {
    if (!e?.hit) return;
    const b = bbox(e.drawn, w, h);
    if (!b) return;
    const bw = b[2] - b[0] + 1, bh = b[3] - b[1] + 1, inPatch = (p) => patch.d[4 * p + 3] > 0;
    const ok = (p) => inPatch(p) && (e.drawn[p] || changed[p]);
    const wn = whites(im, b, (p) => e.drawn[p], white, w, h);
    const we = whites(E, [b[0] - 0.15 * bw, b[1] - 0.6 * bh, b[2] + 0.15 * bw, b[3] + 0.4 * bh], ok, white, w, h);
    if (wn.n >= 30 && we.n < 0.2 * wn.n) { shut.push(s ? 'R' : 'L'); return; }
    const M = new Uint8Array(N);
    if (wn.n >= 30 && we.b) {
      const m = lineMargins(im, e.drawn, b, white, w);
      const X0 = Math.max(0, Math.min(b[0], we.b[0] - m[0])), X1 = Math.min(w - 1, Math.max(b[2], we.b[2] + m[2]));
      const Y0 = Math.max(0, we.b[1] - m[1]), Y1 = Math.min(h - 1, we.b[3] + m[3]);
      // each column's whites, then a start for the columns without (between the nearest columns with whites)
      const span = [];
      for (let x = X0; x <= X1; x++) {
        let t = -1, u = -1;
        for (let y = Y0; y <= Y1; y++) if (we.m[y * w + x]) { if (t < 0) t = y; u = y; }
        span.push(t < 0 ? null : [t, u]);
      }
      const mid = (i, d) => { for (let j = i + d; j >= 0 && j < span.length; j += d) if (span[j]) return (span[j][0] + span[j][1]) / 2; return null; };
      span.forEach((sp, i) => {
        const x = X0 + i;
        let lo, hi;
        // past the whites by at least as thick as the neutral eye's lines: a light band under the lash, close to the
        // skin, would stop the walk short of the lash
        if (sp) [lo, hi] = [Math.max(Y0, sp[0] - m[1]), Math.min(Y1, sp[1] + m[3])];
        else {
          const ms = [mid(i, -1), mid(i, 1)].filter((v) => v !== null), y = Math.round(ms.reduce((a, v) => a + v, 0) / ms.length);
          // a corner past the whites, or no line there: the whole column of the box
          if (!ms.length || !notSkin(y * w + x)) { lo = Y0; hi = Y1; } else lo = hi = y;
        }
        while (lo > Y0 && notSkin((lo - 1) * w + x)) lo--;
        while (hi < Y1 && notSkin((hi + 1) * w + x)) hi++;
        for (let y = lo; y <= hi; y++) M[y * w + x] = 1;
      });
      // the soft edge of each line, still inside the box
      const G = dilate(M, w, h, 2);
      M.fill(0);
      for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) { const p = y * w + x; if (G[p]) M[p] = 1; }
    } else {
      // no whites to go by (an eye all iris): the neutral eye's place, a little grown
      for (let y = Math.max(0, Math.round(b[1] - 0.15 * bh)); y <= Math.min(h - 1, Math.round(b[3] + 0.15 * bh)); y++) {
        for (let x = Math.max(0, Math.round(b[0] - 0.1 * bw)); x <= Math.min(w - 1, Math.round(b[2] + 0.1 * bw)); x++) M[y * w + x] = 1;
      }
    }
    for (let p = 0; p < N; p++) if (M[p] && !inPatch(p)) M[p] = 0; else if (M[p]) any[p] = 1;
    R[s] = M;
  });
  return { R, shut, any };
}

/**
 * Cut the eyes in `regions` (from expressionEyeRegions) out of the patch `L` and its talking copy `T`, in place;
 * `keep`: pixels that stay in the patch (the brows it redrew), or null; `under` the bare face; `pivots` per side, the
 * neutral eyes' (the lid line). Returns `whole` (the patch and its talking copy as they were, for the LivLiv package),
 * `eyes` ([{ side, L, pivot }] for the sides cut) and `note` (for the check line).
 */
export function cutExpressionEyes({ L, T, under, regions, pivots, keep, w, h }) {
  const N = w * h, whole = { L: clone(L), talk: clone(T) }, out = [];
  regions.R.forEach((M, s) => {
    if (!M) return;
    const R = keep ? minus(M, keep) : M;
    if (!count(R)) return;
    const f = blur(Float32Array.from(R), w, h, 1);
    const X = blank(w, h);
    for (let p = 0; p < N; p++) {
      const a = Math.min(1, 1.25 * f[p]) * (L.d[4 * p + 3] / 255);
      if (!(a > 0.01)) continue;
      setPx(X, p, rgb(L, p), a);
      for (const P of [L, T]) setPx(P, p, rgb(under, p), P.d[4 * p + 3] / 255);
    }
    out.push({ side: s ? 'R' : 'L', L: X, pivot: pivots[s] });
  });
  const cut = out.map((o) => o.side).join(' ');
  const { shut } = regions;
  const note = `${cut ? `; eyes ${cut} blink` : ''}${shut.length ? `; eyes ${shut.join(' ')} drawn shut, kept in the patch` : ''}`;
  return { whole, eyes: out, note };
}

/** debug: the edit, its eye regions tinted green */
export function writeEyeDebug(file, E, { any }, w, h) {
  const dm = clone(E);
  for (let p = 0; p < w * h; p++) {
    if (any[p]) dm.d.set([0.5 * E.d[4 * p], 0.5 * E.d[4 * p + 1] + 127, 0.5 * E.d[4 * p + 2]], 4 * p);
    dm.d[4 * p + 3] = 255;
  }
  writePng(file, dm);
}

/** the layers for the cut eyes, after the expression's patch */
export const expressionEyeLayers = (id, eyes) =>
  eyes.map((e) => ({ id: `expr_${id}_eye_${e.side}`, L: e.L, def: { group: 'head', depth: 0, role: `expr_eye_${e.side}`, expression: id, pivot: e.pivot }, hidden: true }));
