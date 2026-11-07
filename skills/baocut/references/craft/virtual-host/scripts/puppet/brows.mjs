// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// The brows an expression edit redrew, for both builds (puppet-build.mjs and the part-map build). The players draw an
// expression's brow texture right after the brows layer, over the bangs, while the expression's patch is under them:
// so a brow the edit moved onto the hair still shows.
import { blank, dilate, and, or, count, blur, components, compMask } from './ops.mjs';
import { boxMask } from './segment.mjs';
import { setPx, rgb } from './layers.mjs';
import { writePng } from './png.mjs';

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** the left (s 0) or right (s 1) half of m */
export const sideOf = (m, s, midX, w, h) => and(m, boxMask(w, h, s ? midX : 0, 0, s ? w - 1 : midX - 1, h - 1));

/**
 * Where an edit's brows can be, over skin or hair: round the old brows (`full`, both sides) and down to the eyes (a sad
 * or angry brow can drop that far), never on an eye. `boxes` and `eyes` are [x0, y0, x1, y1] per side (a missing brow
 * is null).
 */
export function browNear({ full, boxes, eyes, midX, eyeH, w, h }) {
  const aboveEyes = or(boxMask(w, h, 0, 0, midX - 1, eyes[0][1] - 2), boxMask(w, h, midX, 0, w - 1, eyes[1][1] - 2));
  let near = dilate(full, w, h, Math.max(4, Math.round(0.3 * eyeH)));
  for (const s of [0, 1]) {
    const b = boxes[s];
    if (b) near = or(near, boxMask(w, h, b[0] - 0.25 * (b[2] - b[0]), b[1], b[2] + 0.25 * (b[2] - b[0]), eyes[s][1]));
  }
  return and(near, aboveEyes);
}

/**
 * The brows an edit `E` redrew: on each side the widest brow-coloured strokes near the old brows, changed from the
 * portrait `im` or on the old brow. Returns `BT` (their colours, a 1 px soft edge; null when none were found: a brow the
 * colour of the hair, and the brows stay in the patch) and `bm` (their pixels). The players mesh a layer only where
 * its own texture is opaque, so the patch `L` and its talking copy `T` become `under` (the bare face) beneath them,
 * also where the edit left a brow as it was: the neutral brows fade out under a redrawn one.
 */
export function redrawnBrows({ E, im, near, full, browCol, hairCol, skin, midX, L, T, under, w, h }) {
  const N = w * h, like = new Uint8Array(N), hairApart = !!hairCol && dist3(browCol, hairCol) >= 40;
  for (let p = 0; p < N; p++) {
    if (!near[p]) continue;
    const c = rgb(E, p), dB = dist3(c, browCol);
    if (dB >= dist3(c, skin) || (hairApart && dB >= dist3(c, hairCol))) continue;
    let m = 0;
    for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(E.d[4 * p + k] - im.d[4 * p + k]));
    if (full[p] || m > 30) like[p] = 1;
  }
  const lc = components(dilate(like, w, h, 1), w, h), pick = [];
  for (const s of [0, 1]) {
    const mine = lc.comps.filter((c) => (c.cx >= midX) === (s === 1) && c.x1 - c.x0 >= 0.8 * (c.y1 - c.y0));
    const top = mine.filter((c) => c.x1 - c.x0 > c.y1 - c.y0).reduce((a, c) => Math.max(a, c.area), 0);
    if (top) pick.push(...mine.filter((c) => c.area >= 0.5 * top).map((c) => c.id));
  }
  const bm = and(compMask(lc.lab, pick), like);
  if (!count(bm)) return { BT: null, bm, like };
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
  return { BT, bm, like };
}

/** the check's note: how many brow pixels on each side, and how many of them on the hair */
export const browNoteOf = (bm, onHair, midX, w, h) =>
  `; brows L ${count(sideOf(bm, 0, midX, w, h))} / R ${count(sideOf(bm, 1, midX, w, h))} px, ${count(and(bm, onHair))} of them on the bangs`;

/** debug: grey where the edit's brows can be, red its brow-coloured strokes, green the ones taken */
export function writeBrowDebug(file, { bm, like }, near, w, h) {
  const dm = blank(w, h);
  for (let p = 0; p < w * h; p++) {
    if (bm[p]) setPx(dm, p, [0, 200, 0], 1);
    else if (like[p]) setPx(dm, p, [230, 0, 0], 1);
    else if (near[p]) setPx(dm, p, [120, 120, 120], 1);
  }
  writePng(file, dm);
}
