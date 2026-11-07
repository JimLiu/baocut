#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// Build a layered character package (.bcpuppet) from one flat front-facing cartoon portrait on a solid key colour, a
// bald repaint of it (the scalp under the hair) and whole-image edits of the mouth shapes, the closed eyes and the
// expressions. Plain Node >= 22 and nothing else (ffmpeg only for inputs that are not 8-bit PNG).
//
//   node puppet-build.mjs <character.json> [--debug]
//
// character.json (paths relative to it; see examples/character.example.json):
//   name, portrait, bald, mouths: { half, open, round?, wide? }, lids?, expressions?: { <id>: edit },
//   out? (default "puppet"), profile?, skin?: [r, g, b], line?: [r, g, b] (the outline colour; measured when unset),
//   hair?: [r, g, b] | null (null: the line colour), glasses?
//
// Writes into <out>/: <name>.bcpuppet (import this), package/ (the same files unzipped), rest.png (all layers at rest),
// rest-diff.png (where rest differs from the portrait, brighter = more) and report.json. Every check prints one line,
// "ok" or "FIX"; the exit code is 1 when any line says FIX.
import fs from 'node:fs';
import path from 'node:path';
import { readImage, writePng, writeGray } from './puppet/png.mjs';
import { blank, clone, dilate, erode, distTo, not, and, or, minus, count, bbox, medianColor, over, blur, components, compMask } from './puppet/ops.mjs';
import { keyOut, luma, unmix } from './puppet/seg.mjs';
import { ellipseBand, ellipseCover } from './puppet/parts.mjs';
import { buildEye } from './puppet/eyes.mjs';
import { segment, boxMask } from './puppet/segment.mjs';
import { fillHoles, softEdge, fromMask, setPx, rgb, alphaBox, unionBox, cut, bleed, nearestIndex } from './puppet/layers.mjs';
import { registered, strokes } from './puppet/edits.mjs';
import { zip } from './puppet/zip.mjs';

const args = process.argv.slice(2);
const cfgArg = args.find((a) => !a.startsWith('--'));
if (!cfgArg) {
  console.error('usage: node puppet-build.mjs <character.json> [--debug]');
  process.exit(2);
}
const cfgPath = path.resolve(cfgArg);
const DEBUG = args.includes('--debug');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const P = (f) => path.resolve(path.dirname(cfgPath), f);
const log = (...a) => { if (DEBUG) console.log(...a.map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v))); };
const OUT = P(cfg.out ?? 'puppet'), PKG = path.join(OUT, 'package'), DBG = path.join(OUT, 'work');
const NAME = cfg.name ?? path.basename(OUT);
fs.rmSync(PKG, { recursive: true, force: true });
fs.mkdirSync(path.join(PKG, 'textures'), { recursive: true });
if (DEBUG) fs.mkdirSync(DBG, { recursive: true });
// an edit registered to the portrait leaves this much mean difference (0-255 grey) round the part it was asked to change
const RESIDUAL_MAX = 6;
// one line per check: ok, or FIX with what to redo
const checks = [];
const check = (ok, item, note = '') => { checks.push({ ok, item, note }); console.log(`${ok ? 'ok ' : 'FIX'}  ${item}${note ? `: ${note}` : ''}`); };
const need = (f, what) => { if (!f) { console.error(`FIX  config: "${what}" is required`); process.exit(1); } return readImage(P(f)); };
const sameSize = (e, f) => {
  if (e.w !== w || e.h !== h) { console.error(`FIX  ${f}: ${e.w}x${e.h}, the portrait is ${w}x${h}; ask for the same size`); process.exit(1); }
  return e;
};
const round1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- segmentation
const im = need(cfg.portrait, 'portrait');
const { w, h } = im, N = w * h;
let G;
try {
  G = segment(im, { log, skin: cfg.skin, line: cfg.line, hair: cfg.hair, glasses: cfg.glasses });
} catch (e) {
  console.error(`FIX  portrait: ${e.message}`);
  process.exit(1);
}
check(true, 'portrait', `${w}x${h}, key ${G.K.key}, skin ${G.skin}, line ${G.line}, hair ${G.hairRGB ?? 'line colour'}, ${G.rims ? 'glasses' : 'no glasses'}`);
const { K, C, skin } = G;
const Lline = luma(...G.line);
const neckSkinCol = medianColor(im, erode(G.neckSkin, w, h, 2));
log('neck skin', neckSkinCol);

// an edit must keep everything but the asked-for part where it was: what is left after registering shows how well
function alignCheck(what, A) {
  const okA = A.residual <= RESIDUAL_MAX;
  check(okA, `${what} lines up`, `residual ${A.residual}, shift ${A.dx},${A.dy}, scale ${A.s}${okA ? '' : '; the edit redrew more than it was asked to: redo it from the portrait'}`);
}

// the bald repaint: pixel-aligned with the portrait outside the hair; its keyed alpha is the head's extent
const bald = sameSize(need(cfg.bald, 'bald'), cfg.bald);
const BK = keyOut(bald, { key: K.key });
const changed = new Uint8Array(N);
for (let p = 0; p < N; p++) for (let k = 0; k < 3; k++) if (Math.abs(bald.d[4 * p + k] - im.d[4 * p + k]) > 10) { changed[p] = 1; break; }
const zone = dilate(and(dilate(G.hair, w, h, 20), changed), w, h, 2);
log('bald repaint changed', count(changed), 'zone', count(zone));
{
  // the repaint may only change the hair and round it
  const outside = count(minus(changed, dilate(G.hair, w, h, 40))), share = outside / count(G.char);
  check(share < 0.01 && count(zone) > 0, 'bald repaint', count(zone) ? `${(100 * share).toFixed(2)}% of the character changed away from the hair${share >= 0.01 ? '; the repaint must keep everything but the hair pixel-identical (repaint with the hair mask only)' : ''}` : 'nothing changed under the hair');
}

// what the face layer holds: the head (from the portrait's segmentation) plus the bald scalp in the repainted zone
const baldHead = and(zone, Uint8Array.from(BK.alpha, (a) => (a > 0.02 ? 1 : 0)));
let faceM = or(minus(G.head, minus(zone, baldHead)), baldHead);
faceM = and(fillHoles(faceM, w, h), or(G.char, baldHead));
// below the jaw the repaint shows the neck and the collar behind hanging hair: they stay the body's, or a turn drags
// their lines along with the head. The jaw, per column: the lowest row of the face in the portrait or of its skin in
// the repaint (the hair may hide a cheek in the portrait), plus the outline
{
  const bs = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (BK.alpha[p] > 0.9 && Math.hypot(bald.d[4 * p] - skin[0], bald.d[4 * p + 1] - skin[1], bald.d[4 * p + 2] - skin[2]) < 30) bs[p] = 1;
  const cc = components(bs, w, h), hits = new Map();
  for (let p = 0; p < N; p++) if (G.headSkin[p] && cc.lab[p]) hits.set(cc.lab[p], (hits.get(cc.lab[p]) ?? 0) + 1);
  const faceId = [...hits].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const jaw = new Int32Array(w).fill(-1);
  for (let p = 0; p < N; p++) if (G.head[p] || (faceId && cc.lab[p] === faceId)) { const x = p % w, y = (p - x) / w; if (y > jaw[x]) jaw[x] = y; }
  let cut = 0;
  for (let p = 0; p < N; p++) {
    if (!faceM[p] || G.head[p]) continue;
    const x = p % w, y = (p - x) / w;
    if (y > (jaw[x] >= 0 ? jaw[x] + G.lw + 2 : G.chin)) { faceM[p] = 0; cut++; }
  }
  log('repaint below the jaw left to the body', cut);
}
const baldSkin = medianColor(bald, Uint8Array.from({ length: N }, (_, p) => (zone[p] && BK.alpha[p] > 0.98 && Math.hypot(bald.d[4 * p] - skin[0], bald.d[4 * p + 1] - skin[1], bald.d[4 * p + 2] - skin[2]) < 25 ? 1 : 0)));
log('bald skin', baldSkin, 'portrait skin', skin);
// strand tips the hair mask missed: thin dark bits next to the hair that the bald repaint turned into skin
{
  const near = dilate(G.hair, w, h, 2);
  const feat = dilate(or(or(G.glass, G.brows), or(G.mouth, or(...G.eyes.map((e) => boxMask(w, h, ...e.box))))), w, h, 4);
  const cand = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    if (!zone[p] || G.hair[p] || feat[p]) continue;
    const lo = luma(im.d[4 * p], im.d[4 * p + 1], im.d[4 * p + 2]), lb = luma(bald.d[4 * p], bald.d[4 * p + 1], bald.d[4 * p + 2]);
    if (!(lo < 195 && lb - lo > 20)) continue;
    // the repaint left plain skin there, and the portrait's pixel is a mix of a dark line and that skin (not an ear's shading)
    const B = [bald.d[4 * p], bald.d[4 * p + 1], bald.d[4 * p + 2]], O = [im.d[4 * p], im.d[4 * p + 1], im.d[4 * p + 2]];
    if (Math.hypot(B[0] - baldSkin[0], B[1] - baldSkin[1], B[2] - baldSkin[2]) > 30) continue;
    const t = Math.max(0, Math.min(1, (lo - Lline) / (luma(...skin) - Lline)));
    if (Math.hypot(...[0, 1, 2].map((k) => O[k] - (t * skin[k] + (1 - t) * G.line[k]))) > 22) continue;
    cand[p] = 1;
  }
  const cc = components(cand, w, h), keep = [];
  for (const c of cc.comps) {
    let touch = false;
    for (let y = c.y0; y <= c.y1 && !touch; y++) for (let x = c.x0; x <= c.x1; x++) if (cc.lab[y * w + x] === c.id && near[y * w + x]) { touch = true; break; }
    if (touch) keep.push(c.id);
  }
  const tips = compMask(cc.lab, keep);
  G.hair = or(G.hair, tips);
  log('hair tips added', count(tips), 'px in', keep.length, 'pieces');
}
// the body: the big pieces below the head; specks left between strands go to the hair (or the face)
{
  const cand = minus(minus(minus(G.char, faceM), G.hair), G.neckShadow);
  const cc = components(cand, w, h), nearHair = dilate(G.hair, w, h, 3), toHair = [], toFace = [];
  for (const c of cc.comps) {
    if (c.cy > G.chinSkin || (c.area >= 0.002 * N && c.cy > G.chinSkin - 0.1 * h)) continue;
    let hairish = false;
    for (let y = c.y0; y <= c.y1 && !hairish; y++) for (let x = c.x0; x <= c.x1; x++) if (cc.lab[y * w + x] === c.id && nearHair[y * w + x]) { hairish = true; break; }
    (hairish ? toHair : toFace).push(c.id);
  }
  G.hair = or(G.hair, compMask(cc.lab, toHair));
  faceM = or(faceM, compMask(cc.lab, toFace));
  log('specks to hair', toHair.length, 'to face', toFace.length);
}

// the face's colours: the portrait wherever it shows at rest, the repaint under the hair. The repaint's skin is a
// shade off the portrait's: its skin-to-line mixes are moved onto the portrait's skin so a moving fringe leaves no seam
// the silhouette's strand tips: portrait pixels next to the hair that the repaint made background belong to the hair
for (let pass = 0; pass < 3; pass++) {
  const near = dilate(G.hair, w, h, 3), lost = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (near[p] && !G.hair[p] && K.alpha[p] > 0.02 && BK.alpha[p] < K.alpha[p] - 0.3) lost[p] = 1;
  if (!count(lost)) break;
  G.hair = or(G.hair, lost);
  log('silhouette tips to hair', count(lost));
}
const underHair = dilate(G.hair, w, h, 3);
const faceSrc = clone(im), faceKey = { alpha: Float32Array.from(K.alpha), fg: clone(K.fg) };
{
  const Ls = luma(...baldSkin), Lk = Lline, shift = [0, 1, 2].map((k) => skin[k] - baldSkin[k]);
  const fix = (img, q) => {
    const t = Math.max(0, Math.min(1, (luma(img.d[q], img.d[q + 1], img.d[q + 2]) - Lk) / (Ls - Lk)));
    for (let k = 0; k < 3; k++) img.d[q + k] = Math.max(0, Math.min(255, Math.round(img.d[q + k] + t * shift[k])));
  };
  // just outside the hair (its antialiased ring) the colour behind it is the portrait's next to the ring, carried in
  // where the pixel has hair mixed in;
  // the repaint is used under the hair itself (it may draw lines of its own round the hair's edge)
  const nOut = nearestIndex(not(underHair), w, h, 6);
  for (let p = 0; p < N; p++) if (underHair[p]) {
    if (!G.hair[p] && nOut[p] >= 0) {
      const q = nOut[p];
      // a clean pixel (no hair mixed in) stays as it is
      if (unmix(rgb(im, p), G.line, rgb(im, q)) < 0.12) continue;
      for (let k = 0; k < 3; k++) { faceSrc.d[4 * p + k] = im.d[4 * q + k]; faceKey.fg.d[4 * p + k] = K.fg.d[4 * q + k]; }
      faceKey.alpha[p] = K.alpha[q];
      continue;
    }
    for (let k = 0; k < 4; k++) { faceSrc.d[4 * p + k] = bald.d[4 * p + k]; faceKey.fg.d[4 * p + k] = BK.fg.d[4 * p + k]; }
    faceKey.alpha[p] = BK.alpha[p];
    fix(faceSrc, 4 * p); fix(faceKey.fg, 4 * p);
  }
}

// feature cores (cut to their own layers, blanked to skin in the face)
const eyes = [0, 1].map((i) => {
  const excl = or(or(G.glass, G.brows), G.hair);
  return buildEye(K.fg, C, w, h, G.eyes[i], G.iris[i], excl, skin);
});
const eyeRegion = or(eyes[0].region, eyes[1].region);

// ---------------------------------------------------------------- layers, bottom first
const layers = []; // { id, L (full canvas), def, frames?, mask?, extra }
const rest = blank(w, h); // what's drawn at rest, kept up to date as layers are added
const add = (id, L, def, o = {}) => { layers.push({ id, L, def, ...o }); if (!o.hidden) over(rest, o.restIm ?? L); };

// back hair: the hair's silhouette in one flat colour, a little inside the front hair's edge, and down behind the
// head to the ears so a turn never shows a hole behind the scalp
const hairCol = medianColor(im, and(erode(G.hair, w, h, 3), G.hairMask));
{
  // (no closing: the gaps between the outer spikes are background and must stay clear at rest)
  const sil = erode(fillHoles(G.hair, w, h), w, h, 3);
  const earTop = bbox(G.headShade, w, h)?.[1] ?? G.eyeBot;
  const behind = and(erode(faceM, w, h, 4), boxMask(w, h, 0, 0, w, earTop));
  const m = or(sil, and(behind, dilate(sil, w, h, 40)));
  const soft = blur(Float32Array.from(m), w, h, 1);
  const L = blank(w, h);
  for (let p = 0; p < N; p++) if (soft[p] > 0.01) setPx(L, p, hairCol, Math.min(1, soft[p] * 1.2));
  add('back_hair', L, { group: 'hair_back', depth: -0.35 });
}

// body: everything below the head, the jaw's shadow painted out with neck skin, and the neck carried up under the
// face to the mouth line (its outlines continued straight up) so a nod or turn never opens a hole under the chin; the
// jaw line's antialiased rim just below the face goes too (a nod showed it as a faint second chin)
const mouthY = Math.round(G.mouthComp ? (G.mouthComp.y0 + G.mouthComp.y1) / 2 : G.chin - 0.25 * (G.chin - G.eyeBot));
{
  const bodyM = minus(minus(minus(G.char, faceM), G.hair), G.neckShadow);
  const L = fromMask(K.fg, K.alpha, bodyM, w, h);
  const shadowOut = minus(dilate(G.neckShadow, w, h, 2), C.dark);
  for (let p = 0; p < N; p++) if (shadowOut[p] && !faceM[p]) setPx(L, p, neckSkinCol, 1);
  const nk = G.neck;
  if (nk) {
    const lineCol = G.line, lw = nk.lw;
    const y1 = Math.min(h - 1, G.chin + G.lw + 4);
    const under = dilate(faceM, w, h, 2);
    for (let y = Math.max(0, mouthY - 4); y <= y1; y++) {
      const xl = nk.left(Math.max(y, nk.top)), xr = nk.right(Math.max(y, nk.top));
      for (let x = Math.floor(xl - lw); x <= Math.ceil(xr + lw); x++) {
        const p = y * w + x;
        if (!under[p]) continue;
        const d = Math.min(Math.abs(x - xl), Math.abs(x - xr));
        const la = Math.max(0, Math.min(1, lw / 2 + 0.5 - d));
        const inside = x > xl && x < xr;
        if (inside) setPx(L, p, [0, 1, 2].map((k) => la * lineCol[k] + (1 - la) * neckSkinCol[k]), 1);
        else if (la > 0) setPx(L, p, lineCol, la);
      }
    }
  }
  add('body', L, { group: 'body', depth: 0 });
}

// the jaw's shadow on the neck: its own layer (it moves with the jaw), carried up under the jaw line
{
  const nsCol = medianColor(im, erode(G.neckShadow, w, h, 2));
  const nk = G.neck;
  const cols = nk ? (x, y) => x > nk.left(Math.max(y, nk.top)) + 2 && x < nk.right(Math.max(y, nk.top)) - 2 : () => true;
  const up = new Uint8Array(N);
  const d = distTo(G.neckShadow, w, h);
  for (let p = 0; p < N; p++) if (faceM[p] && d[p] <= G.lw + 4 && cols(p % w, (p / w) | 0)) up[p] = 1;
  const core = or(G.neckShadow, up);
  const L = fromMask(im, null, G.neckShadow, w, h);
  for (let p = 0; p < N; p++) if (up[p]) setPx(L, p, nsCol, 1);
  softEdge(L, core, im, rest, K, w, h, { allow: not(faceM) });
  add('neck_shadow', L, { group: 'head', depth: 0, role: 'neck_shadow' });
}

// face: the bald repaint's head with the eyes, brows, glasses and mouth painted out in skin
const featCore = or(or(eyeRegion, G.brows), or(G.glass, G.mouth));
let rimBlank = new Uint8Array(N);
if (G.rims) {
  // the repaint may redraw a rim's top under the hair: anything dark near the rims goes too
  const band = or(ellipseBand(G.rims[0], w, h, G.rimW / 2 + 4), ellipseBand(G.rims[1], w, h, G.rimW / 2 + 4));
  const baldDark = Uint8Array.from({ length: N }, (_, p) => (luma(bald.d[4 * p], bald.d[4 * p + 1], bald.d[4 * p + 2]) < 160 ? 1 : 0));
  rimBlank = and(and(band, zone), baldDark);
}
{
  const L = fromMask(faceKey.fg, faceKey.alpha, faceM, w, h);
  // the face's own lines next to a feature stay (the outline where a rim or the hair touches it)
  const edge = minus(faceM, erode(faceM, w, h, G.lw + 3));
  const blankM = and(and(or(dilate(featCore, w, h, 3), dilate(rimBlank, w, h, 2)), faceM), not(edge));
  for (let p = 0; p < N; p++) if (blankM[p]) setPx(L, p, skin, 1);
  softEdge(L, faceM, faceSrc, rest, faceKey, w, h, { allow: not(G.hair) });
  add('face', L, { group: 'head', depth: 0 });
  if (DEBUG) writeGray(path.join(DBG, 'blank.png'), w, h, blankM.map((v) => v * 255));
}

// eyes (L first): the closed lid (from the closed-eyes edit), the open eye with its iris removed and the whites
// completed (+ the whites' mask), the full iris clipped by its eye
const eyeLayers = [];
let lidEdit = null;
if (cfg.lids) {
  const e = sameSize(readImage(P(cfg.lids)), cfg.lids);
  const fc = G.faceComp;
  const skip = [...G.eyes.map((x) => [x.box[0] - 25, x.box[1] - 25, x.box[2] + 25, x.box[3] + 25]),
    ...G.browComps.filter(Boolean).map((c) => [c.x0 - 15, c.y0 - 15, c.x1 + 15, c.y1 + 15])];
  lidEdit = registered(im, e, [fc.x0 - 20, G.eyeTop - 120, fc.x1 + 20, G.chin + 20], skip);
  log('lids edit aligned', lidEdit.A);
  alignCheck('lids', lidEdit.A);
  if (DEBUG) writePng(path.join(DBG, 'lids-warped.png'), lidEdit.im);
}
for (const [i, side] of [[0, 'L'], [1, 'R']]) {
  const E = eyes[i], eb = G.eyes[i].box;
  // lid: the strokes the closed-eyes edit drew in this eye's place (inside the rim, under the brow)
  if (lidEdit) {
    let lz = dilate(boxMask(w, h, eb[0], eb[1], eb[2], eb[3]), w, h, 16);
    if (G.rims) {
      const r = G.rims[i], sh = { cx: r.cx, cy: r.cy, rx: r.rx - G.rimW / 2 - 4, ry: r.ry - G.rimW / 2 - 4 };
      const inside = new Uint8Array(N);
      for (let y = Math.floor(sh.cy - sh.ry); y <= sh.cy + sh.ry; y++) for (let x = Math.floor(sh.cx - sh.rx); x <= sh.cx + sh.rx; x++) if (ellipseCover(sh, x + 0.5, y + 0.5) >= 1) inside[y * w + x] = 1;
      lz = and(lz, inside);
    }
    lz = minus(lz, dilate(G.brows, w, h, 6));
    const S = strokes(lidEdit.im, lz, w, h, { skin, minArea: 40 });
    log(`lid ${side}`, S.comps.map((c) => [c.x0, c.y0, c.x1, c.y1, c.area]), 'skin', S.skin);
    check(S.comps.length > 0, `closed eye ${side}`, S.comps.length ? `${count(S.core)} px` : 'the lids edit drew nothing in this eye; redo it with both eyes closed');
    eyeLayers.push({ id: `eye_${side}_closed`, L: S.L, def: { group: 'head', depth: 0, role: `lid_${side}` }, hidden: true });
  }
  const eyeL = blank(w, h), [bx, by, bw, bh] = E.box;
  over(eyeL, E.tex, bx, by);
  const maskFull = blank(w, h);
  for (let j = 0; j < bh; j++) for (let k = 0; k < bw; k++) { const v = E.mask[j * bw + k], p = (by + j) * w + bx + k; maskFull.d.set([v, v, v, 255], 4 * p); }
  const irisL = blank(w, h); over(irisL, E.irisTex, E.irisBox[0], E.irisBox[1]);
  // the iris at rest, clipped by the whites
  const irisRest = clone(irisL);
  for (let p = 0; p < N; p++) irisRest.d[4 * p + 3] = Math.round((irisRest.d[4 * p + 3] * maskFull.d[4 * p]) / 255);
  const ab = G.eyes[i].box;
  const ew = E.width, eh = E.height;
  eyeLayers.push({ id: `eye_${side}`, L: eyeL, def: { group: 'head', depth: 0, role: `eye_${side}`, pivot: E.pivot }, maskFull, box: E.box });
  eyeLayers.push({ id: `iris_${side}`, L: irisL, restIm: irisRest, def: { group: 'head', depth: 0, role: `iris_${side}`, pivot: E.pivot, clip: `eye_${side}`, range: [round1(0.18 * (ab[2] - ab[0] + 1)), round1(0.12 * (ab[3] - ab[1] + 1))] }, box: E.irisBox });
  log(`eye ${side}`, { box: E.box, iris: E.irisBox, pivot: E.pivot, irisCol: E.irisCol, lashCol: E.lashCol, w: ew, h: eh });
}
if (!cfg.lids) check(false, 'lids', 'no closed-eyes edit: blinks only squash the open eye; add "lids"');
for (const e of eyeLayers) add(e.id, e.L, e.def, e);

// mouth: the portrait's line (closed) and the shapes cut from the mouth edits, all in one box, skin made clear
{
  const fc = G.faceComp, mc = G.mouthComp;
  const faceIn = erode(fillHoles(or(G.headSkin, G.headShade), w, h), w, h, 2);
  // the nose's shade stays out of the zone; shading on or under the lips is part of the mouth the edits redraw (cut
  // out, it left a hole of skin in every open mouth)
  const shade = components(G.headShade, w, h);
  const nose = dilate(compMask(shade.lab, shade.comps.filter((c) => c.y1 < mc.y0).map((c) => c.id)), w, h, 6);
  const mw = mc.x1 - mc.x0;
  const mz = minus(and(boxMask(w, h, mc.x0 - 0.35 * mw, mc.y0 - 0.3 * mw, mc.x1 + 0.35 * mw, G.chin - G.lw - 8), and(faceIn, not(minus(featCore, G.mouth)))), nose);
  const mzAll = or(mz, dilate(G.mouth, w, h, 3));
  const closed = fromMask(im, null, G.mouth, w, h);
  softEdge(closed, G.mouth, im, rest, K, w, h, { allow: mzAll });
  const frames = { closed };
  const mouthSize = {};
  const skipBox = [mc.x0 - 0.4 * mw, mc.y0 - 0.3 * mw, mc.x1 + 0.4 * mw, G.chin - G.lw];
  for (const v of ['half', 'open', 'round', 'wide']) {
    const f = cfg.mouths?.[v];
    if (!f) continue;
    const R = registered(im, sameSize(readImage(P(f)), f), [fc.x0 - 20, G.eyeTop - 60, fc.x1 + 20, G.chin + 30], [skipBox]);
    const S = strokes(R.im, mz, w, h, { skin, minArea: 25, keep: (c) => c.cy > mc.y0 - 0.25 * mw });
    log(`mouth ${v}`, f, R.A, S.comps.map((c) => [c.x0, c.y0, c.x1, c.y1, c.area]));
    alignCheck(`mouth ${v}`, R.A);
    const b = bbox(S.core, w, h);
    mouthSize[v] = b ? { w: b[2] - b[0] + 1, h: b[3] - b[1] + 1 } : null;
    check(!!b, `mouth ${v}`, b ? `${mouthSize[v].w}x${mouthSize[v].h} px` : 'the edit drew no mouth inside the mouth area; redo it');
    frames[v] = S.L;
    if (DEBUG) writePng(path.join(DBG, `mouth-${v}-warped.png`), R.im);
  }
  for (const v of ['half', 'open']) if (!cfg.mouths?.[v]) check(false, `mouth ${v}`, `missing; "mouths.${v}" is required for talking`);
  if (mouthSize.half && mouthSize.open) check(mouthSize.half.h < mouthSize.open.h, 'mouth ladder', `half ${mouthSize.half.h} px tall, open ${mouthSize.open.h} px${mouthSize.half.h < mouthSize.open.h ? '' : '; open must be taller than half'}`);
  const visemes = Object.keys(frames);
  add('mouth', frames.closed, { group: 'head', depth: 0, role: 'mouth', pivot: [round1((mc.x0 + mc.x1) / 2), round1((mc.y0 + mc.y1) / 2)] }, { frames: visemes.map((v) => frames[v]), visemes });
}

// expressions: what each edit changed in the lower face, cut as a patch over the mouth; while talking the patch is
// drawn without its mouth (the "talk" texture) and the talking mouth goes over it
const expressions = [];
for (const [id, f] of Object.entries(cfg.expressions ?? {})) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) { check(false, `expression ${id}`, 'ids are 1-64 letters, digits, _ or -'); continue; }
  const fc = G.faceComp, mc = G.mouthComp, mw = mc.x1 - mc.x0;
  const zoneTop = G.eyeBot + 0.25 * (G.eyeBot - G.eyeTop);
  const R = registered(im, sameSize(readImage(P(f)), f), [fc.x0 - 20, G.eyeTop - 60, fc.x1 + 20, G.chin + 30], [[fc.x0, zoneTop, fc.x1, G.chin]]);
  alignCheck(`expression ${id}`, R.A);
  const faceIn = erode(fillHoles(or(G.headSkin, G.headShade), w, h), w, h, 2);
  const zone = and(faceIn, boxMask(w, h, fc.x0, zoneTop, fc.x1, G.chin - G.lw));
  const changed = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (zone[p] && Math.max(...[0, 1, 2].map((k) => Math.abs(R.im.d[4 * p + k] - im.d[4 * p + k]))) > 40) changed[p] = 1;
  const cc = components(changed, w, h);
  const kept = compMask(cc.lab, cc.comps.filter((c) => c.area >= 25).map((c) => c.id));
  if (!count(kept)) { check(false, `expression ${id}`, 'the edit changed nothing below the eyes; redo it'); continue; }
  const patch = and(fillHoles(dilate(or(kept, G.mouth), w, h, 6), w, h), faceIn);
  const soft = blur(Float32Array.from(patch), w, h, 2);
  const L = blank(w, h), T = blank(w, h);
  const eskin = medianColor(R.im, and(patch, Uint8Array.from({ length: N }, (_, p) => (Math.hypot(...[0, 1, 2].map((k) => R.im.d[4 * p + k] - skin[k])) < 30 ? 1 : 0))));
  const mouthArea = dilate(boxMask(w, h, mc.x0 - 0.2 * mw, mc.y0 - 0.25 * mw, mc.x1 + 0.2 * mw, G.chin - G.lw - 4), w, h, 2);
  // the edit's skin may be a shade off the portrait's: move its colours onto the portrait's skin so the patch has no seam
  const Ls = luma(...eskin), shift = [0, 1, 2].map((k) => skin[k] - eskin[k]);
  const onSkin = (c) => { const t = Math.max(0, Math.min(1, (luma(...c) - Lline) / (Ls - Lline))); return c.map((v, k) => Math.max(0, Math.min(255, Math.round(v + t * shift[k])))); };
  for (let p = 0; p < N; p++) {
    const a = Math.min(1, soft[p] * 1.25);
    if (a <= 0.01) continue;
    setPx(L, p, onSkin(rgb(R.im, p)), a);
    setPx(T, p, mouthArea[p] ? skin : onSkin(rgb(R.im, p)), a);
  }
  const box = alphaBox(L, w, h, 2);
  expressions.push({ id });
  check(true, `expression ${id}`, `${box[2]}x${box[3]} px patch`);
  layers.push({ id: `expr_${id}`, L, talk: T, def: { group: 'head', depth: 0, role: 'expr', expression: id }, hidden: true });
}

// glasses (frames only), front hair, brows: cut from the portrait, edges unmixed against what's under them
if (G.rims) {
  const L = fromMask(im, null, G.glass, w, h);
  softEdge(L, G.glass, im, rest, K, w, h, { allow: not(G.hair) });
  add('glasses', L, { group: 'head', depth: 0.03 });
}
{
  const L = fromMask(K.fg, K.alpha, G.hair, w, h);
  softEdge(L, G.hair, K.fg, rest, K, w, h, { allow: not(or(G.brows, G.glass)) });
  add('front_hair', L, { group: 'hair_front', depth: 0.12 });
}
{
  const L = fromMask(im, null, G.brows, w, h);
  softEdge(L, G.brows, im, rest, K, w, h, {});
  add('brows', L, { group: 'head', depth: 0 });
}

// ---------------------------------------------------------------- anchors
const fc = G.faceComp;
const skullTop = bbox(baldHead, w, h)?.[1] ?? G.hairBox[1];
const nk = G.neck;
const neckY = Math.round(nk ? nk.top + 0.5 * (G.chin - nk.top) : G.chin - 0.05 * (G.chin - skullTop));
const faceX0 = fc.x0 - G.lw, faceX1 = fc.x1 + G.lw;
const head = { cx: round1((faceX0 + faceX1) / 2), cy: round1((skullTop + neckY) / 2), rx: round1((faceX1 - faceX0) / 2), ry: round1((neckY - skullTop) / 2) };
let foreheadTop = h;
for (let y = 0; y < h && foreheadTop === h; y++) for (let x = fc.x0; x <= fc.x1; x++) if (G.headSkin[y * w + x]) { foreheadTop = y; break; }
const charBox = bbox(G.char, w, h);
const bodyBox = bbox(minus(G.char, or(faceM, G.hair)), w, h);
const chestY = Math.min(h - 1, Math.round(G.chin + 0.6 * (h - G.chin)));
const anchors = {
  head,
  face: [faceX0, foreheadTop, faceX1, G.chin],
  neck_y: neckY,
  top_y: charBox[1],
  bottom_y: charBox[3],
  hair_root_y: skullTop,
  eyes: G.eyes.map((e) => e.box),
  brows: G.browComps.map((c) => (c ? [c.x0, c.y0, c.x1, c.y1] : null)),
  jaw: { top: mouthY, chin: G.chin, half: 0, open: 0, round: 0, wide: 0 },
  chest: { cx: round1((bodyBox[0] + bodyBox[2]) / 2), cy: chestY, rx: round1(0.3 * (bodyBox[2] - bodyBox[0])), ry: round1(0.12 * h) },
};

// ---------------------------------------------------------------- write the package
const defs = [];
for (const Lr of layers) {
  let box;
  if (Lr.frames) box = unionBox(Lr.frames.map((f) => alphaBox(f, w, h, 3)));
  else if (Lr.maskFull) box = unionBox([alphaBox(Lr.L, w, h, 2)]);
  else box = alphaBox(Lr.L, w, h, 2);
  if (!box) { log('skip empty layer', Lr.id); continue; }
  const def = { id: Lr.id, texture: `textures/${Lr.id}.png`, x: box[0], y: box[1], w: box[2], h: box[3], ...Lr.def };
  if (Lr.frames) {
    def.frames = Lr.visemes.map((v) => `textures/${Lr.id}_${v}.png`);
    def.visemes = Lr.visemes;
    Lr.frames.forEach((f, k) => writePng(path.join(PKG, def.frames[k]), bleed(cut(f, box))));
    def.texture = def.frames[0];
  } else writePng(path.join(PKG, def.texture), bleed(cut(Lr.L, box)));
  if (Lr.talk) {
    def.talk = `textures/${Lr.id}_talk.png`;
    writePng(path.join(PKG, def.talk), bleed(cut(Lr.talk, box)));
  }
  if (Lr.maskFull) {
    def.mask = `textures/${Lr.id}_mask.png`;
    const mc = cut(Lr.maskFull, box);
    // the whites' coverage is the mask's ALPHA (white RGB), as LivLiv reads it (uMode 1: o = vec4(c.a))
    for (let k = 0; k < box[2] * box[3]; k++) { const v = mc.d[4 * k]; mc.d[4 * k] = mc.d[4 * k + 1] = mc.d[4 * k + 2] = 255; mc.d[4 * k + 3] = v; }
    writePng(path.join(PKG, def.mask), mc);
  }
  // key order like the reference models
  const order = ['id', 'texture', 'frames', 'visemes', 'mask', 'talk', 'x', 'y', 'w', 'h', 'group', 'depth', 'role', 'expression', 'pivot', 'clip', 'range'];
  defs.push(Object.fromEntries(order.filter((k) => def[k] !== undefined).map((k) => [k, def[k]])));
}
const model = {
  format: 'baocut-puppet', version: 1, name: NAME,
  canvas: [w, h],
  // the rig and tuning are left to the player's defaults
  profile: cfg.profile ?? { id: 'anime_half', facing: 'front', glasses: !!G.rims },
  anchors,
  expressions,
  layers: defs,
};
fs.writeFileSync(path.join(PKG, 'model.json'), JSON.stringify(model, null, 1) + '\n');

// ---------------------------------------------------------------- checks
const errs = [];
for (const d of defs) {
  if (d.x < 0 || d.y < 0 || d.x + d.w > w || d.y + d.h > h) errs.push(`${d.id}: box outside the canvas`);
  for (const f of [d.texture, ...(d.frames ?? []), d.mask].filter(Boolean)) {
    const t = readImage(path.join(PKG, f));
    if (t.w !== d.w || t.h !== d.h) errs.push(`${d.id}: ${f} is ${t.w}x${t.h}, box ${d.w}x${d.h}`);
  }
  if (d.frames && d.frames.length !== d.visemes.length) errs.push(`${d.id}: frames/visemes`);
}
const inCanvas = (b) => b[0] >= 0 && b[1] >= 0 && b[2] < w && b[3] < h;
for (const b of [anchors.face, ...anchors.eyes, ...anchors.brows.filter(Boolean)]) if (!inCanvas(b)) errs.push(`anchor box ${b} outside`);
// at rest the layers must give back the portrait (outside what the bald repaint changed under the hair)
let diff = 0, worst = 0; const dimg = blank(w, h), off = new Uint8Array(N);
for (let p = 0; p < N; p++) {
  const a = rest.d[4 * p + 3] / 255, ka = K.alpha[p];
  const c = [0, 1, 2].map((k) => rest.d[4 * p + k] * a + K.key[k] * (1 - a));
  const e = Math.max(...[0, 1, 2].map((k) => Math.abs(c[k] - im.d[4 * p + k])));
  if (e > 24) { diff++; off[p] = 1; }
  worst = Math.max(worst, e);
  const v = Math.min(255, e * 4); dimg.d.set([v, v, v, 255], 4 * p);
}
writePng(path.join(OUT, 'rest.png'), rest);
writePng(path.join(OUT, 'rest-diff.png'), dimg);
{
  // the layers must give back the portrait. Re-cut antialiased edges leave thin lines of small differences along the
  // outlines; a part that went missing or moved leaves a patch: count the patches (off pixels at least 3 px thick)
  const blob = count(and(dilate(erode(off, w, h, 1), w, h, 1), off)), nc = count(G.char);
  const share = diff / nc, blobShare = blob / nc, okRest = blobShare < 0.0005 && share < 0.01;
  check(okRest, 'rest matches the portrait', `${diff} px off by more than 24 (${(100 * share).toFixed(2)}%), ${blob} px of them in patches (${(100 * blobShare).toFixed(2)}%), worst ${Math.round(worst)}${okRest ? '' : '; look at rest-diff.png'}`);
}
check(!errs.length, 'package', errs.length ? errs.join('; ') : `${defs.length} layers`);
log('layers', defs.map((d) => `${d.id} ${d.w}x${d.h}@${d.x},${d.y}`).join(' | '));
const files = [['model.json', fs.readFileSync(path.join(PKG, 'model.json'))]];
for (const d of defs) for (const f of [d.texture, ...(d.frames ?? []), d.mask, d.talk].filter(Boolean)) if (!files.some(([n]) => n === f)) files.push([f, fs.readFileSync(path.join(PKG, f))]);
const pkgFile = path.join(OUT, `${NAME.replace(/[^\w.-]+/g, '-')}.bcpuppet`);
fs.writeFileSync(pkgFile, zip(files));
const ok = checks.every((c) => c.ok);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ok, package: pkgFile, checks }, null, 1) + '\n');
console.log(`${ok ? 'built' : 'built with FIX lines'} -> ${pkgFile}`);
process.exitCode = ok ? 0 : 1;
