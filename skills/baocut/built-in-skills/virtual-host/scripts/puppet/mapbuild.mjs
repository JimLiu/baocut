// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// The part-map build: a character drawn in any style (soft anime shading, painterly) split into layers along a part
// map, an image edit of the portrait that paints each part in one flat key colour (partmap.mjs). What a moved part
// uncovers is painted from the bald repaint (under the hair) or filled smoothly from round it (under the eyes, brows
// and mouth). Writes the BaoCut package and the LivLiv v4 package from the same layers.
import fs from 'node:fs';
import path from 'node:path';
import { readImage, writePng } from './png.mjs';
import { blank, clone, dilate, erode, distTo, not, and, or, minus, count, bbox, medianColor, over, blur, components, compMask } from './ops.mjs';
import { keyOut, luma, unmix } from './seg.mjs';
import { ellipseCover } from './parts.mjs';
import { fillHoles, softEdge, setPx, rgb, alphaBox, nearestIndex } from './layers.mjs';
import { registered } from './edits.mjs';
import { readLabels, part, faceZone, PARTS, NAMES } from './partmap.mjs';
import { smoothFill, strandFill } from './fill.mjs';
import { browNear, redrawnBrows, browNoteOf, writeBrowDebug, browAcross } from './brows.mjs';
import { writeLayers, writePackages, NECK_UP_MAX } from './pack.mjs';
import { expressionEyeRegions, cutExpressionEyes, expressionEyeLayers, writeEyeDebug } from './expreyes.mjs';

// soft shading redrawn by an edit leaves more residual than flat colours (puppet-build.mjs uses 6)
const RESIDUAL_MAX = 8;
// how far out from the bangs and the side locks the face is skin (no more than the hair layers' soft edge reaches, so
// at rest they give the strands' outlines back over it)
const HAIR_EDGE = 2;
// there a hair layer carries a pixel as drawn when it and the skin under it differ from the portrait by more than this
const EDGE_KEEP = 16;
const round1 = (v) => Math.round(v * 10) / 10;
const box = (w, h, x0, y0, x1, y1) => {
  const m = new Uint8Array(w * h);
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(h - 1, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(w - 1, Math.ceil(x1)); x++) m[y * w + x] = 1;
  return m;
};
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** run the build; returns the exit code (0 all ok, 1 a FIX line) */
export function buildFromMap(cfgPath, cfg, o = {}) {
  const DEBUG = !!o.debug;
  const P = (f) => path.resolve(path.dirname(cfgPath), f);
  const log = (...a) => { if (DEBUG) console.log(...a.map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v))); };
  const OUT = P(cfg.out ?? 'puppet'), PKG = path.join(OUT, 'package'), DBG = path.join(OUT, 'work');
  const NAME = cfg.name ?? path.basename(OUT);
  fs.mkdirSync(OUT, { recursive: true });
  if (DEBUG) fs.mkdirSync(DBG, { recursive: true });
  const checks = [];
  const check = (ok, item, note = '') => { checks.push({ ok, item, note }); console.log(`${ok ? 'ok ' : 'FIX'}  ${item}${note ? `: ${note}` : ''}`); };
  const fail = (item, note) => { check(false, item, note); fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ok: false, checks }, null, 1) + '\n'); return 1; };
  const read = (f) => readImage(P(f));

  // ---------------------------------------------------------------- inputs and labels
  if (!cfg.portrait) return fail('config', '"portrait" is required');
  const im = read(cfg.portrait), { w, h } = im, N = w * h;
  const sameSize = (e, f) => (e.w === w && e.h === h ? e : null);
  let K = keyOut(im);
  const pm = sameSize(read(cfg.partmap), cfg.partmap);
  if (!pm) return fail('part map', `not ${w}x${h} like the portrait; ask for the same size`);
  const LB = readLabels(im, pm, K);
  const lab = LB.lab;
  // a gap between locks that the backdrop shows through, closed off from the rest of it: the map says it is hair, so
  // key colour there is background (green eyes or clothes are other parts and stay)
  K = keyOut(im, { holes: part(lab, 'front', 'side', 'back') });
  const fgN = count(Uint8Array.from(K.alpha, (a) => (a > 0.5 ? 1 : 0)));
  {
    const okA = Math.abs(LB.A.s - 1) <= 0.03 && LB.A.residual <= 8, farShare = LB.far / fgN;
    check(okA && farShare < 0.02, 'part map', `shift ${LB.A.dx},${LB.A.dy}, scale ${LB.A.s}, residual ${LB.A.residual}, ${(100 * farShare).toFixed(2)}% of the character in no palette colour${okA ? '' : '; the map moved or resized the character: redo it'}${farShare < 0.02 ? '' : '; the map is not flat colours: redo it with the palette'}`);
  }
  if (DEBUG) {
    const V = blank(w, h);
    for (let p = 0; p < N; p++) { const c = PARTS[NAMES[lab[p]]]; V.d.set([...c, 255], 4 * p); }
    writePng(path.join(DBG, 'labels.png'), V);
  }
  const M = {};
  for (const n of NAMES) M[n] = part(lab, n);
  // each face part only where it can be: the face is the biggest yellow blob and the skin between the strands over a
  // brow (faceZone); eyes, brows, mouth and ears inside the head, no clothes over the eyes, and neck only in pieces
  // that reach below the chin (two map colours mixing at an edge can make a third, a brow-purple between pink and blue
  // hair, a cloth-grey between a black lash and the white, a neck-orange between the red bangs and the yellow face); a
  // stray takes the part round it
  let overBrows = 0;
  {
    const F = faceZone(M.face, M.brow, w, h);
    if (!F) return fail('part map', 'no face (yellow) in the map; redo it');
    const big = F.big;
    overBrows = F.overBrows;
    const fw0 = big.x1 - big.x0, fh0 = big.y1 - big.y0;
    const inFace = box(w, h, big.x0, big.y0 - 0.15 * fh0, big.x1, big.y1);
    const nc = components(M.neck, w, h);
    const zone = {
      neck: compMask(nc.lab, nc.comps.filter((c) => c.y1 > big.y1).map((c) => c.id)),
      face: F.zone,
      white: inFace, iris: inFace, lash: inFace, brow: inFace,
      mouth: box(w, h, big.x0, big.y0 + 0.5 * fh0, big.x1, big.y1),
      ear: box(w, h, big.x0 - 0.3 * fw0, big.y0, big.x1 + 0.3 * fw0, big.y1),
      cloth: not(box(w, h, big.x0, big.y0 - 0.15 * fh0, big.x1, big.y0 + 0.7 * fh0)),
    };
    const stray = new Uint8Array(N);
    for (const [n, z] of Object.entries(zone)) for (let p = 0; p < N; p++) if (M[n][p] && !z[p]) stray[p] = 1;
    if (count(stray)) {
      const ni = nearestIndex(Uint8Array.from(stray, (v, p) => (!v && lab[p] !== 0 ? 1 : 0)), w, h, 60);
      for (let p = 0; p < N; p++) if (stray[p]) lab[p] = ni[p] >= 0 ? lab[ni[p]] : 0;
      for (const n of NAMES) M[n] = part(lab, n);
    }
    log('stray part pixels relabelled', count(stray));
  }
  // highlights painted white inside the iris are the iris's
  {
    const cc = components(M.white, w, h), ring = dilate(M.white, w, h, 1);
    for (const c of cc.comps) {
      let iris = 0, all = 0;
      for (let y = Math.max(0, c.y0 - 1); y <= Math.min(h - 1, c.y1 + 1); y++) for (let x = Math.max(0, c.x0 - 1); x <= Math.min(w - 1, c.x1 + 1); x++) {
        const p = y * w + x;
        if (!ring[p] || M.white[p]) continue;
        all++; if (M.iris[p]) iris++;
      }
      if (all && iris / all > 0.8) for (let p = 0; p < N; p++) if (cc.lab[p] === c.id) { M.white[p] = 0; M.iris[p] = 1; }
    }
  }
  // thin bang tips the map painted as face: face pixels by the bangs, in the hair's colour, joined to the bangs
  {
    const fb0 = bbox(M.face, w, h), hairCol = medianColor(im, erode(M.front, w, h, 2)), skinC = medianColor(im, erode(M.face, w, h, 4));
    const near = and(dilate(M.front, w, h, 14), box(w, h, 0, 0, w - 1, fb0[1] + 0.5 * (fb0[3] - fb0[1])));
    const cand = new Uint8Array(N);
    for (let p = 0; p < N; p++) if (M.face[p] && near[p]) { const c = rgb(im, p); if (dist3(c, hairCol) < dist3(c, skinC)) cand[p] = 1; }
    const cc = components(cand, w, h), touch = dilate(M.front, w, h, 1), joined = new Set();
    for (let p = 0; p < N; p++) if (cand[p] && touch[p]) joined.add(cc.lab[p]);
    let n = 0;
    for (let p = 0; p < N; p++) if (cand[p] && joined.has(cc.lab[p])) { M.face[p] = 0; M.front[p] = 1; n++; }
    log('bang tips moved from the face to the hair', n);
  }
  const feat = or(or(or(M.brow, M.white), or(M.iris, M.lash)), M.mouth);
  const faceVis = or(or(M.face, M.ear), feat);
  const fb = bbox(M.face, w, h);
  if (!fb) return fail('part map', 'no face (yellow) in the map; redo it');
  const midX = (fb[0] + fb[2]) / 2, chin = fb[3];
  const sideOf = (m, s) => and(m, box(w, h, s ? midX : 0, 0, s ? w - 1 : midX - 1, h - 1));
  // two eyes, a brow over each, one mouth: what the layers need
  const eyeParts = [0, 1].map((s) => ({ white: sideOf(M.white, s), iris: sideOf(M.iris, s), lash: sideOf(M.lash, s) }));
  for (const [s, side] of [[0, 'L'], [1, 'R']]) {
    const e = eyeParts[s], nw = count(e.white), ni = count(e.iris);
    if (nw < 40 || ni < 20) return fail(`eye ${side}`, `the map has ${nw} px of eye white and ${ni} px of iris on this side; redo the map (or the portrait, eyes open with the whites showing)`);
    // keep the eye's own pieces: the biggest blob of white + iris and what touches it
    const opening = or(e.white, e.iris), cc = components(opening, w, h), big = cc.comps.sort((a, b) => b.area - a.area)[0];
    const eb = [big.x0, big.y0, big.x1, big.y1], pad = 0.6 * (eb[2] - eb[0]);
    const zone = box(w, h, eb[0] - pad, eb[1] - pad, eb[2] + pad, eb[3] + 0.5 * pad);
    e.white = and(e.white, zone); e.iris = and(e.iris, zone); e.lash = and(e.lash, zone);
    e.opening = or(e.white, e.iris);
    e.box = bbox(or(e.opening, e.lash), w, h);
  }
  // a brow is above its eye: a brow-coloured blob that starts below the eye's top is two map colours mixing at an edge
  // (hair over the cheek, say), and takes the part round it, or the brow's box runs down the face
  {
    const cc = components(M.brow, w, h), low = cc.comps.filter((c) => c.y0 > eyeParts[c.cx >= midX ? 1 : 0].box[1]).map((c) => c.id);
    const stray = compMask(cc.lab, low);
    if (count(stray)) {
      const ni = nearestIndex(Uint8Array.from(stray, (v, p) => (!v && !M.brow[p] && lab[p] !== 0 ? 1 : 0)), w, h, 60);
      for (let p = 0; p < N; p++) {
        if (!stray[p]) continue;
        M.brow[p] = 0;
        lab[p] = ni[p] >= 0 ? lab[ni[p]] : 0;
        if (lab[p]) M[NAMES[lab[p]]][p] = 1;
      }
      log('brow pixels below the eyes relabelled', count(stray));
    }
  }
  if (count(M.mouth) < 15) return fail('mouth', 'the map has no mouth (dark red); redo it');
  const mb = bbox(M.mouth, w, h), mouthC = [(mb[0] + mb[2]) / 2, (mb[1] + mb[3]) / 2], mw = mb[2] - mb[0] + 1;
  // where the map painted a brow over a strand of hair that the portrait draws over the brow, those pixels (in the
  // hair's colour, by the bangs) are the hair's, and the brow goes on under them
  const lineCol = medianColor(im, or(eyeParts[0].lash, eyeParts[1].lash));
  const browVis = new Uint8Array(N), browHidden = new Uint8Array(N);
  const frontCol = medianColor(im, erode(M.front, w, h, 2)), browCol = medianColor(im, erode(M.brow, w, h, 1).some((v) => v) ? erode(M.brow, w, h, 1) : M.brow);
  {
    const nearFront = dilate(M.front, w, h, 3);
    for (let p = 0; p < N; p++) {
      if (!M.brow[p]) continue;
      const c = rgb(im, p);
      if (nearFront[p] && dist3(c, frontCol) + 12 < dist3(c, browCol)) { browHidden[p] = 1; M.front[p] = 1; } else browVis[p] = 1;
    }
  }
  // and the other way round: a strand the map painted across a brow that the portrait draws over the strand (or
  // through it) is the brow there, and the bangs under it are filled like those under any brow on the bangs
  const across = browAcross({ im, brow: M.brow, front: M.front, browCol, midX, w, h });
  for (let p = 0; p < N; p++) if (across[p]) { M.brow[p] = 1; browVis[p] = 1; }
  const browFull = or(browVis, browHidden);
  const brows = [0, 1].map((s) => { const m = sideOf(browFull, s); return count(m) > 10 ? m : null; });
  // the brows are drawn over the bangs: where a brow lies on the bangs (hair right above and right below it in its
  // column) the bangs under it are filled, so they stay whole when an expression's brows replace it; a brow on the
  // forehead keeps skin under it
  const browOnHair = new Uint8Array(N);
  {
    const hairBeside = (x, y, step) => { for (let k = 1; k <= 2; k++) { const yy = y + step * k; if (yy >= 0 && yy < h && M.front[yy * w + x]) return true; } return false; };
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; ) {
        if (!browVis[y * w + x]) { y++; continue; }
        let y1 = y;
        while (y1 + 1 < h && browVis[(y1 + 1) * w + x]) y1++;
        if (hairBeside(x, y, -1) && hairBeside(x, y1, 1)) for (let k = y; k <= y1; k++) browOnHair[k * w + x] = 1;
        y = y1 + 1;
      }
    }
  }
  for (let p = 0; p < N; p++) if (across[p]) browOnHair[p] = 1;
  if (DEBUG) {
    // brows on the bangs: green filled under, red brow left on skin, blue brow under a strand, grey the bangs
    const dm = blank(w, h);
    for (let p = 0; p < N; p++) {
      if (browOnHair[p]) setPx(dm, p, [0, 200, 0], 1);
      else if (browVis[p]) setPx(dm, p, [230, 0, 0], 1);
      else if (browHidden[p]) setPx(dm, p, [0, 0, 230], 1);
      else if (M.front[p]) setPx(dm, p, [150, 150, 150], 1);
      else if (M.face[p]) setPx(dm, p, [250, 220, 200], 1);
    }
    writePng(path.join(DBG, 'brow-bangs.png'), dm);
  }
  check(true, 'parts', `eyes ${eyeParts.map((e) => e.box.join(',')).join(' / ')}, brows ${brows.filter(Boolean).length}, mouth ${mw} px wide, ${count(browHidden)} px of brow under the hair, ${count(across)} over strands the map painted across it, ${count(browOnHair)} on the bangs, ${overBrows} px of skin between the strands over the brows`);
  const hairF = or(or(M.front, M.side), M.back);

  // ---------------------------------------------------------------- the bald repaint: what is under the hair
  if (!cfg.bald) return fail('bald', 'missing: run puppet-mask.mjs, repaint the hair with retouch (references/art.md section 2) and add "bald"');
  const bald = sameSize(read(cfg.bald), cfg.bald);
  if (!bald) return fail('bald', `not ${w}x${h}`);
  const BK = keyOut(bald, { key: K.key });
  const baldFg = Uint8Array.from(BK.alpha, (a) => (a > 0.5 ? 1 : 0));
  // the head: above the ears' bottom, the bald head's columns; below, the face's own width in each row
  const earB = count(M.ear) ? bbox(M.ear, w, h)[3] : Math.round(Math.max(eyeParts[0].box[3], eyeParts[1].box[3]) + 0.25 * (chin - eyeParts[0].box[3]));
  const fw = fb[2] - fb[0];
  const headZone = new Uint8Array(N);
  for (let y = 0; y <= chin; y++) {
    if (y <= earB) { for (let x = Math.max(0, Math.floor(fb[0] - 0.15 * fw)); x <= Math.min(w - 1, fb[2] + 0.15 * fw); x++) headZone[y * w + x] = 1; continue; }
    let x0 = w, x1 = -1;
    for (let x = 0; x < w; x++) if (faceVis[y * w + x] || (M.ear[y * w + x])) { if (x < x0) x0 = x; x1 = x; }
    for (let x = x0; x <= x1; x++) headZone[y * w + x] = 1;
  }
  // only the bangs and the side locks hide anything: the back hair is behind the head and the body, so where it shows
  // there is nothing of them
  const hides = or(M.front, M.side);
  const faceUnder = and(and(and(hides, headZone), baldFg), not(M.cloth));
  const bodyUnder = and(and(hides, baldFg), not(headZone));
  // the base picture: the portrait, with the bald repaint where the hair hides something (never on what shows)
  const B = clone(im), BA = Float32Array.from(K.alpha), BF = clone(K.fg);
  for (let p = 0; p < N; p++) if (hides[p]) {
    for (let k = 0; k < 4; k++) { B.d[4 * p + k] = bald.d[4 * p + k]; BF.d[4 * p + k] = BK.fg.d[4 * p + k]; }
    BA[p] = BK.alpha[p];
  }
  const BKey = { alpha: BA, fg: BF };
  {
    // where the repaint left hair: dark hair-coloured strokes under the hair inside the head
    const hairCol = medianColor(im, erode(M.front, w, h, 3)), skinCol = medianColor(im, erode(M.face, w, h, 4));
    let left = 0;
    for (let p = 0; p < N; p++) if (faceUnder[p] && dist3(rgb(bald, p), hairCol) < 0.5 * dist3(skinCol, hairCol)) left++;
    const share = left / Math.max(1, count(faceUnder));
    check(share < 0.08, 'bald repaint', `${(100 * share).toFixed(1)}% of the scalp under the hair still looks like hair${share < 0.08 ? '' : '; redo the repaint (references/art.md section 2)'}`);
  }

  // ---------------------------------------------------------------- layers, bottom first
  const layers = [];
  const rest = blank(w, h);
  const add = (id, L, def, x = {}) => { layers.push({ id, L, def, ...x }); if (!x.hidden) over(rest, x.restIm ?? L); };
  const fromSrc = (src, alpha, m) => { const L = blank(w, h); for (let p = 0; p < N; p++) if (m[p]) setPx(L, p, rgb(src, p), alpha ? alpha[p] : 1); return L; };
  const ones = new Float32Array(N).fill(1);
  const skin = medianColor(im, erode(M.face, w, h, 4));

  // back hair: what shows, and behind the head and the shoulders a smooth fill of its colours, so a turn or a swing
  // never opens a hole; the fill stays inside what the layers above cover at rest
  {
    const sil = fillHoles(or(or(hairF, faceVis), or(faceUnder, M.ear)), w, h);
    const fg = Uint8Array.from(BA, (a) => (a > 0.5 ? 1 : 0));
    const behindBody = and(dilate(M.back, w, h, 24), or(M.cloth, M.neck));
    // the back hair's rim along the head and the body is half skin or cloth in the portrait: it takes hair colours
    // too, so a turn never shows a light line round the head
    const rim = and(and(M.back, dilate(or(or(faceVis, faceUnder), or(M.neck, M.cloth)), w, h, 2)), fg);
    const fillM = or(minus(and(or(erode(sil, w, h, 3), behindBody), fg), M.back), rim);
    const L = blank(w, h);
    for (let p = 0; p < N; p++) if (M.back[p]) setPx(L, p, rgb(K.fg, p), K.alpha[p]);
    const solid = Uint8Array.from(K.alpha, (a) => (a > 0.9 ? 1 : 0));
    const known = and(minus(count(M.back) > 400 ? erode(M.back, w, h, 1) : erode(hairF, w, h, 2), rim), solid);
    const src = clone(K.fg);
    smoothFill(src, fillM, known, w, h);
    for (let p = 0; p < N; p++) if (fillM[p]) setPx(L, p, rgb(src, p), 1);
    add('back_hair', L, { group: 'hair_back', depth: -0.35 });
  }

  // body: clothes, neck and the bald repaint's shoulders under the hair; the neck carried up under the face to the
  // mouth line, so a nod or the jaw opening never shows a hole under the chin
  const neckB = bbox(M.neck, w, h);
  // the chin's outline is drawn on the neck: it goes with the face, and the neck under it is filled
  let chinLine = new Uint8Array(N);
  if (neckB) {
    const nl = luma(...medianColor(im, erode(M.neck, w, h, 3)));
    const near = dilate(faceVis, w, h, 4);
    for (let p = 0; p < N; p++) if (M.neck[p] && near[p] && luma(...rgb(im, p)) < nl - 45) chinLine[p] = 1;
    chinLine = and(dilate(chinLine, w, h, 1), M.neck);
  }
  let neckExt = null, neckSrc = null;
  {
    const core0 = or(or(M.cloth, M.neck), bodyUnder);
    const L = fromSrc(BF, BA, core0);
    if (neckB) {
      const top = neckB[1];
      let xl = w, xr = -1;
      for (let y = top; y < Math.min(h, top + 12); y++) for (let x = 0; x < w; x++) if (M.neck[y * w + x]) { if (x < xl) xl = x; if (x > xr) xr = x; }
      neckExt = and(box(w, h, xl + 1, mouthC[1], xr - 1, Math.max(top, chin) + 2), or(or(faceVis, faceUnder), chinLine));
      neckSrc = clone(B);
      smoothFill(neckSrc, neckExt, erode(minus(M.neck, chinLine), w, h, 2), w, h);
    }
    softEdge(L, core0, B, rest, BKey, w, h, { allow: not(or(faceVis, faceUnder)) });
    if (neckExt) {
      for (let p = 0; p < N; p++) if (neckExt[p]) setPx(L, p, rgb(neckSrc, p), 1);
      const seam = and(dilate(neckExt, w, h, 2), M.neck);
      for (let p = 0; p < N; p++) if (seam[p]) setPx(L, p, rgb(L, p), 1);
    }
    add('body', L, { group: 'body', depth: 0 });
  }

  // an edit's skin may be a shade off and drift across the face: move it onto the portrait's, as a whole, then by what
  // is left round each place it did not change. Returns the edit with its colours in `area` matched (others as they are).
  // As a whole: onto the portrait's skin over the same pixels, not the whole face's. A shaded face is darker round the
  // eyes than on the cheeks; matched to the whole face, a closed lid came out a light blotch over the eye
  const Lline = luma(...lineCol);
  const tSkin = (c, Ls) => Math.max(0, Math.min(1, (luma(...c) - Lline) / Math.max(1, Ls - Lline)));
  const changed = (E, area, m0) => {
    const out = new Uint8Array(N);
    for (let p = 0; p < N; p++) {
      if (!area[p]) continue;
      const d = [0, 1, 2].map((k) => E.d[4 * p + k] - im.d[4 * p + k]), m = Math.max(...d.map(Math.abs));
      if (m > m0 || (m > 8 && d[0] - d[1] > 8)) out[p] = 1;
    }
    return out;
  };
  const matchSkin = (Rim, area) => {
    const skinCore = and(erode(M.face, w, h, 3), area);
    const eskin = medianColor(Rim, skinCore), here = medianColor(im, skinCore);
    const Ls = luma(...eskin), shift = [0, 1, 2].map((k) => here[k] - eskin[k]);
    const E = clone(Rim);
    for (let p = 0; p < N; p++) if (area[p]) { const c = rgb(Rim, p), t = tSkin(c, Ls); E.d.set([...c.map((v, k) => v + t * shift[k]), 255], 4 * p); }
    const away = dilate(changed(E, area, 30), w, h, 8);
    const U = new Float32Array(N), Rk = [0, 1, 2].map(() => new Float32Array(N));
    for (let p = 0; p < N; p++) {
      if (!skinCore[p] || away[p]) continue;
      const d = [0, 1, 2].map((k) => E.d[4 * p + k] - im.d[4 * p + k]);
      if (Math.max(...d.map(Math.abs)) >= 20) continue;
      U[p] = 1; for (let k = 0; k < 3; k++) Rk[k][p] = d[k];
    }
    const den = blur(U, w, h, 16), num = Rk.map((r) => blur(r, w, h, 16));
    for (let p = 0; p < N; p++) {
      if (!area[p] || den[p] < 0.02) continue;
      const t = tSkin(rgb(E, p), luma(...here));
      for (let k = 0; k < 3; k++) E.d[4 * p + k] -= (t * num[k][p]) / den[p];
    }
    return E;
  };

  // the closed-eyes edit, lined up, and its eyes matched to the face
  let lidEdit = null;
  if (cfg.lids) {
    const e = sameSize(read(cfg.lids), cfg.lids);
    if (!e) return fail('lids', `not ${w}x${h}`);
    const skip = eyeParts.map((x) => [x.box[0] - 25, x.box[1] - 25, x.box[2] + 25, x.box[3] + 25]);
    for (const b of brows) if (b) { const bb = bbox(b, w, h); skip.push([bb[0] - 15, bb[1] - 15, bb[2] + 15, bb[3] + 15]); }
    lidEdit = registered(im, e, [fb[0] - 20, fb[1] - 60, fb[2] + 20, chin + 20], skip);
    check(lidEdit.A.residual <= RESIDUAL_MAX, 'lids lines up', `residual ${lidEdit.A.residual}, shift ${lidEdit.A.dx},${lidEdit.A.dy}, scale ${lidEdit.A.s}`);
  } else check(false, 'lids', 'no closed-eyes edit: blinks only squash the open eye; add "lids"');
  const lidZ = [], lidE = [];
  if (lidEdit) for (const s of [0, 1]) {
    const eb = eyeParts[s].box;
    lidZ[s] = minus(and(dilate(box(w, h, eb[0], eb[1], eb[2], eb[3]), w, h, 14), faceVis), dilate(browFull, w, h, 5));
    lidE[s] = matchSkin(lidEdit.im, lidZ[s]);
  }
  // face: the face, the ears and the bald scalp under the hair, with the eyes, brows and mouth filled smoothly
  const faceM = or(or(or(faceVis, faceUnder), browHidden), chinLine);
  // the whole neutral mouth: the map's mouth misses its thin ends, a lip highlight and the shade under the lower lip.
  // Left on the bare face they showed beside a narrower mouth frame (an "o" with a dot or a light dash next to it)
  const mouthAll = wholeMouth(im, M.mouth, M.face, mb, mw, w, h);
  log('mouth pixels beyond the map', count(minus(mouthAll, dilate(M.mouth, w, h, 2))));
  const holeM = and(or(dilate(or(feat, browHidden), w, h, 2), mouthAll), faceM);
  const faceSrc = clone(B);
  smoothFill(faceSrc, holeM, minus(or(or(M.face, M.ear), faceUnder), holeM), w, h);
  // round the bangs and the side locks the face is skin, and under them where the bald repaint left a stroke of hair:
  // the map's hair line runs a pixel or two inside the strands' outlines and light rims. Left on the face, they stayed
  // put while the hair swayed or the head turned, a pale or dark copy of each strand's edge; the hair layers take them
  // over the skin filled here (hairEdge), so at rest the portrait is as drawn
  const hairEdge = minus(and(minus(dilate(hides, w, h, HAIR_EDGE), hides), faceVis), holeM);
  {
    const hairCol = medianColor(im, erode(M.front, w, h, 3)), left = new Uint8Array(N);
    for (let p = 0; p < N; p++) if (faceUnder[p] && dist3(rgb(B, p), hairCol) < 0.5 * dist3(skin, hairCol)) left[p] = 1;
    const fillM = or(hairEdge, minus(and(dilate(left, w, h, 1), faceUnder), holeM));
    log('face skin round the hair', count(fillM));
    smoothFill(faceSrc, fillM, minus(or(or(M.face, M.ear), faceUnder), fillM), w, h);
  }
  // under each eye the closed-eyes edit's eyelid skin, its lash line filled: what a blink shows above the closing eye
  if (lidEdit) for (const s of [0, 1]) {
    const E = eyeParts[s], Ez = clone(lidE[s]), Ls = luma(...skin);
    const lash = new Uint8Array(N);
    for (let p = 0; p < N; p++) if (lidZ[s][p] && luma(...rgb(Ez, p)) < Ls - 40) lash[p] = 1;
    const lashD = dilate(lash, w, h, 2);
    smoothFill(Ez, lashD, minus(lidZ[s], lashD), w, h);
    if (DEBUG) writePng(path.join(DBG, `lid-skin-${s}.png`), Ez);
    const soft = blur(Float32Array.from(and(dilate(or(E.opening, E.lash), w, h, 2), holeM)), w, h, 2);
    for (let p = 0; p < N; p++) {
      const a = holeM[p] && lidZ[s][p] ? Math.min(1, 1.25 * soft[p]) : 0;
      if (a > 0.01) for (let k = 0; k < 3; k++) faceSrc.d[4 * p + k] += a * (Ez.d[4 * p + k] - faceSrc.d[4 * p + k]);
    }
  }
  {
    const L = blank(w, h);
    for (let p = 0; p < N; p++) if (faceM[p]) setPx(L, p, rgb(faceSrc, p), holeM[p] ? 1 : BA[p]);
    const keyF = { alpha: Float32Array.from(BA, (a, p) => (holeM[p] ? 1 : a)), fg: faceSrc };
    softEdge(L, faceM, faceSrc, rest, keyF, w, h, { allow: not(hairF) });
    add('face', L, { group: 'head', depth: 0 });
  }
  const blankFace = clone(rest); // what is under every feature: the edits are cut against it
  // eyes (image left first): the closed lid (from the closed-eyes edit), the open eye with the whites completed under
  // the iris (and their mask), the iris completed under the lash, and its highlights
  const eyeInfo = [];
  // where the closed lids cover (an expression's brows there go over them)
  let lidCover = new Uint8Array(N);
  for (const [s, side] of [[0, 'L'], [1, 'R']]) {
    const E = eyeParts[s], eb = E.box, ew = eb[2] - eb[0] + 1, eh = eb[3] - eb[1] + 1;
    // the iris ellipse: its widest row is the centre; the bottom as drawn (or as tall as it is wide when cut)
    const ib = bbox(E.iris, w, h);
    let wide = 0, cy = (ib[1] + ib[3]) / 2;
    for (let y = ib[1]; y <= ib[3]; y++) { let n = 0; for (let x = ib[0]; x <= ib[2]; x++) n += E.iris[y * w + x]; if (n > wide) { wide = n; cy = y + 0.5; } }
    const rx = (ib[2] - ib[0] + 1) / 2, cx = (ib[0] + ib[2] + 1) / 2;
    const ry = Math.max(ib[3] + 1 - cy, 1.1 * rx);
    const ell = { cx, cy, rx, ry };
    // lid
    if (lidEdit) {
      // the edit's closed eye whole: the open eye's place, what the edit changed round it, and a little more, in the
      // edit's colours matched to the face and feathered into it (only the changed pixels would leave a blotchy lid)
      const zone = lidZ[s], Ez = lidE[s];
      const S = diffPart(Ez, blankFace, zone, w, h, { thresh: 22, minArea: 30 });
      check(count(S.core) > 0, `closed eye ${side}`, count(S.core) ? `${count(S.core)} px` : 'the lids edit drew nothing in this eye; redo it with both eyes closed');
      const patch = and(fillHoles(or(dilate(or(E.opening, E.lash), w, h, 6), dilate(S.core, w, h, 3)), w, h), zone);
      const soft = blur(Float32Array.from(patch), w, h, 2);
      const Ld = blank(w, h);
      for (let p = 0; p < N; p++) { const a = Math.min(1, soft[p] * 1.25); if (a > 0.01 && zone[p]) setPx(Ld, p, rgb(Ez, p), a); }
      add(`eye_${side}_closed`, Ld, { group: 'head', depth: 0, role: `lid_${side}` }, { hidden: true });
      lidCover = or(lidCover, Uint8Array.from({ length: N }, (_, p) => (Ld.d[4 * p + 3] > 0 ? 1 : 0)));
    }
    // the open eye: lashes and whites as drawn, the whites filled in where the iris was
    const eyeCore = or(E.opening, E.lash);
    const src = clone(im);
    smoothFill(src, E.iris, E.white, w, h);
    const L = blank(w, h);
    for (let p = 0; p < N; p++) if (eyeCore[p]) setPx(L, p, rgb(src, p), 1);
    softEdge(L, eyeCore, src, rest, { alpha: ones, fg: src }, w, h, { allow: faceM, minSep: 24 });
    const mask = blank(w, h);
    for (let p = 0; p < N; p++) if (E.opening[p]) mask.d.set([255, 255, 255, 255], 4 * p);
    // the lid line at the iris: where the eye squashes to as it closes
    const col = Math.round(cx);
    let top = -1, bot = -1;
    for (let y = eb[1]; y <= eb[3]; y++) if (E.opening[y * w + col]) { if (top < 0) top = y; bot = y; }
    const pivot = [round1(cx), round1(top < 0 ? (eb[1] + eb[3]) / 2 : top + 0.62 * (bot - top))];
    const range = [round1(0.18 * ew), round1(0.12 * eh)];
    add(`eye_${side}`, L, { group: 'head', depth: 0, role: `eye_${side}`, pivot }, { mask });
    // highlights: the brightest pixels of the iris
    const irisL = [...E.iris].map((v, p) => (v ? luma(...rgb(im, p)) : -1)).filter((v) => v >= 0).sort((a, b) => a - b);
    const p90 = irisL[Math.floor(0.9 * (irisL.length - 1))] ?? 255;
    const shineT = Math.max(190, Math.min(245, p90 + 35));
    let shine = Uint8Array.from(E.iris, (v, p) => (v && luma(...rgb(im, p)) > shineT ? 1 : 0));
    { const cc = components(shine, w, h); shine = compMask(cc.lab, cc.comps.filter((c) => c.area >= 3).map((c) => c.id)); }
    // the iris: as drawn, the highlights and the part under the lash filled from its own colours
    const irisFull = new Float32Array(N);
    for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const p = y * w + x;
      // the completion goes only where the whites are not: under the lash and outside the eye
      irisFull[p] = E.iris[p] ? 1 : E.white[p] ? 0 : ellipseCover(ell, x + 0.5, y + 0.5);
    }
    const irisM = Uint8Array.from(irisFull, (v) => (v > 0 ? 1 : 0));
    const isrc = clone(im);
    const shineD = and(dilate(shine, w, h, 1), E.iris);
    smoothFill(isrc, or(minus(irisM, E.iris), shineD), minus(E.iris, shineD), w, h);
    const I = blank(w, h);
    for (let p = 0; p < N; p++) if (irisM[p]) setPx(I, p, rgb(isrc, p), E.iris[p] ? 1 : irisFull[p]);
    softEdge(I, E.iris, isrc, rest, { alpha: ones, fg: isrc }, w, h, { allow: E.white, minSep: 30 });
    const irisRest = clone(I);
    for (let p = 0; p < N; p++) irisRest.d[4 * p + 3] = E.opening[p] ? irisRest.d[4 * p + 3] : 0;
    add(`iris_${side}`, I, { group: 'head', depth: 0, role: `iris_${side}`, pivot, clip: `eye_${side}`, range }, { restIm: irisRest });
    if (count(shine)) {
      const Sh = blank(w, h);
      for (let p = 0; p < N; p++) if (shine[p]) setPx(Sh, p, rgb(im, p), 1);
      softEdge(Sh, shine, im, rest, { alpha: ones, fg: im }, w, h, { allow: E.iris, minSep: 20, r: 1.5 });
      add(`shine_${side}`, Sh, { group: 'head', depth: 0, role: `shine_${side}`, pivot, clip: `eye_${side}`, range });
    }
    eyeInfo.push({ box: eb, ell, pivot });
  }

  // mouth: the portrait's mouth (closed) and the shapes cut from the mouth edits, against the filled face
  const eyeBot = Math.max(eyeParts[0].box[3], eyeParts[1].box[3]);
  const mz = and(box(w, h, mb[0] - 0.45 * mw, Math.max(eyeBot + 0.55 * (mb[1] - eyeBot), mb[1] - 0.35 * mw), mb[2] + 0.45 * mw, chin - 3), or(faceVis, dilate(M.mouth, w, h, 3)));
  {
    const frames = { closed: diffPart(im, blankFace, or(mz, dilate(M.mouth, w, h, 3)), w, h, { thresh: 14, minArea: 6, near: mouthC, nearR: 0.8 * mw }).L };
    const size = {};
    const skipBox = [mb[0] - 0.5 * mw, mb[1] - 0.4 * mw, mb[2] + 0.5 * mw, chin - 2];
    for (const v of ['half', 'open', 'round', 'wide']) {
      const f = cfg.mouths?.[v];
      if (!f) continue;
      const e = sameSize(read(f), f);
      if (!e) return fail(`mouth ${v}`, `not ${w}x${h}`);
      const R = registered(im, e, [fb[0] - 20, eyeBot - 80, fb[2] + 20, chin + 30], [skipBox]);
      check(R.A.residual <= RESIDUAL_MAX, `mouth ${v} lines up`, `residual ${R.A.residual}, shift ${R.A.dx},${R.A.dy}, scale ${R.A.s}`);
      const S = diffPart(R.im, blankFace, mz, w, h, { thresh: 16, minArea: 20, near: mouthC, nearR: 0.9 * mw });
      const b = bbox(S.core, w, h);
      size[v] = b ? { w: b[2] - b[0] + 1, h: b[3] - b[1] + 1 } : null;
      check(!!b, `mouth ${v}`, b ? `${size[v].w}x${size[v].h} px` : 'the edit drew no mouth inside the mouth area; redo it');
      if (b) frames[v] = S.L;
      if (DEBUG) writePng(path.join(DBG, `mouth-${v}.png`), S.L);
    }
    for (const v of ['half', 'open']) if (!cfg.mouths?.[v]) check(false, `mouth ${v}`, `missing; "mouths.${v}" is required for talking`);
    if (size.half && size.open) check(size.half.h < size.open.h, 'mouth ladder', `half ${size.half.h} px tall, open ${size.open.h} px${size.half.h < size.open.h ? '' : '; open must be taller than half'}`);
    const visemes = Object.keys(frames);
    add('mouth', frames.closed, { group: 'head', depth: 0, role: 'mouth', pivot: [round1(mouthC[0]), round1(mouthC[1])] }, { frames: visemes.map((v) => frames[v]), visemes });
  }

  // expressions: what each edit changed on the face, cut as one soft patch over the eyes and the mouth
  const expressions = [];
  {
    const browTop = Math.min(...eyeParts.map((e) => e.box[1]), ...brows.filter(Boolean).map((b) => bbox(b, w, h)[1]));
    const eyeH = eyeBot - Math.min(eyeParts[0].box[1], eyeParts[1].box[1]);
    // the face's own outline (the jaw, the chin, the edge of the side locks) is never part of an expression: an edit that moved it a pixel would
    // draw it twice
    const outline = or(dilate(minus(not(faceVis), hairF), w, h, 4), dilate(M.side, w, h, 4));
    const area = minus(minus(and(or(faceM, dilate(browFull, w, h, 10)), box(w, h, fb[0], browTop - 0.5 * eyeH, fb[2], chin - 3)), minus(dilate(minus(hairF, browHidden), w, h, 1), dilate(browFull, w, h, 3))), outline);
    const eyeBox = eyeParts.map((e) => and(dilate(box(w, h, ...e.box), w, h, 4), area));
    const eyeDrawn = ['L', 'R'].map((s) => { const Lr = layers.find((l) => l.id === `eye_${s}`).L; return Uint8Array.from({ length: N }, (_, p) => (Lr.d[4 * p + 3] > 0 ? 1 : 0)); });
    const browZone = and(dilate(browFull, w, h, 6), area);
    const near = browNear({ full: browFull, boxes: brows.map((b) => b && bbox(b, w, h)), eyes: eyeParts.map((e) => e.box), midX, eyeH, w, h });
    const bangsOver = or(M.front, browOnHair), bangsEdge = minus(dilate(bangsOver, w, h, 2), bangsOver);
    const cheeks = minus(and(area, box(w, h, fb[0], eyeBot, fb[2], mb[3] + 0.2 * mw)), or(or(...eyeBox.map((m) => dilate(m, w, h, 4))), dilate(M.mouth, w, h, 10)));
    const mouthArea = dilate(box(w, h, mb[0] - 0.2 * mw, mb[1] - 0.25 * mw, mb[2] + 0.2 * mw, chin - 4), w, h, 2);
    const changes = (E) => {
      const strong = new Uint8Array(N), pink = new Uint8Array(N);
      for (let p = 0; p < N; p++) {
        if (!area[p]) continue;
        const d = [0, 1, 2].map((k) => E.d[4 * p + k] - im.d[4 * p + k]), m = Math.max(...d.map(Math.abs));
        if (m > 30) strong[p] = 1;
        if (cheeks[p] && m > 8 && d[0] - d[1] > 8) pink[p] = 1;
      }
      return { strong, pink };
    };
    for (const [id, f] of Object.entries(cfg.expressions ?? {})) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) { check(false, `expression ${id}`, 'ids are 1-64 letters, digits, _ or -'); continue; }
      const e = sameSize(read(f), f);
      if (!e) return fail(`expression ${id}`, `not ${w}x${h}`);
      const R = registered(im, e, [fb[0] - 60, browTop - 140, fb[2] + 60, chin + 40], [[fb[0] - 4, browTop - 12, fb[2] + 4, chin]]);
      check(R.A.residual <= RESIDUAL_MAX, `expression ${id} lines up`, `residual ${R.A.residual}, shift ${R.A.dx},${R.A.dy}, scale ${R.A.s}`);
      const E = matchSkin(R.im, area);
      const { strong, pink } = changes(E);
      const solid = and(dilate(erode(strong, w, h, 1), w, h, 1), strong);
      const sc = components(strong, w, h), real = new Set();
      for (let p = 0; p < N; p++) if (solid[p] && sc.lab[p]) real.add(sc.lab[p]);
      const kept = compMask(sc.lab, sc.comps.filter((c) => c.area >= 25 && real.has(c.id)).map((c) => c.id));
      const pc = components(pink, w, h);
      const blush = compMask(pc.lab, pc.comps.filter((c) => c.area >= 150).map((c) => c.id));
      const eyesHit = eyeBox.map((m) => count(and(solid, m)) > 0.02 * count(m));
      const browsRedrawn = count(browZone) > 0 && count(and(solid, browZone)) > 0.05 * count(browZone);
      if (!count(kept) && !count(blush)) { check(false, `expression ${id}`, 'the edit changed nothing on the face; redo it'); continue; }
      let seed = or(or(kept, blush), M.mouth);
      eyeBox.forEach((m, i) => { if (eyesHit[i]) seed = or(seed, m); });
      if (browsRedrawn) seed = or(seed, browZone);
      let patch = and(fillHoles(dilate(seed, w, h, 6), w, h), area);
      if (!browsRedrawn) patch = minus(patch, dilate(browFull, w, h, 4));
      eyeBox.forEach((m, i) => { if (!eyesHit[i]) patch = minus(patch, dilate(or(m, eyeDrawn[i]), w, h, 2)); });
      const soft = blur(Float32Array.from(or(patch, and(dilate(blush, w, h, 10), cheeks))), w, h, 2);
      // the edit's own mouth can reach past the portrait's (a broad smile): every changed stroke that reaches into the
      // mouth area is that mouth, and the talking patch shows the face under all of it, so its ends never stay on
      // beside the talking mouth
      const inMouth = new Set();
      for (let p = 0; p < N; p++) if (mouthArea[p] && sc.lab[p]) inMouth.add(sc.lab[p]);
      const talkFace = or(mouthArea, dilate(compMask(sc.lab, [...inMouth]), w, h, 2));
      const L = blank(w, h), T = blank(w, h);
      for (let p = 0; p < N; p++) {
        const a = Math.min(1, soft[p] * 1.25);
        if (a <= 0.01 || !area[p]) continue;
        const c = rgb(E, p);
        setPx(L, p, c, a);
        setPx(T, p, talkFace[p] ? rgb(blankFace, p) : c, a);
      }
      // brows the edit redrew go to the layer's brow texture, drawn over the bangs (the patch is under them, the bare
      // face beneath them). Found nothing (a brow the colour of the hair): the brows stay in the patch
      // the eyes it drew are placed first and the brows looked for outside them: a lash is never taken for a brow
      const ER = expressionEyeRegions({ E, im, patch: L, eyes: eyeDrawn.map((drawn, s) => ({ drawn, hit: eyesHit[s] })), changed: kept, skin, w, h });
      if (DEBUG) writeEyeDebug(path.join(DBG, `eyes-${id}.png`), E, ER, w, h, L);
      let BT = null, browNote = '', browPx = null;
      if (browsRedrawn) {
        const B = redrawnBrows({ E, im, near, eyes: ER.any, lids: lidCover, full: browFull, browCol, hairCol: frontCol, skin, midX, L, T, under: blankFace, w, h });
        if (DEBUG) writeBrowDebug(path.join(DBG, `brows-${id}.png`), B, near, w, h);
        BT = B.BT;
        if (BT) browPx = dilate(B.bm, w, h, 2);
        browNote = BT ? browNoteOf(B.bm, or(M.front, browOnHair), midX, w, h) : '; brows kept in the patch (none found)';
      }
      // under the bangs (and on their edge, where the edit's strands lie a pixel off the portrait's) the patch is skin,
      // filled from its own skin round it: the bangs layer is drawn over it there, and the edit's own copy of the
      // strands would come out from under it as the head turns (the hair moves on its own). The bare face there would
      // be a light seam against the edit's skin
      {
        const hairy = (p) => { const c = rgb(E, p); return dist3(c, frontCol) < dist3(c, skin) || dist3(c, browCol) < dist3(c, skin); };
        const keep = or(ER.any, browPx ?? new Uint8Array(N)), hole = new Uint8Array(N), known = new Uint8Array(N);
        for (let p = 0; p < N; p++) {
          if (keep[p] || !L.d[4 * p + 3]) continue;
          if (bangsOver[p] || (bangsEdge[p] && hairy(p))) hole[p] = 1;
          else if (L.d[4 * p + 3] === 255 && !hairy(p)) known[p] = 1;
        }
        if (count(hole) && count(known)) for (const X of [L, T]) {
          const a = Uint8Array.from({ length: N }, (_, p) => X.d[4 * p + 3]);
          smoothFill(X, hole, known, w, h);
          for (let p = 0; p < N; p++) X.d[4 * p + 3] = a[p];
        }
      }
      // the eyes it drew go to layers of their own that blink, the bare face under them in the patch
      const X = cutExpressionEyes({ L, T, under: blankFace, regions: ER, pivots: eyeInfo.map((e) => e.pivot), keep: browPx, w, h });
      const bx = alphaBox(L, w, h, 2);
      expressions.push({ id });
      const parts = [eyesHit.every(Boolean) ? 'eyes' : eyesHit[0] ? 'left eye' : eyesHit[1] ? 'right eye' : '', browsRedrawn ? 'brows' : '', count(blush) ? 'blush' : '', 'mouth'].filter(Boolean);
      check(true, `expression ${id}`, `${bx[2]}x${bx[3]} px patch: ${parts.join(', ')}${browNote}${X.note}`);
      layers.push({ id: `expr_${id}`, L, talk: T, ...(BT ? { browTex: BT } : {}), whole: X.whole, def: { group: 'head', depth: 0, role: 'expr', expression: id, ...(browsRedrawn ? { brows: 'redrawn' } : {}) }, hidden: true });
      layers.push(...expressionEyeLayers(id, X.eyes));
    }
  }

  // side locks, bangs, and the brows over the bangs as drawn, with the strands that cross them: the players draw an
  // expression's brows right after this layer. Under a brow on the bangs the bangs are filled from the clean hair
  // round it, along its strands, 2 px past the brow (its outline or halo is the brow's, not the hair's), and the brows
  // layer carries those pixels as drawn, so the rest is the portrait and a redrawn brow leaves plain hair
  const bangsFill = or(browOnHair, and(dilate(browOnHair, w, h, 2), M.front));
  // round the hair, what the face no longer carries and the soft edge did not take (a light rim, lighter than the skin
  // and the hair both, that no mix of them gives) the hair layer carries as drawn: it goes with the strands
  const edgeAsDrawn = (L, m) => {
    for (let p = 0; p < N; p++) {
      if (!m[p]) continue;
      const a = L.d[4 * p + 3] / 255, c = rgb(L, p), u = rgb(rest, p);
      if (dist3([0, 1, 2].map((k) => a * c[k] + (1 - a) * u[k]), rgb(im, p)) > EDGE_KEEP) setPx(L, p, rgb(im, p), 1);
    }
  };
  if (count(M.side)) {
    const L = fromSrc(K.fg, K.alpha, M.side);
    softEdge(L, M.side, K.fg, rest, K, w, h, {});
    edgeAsDrawn(L, and(hairEdge, dilate(M.side, w, h, HAIR_EDGE)));
    add('side_hair', L, { group: 'hair_side', depth: 0.06 });
  }
  {
    const fg = clone(K.fg);
    strandFill(fg, bangsFill, minus(M.front, bangsFill), w, h);
    const front = or(M.front, browOnHair);
    const L = fromSrc(fg, Float32Array.from(K.alpha, (a, p) => (bangsFill[p] ? 1 : a)), front);
    softEdge(L, front, fg, rest, K, w, h, { allow: not(or(M.side, browVis)) });
    edgeAsDrawn(L, minus(and(hairEdge, dilate(front, w, h, HAIR_EDGE)), browVis));
    add('front_hair', L, { group: 'hair_front', depth: 0.12 });
  }
  {
    const bm = or(browFull, bangsFill), L = blank(w, h);
    for (let p = 0; p < N; p++) if (bm[p]) setPx(L, p, rgb(im, p), 1);
    softEdge(L, bm, im, rest, { alpha: ones, fg: im }, w, h, { allow: faceM, minSep: 20 });
    add('brows', L, { group: 'head', depth: 0 });
  }

  // ---------------------------------------------------------------- anchors
  const charBox = bbox(Uint8Array.from(K.alpha, (a) => (a > 0.5 ? 1 : 0)), w, h);
  const skullTop = bbox(and(baldFg, headZone), w, h)?.[1] ?? bbox(hairF, w, h)[1];
  const neckTop = neckB ? Math.min(neckB[1], chin) : chin - 0.05 * (chin - skullTop);
  const neckY = Math.round(neckTop + 0.5 * (chin - neckTop));
  {
    const up = (chin - neckY) / Math.max(1, chin - fb[1]);
    check(up <= NECK_UP_MAX, 'neck line', `${chin - neckY} px above the chin (${(100 * up).toFixed(0)}% of the face)${up <= NECK_UP_MAX ? '' : '; the neck (orange) in the part map starts up in the face: redo the map'}`);
  }
  const fX0 = fb[0], fX1 = fb[2];
  let foreheadTop = h;
  for (let y = 0; y < h && foreheadTop === h; y++) for (let x = fX0; x <= fX1; x++) if (M.face[y * w + x]) { foreheadTop = y; break; }
  const bodyBox = bbox(or(M.cloth, M.neck), w, h) ?? charBox;
  const head = { cx: round1((fX0 + fX1 + 1) / 2), cy: round1((skullTop + neckY) / 2), rx: round1((fX1 - fX0 + 1) / 2), ry: round1((neckY - skullTop) / 2) };
  // brow lines: per brow, its lowest pixel and the lash's highest in each sampled column
  const browLines = [0, 1].map((s) => {
    const m = brows[s];
    if (!m) return null;
    const bb = bbox(m, w, h), lash = or(eyeParts[s].lash, eyeParts[s].opening), lb = bbox(lash, w, h);
    const xs = [], bottom = [], lid = [];
    for (let k = 0; k < 7; k++) {
      const x = Math.round(bb[0] + ((bb[2] - bb[0]) * k) / 6);
      let yb = -1; for (let y = bb[1]; y <= bb[3]; y++) if (m[y * w + x]) yb = y;
      if (yb < 0) yb = bb[3];
      const xl = Math.max(lb[0], Math.min(lb[2], x));
      let yl = -1; for (let y = lb[1]; y <= lb[3]; y++) if (lash[y * w + xl]) { yl = y; break; }
      if (yl < 0) yl = lb[1];
      xs.push(x); bottom.push(yb + 0.5); lid.push(Math.max(yb + 3, yl));
    }
    return { x: xs, bottom, lid };
  });
  let collarY;
  {
    const c = Math.round(head.cx), r = Math.round(0.1 * fw);
    let y0 = h;
    for (let x = c - r; x <= c + r; x++) for (let y = chin; y < h; y++) if (M.cloth[y * w + x]) { y0 = Math.min(y0, y); break; }
    if (y0 < h) collarY = y0;
  }
  const anchors = {
    head,
    face: [fX0, foreheadTop, fX1, chin],
    neck_y: neckY,
    ...(collarY !== undefined ? { collar_y: collarY } : {}),
    top_y: charBox[1],
    bottom_y: charBox[3],
    hair_root_y: skullTop,
    eyes: eyeParts.map((e) => e.box),
    brows: brows.map((m) => (m ? bbox(m, w, h) : null)),
    brow_lines: browLines,
    jaw: { top: Math.round(mouthC[1]), chin, half: 0, open: 0, round: 0, wide: 0 },
    chest: { cx: round1((bodyBox[0] + bodyBox[2]) / 2), cy: Math.min(h - 1, Math.round(chin + 0.6 * (h - chin))), rx: round1(0.3 * (bodyBox[2] - bodyBox[0])), ry: round1(0.12 * h) },
  };

  // ---------------------------------------------------------------- write and check
  const defs = writeLayers(layers, PKG, w, h);
  const profile = cfg.profile ?? { id: 'anime_half', facing: 'front', glasses: false };
  const outp = writePackages(OUT, PKG, { name: NAME, canvas: [w, h], profile, anchors, expressions, layers: defs }, rest, { livliv: cfg.livliv !== false, meta: cfg.meta, whole: Object.fromEntries(layers.filter((l) => l.whole).map((l) => [l.id, l.whole])) });
  let diff = 0, worst = 0; const dimg = blank(w, h), off = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const a = rest.d[4 * p + 3] / 255;
    // what shows through: the portrait's own backdrop there (it is not one flat colour)
    const u = a > 0.999 ? K.key : K.bg[p] ? [im.d[4 * p], im.d[4 * p + 1], im.d[4 * p + 2]] : K.under(p);
    const c = [0, 1, 2].map((k) => rest.d[4 * p + k] * a + u[k] * (1 - a));
    const e = Math.max(...[0, 1, 2].map((k) => Math.abs(c[k] - K.clean.d[4 * p + k])));
    if (e > 24) { diff++; off[p] = 1; }
    worst = Math.max(worst, e);
    const v = Math.min(255, e * 4); dimg.d.set([v, v, v, 255], 4 * p);
  }
  writePng(path.join(OUT, 'rest.png'), rest);
  writePng(path.join(OUT, 'rest-diff.png'), dimg);
  {
    const blob = count(and(dilate(erode(off, w, h, 1), w, h, 1), off));
    const share = diff / fgN, blobShare = blob / fgN, okRest = blobShare < 0.0005 && share < 0.01;
    check(okRest, 'rest matches the portrait', `${diff} px off by more than 24 (${(100 * share).toFixed(2)}%), ${blob} px of them in patches (${(100 * blobShare).toFixed(2)}%), worst ${Math.round(worst)}${okRest ? '' : '; look at rest-diff.png'}`);
  }
  check(!outp.errors.length, 'package', outp.errors.length ? outp.errors.join('; ') : `${defs.length} layers`);
  log('layers', defs.map((d) => `${d.id} ${d.w}x${d.h}@${d.x},${d.y}`).join(' | '));
  const ok = checks.every((c) => c.ok);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ok, package: outp.bcpuppet, livliv: outp.livliv, checks }, null, 1) + '\n');
  console.log(`${ok ? 'built' : 'built with FIX lines'} -> ${outp.bcpuppet}${outp.livliv ? ` and ${outp.livliv}` : ''}`);
  return ok ? 0 : 1;
}

/**
 * Everything round the mouth that is part of it: the map's mouth, and pixels within a twelfth of its width of it that
 * stand out from a smooth fill of the skin there (more than 14 in a channel, like the closed frame's cut: a lip
 * highlight, a lip's tint, a stroke's thin end), grown by 1 px. The fill takes the face just outside a box of the mouth
 * widened by 0.15 of its width on each side and 0.12 above and below.
 */
export function wholeMouth(im, mouth, face, mb, mw, w, h) {
  const N = w * h;
  const zone = and(box(w, h, mb[0] - 0.15 * mw, mb[1] - 0.12 * mw, mb[2] + 0.15 * mw, mb[3] + 0.12 * mw), or(face, mouth));
  const S = clone(im);
  smoothFill(S, zone, minus(face, zone), w, h);
  const near = and(dilate(mouth, w, h, Math.max(3, Math.round(mw / 12))), zone), M = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    if (!near[p]) continue;
    let m = 0;
    for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(im.d[4 * p + k] - S.d[4 * p + k]));
    if (m > 14 || mouth[p]) M[p] = 1;
  }
  return and(dilate(M, w, h, 1), zone);
}

/**
 * The part an edit drew: pixels of `im` inside `zone` that differ from `base` (what is under the part) by more than
 * o.thresh in some channel, specks dropped (o.minArea), holes filled, the edge antialiased against the base.
 * o.near / o.nearR: keep only pieces whose centre lies that close to a point.
 */
export function diffPart(im, base, zone, w, h, o = {}) {
  const N = w * h, thresh = o.thresh ?? 20;
  const featM = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    if (!zone[p]) continue;
    let m = 0;
    for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(im.d[4 * p + k] - base.d[4 * p + k]));
    if (m > thresh) featM[p] = 1;
  }
  const cc = components(featM, w, h);
  const keep = cc.comps.filter((c) => c.area >= (o.minArea ?? 20) && (!o.near || Math.hypot(c.cx - o.near[0], c.cy - o.near[1]) <= o.nearR)).map((c) => c.id);
  const core = and(fillHoles(compMask(cc.lab, keep), w, h), zone);
  const L = blank(w, h);
  for (let p = 0; p < N; p++) if (core[p]) setPx(L, p, rgb(im, p), 1);
  softEdge(L, core, im, base, { alpha: new Float32Array(N).fill(1), fg: im }, w, h, { r: 2.5, allow: zone, minSep: 10 });
  return { L, core };
}
