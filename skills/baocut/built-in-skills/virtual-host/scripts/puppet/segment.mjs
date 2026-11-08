// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// Segmenting a flat front-facing cartoon portrait (solid key background) into what each puppet layer is cut from.
import { components, compMask, dilate, erode, distTo, grow, not, and, or, minus, count, bbox, medianColor } from './ops.mjs';
import { keyOut, classes, lineColor, lineWidth, findHair, hairColor, nearColor, luma } from './seg.mjs';
import { findEyes, fitIris, fitRim, ellipseBand, ellipseCover } from './parts.mjs';
import { fillHoles } from './layers.mjs';

const boxMask = (w, h, x0, y0, x1, y1) => {
  const m = new Uint8Array(w * h);
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(h - 1, Math.ceil(y1)); y++)
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(w - 1, Math.ceil(x1)); x++) m[y * w + x] = 1;
  return m;
};
export { boxMask };

/** the pieces of an eye's whites that reach to within 3 px of its iris (all of them when none does) */
function irisWhites(e, iris, w, h) {
  const m = new Uint8Array(w * h), rx = iris.rx + 3, ry = iris.ry + 3;
  for (const c of e.pieces) {
    let at = false;
    for (let y = c.y0; y <= c.y1 && !at; y++) for (let x = c.x0; x <= c.x1 && !at; x++)
      at = e.lab[y * w + x] === c.id && ((x + 0.5 - iris.cx) / rx) ** 2 + ((y + 0.5 - iris.cy) / ry) ** 2 <= 1;
    if (at) for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (e.lab[y * w + x] === c.id) m[y * w + x] = 1;
  }
  return m.some(Boolean) ? m : e.whites;
}

// a brow spans at least this much of its eye's width, side to side
const BROW_OVER_EYE = 0.25;
// a frame's body this far from the line colour is a colour of its own, and a pixel this near it is the frame's
const FRAME_OWN_COLOUR = 28;

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
  let rims = null, glass = new Uint8Array(n), rimW = 0, ring = glass, frame = glass, frameLines = glass, glassSpots = glass, spotsOn = null;
  if (cfg.glasses !== false) {
    // a rim runs through skin round the eye: the eye's own outline and lashes (touching the whites) are not a rim
    // (the whites against the iris: a highlight along a lens's lower bar passes for a piece of the whites, and its line
    // took the bar out of the score, which fitted the rim flat along the top bar)
    const core = dilate(and(H.thick, hair), w, h, 1), score = new Float32Array(n);
    const ownLine = dilate(or(...eyes.map((e, s) => irisWhites(e, iris[s], w, h))), w, h, outline + 3);
    for (let p = 0; p < n; p++) score[p] = C.dark[p] && !core[p] && !ownLine[p] ? 1 : C.skin[p] ? -0.2 : 0;
    const fw = eyes[1].box[2] - eyes[0].box[0];
    rims = eyes.map((e) => fitRim(score, w, h, (e.box[0] + e.box[2]) / 2, (e.box[1] + e.box[3]) / 2, { rMin: Math.round(0.12 * fw), rMax: Math.round(0.4 * fw) }));
    log('rims', rims.map((r) => [r.cx, r.cy, r.rx, r.ry, +r.score.toFixed(2)]));
    if (rims.some((r) => r.score < 0.5)) { log('no glasses (rim score low)'); rims = null; }
  }
  if (rims) {
    rimW = Math.round((rimWidth(C.dark, w, h, rims[0]) + rimWidth(C.dark, w, h, rims[1])) / 2);
    const band = or(ellipseBand(rims[0], w, h, rimW / 2 + 2), ellipseBand(rims[1], w, h, rimW / 2 + 2));
    ring = and(C.dark, band);
    // the bridge: dark pixels between the rims joined to them
    const [a, b] = rims;
    const between = boxMask(w, h, a.cx + 0.6 * a.rx, Math.min(a.cy, b.cy) - Math.max(a.ry, b.ry), b.cx - 0.6 * b.rx, Math.max(a.cy, b.cy));
    const cand = minus(and(C.dark, between), hair);
    const cc = components(cand, w, h), touch = dilate(ring, w, h, 2), ids = new Set();
    for (let p = 0; p < n; p++) if (cc.lab[p] && touch[p]) ids.add(cc.lab[p]);
    glass = or(ring, compMask(cc.lab, [...ids]));
    // a rivet or a glint on the frame: a small spot, not skin, on the frame and closed round by it, the line art past
    // the rims and the hair over a hinge. Left to the face it was painted out in skin and showed as a hole at rest. A
    // catchlight in an eye that reaches the frame stays with the eye: on the glasses it would hang there when the eye shut
    spotsOn = (glass) => {
      const wall = or(or(glass, hair), C.dark), nearFrame = dilate(glass, w, h, 1);
      const eyeZone = or(...eyes.map(({ box: b }) => boxMask(w, h, b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1)));
      const shut = components(minus(fillHoles(wall, w, h), wall), w, h), spots = [];
      for (const c of shut.comps) {
        if (c.area > 2 * rimW * rimW) continue;
        let onFrame = 0, onSkin = 0, onEye = 0;
        for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
          const q = y * w + x;
          if (shut.lab[q] !== c.id) continue;
          if (nearFrame[q]) onFrame++;
          if (C.skin[q]) onSkin++;
          if (eyeZone[q]) onEye++;
        }
        if (onFrame && !onEye && onSkin < c.area / 2) spots.push(c.id);
      }
      return { m: compMask(shut.lab, spots), n: spots.length };
    };
    const sp = spotsOn(glass);
    glassSpots = sp.m;
    glass = or(glass, glassSpots);
    log('glasses', count(glass), 'rim width', rimW, 'spots on the frame', sp.n);
    // the frame's own dark line art joined to the rims (corners and hinges past the fitted ellipses)
    frame = grow(glass, minus(C.dark, hair), w, h, rimW);
    // a highlight along a lens's inner edge touches the skin seen through the lens and passed for a piece of the eye's
    // whites: the eye's box ran down to the frame, and the open eye carried the frame's edge and a white line down the
    // lens. A piece lying mostly against the frame's lines is the lens's, not the eye's
    const byFrame = dilate(frame, w, h, outline + 2);
    eyes.forEach((e, s) => {
      const own = e.pieces.filter((c) => {
        let on = 0;
        for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (e.lab[y * w + x] === c.id && byFrame[y * w + x]) on++;
        return on < c.area / 2;
      });
      if (!own.length || own.length === e.pieces.length) return;
      const keep = new Uint8Array(n);
      for (const c of own) for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (e.lab[y * w + x] === c.id) keep[y * w + x] = 1;
      e.whites = keep; e.pieces = own;
      e.box = own.reduce((b, c) => [Math.min(b[0], c.x0), Math.min(b[1], c.y0), Math.max(b[2], c.x1), Math.max(b[3], c.y1)], [w, h, -1, -1]);
      iris[s] = fitIris(e, C, w, h);
      log(`eye ${s}: lens highlights left out of the whites`, e.box);
    });
  }

  // brows: the big strokes above the eyes, in the line colour or a colour of their own (brown brows are a fill)
  const eyeTop = Math.min(eyes[0].box[1], eyes[1].box[1]), eyeBot = Math.max(eyes[0].box[3], eyes[1].box[3]);
  const eyeH = eyeBot - eyeTop;
  const notHair = minus(minus(C.dark, hair), glass);
  const dc = components(notHair, w, h);
  // the frame's line art is not brow: a brow resting on the frame took a corner of it along. A brow in a colour of its
  // own stays whole; one in the line colour loses the rows that touch the frame, and one with a gap above the frame is
  // not reached
  const bc = components(minus(minus(or(C.dark, C.fill), hair), frame), w, h);
  const midX = (eyes[0].box[2] + eyes[1].box[0]) / 2;
  // a brow lies over its own eye: a dark piece of the hair or the temple beside the eye, however big, is not one
  const overEye = (c, s) => { const e = eyes[s].box; return Math.min(c.x1, e[2]) - Math.max(c.x0, e[0]) >= BROW_OVER_EYE * (e[2] - e[0]); };
  const browLike = (c, s) => c.area > 150 && c.cy < eyeTop && c.cy > eyeTop - 2.5 * eyeH && (s ? c.cx > midX : c.cx < midX) && c.x1 - c.x0 < 0.6 * (eyes[1].box[2] - eyes[0].box[0]) && overEye(c, s);
  const offHair = [0, 1].map((s) => bc.comps.filter((c) => browLike(c, s)).sort((p, q) => q.area - p.area)[0]);
  const browComps = [...offHair];
  // brows drawn over the bangs: a side with none off the hair takes a dark stroke inside the hair (when the hair has a
  // colour of its own) that is cut off from the hair's own lines, all round it hair, with a brow's place and shape.
  // They stay in the hair mask too (the bald repaint goes under them)
  const browOnHair = new Uint8Array(n);
  if (hairRGB && Math.hypot(hairRGB[0] - line[0], hairRGB[1] - line[1], hairRGB[2] - line[2]) >= 40 && !browComps.every(Boolean)) {
    const inHair = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (!hair[p] || glass[p] || K.alpha[p] < 0.5) continue;
      const r = K.fg.d[4 * p], g = K.fg.d[4 * p + 1], b = K.fg.d[4 * p + 2];
      if (luma(r, g, b) < 100 && Math.hypot(r - hairRGB[0], g - hairRGB[1], b - hairRGB[2]) >= 40) inHair[p] = 1;
    }
    const hc = components(inHair, w, h);
    const enclosed = (c) => {
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
        if (hc.lab[y * w + x] !== c.id) continue;
        for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = x + i, Y = y + j;
          if (X < 0 || Y < 0 || X >= w || Y >= h) return false;
          const q = Y * w + X;
          if (hc.lab[q] !== c.id && !hair[q]) return false;
        }
      }
      return true;
    };
    for (const s of [0, 1]) {
      if (browComps[s]) continue;
      const c = hc.comps.filter((c) => browLike(c, s) && c.x1 - c.x0 >= 2 * (c.y1 - c.y0) && enclosed(c)).sort((p, q) => q.area - p.area)[0];
      if (!c) continue;
      browComps[s] = c;
      for (let p = 0; p < n; p++) if (hc.lab[p] === c.id) browOnHair[p] = 1;
    }
  }
  const brows = or(compMask(bc.lab, offHair.filter(Boolean).map((c) => c.id)), browOnHair);
  log('brows', browComps.map((c) => c && [c.x0, c.y0, c.x1, c.y1]), 'on the bangs', count(browOnHair));

  if (rims) {
    // the lens side, once the brows are known: a brow is dark too (a brown one a dark fill, like a navy frame), and one
    // resting on the frame's top was followed into the glasses: it stayed on the face when an expression redrew it
    const browOff = dilate(brows, w, h, 2);
    // the fitted ellipses miss a frame that is not one (a rounded square, a corner cut on a slant): its inner side ran
    // inside the band, was left to the face, and a turn split the frame in two along the lens. On the lens side of each
    // rim the frame's lines are followed round from the band, all the way along, through a ring four rim widths deep (a
    // rounded square's side lay over three rim widths inside its ellipse, and a reach counted from the band stopped
    // halfway down it), with the lens's highlights against them; past the rims the lines run on into the face's outline
    // at the hinges and stay the face's. Not the eyes' own lines where they run into the frame
    const lens = new Uint8Array(n), lensSide = new Uint8Array(n);
    for (const r of rims) {
      const e = { cx: r.cx, cy: r.cy, rx: r.rx + rimW / 2 + 2, ry: r.ry + rimW / 2 + 2 };
      const inner = { cx: r.cx, cy: r.cy, rx: r.rx - 4 * rimW, ry: r.ry - 4 * rimW };
      for (let y = Math.max(0, Math.floor(e.cy - e.ry)); y <= Math.min(h - 1, e.cy + e.ry); y++)
        for (let x = Math.max(0, Math.floor(e.cx - e.rx)); x <= Math.min(w - 1, e.cx + e.rx); x++) {
          if (ellipseCover(e, x + 0.5, y + 0.5) < 0.5) continue;
          lens[y * w + x] = 1;
          if (inner.rx <= 0 || inner.ry <= 0 || ellipseCover(inner, x + 0.5, y + 0.5) < 0.5) lensSide[y * w + x] = 1;
        }
    }
    const eyeBoxes = or(...eyes.map(({ box: b }) => boxMask(w, h, b[0] - outline - 3, b[1] - outline - 3, b[2] + outline + 3, b[3] + outline + 3)));
    // the frame's dark: a coloured frame's own shade (a navy) is a dark fill, not line colour; left out, its pixels were
    // holes in the glasses over a face painted skin round them
    const deep = Uint8Array.from({ length: n }, (_, p) => (C.dark[p] || (C.fill[p] && luma(K.fg.d[4 * p], K.fg.d[4 * p + 1], K.fg.d[4 * p + 2]) < 100) ? 1 : 0));
    const eyeWhites = or(eyes[0].whites, eyes[1].whites), lineArt = minus(minus(deep, hair), dilate(eyeWhites, w, h, outline + 3));
    const lines = grow(glass, minus(minus(and(lineArt, lensSide), eyeBoxes), browOff), w, h), byLines = dilate(lines, w, h, outline + 2);
    const LW = components(and(and(C.white, lens), not(eyeWhites)), w, h), glints = [];
    for (const c of LW.comps) {
      let on = 0;
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (LW.lab[y * w + x] === c.id && byLines[y * w + x]) on++;
      if (on >= c.area / 2) glints.push(c.id);
    }
    // the spots and highlights keep their own colour on the glasses: they are not the frame's line colour mixed with skin
    glassSpots = or(glassSpots, compMask(LW.lab, glints));
    const lensGlass = or(lines, glassSpots);
    log('glasses: on the lens side', count(minus(lensGlass, glass)), 'px of frame lines and', glints.length, 'highlights');
    glass = or(glass, lensGlass);
    // and its outer corners: a square frame's corners stand further off its ellipse than the band reaches, and left to
    // the face they stayed behind as dark wedges when a turn moved the glasses. Its dark past the band but inside the
    // ellipse's box, joined to the glasses (the arms past the box run on into the face's outline and stay the face's)
    const cornerZone = new Uint8Array(n);
    for (const r of rims) {
      const b = rimW / 2 + 2;
      for (let y = Math.max(0, Math.floor(r.cy - r.ry - b)); y <= Math.min(h - 1, r.cy + r.ry + b); y++)
        for (let x = Math.max(0, Math.floor(r.cx - r.rx - b)); x <= Math.min(w - 1, r.cx + r.rx + b); x++) if (!lens[y * w + x]) cornerZone[y * w + x] = 1;
    }
    const corners = minus(grow(glass, minus(minus(and(deep, cornerZone), hair), browOff), w, h), glass);
    glass = or(glass, corners);
    // and its end pieces out to the hinges: they run on past the box (a wide frame's, with its rivet, two rim widths
    // past it), and a rim fitted close to the frame left them to the face, cut off in a straight line. A frame in a
    // colour of its own (a navy, a tortoiseshell) is followed through that colour, with its outline, as far as half a
    // lens's width (a hinge is long beside a thin frame); one drawn in the line colour stops at the box, where its arms
    // run on into the face's outline. An end piece against the hair at the temple was taken into the hair (it is dark
    // and joined to it): a turn moved it with the hair, apart from the rest of the frame. Its own colour is taken back
    // from the hair, a pixel at a time, when it is much nearer the frame than the hair's colour (a navy fringe beside a
    // navy frame stays hair)
    const body = medianColor(K.fg, ring), near = (p, c) => Math.hypot(K.fg.d[4 * p] - c[0], K.fg.d[4 * p + 1] - c[1], K.fg.d[4 * p + 2] - c[2]);
    let ends = new Uint8Array(n);
    if (Math.hypot(body[0] - line[0], body[1] - line[1], body[2] - line[2]) >= FRAME_OWN_COLOUR) {
      const own = new Uint8Array(n), open = minus(minus(deep, browOff), lens);
      for (let p = 0; p < n; p++) {
        if (!open[p] || near(p, body) >= FRAME_OWN_COLOUR || near(p, body) >= near(p, line)) continue;
        if (!hair[p] || (hairRGB && 2 * near(p, body) < near(p, hairRGB))) own[p] = 1;
      }
      const pieces = minus(grow(glass, own, w, h, Math.max(4 * rimW, ...rims.map((r) => r.rx))), glass);
      ends = or(pieces, minus(grow(pieces, and(open, dilate(pieces, w, h, outline + 1)), w, h), glass));
      glass = or(glass, ends);
      for (let p = 0; p < n; p++) if (ends[p]) hair[p] = 0;
    }
    // and the spots they close round or come next to (a rivet on a hinge): unmixed as the frame over skin it came out
    // a muddy brown, over a face painted skin under it
    const more = minus(spotsOn(glass).m, glass);
    glassSpots = or(glassSpots, more);
    glass = or(glass, more);
    log('glasses: outer corners', count(corners), 'px, end pieces', count(ends), 'px and', count(more), 'px of spots by them');
    // the frame's lines out to a rim width past the glasses, for the closed lids and the redrawn brows
    frameLines = grow(glass, minus(lineArt, browOff), w, h, rimW);
  }

  // face skin: the skin component under the left eye's rim (cheek); the chin is its lowest row. The first sizeable
  // skin down the iris's column from a little under the rim: a rim fitted close to the frame put that point on the
  // cheek's shade under the lens
  const S = components(C.skin, w, h), big = Math.max(...S.comps.map((c) => c.area)) / 10, cx = Math.round(iris[0].cx);
  const cheekY = Math.round((rims ? rims[0].cy + rims[0].ry : eyes[0].box[3]) + 0.3 * eyeH);
  let cheek = 0;
  for (let y = cheekY; y < Math.min(h, cheekY + eyeH) && !cheek; y++) {
    const id = S.lab[y * w + cx];
    if (id && S.comps.find((c) => c.id === id).area >= big) cheek = id;
  }
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
  // a highlight on the face (lighter than the skin, in its warm hue: a fill or a white of its own) joined to the head's
  // skin is the head's: one along the face's edge was left to the body with the jaw line beyond it, and a turn showed
  // the backdrop through the face and a stripe of it left behind
  const light = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (!C.fill[p] && !C.white[p]) continue;
    const r = K.fg.d[4 * p], g = K.fg.d[4 * p + 1], b = K.fg.d[4 * p + 2];
    if (r >= skin[0] - 22 && g >= skin[1] - 26 && b >= skin[2] - 28 && r >= g && g >= b - 6) light[p] = 1;
  }
  const LC = components(light, w, h), onSkin = dilate(headSkin, w, h, 2);
  const headLight = compMask(LC.lab, LC.comps.filter((c) => {
    if (c.y1 > chinSkin + 2 || c.area <= 20) return false;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (LC.lab[y * w + x] === c.id && onSkin[y * w + x]) return true;
    return false;
  }).map((c) => c.id));
  const headFill = or(or(headSkin, headShade), headLight);
  const near = dilate(headFill, w, h, lw + 2);
  // flat fills (clothes) are body, not the head's outline: their solid parts, without the thin antialiased rings
  const solidFill = grow(erode(C.fill, w, h, 2), C.fill, w, h, 3);
  const strayWhite = minus(C.white, dilate(or(eyes[0].whites, eyes[1].whites), w, h, 4));
  const notBody = not(or(or(neckSkin, neckShadow), or(solidFill, strayWhite)));
  let head = or(headFill, and(and(near, char), and(notBody, not(C.skin))));
  // an outline drawn heavier than the jaw's (an ear's) reaches past that: its outer rim, left to the body, stayed
  // behind as a second line when the head turned. The head takes the line art round it out to twice the jaw's line,
  // above the chin and away from the neck and the clothes
  {
    const fromFill = distTo(headFill, w, h), bodyNear = dilate(or(or(neckSkin, neckShadow), or(solidFill, strayWhite)), w, h, lw + 2);
    const rim = Uint8Array.from({ length: n }, (_, p) => (char[p] && !C.skin[p] && !hair[p] && notBody[p] && !bodyNear[p] && fromFill[p] <= 2 * lw + 4 && p < (chinSkin + 1) * w ? 1 : 0));
    head = or(head, grow(head, rim, w, h, lw + 4));
  }
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

  return { w, h, K, skin, line, hairRGB, hairMask, C, char, charBox, H, hair, hairBox, eyes, iris, rims, rimW, glass, glassSpots, frameLines, brows, browComps, browOnHair, mouth, mouthComp: mc,
    faceComp, chin, chinSkin, lw, headSkin, headShade, neckSkin, neckShadow, head, neck, eyeTop, eyeBot };
}
