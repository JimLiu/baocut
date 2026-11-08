// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// The part map: an image edit of the portrait that paints every part in one flat key colour (references/art.md). It is
// registered to the portrait by the two silhouettes and read back as one label per pixel, so the layers follow the
// drawing's own boundaries whatever its shading.
import { blank, components, compMask, dilate } from './ops.mjs';
import { keyOut } from './seg.mjs';
import { align, warp } from './align.mjs';
import { nearestIndex } from './layers.mjs';

/**
 * the palette the part-map prompt asks for (references/art.md); bg, the backdrop, is read off the map itself (any green
 * the map is painted on), and this one only shows it in the debug labels
 */
export const PARTS = {
  bg: [0, 177, 64],
  front: [255, 0, 0], // bangs and the hair on top
  side: [255, 0, 255], // locks beside the face and in front of the shoulders
  back: [0, 0, 255], // the hair behind the head and the shoulders
  face: [255, 255, 0], // face skin and the nose
  ear: [255, 128, 192],
  neck: [255, 128, 0], // the neck and other bare skin below the chin
  brow: [128, 0, 255],
  white: [255, 255, 255],
  iris: [0, 255, 255], // iris, pupil and highlights
  lash: [0, 0, 0], // lashes and the eye lines
  mouth: [128, 0, 0],
  cloth: [128, 128, 128],
};
export const NAMES = Object.keys(PARTS);
export const ID = Object.fromEntries(NAMES.map((n, i) => [n, i]));
const COL = NAMES.map((n) => PARTS[n]);

const d2 = (r, g, b, c) => (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;

/**
 * Labels for every pixel of the portrait. im: the portrait; pm: the part map (same size); K: keyOut(im).
 * Returns { lab (Uint8Array of ID), A (the registration), far (pixels of the character, as the portrait keys it, that
 * no colour or pair of colours explains), map }.
 */
export function readLabels(im, pm, K, o = {}) {
  const { w, h } = im, N = w * h;
  const sil = (I, KK) => {
    const S = blank(w, h);
    for (let p = 0; p < N; p++) { const v = Math.round(255 * KK.alpha[p]); S.d.set([v, v, v, 255], 4 * p); }
    return S;
  };
  // the map's backdrop is measured on its border, like the portrait's: the prompt asks for the portrait's green, and a
  // map comes on a near one or on the prompt's own #00B140. Taken as #00B140, a map on a bright green had its whole
  // backdrop in no palette colour (and a portrait's green is not always near enough the map's to key it with)
  const KP = keyOut(pm);
  const A = align(sil(im, K), sil(pm, KP), { range: o.range ?? 40 });
  const M = warp(pm, A);
  // the model paints each part near its palette colour, not on it (a mouth asked as #800000 may come as #A01000):
  // move every palette colour to the mean of the map's pixels round it
  const ref = COL.map((c, k) => (k === ID.bg ? [...KP.key] : c)), col = ref.map((c) => [...c]);
  {
    const acc = ref.map(() => [0, 0, 0, 0]);
    for (let p = 0; p < N; p++) {
      const r = M.d[4 * p], g = M.d[4 * p + 1], b = M.d[4 * p + 2];
      let best = 0, bd = Infinity;
      for (let k = 0; k < ref.length; k++) { const d = d2(r, g, b, ref[k]); if (d < bd) { bd = d; best = k; } }
      if (bd < 70 * 70) { const A = acc[best]; A[0] += r; A[1] += g; A[2] += b; A[3]++; }
    }
    acc.forEach((A, k) => { if (A[3] > 50) col[k] = [A[0] / A[3], A[1] / A[3], A[2] / A[3]]; });
  }
  const lab = new Uint8Array(N), sure = new Uint8Array(N), err = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    const r = M.d[4 * p], g = M.d[4 * p + 1], b = M.d[4 * p + 2];
    let best = 0, bd = Infinity;
    for (let k = 0; k < col.length; k++) { const d = d2(r, g, b, col[k]); if (d < bd) { bd = d; best = k; } }
    lab[p] = best; err[p] = bd;
    if (bd <= 28 * 28) sure[p] = 1;
  }
  // an antialiased edge mixes two colours (red and yellow make the neck's orange): fit the pixel as a mix of two of the
  // parts that are really there round it, and take the stronger side. Only the character counts as far: the portrait's
  // backdrop is background whatever the map has there
  const fg = Uint8Array.from(K.alpha, (a) => (a > 0.5 ? 1 : 0));
  let far = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (sure[p]) continue;
    const near = new Set();
    for (let j = Math.max(0, y - 3); j <= Math.min(h - 1, y + 3); j++) for (let i = Math.max(0, x - 3); i <= Math.min(w - 1, x + 3); i++) if (sure[j * w + i]) near.add(lab[j * w + i]);
    if (!near.size) { if (fg[p] && err[p] > 40 * 40) far++; continue; }
    const r = M.d[4 * p], g = M.d[4 * p + 1], b = M.d[4 * p + 2], ks = [...near];
    let bd = Infinity, bk = lab[p];
    for (const k of ks) { const d = d2(r, g, b, col[k]); if (d < bd) { bd = d; bk = k; } }
    for (let u = 0; u < ks.length; u++) for (let v = u + 1; v < ks.length; v++) {
      const a = col[ks[u]], c = col[ks[v]], e = [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
      const ee = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
      if (ee < 1) continue;
      const t = Math.max(0, Math.min(1, ((r - c[0]) * e[0] + (g - c[1]) * e[1] + (b - c[2]) * e[2]) / ee));
      const d = d2(r, g, b, [c[0] + t * e[0], c[1] + t * e[1], c[2] + t * e[2]]);
      if (d < bd) { bd = d; bk = t >= 0.5 ? ks[u] : ks[v]; }
    }
    if (fg[p] && bd > 40 * 40) far++;
    lab[p] = bk;
  }
  // the portrait's own background decides what is background; character pixels the map left as background take the
  // nearest part
  for (let p = 0; p < N; p++) if (!fg[p]) lab[p] = ID.bg;
  const isPart = Uint8Array.from(lab, (v, p) => (v !== ID.bg ? 1 : 0));
  const ni = nearestIndex(isPart, w, h, 40);
  for (let p = 0; p < N; p++) if (fg[p] && lab[p] === ID.bg && ni[p] >= 0) lab[p] = lab[ni[p]];
  // specks (under 16 px) join the part round them
  despeckle(lab, w, h, 16);
  return { lab, A, far, map: M, palette: Object.fromEntries(NAMES.map((n, k) => [n, col[k].map(Math.round)])) };
}

/** components of one label smaller than `min` px take the commonest label on their border */
export function despeckle(lab, w, h, min) {
  for (let k = 0; k < NAMES.length; k++) {
    if (k === ID.bg) continue;
    const m = Uint8Array.from(lab, (v) => (v === k ? 1 : 0));
    const cc = components(m, w, h);
    const small = new Set(cc.comps.filter((c) => c.area < min).map((c) => c.id));
    if (!small.size) continue;
    const votes = new Map();
    for (let p = 0; p < w * h; p++) {
      const id = cc.lab[p];
      if (!small.has(id)) continue;
      const x = p % w;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || (q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        if (cc.lab[q] === id) continue;
        const v = votes.get(id) ?? new Map(); v.set(lab[q], (v.get(lab[q]) ?? 0) + 1); votes.set(id, v);
      }
    }
    for (let p = 0; p < w * h; p++) {
      const v = votes.get(cc.lab[p]);
      if (!v || !small.has(cc.lab[p])) continue;
      lab[p] = [...v.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  }
  return lab;
}

/** the mask of one or more labels */
export const part = (lab, ...names) => {
  const s = new Set(names.map((n) => ID[n]));
  return Uint8Array.from(lab, (v) => (s.has(v) ? 1 : 0));
};

/**
 * The face in the map (`face`, the yellow): its biggest blob, and the skin between the strands right over a brow
 * (`brow`), which the brow's band cuts off from it, yellow pieces that touch a brow and lie in the head (their middle
 * in the face's width, between a little over its top and its chin). Taken for strays, those went to the bangs: the
 * forehead there moved with the hair, and a brow between two of them counted as one on the bangs, filled under from
 * that skin, which showed through when an expression redrew the brow. Other yellow pieces are two map colours mixing
 * at an edge. Returns the mask, the biggest blob (components' record) and how many pixels of skin over the brows it
 * took back; null for a map with no yellow.
 */
export function faceZone(face, brow, w, h) {
  const cc = components(face, w, h), comps = [...cc.comps].sort((a, b) => b.area - a.area), big = comps[0];
  if (!big) return null;
  // 2 px: the map's own edge between the yellow and the purple can be a pixel of a third colour
  const nearBrow = dilate(brow, w, h, 2), touch = new Set();
  for (let p = 0; p < w * h; p++) if (cc.lab[p] && nearBrow[p]) touch.add(cc.lab[p]);
  const top = big.y0 - 0.15 * (big.y1 - big.y0);
  const pockets = comps.slice(1).filter((c) => touch.has(c.id) && c.cx >= big.x0 && c.cx <= big.x1 && c.cy >= top && c.cy <= big.y1);
  return { zone: compMask(cc.lab, [big.id, ...pockets.map((c) => c.id)]), big, overBrows: pockets.reduce((a, c) => a + c.area, 0) };
}
