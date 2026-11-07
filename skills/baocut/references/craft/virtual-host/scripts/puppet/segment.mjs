// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// Segmenting a flat front-facing cartoon portrait (solid key background) into what each puppet layer is cut from.
import { components, compMask, dilate, erode, distTo, grow, not, and, or, minus, count, bbox, medianColor } from './ops.mjs';
import { keyOut, classes, lineColor, lineWidth, findHair, hairColor, nearColor, luma } from './seg.mjs';
import { findEyes, fitIris, fitRim, ellipseBand } from './parts.mjs';
import { fillHoles } from './layers.mjs';

const boxMask = (w, h, x0, y0, x1, y1) => {
  const m = new Uint8Array(w * h);
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(h - 1, Math.ceil(y1)); y++)
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(w - 1, Math.ceil(x1)); x++) m[y * w + x] = 1;
  return m;
};
export { boxMask };

/** the skin colour: the commonest light warm colour in the middle of the character */
export function estimateSkin(K, w, h) {
  const hist = new Map();
  for (let y = Math.floor(0.25 * h); y < 0.75 * h; y += 2) for (let x = Math.floor(0.3 * w); x < 0.7 * w; x += 2) {
    const p = y * w + x; if (K.alpha[p] < 0.99) continue;
    const r = K.fg.d[4 * p], g = K.fg.d[4 * p + 1], b = K.fg.d[4 * p + 2];
    if (!(r > 170 && r >= g && g >= b && r - b > 40 && luma(r, g, b) > 150)) continue;
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  if (!hist.size) throw new Error('no light warm skin colour found in the middle of the portrait: set "skin": [r, g, b] in the config');
  const [k] = [...hist].sort((a, b) => b[1] - a[1])[0];
  return [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4];
}

/** median width of a dark line crossing an ellipse, measured along the normal at n points */
function rimWidth(dark, w, h, e, n = 64) {
  const ws = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n, x = e.cx + e.rx * Math.cos(t), y = e.cy + e.ry * Math.sin(t);
    let nx = Math.cos(t) / e.rx, ny = Math.sin(t) / e.ry; const l = Math.hypot(nx, ny); nx /= l; ny /= l;
    const on = (s) => { const X = Math.round(x + nx * s), Y = Math.round(y + ny * s); return X >= 0 && Y >= 0 && X < w && Y < h && dark[Y * w + X]; };
    if (!on(0)) continue;
    let a = 0, b = 0; while (a < 15 && on(-a - 1)) a++; while (b < 15 && on(b + 1)) b++;
    if (a < 15 && b < 15) ws.push(a + b + 1);
  }
  ws.sort((p, q) => p - q);
  return ws[ws.length >> 1] ?? 6;
}

export function segment(im, cfg = {}) {
  const { w, h } = im, n = w * h, log = cfg.log ?? (() => {});
  const K = keyOut(im);
  const skin = cfg.skin ?? estimateSkin(K, w, h);
  const line = cfg.line ?? lineColor(K, w, h);
  const C = classes(K.fg, K.alpha, skin, line);
  const char = Uint8Array.from(K.alpha, (a) => (a > 0.02 ? 1 : 0));
  const charBox = bbox(char, w, h);
  if (!charBox) throw new Error('the portrait is all background: it needs one character on a solid key colour');
  // hair: the thick mass on top (dark, or the hair's own colour with its lines), grown back over the strand ends
  const hairRGB = cfg.hair !== undefined ? cfg.hair : hairColor(K.fg, K.alpha, C, w, h);
  const hairMask = hairRGB ? or(C.dark, minus(nearColor(K.fg, K.alpha, hairRGB, cfg.hairTolerance ?? 60), C.skin)) : C.dark;
  log('key', K.key, 'skin', skin, 'line', line, 'hair colour', hairRGB ?? 'line colour');
  // the hair's core is thicker than any outline: a thick outline joined to the hair is not hair
  const outline = lineWidth(C.dark, K.bg, w, h);
  const H = findHair(hairMask, w, h, { thick: Math.max(4, Math.floor(outline / 2) + 2), reach: cfg.hairReach ?? 8, top: charBox[1] });
  const hair = H.hair, hairBox = bbox(hair, w, h);
  if (!hairBox) throw new Error('no hair found on top of the head (a bald character is not supported yet)');
  log('outline', outline, 'px; hair', count(hair), hairBox);

  // eyes and irises
  const eyes = findEyes(C, w, h, hairBox);
  const iris = eyes.map((e) => fitIris(e, C, w, h));
  log('eyes', eyes.map((e) => e.box), 'iris', iris.map((i) => [i.cx, i.cy, i.rx, i.ry].map((v) => +v.toFixed(1))));

  // glasses: a dark ellipse round each eye, not the hair's thick mass
  let rims = null, glass = new Uint8Array(n), rimW = 0;
  if (cfg.glasses !== false) {
    // a rim runs through skin round the eye: the eye's own outline and lashes (touching the whites) are not a rim
    const core = dilate(and(H.thick, hair), w, h, 1), score = new Float32Array(n);
    const ownLine = dilate(or(eyes[0].whites, eyes[1].whites), w, h, outline + 3);
    for (let p = 0; p < n; p++) score[p] = C.dark[p] && !core[p] && !ownLine[p] ? 1 : C.skin[p] ? -0.2 : 0;
    const fw = eyes[1].box[2] - eyes[0].box[0];
    rims = eyes.map((e) => fitRim(score, w, h, (e.box[0] + e.box[2]) / 2, (e.box[1] + e.box[3]) / 2, { rMin: Math.round(0.12 * fw), rMax: Math.round(0.4 * fw) }));
    log('rims', rims.map((r) => [r.cx, r.cy, r.rx, r.ry, +r.score.toFixed(2)]));
    if (rims.some((r) => r.score < 0.5)) { log('no glasses (rim score low)'); rims = null; }
  }
  if (rims) {
    rimW = Math.round((rimWidth(C.dark, w, h, rims[0]) + rimWidth(C.dark, w, h, rims[1])) / 2);
    const band = or(ellipseBand(rims[0], w, h, rimW / 2 + 2), ellipseBand(rims[1], w, h, rimW / 2 + 2));
    const ring = and(C.dark, band);
    // the bridge: dark pixels between the rims joined to them
    const [a, b] = rims;
    const between = boxMask(w, h, a.cx + 0.6 * a.rx, Math.min(a.cy, b.cy) - Math.max(a.ry, b.ry), b.cx - 0.6 * b.rx, Math.max(a.cy, b.cy));
    const cand = minus(and(C.dark, between), hair);
    const cc = components(cand, w, h), touch = dilate(ring, w, h, 2), ids = new Set();
    for (let p = 0; p < n; p++) if (cc.lab[p] && touch[p]) ids.add(cc.lab[p]);
    glass = or(ring, compMask(cc.lab, [...ids]));
    log('glasses', count(glass), 'rim width', rimW);
  }

  // brows: the big strokes above the eyes, in the line colour or a colour of their own (brown brows are a fill)
  const eyeTop = Math.min(eyes[0].box[1], eyes[1].box[1]), eyeBot = Math.max(eyes[0].box[3], eyes[1].box[3]);
  const eyeH = eyeBot - eyeTop;
  const notHair = minus(minus(C.dark, hair), glass);
  const dc = components(notHair, w, h);
  const bc = components(minus(minus(or(C.dark, C.fill), hair), glass), w, h);
  const midX = (eyes[0].box[2] + eyes[1].box[0]) / 2;
  const browComps = [0, 1].map((s) => bc.comps
    .filter((c) => c.area > 150 && c.cy < eyeTop && c.cy > eyeTop - 2.5 * eyeH && (s ? c.cx > midX : c.cx < midX) && c.x1 - c.x0 < 0.6 * (eyes[1].box[2] - eyes[0].box[0]))
    .sort((p, q) => q.area - p.area)[0]);
  const brows = compMask(bc.lab, browComps.filter(Boolean).map((c) => c.id));
  log('brows', browComps.map((c) => c && [c.x0, c.y0, c.x1, c.y1]));

  // face skin: the skin component under the left eye's rim (cheek); the chin is its lowest row
  const S = components(C.skin, w, h);
  const cheekY = Math.round((rims ? rims[0].cy + rims[0].ry : eyes[0].box[3]) + 0.3 * eyeH);
  const cheek = S.lab[cheekY * w + Math.round(iris[0].cx)];
  if (!cheek) throw new Error(`no face skin under the left eye at (${Math.round(iris[0].cx)}, ${cheekY}): the cheek must be bare skin (no hair, hands or shading across it)`);
  const faceComp = S.comps.find((c) => c.id === cheek);
  const chinSkin = faceComp.y1;
  const headSkinIds = S.comps.filter((c) => c.y1 <= chinSkin + 2 && c.area > 20).map((c) => c.id);
  const headSkin = compMask(S.lab, headSkinIds);
  const neckSkin = compMask(S.lab, S.comps.filter((c) => c.y1 > chinSkin + 2 && c.cy > chinSkin - 0.1 * h && c.area > 500).map((c) => c.id));
  // shades: inside the head (nose, ears) or under the chin (the jaw's shadow on the neck)
  const SH = components(C.shade, w, h);
  const headShade = compMask(SH.lab, SH.comps.filter((c) => c.y1 <= chinSkin && c.area > 20).map((c) => c.id));
  const neckNear = dilate(neckSkin, w, h, 3);
  const nsIds = SH.comps.filter((c) => c.y1 > chinSkin && c.area > 200).filter((c) => {
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (SH.lab[y * w + x] === c.id && neckNear[y * w + x]) return true;
    return false;
  }).map((c) => c.id);
  const neckShadow = compMask(SH.lab, nsIds);
  log('face comp', [faceComp.x0, faceComp.y0, faceComp.x1, faceComp.y1], 'neck skin', bbox(neckSkin, w, h), 'neck shadow', bbox(neckShadow, w, h));

  // line weight of the outline: the dark run below the chin's lowest skin pixel
  let lw = 0; { const x = Math.round((faceComp.x0 + faceComp.x1) / 2); let y = chinSkin + 1; while (y < h && C.dark[y * w + x]) { lw++; y++; } lw = Math.max(3, Math.min(14, lw || 6)); }
  const chin = chinSkin + lw;

  // mouth: the dark stroke between the eyes and the chin, near the middle, with face skin below it (a piece of the
  // chin's outline, cut off by the hair, ends on the chin's lowest skin row or below)
  const mc = dc.comps.filter((c) => c.cy > eyeBot + 0.5 * eyeH && c.y1 < chinSkin - 2 && Math.abs(c.cx - midX) < 0.12 * w && c.area > 60 && c.x1 - c.x0 < 0.6 * (faceComp.x1 - faceComp.x0))
    .sort((p, q) => q.area - p.area)[0];
  if (!mc) throw new Error('no closed mouth line found between the eyes and the chin');
  const mouth = compMask(dc.lab, [mc.id]);
  log('mouth', mc && [mc.x0, mc.y0, mc.x1, mc.y1]);

  // the head: its skin and shades, the lines round them, and what they enclose (eyes, glasses, brows, mouth)
  const headFill = or(headSkin, headShade);
  const near = dilate(headFill, w, h, lw + 2);
  // flat fills (clothes) are body, not the head's outline: their solid parts, without the thin antialiased rings
  const solidFill = grow(erode(C.fill, w, h, 2), C.fill, w, h, 3);
  const notBody = not(or(or(neckSkin, neckShadow), or(solidFill, minus(C.white, dilate(or(eyes[0].whites, eyes[1].whites), w, h, 4)))));
  let head = or(headFill, and(and(near, char), and(notBody, not(C.skin))));
  const eyeReg = or(eyes[0].whites, eyes[1].whites);
  head = or(head, or(or(eyeReg, brows), or(glass, mouth)));
  head = fillHoles(and(head, not(hair)), w, h); // the hair is cut from its own layer; the bald repaint fills under it
  head = or(head, and(and(fillHoles(or(head, hair), w, h), char), minus(not(hair), or(neckSkin, neckShadow)))); // holes the hair closes

  // the neck outlines: per row below the head, the edges of the neck fill (skin + shadow) and the dark run beyond
  const neckFill = or(neckSkin, neckShadow);
  const nb = bbox(neckFill, w, h);
  const rows = [];
  const span = (y) => { let xl = -1, xr = -1; for (let x = 0; x < w; x++) if (neckFill[y * w + x]) { if (xl < 0) xl = x; xr = x; } return [xl, xr]; };
  // rows where the fill already spans the neck (above, the jaw line still cuts in)
  const ref = nb ? span(Math.min(h - 1, nb[1] + Math.round(0.04 * h))) : null;
  let y0 = nb ? nb[1] : 0;
  if (nb) while (y0 < nb[3]) { const [a, b] = span(y0); if (a >= 0 && b - a >= ref[1] - ref[0] - 2 * lw) break; y0++; }
  if (nb) for (let y = y0; y < Math.min(h, y0 + Math.round(0.03 * h)); y++) {
    const [xl, xr] = span(y);
    if (xl < 0) continue;
    // the dark run beyond each edge (an antialiased pixel or two may sit between)
    let gl = 1; while (gl <= 3 && xl - gl >= 0 && !C.dark[y * w + xl - gl]) gl++;
    let a = 0; while (xl - gl - a >= 0 && C.dark[y * w + xl - gl - a]) a++;
    let gr = 1; while (gr <= 3 && xr + gr < w && !C.dark[y * w + xr + gr]) gr++;
    let b = 0; while (xr + gr + b < w && C.dark[y * w + xr + gr + b]) b++;
    if (a >= 2 && b >= 2 && a < 2 * lw && b < 2 * lw) rows.push({ y, l: xl - gl - a / 2 + 0.5, r: xr + gr + b / 2 - 0.5, lw: (a + b) / 2 + 1 });
  }
  const fit = (k) => { // x = p + q*y least squares
    const m = rows.length, sy = rows.reduce((s, r) => s + r.y, 0), sx = rows.reduce((s, r) => s + r[k], 0);
    const syy = rows.reduce((s, r) => s + r.y * r.y, 0), sxy = rows.reduce((s, r) => s + r.y * r[k], 0);
    const q = (m * sxy - sy * sx) / (m * syy - sy * sy || 1), p = (sx - q * sy) / m; return (y) => p + q * y;
  };
  const neck = rows.length > 5 ? { top: y0, fillTop: nb[1], left: fit('l'), right: fit('r'), lw: rows.reduce((s, r) => s + r.lw, 0) / rows.length } : null;
  log('neck', neck && { top: neck.top, l: +neck.left(neck.top).toFixed(1), r: +neck.right(neck.top).toFixed(1), lw: +neck.lw.toFixed(1) });

  return { w, h, K, skin, line, hairRGB, hairMask, C, char, charBox, H, hair, hairBox, eyes, iris, rims, rimW, glass, brows, browComps, mouth, mouthComp: mc,
    faceComp, chin, chinSkin, lw, headSkin, headShade, neckSkin, neckShadow, head, neck, eyeTop, eyeBot };
}
