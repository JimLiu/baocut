// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// The brows an expression edit redrew, for both builds (puppet-build.mjs and the part-map build). The players draw an
// expression's brow texture right after the brows layer, over the bangs, while the expression's patch is under them:
// so a brow the edit moved onto the hair still shows.
import { blank, dilate, and, or, minus, count, blur, components, compMask, close, bbox, grow } from './ops.mjs';
import { boxMask } from './segment.mjs';
import { setPx, rgb } from './layers.mjs';
import { writePng } from './png.mjs';

// how far an edit's brow can move: up by this much of its width (raised in surprise), down to this far into the
// neutral eye, top to bottom (pressed onto the lid in anger)
const BROW_RISE = 0.6, BROW_DROP = 0.5;
// a brow runs along the row at least this much of its thickness; a strand line drawn across or beside it is narrower
const STROKE_RUN = 0.6;
// the largest piece on a side is a brow when it has at least this much of the neutral brow's pixels (smaller: a speck
// of hair); other pieces (a brow cut by the strands over it) when they have this much of the largest and lie level
const PIECE_MIN = 0.06, PIECE_OTHER = 0.25;
// a brow that runs into an eye the edit drew goes on as long as this much of its thickness is there, column by
// column, at most this much of its width
const INTO_EYE_FILL = 0.4, INTO_EYE_MAX = 0.5;
// brow-coloured pixels this much of a brow's thickness from the strokes taken are the same brow
const BROW_GROW = 0.5;
// under the neutral closed lid, this much of it
const UNDER_LID_GROW = 2;
// a colour this near the brow an edit drew (and nearer it than the skin) is that brow
const SAME_BROW = 60;
// where the part map painted a strand across a brow: a gap between two columns of the map's brow at least as thick
// as its median is bridged when it is at most this much of the brow's width; there a pixel this far or more from the
// strand's own colour toward the brow's (the two at least ACROSS_CONTRAST apart; the strand's colour from this many
// columns either way) is the brow drawn over the strand
const ACROSS_GAP = 0.4, ACROSS_T = 0.4, ACROSS_CONTRAST = 24, REF_SPAN = 3;
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** the left (s 0) or right (s 1) half of m */
export const sideOf = (m, s, midX, w, h) => and(m, boxMask(w, h, s ? midX : 0, 0, s ? w - 1 : midX - 1, h - 1));

/**
 * Where an edit's brows can be, over skin or hair: round the old brows (`full`, both sides), up by part of their width
 * (raised) and down into the eyes (lowered onto the lids). `boxes` and `eyes` are [x0, y0, x1, y1] per side (a missing
 * brow is null). A band that stopped at the brows' own height cut a raised brow straight across and left the rest of
 * it in the patch, under the bangs; one that stopped at the eyes left a lowered brow's inner end in the patch, where a
 * blink's lid covers it.
 */
export function browNear({ full, boxes, eyes, midX, eyeH, w, h }) {
  const down = (e) => e[1] + BROW_DROP * (e[3] - e[1]);
  const below = or(boxMask(w, h, 0, 0, midX - 1, down(eyes[0])), boxMask(w, h, midX, 0, w - 1, down(eyes[1])));
  let near = dilate(full, w, h, Math.max(4, Math.round(0.3 * eyeH)));
  for (const s of [0, 1]) {
    const b = boxes[s];
    if (!b) continue;
    const bw = b[2] - b[0];
    near = or(near, boxMask(w, h, b[0] - 0.25 * bw, b[1] - BROW_RISE * bw, b[2] + 0.25 * bw, down(eyes[s])));
  }
  return and(near, below);
}

/**
 * The brow where the part map painted a strand across it but the portrait draws the brow over the strand, or through
 * it: in the band of a brow (`brow`, a side each of `midX`), the pixels of the bangs (`front`) nearer the brow's colour
 * `browCol` than the strand's own (the hair just above and below the brow there). The band runs through the columns
 * where the map has the brow's whole thickness (a strand slanting across leaves some of it above and below) and on
 * from one to the next across a gap. Left in the bangs, that stretch of brow stayed where it was in every expression.
 * A strand drawn over the brow has the strand's colour there and stays hair, and so does a strand's line crossing the
 * brow on its own (under 3 px along the row). Returns the mask of those pixels.
 */
export function browAcross({ im, brow, front, browCol, midX, w, h }) {
  const N = w * h, out = new Uint8Array(N);
  for (const s of [0, 1]) {
    const side = sideOf(brow, s, midX, w, h), b = bbox(side, w, h);
    if (!b) continue;
    const cols = new Map(), ths = [];
    for (let x = b[0]; x <= b[2]; x++) {
      let top = -1, bot = -1;
      for (let y = b[1]; y <= b[3]; y++) if (side[y * w + x]) { if (top < 0) top = y; bot = y; }
      if (top >= 0) { cols.set(x, [top, bot]); ths.push(bot - top + 1); }
    }
    ths.sort((a, c) => a - c);
    const th = ths[ths.length >> 1], band = new Map();
    // the columns with the brow's whole thickness (not a stray far thicker), and the line from one to the next
    const anchors = [...cols.keys()].filter((x) => { const [t, u] = cols.get(x); return u - t + 1 >= th && u - t + 1 <= 2.5 * th; });
    for (const x of anchors) band.set(x, cols.get(x));
    for (let i = 0; i + 1 < anchors.length; i++) {
      const xa = anchors[i], xb = anchors[i + 1], gap = xb - xa, A = cols.get(xa), B = cols.get(xb);
      if (gap < 2 || gap > ACROSS_GAP * (b[2] - b[0] + 1) || Math.abs(A[0] + A[1] - B[0] - B[1]) / 2 > gap) continue;
      for (let x = xa + 1; x < xb; x++) {
        const f = (x - xa) / gap;
        band.set(x, [Math.round(A[0] + f * (B[0] - A[0])), Math.round(A[1] + f * (B[1] - A[1]))]);
      }
    }
    const cand = new Uint8Array(N);
    for (const [x, [top, bot]] of band) {
      // the strand's colour: the hair just above the brow and just below it, a few columns either way (a strand slants)
      const refs = [[top - 6, top - 2], [bot + 2, bot + 6]].map(([y0, y1]) => {
        const m = [0, 0, 0];
        let n = 0;
        for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let xx = Math.max(0, x - REF_SPAN); xx <= Math.min(w - 1, x + REF_SPAN); xx++) {
          const p = y * w + xx;
          if (front[p] && !brow[p]) { const c = rgb(im, p); for (let k = 0; k < 3; k++) m[k] += c[k]; n++; }
        }
        return n ? m.map((v) => v / n) : null;
      }).filter(Boolean);
      if (!refs.length) continue;
      const ref = [0, 1, 2].map((k) => refs.reduce((a, r) => a + r[k], 0) / refs.length);
      const e = [0, 1, 2].map((k) => browCol[k] - ref[k]), ee = e[0] ** 2 + e[1] ** 2 + e[2] ** 2;
      if (ee < ACROSS_CONTRAST ** 2) continue;
      for (let y = Math.max(0, top); y <= Math.min(h - 1, bot); y++) {
        const p = y * w + x;
        if (!front[p] || brow[p]) continue;
        const c = rgb(im, p);
        if (((c[0] - ref[0]) * e[0] + (c[1] - ref[1]) * e[1] + (c[2] - ref[2]) * e[2]) / ee >= ACROSS_T) cand[p] = 1;
      }
    }
    // 3 px or more along the row
    for (let y = 0; y < h; y++) for (let x = 0; x < w; ) {
      if (!cand[y * w + x]) { x++; continue; }
      let x1 = x;
      while (x1 + 1 < w && cand[y * w + x1 + 1]) x1++;
      if (x1 - x + 1 >= 3) for (let k = x; k <= x1; k++) out[y * w + k] = 1;
      x = x1 + 1;
    }
  }
  return out;
}

/** per side (s 0 left, 1 right) the median height of the columns of m */
const thicknessOf = (m, s, midX, w, h) => {
  const runs = [];
  for (let x = s ? Math.ceil(midX) : 0; x < (s ? w : Math.ceil(midX)); x++) {
    for (let y = 0; y < h; ) {
      if (!m[y * w + x]) { y++; continue; }
      let y1 = y;
      while (y1 + 1 < h && m[(y1 + 1) * w + x]) y1++;
      runs.push(y1 - y + 1);
      y = y1 + 1;
    }
  }
  runs.sort((a, b) => a - b);
  return runs.length ? runs[runs.length >> 1] : 0;
};

/**
 * The brows an edit `E` redrew: on each side the widest brow-coloured strokes in the zone `near` (from browNear),
 * changed from the portrait `im` or on the old brow. They are looked for outside `eyes` (the eyes the edit drew, from
 * expressionEyeRegions; a lash is never taken for a brow), and a brow that runs on into one goes on along its own line
 * and thickness: the eye layer leaves those pixels to the brow, so a lowered brow pressed onto the lid stays whole
 * through a blink. Strand lines drawn across or beside a brow (narrow along the row) are left out. Returns `BT` (their
 * colours, a 1 px soft edge; null when none were found: a brow the colour of the hair, and the brows stay in the
 * patch), `bm` (their pixels), `like` and `search` (for the debug picture). The players mesh a layer only where its own
 * texture is opaque, so the patch `L` and its talking copy `T` become `under` (the bare face) beneath them, also where
 * the edit left a brow as it was: the neutral brows fade out under a redrawn one.
 */
export function redrawnBrows({ E, im, near, eyes, lids, full, browCol, hairCol, skin, midX, L, T, under, w, h }) {
  const N = w * h, hairApart = !!hairCol && dist3(browCol, hairCol) >= 40;
  const eyeEdge = eyes ? dilate(eyes, w, h, 1) : new Uint8Array(N), search = minus(near, eyeEdge);
  const browish = new Uint8Array(N), like = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    if (!near[p]) continue;
    const c = rgb(E, p), dB = dist3(c, browCol);
    if (dB >= dist3(c, skin) || (hairApart && dB >= dist3(c, hairCol))) continue;
    browish[p] = 1;
    let m = 0;
    for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(E.d[4 * p + k] - im.d[4 * p + k]));
    if (search[p] && (full[p] || m > 30)) like[p] = 1;
  }
  // a strand's light edge or a gap of a pixel or two across a brow does not cut it
  const solid = and(close(like, w, h, 1), search);
  const thick = [0, 1].map((s) => thicknessOf(full, s, midX, w, h) || 6);
  const wide = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; ) {
    if (!solid[y * w + x]) { x++; continue; }
    let x1 = x;
    while (x1 + 1 < w && solid[y * w + x1 + 1]) x1++;
    if (x1 - x + 1 >= Math.max(4, Math.round(STROKE_RUN * thick[x >= midX ? 1 : 0]))) for (let k = x; k <= x1; k++) wide[y * w + k] = 1;
    x = x1 + 1;
  }
  const lc = components(dilate(wide, w, h, 1), w, h), pick = [];
  for (const s of [0, 1]) {
    const t = thick[s], mine = lc.comps.filter((c) => (c.cx >= midX) === (s === 1) && c.x1 - c.x0 >= 0.8 * (c.y1 - c.y0));
    const main = mine.filter((c) => c.x1 - c.x0 > c.y1 - c.y0).reduce((a, c) => (!a || c.area > a.area ? c : a), null);
    if (!main || main.area < PIECE_MIN * count(sideOf(full, s, midX, w, h))) continue;
    pick.push(...mine.filter((c) => c === main || (c.area >= PIECE_OTHER * main.area && c.cy >= main.y0 - 2 * t && c.cy <= main.y1 + 2 * t)).map((c) => c.id));
  }
  let bm = and(compMask(lc.lab, pick), solid);
  // what the strokes test left of a brow's own pixels (a wedge where it widens, a stretch the edit drew as the portrait
  // had it), taken back from the strokes found
  bm = or(bm, grow(bm, and(browish, search), w, h, Math.round(BROW_GROW * Math.max(...thick))));
  // the neutral closed lid covers the patch when the expression's eyes blink: brow-coloured pixels on the brow under it
  // go to the brow texture (drawn over the lid), or the brow loses its end and shows the lid's skin through a gap
  if (lids) bm = or(bm, grow(bm, and(browish, and(lids, search)), w, h, Math.round(UNDER_LID_GROW * Math.max(...thick))));
  if (eyes) for (const s of [0, 1]) intoEyes(bm, s, E, skin, browish, eyeEdge, thick[s], midX, w, h);
  if (!count(bm)) return { BT: null, bm, like, search };
  const BT = blank(w, h), fe = blur(Float32Array.from(bm), w, h, 1);
  for (let p = 0; p < N; p++) {
    const a = bm[p] ? 1 : Math.min(1, 1.5 * fe[p]);
    if (a > 0.02) setPx(BT, p, rgb(E, p), a);
  }
  // round them (under the brow texture's soft edge) the patch keeps its own colours where it has them: a brow can run
  // on into a line the edit kept (a lash), and the bare face there would show as a pale seam through the brow
  const u = dilate(bm, w, h, 1);
  for (let p = 0; p < N; p++) {
    if (!u[p]) continue;
    const a = Math.max(L.d[4 * p + 3], under.d[4 * p + 3]) / 255;
    for (const X of [L, T]) {
      const xa = X.d[4 * p + 3] / 255, own = bm[p] ? 0 : xa;
      setPx(X, p, rgb(X, p).map((v, k) => own * v + (1 - own) * under.d[4 * p + k]), Math.max(xa, a));
    }
  }
  return { BT, bm, like, search };
}

/**
 * One side's brow (s 0 left, 1 right; its pixels in `bm`, in place) completed where it runs into an eye the edit drew
 * (`eyeEdge`): a lowered brow pressed onto the lid lies partly in the eye region, which squashes away with a blink.
 * Each column of it that meets the eye goes on down to the brow's thickness (its columns clear of the eye, or `thick`,
 * the neutral brow's, when there are too few), as long as it is brow-coloured (`browish`, or the colour the edit drew
 * this brow in, from `E`, and not the `skin`'s); then it is carried on from its inner end (the one a lowered brow
 * presses onto the lid with) column by column along the line of its last columns, as thick, while that much of it is
 * there. Only a run that reaches an eye is taken: a brow that ends on the skin or the hair ends as found. A lash under
 * the brow lies past its thickness and stays with the eye.
 */
function intoEyes(bm, s, E, skin, browish, eyeEdge, thick, midX, w, h) {
  // the colour the edit drew this brow in (an angry brow can be drawn lighter or darker than the neutral one): what is
  // near it, and nearer it than the skin, is this brow too (a lash, the whites and the iris are further)
  const toneOf = (m) => [0, 1, 2].map((k) => {
    const v = [];
    for (let p = 0; p < w * h; p++) if (m[p]) v.push(E.d[4 * p + k]);
    return v.sort((a, b) => a - b)[v.length >> 1] ?? 0;
  });
  const tone = toneOf(sideOf(bm, s, midX, w, h));
  const isBrow = (p) => {
    if (browish[p]) return true;
    const c = rgb(E, p), d = dist3(c, tone);
    return d < SAME_BROW && d < dist3(c, skin);
  };
  // and the colour of the eye's dark lines (mostly the lash): a column of a brow drawn at a slant can be a pixel taller
  // than the brow's median thickness, and that pixel is the brow's when it is nearer the brow's colour than this
  const lineTone = toneOf(sideOf(minus(and(eyeEdge, browish), bm), s, midX, w, h));
  const slack = (p) => { const c = rgb(E, p); return dist3(c, tone) <= dist3(c, lineTone); };
  const columns = () => {
    const side = sideOf(bm, s, midX, w, h), b = bbox(side, w, h), cols = [];
    if (b) for (let x = b[0]; x <= b[2]; x++) {
      let n = 0, sy = 0, top = -1, bot = -1;
      for (let y = b[1]; y <= b[3]; y++) if (side[y * w + x]) { n++; sy += y; if (top < 0) top = y; bot = y; }
      if (n) cols.push({ x, top, bot, cy: sy / n, eye: [1, 2].some((d) => bot + d < h && eyeEdge[(bot + d) * w + x]) });
    }
    return cols;
  };
  const median = (v) => v.sort((p, q) => p - q)[v.length >> 1];
  let cols = columns();
  if (cols.length < 3) return;
  const free = cols.filter((c) => !c.eye).map((c) => c.bot - c.top + 1), T = free.length >= 3 ? median(free) : thick;
  for (const c of cols) if (c.eye) for (let y = c.bot + 1; y < h && y - c.top <= T && isBrow(y * w + c.x) && (y - c.top < T || slack(y * w + c.x)); y++) bm[y * w + c.x] = 1;
  cols = columns();
  const bw = cols[cols.length - 1].x - cols[0].x + 1, K = Math.max(3, Math.round(0.25 * bw)), most = Math.round(INTO_EYE_MAX * bw);
  const dir = s ? -1 : 1, last = (dir < 0 ? cols : [...cols].reverse()).slice(0, K);
  if (last.length < 3) return;
  // the line through the last columns' middles
  const mx = last.reduce((a, c) => a + c.x, 0) / last.length, my = last.reduce((a, c) => a + c.cy, 0) / last.length;
  const sxx = last.reduce((a, c) => a + (c.x - mx) ** 2, 0);
  const slope = sxx ? last.reduce((a, c) => a + (c.x - mx) * (c.cy - my), 0) / sxx : 0;
  let x = last[0].x + dir, cy = my + slope * (x - mx), into = false;
  const pending = [];
  for (let k = 0; k < most && x >= 0 && x < w; k++, x += dir) {
    const lo = Math.max(0, Math.round(cy - T / 2 - 1)), hi = Math.min(h - 1, Math.round(cy + T / 2 + 1));
    let n = 0, sy = 0;
    for (let y = lo; y <= hi; y++) {
      const p = y * w + x;
      if (eyeEdge[p]) into = true;
      if (isBrow(p)) { n++; sy += y; pending.push(p); }
    }
    if (n < INTO_EYE_FILL * T) break;
    if (into) for (const p of pending.splice(0)) bm[p] = 1;
    cy = sy / n + slope * dir;
  }
}

/** the check's note: how many brow pixels on each side, and how many of them on the hair */
export const browNoteOf = (bm, onHair, midX, w, h) =>
  `; brows L ${count(sideOf(bm, 0, midX, w, h))} / R ${count(sideOf(bm, 1, midX, w, h))} px, ${count(and(bm, onHair))} of them on the bangs`;

/**
 * debug: grey where the edit's brows are looked for, blue where they can be but the edit drew an eye, red its
 * brow-coloured strokes, green the ones taken (yellow: carried on into an eye)
 */
export function writeBrowDebug(file, { bm, like, search }, near, w, h) {
  const dm = blank(w, h);
  for (let p = 0; p < w * h; p++) {
    if (bm[p]) setPx(dm, p, search[p] ? [0, 200, 0] : [240, 200, 0], 1);
    else if (like[p]) setPx(dm, p, [230, 0, 0], 1);
    else if (search[p]) setPx(dm, p, [120, 120, 120], 1);
    else if (near[p]) setPx(dm, p, [70, 70, 200], 1);
  }
  writePng(file, dm);
}
