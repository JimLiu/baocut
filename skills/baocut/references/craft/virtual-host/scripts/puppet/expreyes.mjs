// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// The eyes an expression edit drew, for both builds (puppet-build.mjs and the part-map build): cut out of the
// expression's patch into layers of their own (roles expr_eye_L and expr_eye_R, a BaoCut extension). The BaoCut player
// squashes them in a blink like the neutral eyes, over that side's closed lid, so a character that smiles or frowns
// still blinks; the patch was opaque over the eyes, and every expression of a talking host hid every blink. Under them
// the patch and its talking copy are the bare face. The LivLiv package keeps the patch whole: LivLiv draws a role it
// does not know as a plain layer, always on.
import { blank, clone, dilate, and, or, minus, count, bbox, blur } from './ops.mjs';
import { fillHoles, setPx, rgb } from './layers.mjs';

/** a white of an eye: light and grey */
const whiteish = (c) => Math.min(...c) > 190 && Math.max(...c) - Math.min(...c) < 45;

/**
 * Cut the edit's eyes out of the patch `L` (and its talking copy `T`), in place. `eyes` per side (image left first):
 * { zone, hit, pivot }: where the neutral eye is (its box grown a little, inside the patch's area), whether the edit
 * changed that eye, and the neutral eye's pivot (the lid line). `changed`: the strokes the edit changed; `keep`: pixels
 * that stay in the patch (the brows it redrew), or null. `E` the edit as cut, `im` the portrait, `under` the bare face.
 * Returns `whole` (the patch and its talking copy as they were, for the LivLiv package), `eyes` ([{ side, L, pivot }]
 * for the sides cut) and `note` (for the check line).
 */
export function cutExpressionEyes({ E, im, L, T, under, eyes, changed, keep, w, h }) {
  const N = w * h, whole = { L: clone(L), talk: clone(T) }, out = [];
  const shut = [];
  for (const [s, side] of [[0, 'L'], [1, 'R']]) {
    const e = eyes[s];
    if (!e?.hit) continue;
    const b = bbox(e.zone, w, h);
    if (!b) continue;
    // the eye as the edit drew it: the neutral eye's place and every changed stroke reaching round it (a wide-open eye
    // is taller, a narrowed one lower), inside the patch
    const near = dilate(e.zone, w, h, Math.max(4, Math.round(0.35 * (b[3] - b[1] + 1))));
    let R = fillHoles(dilate(or(e.zone, and(changed, near)), w, h, 2), w, h);
    R = Uint8Array.from(R, (v, p) => (v && L.d[4 * p + 3] > 0 ? 1 : 0));
    if (keep) R = minus(R, keep);
    // an eye the edit drew shut (^ ^) has no whites: it has nothing to blink and stays in the patch
    let wE = 0, wN = 0;
    for (let p = 0; p < N; p++) {
      if (R[p] && whiteish(rgb(E, p))) wE++;
      if (e.zone[p] && whiteish(rgb(im, p))) wN++;
    }
    if (wN >= 30 && wE < 0.2 * wN) { shut.push(side); continue; }
    const f = blur(Float32Array.from(R), w, h, 1);
    const X = blank(w, h);
    for (let p = 0; p < N; p++) {
      const a = Math.min(1, 1.25 * f[p]) * (L.d[4 * p + 3] / 255);
      if (!(a > 0.01)) continue;
      setPx(X, p, rgb(L, p), a);
      for (const P of [L, T]) setPx(P, p, rgb(under, p), P.d[4 * p + 3] / 255);
    }
    if (count(R)) out.push({ side, L: X, pivot: e.pivot });
  }
  const cut = out.map((o) => o.side).join(' ');
  const note = `${cut ? `; eyes ${cut} blink` : ''}${shut.length ? `; eyes ${shut.join(' ')} drawn shut, kept in the patch` : ''}`;
  return { whole, eyes: out, note };
}

/** the layers for the cut eyes, after the expression's patch */
export const expressionEyeLayers = (id, eyes) =>
  eyes.map((e) => ({ id: `expr_${id}_eye_${e.side}`, L: e.L, def: { group: 'head', depth: 0, role: `expr_eye_${e.side}`, expression: id, pivot: e.pivot }, hidden: true }));
