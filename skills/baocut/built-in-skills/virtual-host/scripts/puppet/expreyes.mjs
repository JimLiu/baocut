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
 * What a walk out from the whites meets: the skin; the skin in shade (its own colour darker, down to SHADE_MIN of its
 * luma, within SHADE_NEAR of the skin scaled to that luma: under the bangs, in the socket); a line (darker than that, or
 * darker than LINE_K of the skin's luma in a colour of its own: a lash, a crease, the iris); anything else (the whites,
 * a highlight, light hair). Shade stops a walk only once it has crossed a line: past the lash it is the lid, and taken
 * for the eye it carried the walk up through the crease, column by column, so a blink left the crease in pieces; before
 * the lash it is the whites in the lid's shadow, as grey and pink as a pale skin's shade
 */
const SHADE_MIN = 0.7, SHADE_NEAR = 30, LINE_K = 0.85;
const SKIN = 0, SHADE = 1, LINE = 2, OTHER = 3;
/** how many columns running a lid line can go missing at a corner (a faint stroke) and the opening still go on */
const CORNER_MISS = 3;
/** the widest gap between columns of the eye, as a share of its whites' width, that is the eye going on */
const GAP_K = 0.1;
/**
 * How far past the box a line of the eye can go on, as a share of the whites' height (up and down) and width (the
 * corners): a lash drawn thicker than the neutral one, a wing flicked further out. A line that ends on the skin within
 * it is the eye's, taken whole; cut straight at the box, the squashed eye's top was a straight edge while it closed
 */
const PAST_H = 0.35, PAST_W = 0.15;
const luma3 = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const toneOf = (skin) => {
  const ls = luma3(skin);
  return (c) => {
    if (dist3(c, skin) <= SKIN_NEAR) return SKIN;
    const k = luma3(c) / ls;
    if (k >= SHADE_MIN && k <= 1 && dist3(c, skin.map((v) => v * k)) <= SHADE_NEAR) return SHADE;
    return k < LINE_K ? LINE : OTHER;
  };
};

/**
 * The convex hull's side of points [x, y] sorted by x, as a function of x between the first and the last: side 1 the
 * least y (the top of a shape, in image rows), -1 the greatest
 */
function envelope(pts, side) {
  const H = [];
  for (const p of pts) {
    while (H.length >= 2) {
      const [o, a] = [H[H.length - 2], H[H.length - 1]];
      if (side * ((a[0] - o[0]) * (p[1] - o[1]) - (a[1] - o[1]) * (p[0] - o[0])) > 0) break;
      H.pop();
    }
    H.push(p);
  }
  return (x) => {
    let j = 0;
    while (j < H.length - 2 && H[j + 1][0] < x) j++;
    const [a, b] = [H[j], H[Math.min(j + 1, H.length - 1)]];
    return b[0] === a[0] ? a[1] : a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
  };
}

/**
 * Where each eye the edit `E` drew is, found before its brows: the brows are looked for outside it, so a lash is never
 * taken for a brow, and a brow drawn down to the eye loses at most the tip that touches it. The eye is placed by its
 * whites. The box round them, grown on each side by as thick as the neutral eye's lines are there (a wide-open eye
 * reaches above the neutral one, a narrowed one stays below its brow) and never narrower or shallower than the neutral
 * eye, bounds it; past the box only a line that ends on the skin a little further out goes on (a lash drawn thicker, a
 * wing flicked further). Light spots the eye's lines close all round within the neutral eye (a highlight as light as
 * the skin) count as the eye's lines. Inside the box: over the whites' columns, each column from the whites' outline (a
 * convex arc over their tops, a concave one under their bottoms, so the iris, a catchlight or a shaded white inside it
 * is the eye) out through the eye's lines until the skin, or the skin's shade once past a line, so a crease or a brow
 * drawn above the lid, apart from it by skin or shadow, stays out; past them, a corner: the opening between its lid
 * lines while it narrows, then the wing; then the light the whites run into, and a gap of a few columns the eye goes on
 * over. Whites drawn as pink as the skin and cut off from the rest by the iris are not found: they stay in the patch,
 * close to the skin's colour. `eyes` per side (image left first): { drawn: the neutral eye layer's pixels, hit: whether
 * the edit changed that eye }. `patch`: the expression patch (its pixels with alpha); `changed`: the strokes the edit
 * changed. Returns { R: [mask or null per side], shut: the sides the edit drew shut (no whites, nothing to blink: they
 * stay in the patch), any: both masks together }.
 */
export function expressionEyeRegions({ E, im, patch, eyes, changed, skin, w, h }) {
  const N = w * h, white = whiteOf(skin), R = [null, null], shut = [], any = new Uint8Array(N);
  const toneAt = ((t) => (p) => t(rgb(E, p)))(toneOf(skin));
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
      // never shallower than the neutral eye: whites tinted toward the skin under the iris are not found, and the box
      // cut the iris across its middle
      const Y0 = Math.max(0, we.b[1] - m[1]), Y1 = Math.min(h - 1, Math.max(b[3], we.b[3] + m[3]));
      // past the box only a line goes on, and only if it ends within this
      const py = Math.ceil(PAST_H * (we.b[3] - we.b[1] + 1)), px = Math.ceil(PAST_W * (we.b[2] - we.b[0] + 1));
      const OX0 = Math.max(0, X0 - px), OX1 = Math.min(w - 1, X1 + px), OY0 = Math.max(0, Y0 - py), OY1 = Math.min(h - 1, Y1 + py);
      // the eye's light spots its lines close all round, within the neutral eye (a highlight in the iris as light as a
      // pale skin, whites tinted toward it): taken for the skin, they stopped a walk down the column halfway through the
      // iris, and the rest of the iris stayed in the patch, over the closing lid. Skin closed in by strands of the bangs
      // over the lid is outside the neutral eye and stays the skin
      const pocket = new Uint8Array(N);
      {
        const seen = new Uint8Array(N), st = [];
        for (let y = OY0; y <= OY1; y++) for (let x = OX0; x <= OX1; x++) {
          const p = y * w + x;
          if ((y === OY0 || y === OY1 || x === OX0 || x === OX1) && toneAt(p) !== LINE) { seen[p] = 1; st.push(p); }
        }
        while (st.length) {
          const p = st.pop(), x = p % w, y = (p - x) / w;
          for (const [q, ok] of [[p - 1, x > OX0], [p + 1, x < OX1], [p - w, y > OY0], [p + w, y < OY1]]) {
            if (ok && !seen[q] && toneAt(q) !== LINE) { seen[q] = 1; st.push(q); }
          }
        }
        for (let y = OY0; y <= OY1; y++) for (let x = OX0; x <= OX1; x++) {
          const p = y * w + x, t = toneAt(p);
          if (!seen[p] && (t === SKIN || t === SHADE)) pocket[p] = 1;
        }
        const pc = components(pocket, w, h), inEye = new Map();
        for (let p = 0; p < N; p++) if (pc.lab[p] && e.drawn[p]) inEye.set(pc.lab[p], (inEye.get(pc.lab[p]) ?? 0) + 1);
        const keep = new Set(pc.comps.filter((c) => (inEye.get(c.id) ?? 0) >= 0.8 * c.area).map((c) => c.id));
        for (let p = 0; p < N; p++) if (pocket[p] && !keep.has(pc.lab[p])) pocket[p] = 0;
      }
      // each column's whites (columns counted from OX0)
      const found = [];
      for (let x = OX0; x <= OX1; x++) {
        let t = -1, u = -1;
        for (let y = Y0; y <= Y1; y++) if (we.m[y * w + x]) { if (t < 0) t = y; u = y; }
        found.push(t < 0 ? null : [t, u]);
      }
      const F = found.flatMap((sp, i) => (sp ? [i] : []));
      // over the whites' columns, the eye's outline: a convex arc over their tops, a concave one under their bottoms. A
      // column's own whites can be far inside it: the iris hides them, or a highlight of the iris passes for white, or
      // a shaded white goes unfound; from them, the walk out met the iris for a line and stopped at the shade over it,
      // short of the lash, or stopped at a highlight as light as the skin
      const top = envelope(F.map((i) => [i, found[i][0]]), 1), bot = envelope(F.map((i) => [i, found[i][1]]), -1);
      // how far from the middle of the eye a corner's line can be (a wing flicked up)
      const reach = Math.ceil((we.b[3] - we.b[1]) / 2 + Math.max(m[1], m[3]));
      const col = (i) => {
        const x = OX0 + i, at = (y) => (pocket[y * w + x] ? LINE : toneAt(y * w + x)), out = x < X0 || x > X1;
        // from y on outward (d -1 up, 1 down) through the eye's lines, until the skin, or the shade past a line. Past
        // the box (or in a column past it) only a line goes on; one still going at the end of the margin is something
        // else (a brow pressed onto the lid, hair): null, and a column in the box stops at the box as before
        const edge = (y, d) => (d < 0 ? Math.max(y, Y0) : Math.min(y, Y1));
        const walk = (y, d, crossed) => {
          for (let q = y + d; ; y = q, q += d) {
            if (q < OY0 || q > OY1) return out ? null : edge(y, d);
            const t = at(q);
            if (t === SKIN || (t === SHADE && crossed)) return y;
            if (t === LINE) crossed = true;
            else if (out || q < Y0 || q > Y1) return out ? null : edge(y, d);
          }
        };
        const lineIn = (a, b) => { for (let y = a; y <= b; y++) if (at(y) === LINE) return true; return false; };
        const [n0, n1] = out ? [OY0, OY1] : [Y0, Y1];
        const nearest = (y, d) => { for (let q = y; Math.abs(q - y) <= reach && q >= n0 && q <= n1; q += d) if (at(q) === LINE) return q; return -1; };
        const fill = (lo, hi) => { for (let y = lo; y <= hi; y++) M[y * w + x] = 1; return [lo, hi]; };
        return { at, walk, lineIn, nearest, fill, out };
      };
      const F0 = F[0], F1 = F[F.length - 1], spans = [];
      for (let i = F0; i <= F1; i++) {
        const sp = found[i], { at, walk, lineIn, fill } = col(i);
        // past the outline by as thick as the neutral eye's lines: a light band under the lash, close to the skin,
        // would stop the walk short of the lash. Plain skin the start takes in past the lines comes off: over a narrowed
        // eye's lash, under a smiling eye's crescent (its chord bridges it)
        const t = Math.round(top(i)), u = Math.round(bot(i));
        let lo = Math.max(Y0, t - m[1]), hi = Math.min(Y1, u + m[3]);
        const lo1 = sp ? sp[0] : t, hi1 = sp ? sp[1] : u;
        while (lo < lo1 && at(lo) === SKIN) lo++;
        while (hi > hi1 && at(hi) === SKIN) hi--;
        spans[i] = fill(walk(lo, -1, lineIn(lo, lo1 - 1)), walk(hi, 1, lineIn(hi1 + 1, hi)));
      }
      // the corners past the whites, out from the whites column by column. While the opening narrows, from the lid line
      // above its middle to the one below and on out through both (a white too shaded to be found, as pink as the skin,
      // lies between; a faint line missing for a column or two goes on where it was); then, the wing of a flicked eye:
      // from the middle, if it is on the eye (a line, a white, a shade), else the line nearest. The whole column of the
      // box took the skin and the crease above the corner, and a blink squashed them with the eye
      // Past the box a corner goes on column by column only on lines that end on the skin, and stops at the first
      // column without one
      for (const [from, d] of [[F0, -1], [F1, 1]]) {
        let y = Math.round((found[from][0] + found[from][1]) / 2), [up0, dn0] = spans[from], open = true, miss = 0;
        for (let i = from + d; i >= 0 && i < found.length; i += d) {
          const { at, walk, nearest, fill, out } = col(i);
          let up = nearest(y, -1), dn = nearest(y, 1);
          if (open) {
            miss = up < 0 || dn < 0 ? miss + 1 : 0;
            if (out && miss) open = false;
            if (up < 0) up = up0;
            if (dn < 0) dn = dn0;
            open = open && miss <= CORNER_MISS && dn - up <= dn0 - up0 + 1;
          }
          if (open) {
            const a = walk(up, -1, true), b = walk(dn, 1, true);
            if (a === null || b === null) break;
            fill(a, b);
            [up0, dn0] = [up, dn]; y = Math.round((up + dn) / 2);
            continue;
          }
          const t = at(y);
          let q0 = y;
          if (t === SKIN) {
            const a = nearest(y, -1), b = nearest(y, 1);
            q0 = a < 0 ? b : b < 0 || y - a <= b - y ? a : b;
            if (q0 < 0) { if (out) break; continue; }
          } else if (out && t !== LINE) break;
          const crossed = t !== SHADE && t !== OTHER;
          const a = walk(q0, -1, crossed), b = walk(q0, 1, crossed);
          if (a === null || b === null) { if (out) break; continue; }
          fill(a, b);
        }
      }
      // and the light of the opening the whites run into: a white too pink or too shaded to be found as one, a highlight
      const st = [];
      for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (we.m[y * w + x]) { M[y * w + x] = 1; st.push(y * w + x); }
      while (st.length) {
        const p = st.pop(), x = p % w, y = (p - x) / w;
        for (const [q, ok] of [[p - 1, x > X0], [p + 1, x < X1], [p - w, y > Y0], [p + w, y < Y1]]) {
          if (ok && !M[q] && toneAt(q) === OTHER) { M[q] = 1; st.push(q); }
        }
      }
      // a gap of a few columns the eye goes on over (a white as pink as the skin at a corner, met by no walk) is shut
      // to where the columns on both sides reach, and each column's own gap between its lines: left out, it stayed in
      // the patch, a light stripe over the shut lid
      const ext = [];
      for (let x = OX0; x <= OX1; x++) {
        let t = -1, u = -1;
        for (let y = Y0; y <= Y1; y++) if (M[y * w + x]) { if (t < 0) t = y; u = y; }
        ext.push(t < 0 ? null : [t, u]);
      }
      const gap = Math.max(CORNER_MISS, Math.ceil(GAP_K * (we.b[2] - we.b[0] + 1)));
      const reachOf = (a, b) => {
        let t = Infinity, u = -Infinity;
        for (let j = Math.max(0, a); j <= Math.min(ext.length - 1, b); j++) if (ext[j]) { t = Math.min(t, ext[j][0]); u = Math.max(u, ext[j][1]); }
        return t <= u ? [t, u] : null;
      };
      ext.forEach((e, i) => {
        const a = reachOf(i - gap, i - 1), b = reachOf(i + 1, i + gap);
        let t = e ? e[0] : Infinity, u = e ? e[1] : -Infinity;
        if (a && b) { t = Math.min(t, Math.max(a[0], b[0])); u = Math.max(u, Math.min(a[1], b[1])); }
        for (let y = t; y <= u; y++) M[y * w + OX0 + i] = 1;
      });
      // the soft edge of each line, still inside the box and the margin past it
      const G = dilate(M, w, h, 2);
      M.fill(0);
      for (let y = OY0; y <= OY1; y++) for (let x = OX0; x <= OX1; x++) { const p = y * w + x; if (G[p]) M[p] = 1; }
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
 *
 * An open eye over the cut patch is the patch as drawn, over whatever is under it: where the patch is opaque it fades
 * into the bare face over the region's soft edge and the eye layer is opaque; where the patch is see-through (an edit
 * that barely changed the face) its colour stays and the eye layer takes a share of its opacity, so shut, the face
 * under the patch shows there. A soft eye layer over a patch gone to the bare face left a ring of it round the eye.
 */
export function cutExpressionEyes({ L, T, under, regions, pivots, keep, w, h }) {
  const N = w * h, whole = { L: clone(L), talk: clone(T) }, out = [];
  const mix = (c, u, k) => c.map((v, i) => Math.round(v + (u[i] - v) * k));
  regions.R.forEach((M, s) => {
    if (!M) return;
    const R = keep ? minus(M, keep) : M;
    if (!count(R)) return;
    const f = blur(Float32Array.from(R), w, h, 1);
    const X = blank(w, h);
    for (let p = 0; p < N; p++) {
      const k = Math.min(1, 1.25 * f[p]), a = L.d[4 * p + 3] / 255;
      if (!(k > 0.01) || !(a > 0)) continue;
      const ax = a > 254.5 / 255 ? 1 : a * k;
      setPx(X, p, rgb(L, p), ax);
      for (const P of [L, T]) {
        const aP = P.d[4 * p + 3] / 255;
        if (ax === 1) setPx(P, p, mix(rgb(P, p), rgb(under, p), k), aP);
        else setPx(P, p, rgb(P, p), Math.max(0, (aP - ax) / (1 - ax)));
      }
    }
    out.push({ side: s ? 'R' : 'L', L: X, pivot: pivots[s] });
  });
  const cut = out.map((o) => o.side).join(' ');
  const { shut } = regions;
  const note = `${cut ? `; eyes ${cut} blink` : ''}${shut.length ? `; eyes ${shut.join(' ')} drawn shut, kept in the patch` : ''}`;
  return { whole, eyes: out, note };
}

/** debug: the edit, its eye regions tinted green, what the patch leaves out (never drawn) dimmed */
export function writeEyeDebug(file, E, { any }, w, h, patch) {
  const dm = clone(E);
  for (let p = 0; p < w * h; p++) {
    if (any[p]) dm.d.set([0.5 * E.d[4 * p], 0.5 * E.d[4 * p + 1] + 127, 0.5 * E.d[4 * p + 2]], 4 * p);
    else if (patch && !patch.d[4 * p + 3]) dm.d.set([0.3 * E.d[4 * p], 0.3 * E.d[4 * p + 1], 0.3 * E.d[4 * p + 2]], 4 * p);
    dm.d[4 * p + 3] = 255;
  }
  writePng(file, dm);
}

/** the layers for the cut eyes, after the expression's patch */
export const expressionEyeLayers = (id, eyes) =>
  eyes.map((e) => ({ id: `expr_${id}_eye_${e.side}`, L: e.L, def: { group: 'head', depth: 0, role: `expr_eye_${e.side}`, expression: id, pivot: e.pivot }, hidden: true }));
