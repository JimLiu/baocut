// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// Eye layers from the original: the open eye with its iris removed and the whites completed, the whites' mask, and
// the full iris (incl. the part the lash hides).
import { blank, components, compMask, dilate, distTo, and, or, minus, count, bbox, grow, medianColor } from './ops.mjs';
import { ellipseCover } from './parts.mjs';
import { unmix } from './seg.mjs';

/** least-squares quadratic y = a + b x + c x^2 */
function quad(pts) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
  for (const [x, y] of pts) { const r = [1, x, x * x]; for (let i = 0; i < 3; i++) { v[i] += r[i] * y; for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j]; } }
  const A = M.map((r, i) => [...r, v[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i; for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p]] = [A[p], A[i]];
    for (let k = 0; k < 3; k++) if (k !== i) { const f = A[k][i] / A[i][i]; for (let j = i; j <= 3; j++) A[k][j] -= f * A[i][j]; }
  }
  const s = A.map((r, i) => r[3] / r[i]);
  return (x) => s[0] + s[1] * x + s[2] * x * x;
}

/**
 * One eye. src: the keyed original. C: classes. eye: from findEyes; iris: from fitIris; excl: pixels that are never
 * the eye (glasses, brows, hair). skin: the face's skin colour.
 */
export function buildEye(src, C, w, h, eye, iris, excl, skin) {
  const Wv = eye.whites;
  const [bx0, by0, bx1, by1] = eye.box;
  // per column: whites' top and bottom edge (subpixel from the coverage of the edge pixels)
  const whiteC = [252, 252, 252];
  const top = new Map(), bot = new Map();
  const gx0 = iris.cx - iris.rx - 1.5, gx1 = iris.cx + iris.rx + 1.5;
  for (let x = bx0; x <= bx1; x++) {
    let t = -1, b = -1;
    for (let y = by0; y <= by1; y++) if (Wv[y * w + x]) { if (t < 0) t = y; b = y; }
    if (t < 0 || (x > gx0 && x < gx1)) continue;
    top.set(x, t); bot.set(x, b);
  }
  // fit each edge across the iris gap from the columns beside it
  const near = (m, lo, hi) => [...m].filter(([x]) => x >= lo && x <= hi);
  const span = 1.2 * iris.rx;
  const fTop = quad(near(top, gx0 - span, gx1 + span)), fBot = quad(near(bot, gx0 - span, gx1 + span));
  // in the iris's columns the drawn eye may end on the iris itself (the iris cut by the lower lid): there the opening
  // ends where the iris meets the skin, not on the curve fitted to the whites beside it
  const gapBot = new Map();
  for (let x = Math.ceil(gx0); x <= Math.floor(gx1); x++) {
    const yc = Math.round(iris.cy);
    let y = yc, last = -1, lastW = -1;
    while (y < h - 1 && y < fBot(x) + 6) {
      const p = y * w + x;
      if (Wv[p]) lastW = y; // whites under the iris: the visible whites decide
      else if (C.dark[p] || C.fill[p] || eye.shine[p] || src.d[4 * p] < 200) { if (lastW < 0) last = y; }
      else if (C.skin[p]) break;
      y++;
    }
    const nx = (yy) => { const q = (yy + 1) * w + x; return [src.d[4 * q], src.d[4 * q + 1], src.d[4 * q + 2]]; };
    if (lastW >= 0) gapBot.set(x, lastW + 0.5 + unmix(nx(lastW), whiteC, skin));
    else if (last >= 0) gapBot.set(x, Math.min(fBot(x) + 0.5, last + 0.5 + unmix(nx(last), C.line ?? [25, 15, 14], skin)));
  }
  const yTop = (x) => (top.has(x) ? top.get(x) - 0.5 : fTop(x) - 0.5);
  const yBot = (x) => (bot.has(x) ? bot.get(x) + 0.5 : gapBot.has(x) ? gapBot.get(x) : fBot(x) + 0.5);
  // the whites, completed: visible whites, plus the columns of the iris gap between the fitted edges
  const full = new Float32Array(w * h);
  for (let x = bx0; x <= bx1; x++) {
    const inGap = x > gx0 - 1 && x < gx1 + 1;
    for (let y = by0 - 3; y <= by1 + 3; y++) {
      const p = y * w + x;
      if (Wv[p]) { full[p] = 1; continue; }
      if (!inGap) continue;
      const a = Math.min(y + 0.5 - yTop(x), yBot(x) - (y - 0.5));
      if (a > 0) full[p] = Math.min(1, a);
    }
  }
  // the iris: visible part = dark/coloured/shine pixels inside its ellipse and below the lash's lower edge
  const irisVis = new Uint8Array(w * h);
  const ix0 = Math.floor(iris.cx - iris.rx - 2), ix1 = Math.ceil(iris.cx + iris.rx + 2);
  const iy0 = Math.floor(iris.cy - iris.ry - 2), iy1 = Math.ceil(iris.cy + iris.ry + 2);
  for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
    const p = y * w + x;
    if (ellipseCover(iris, x + 0.5, y + 0.5) <= 0) continue;
    if (y + 0.5 < yTop(x) + 1 || y - 0.5 > yBot(x)) continue;
    if (C.dark[p] || C.fill[p] || eye.shine[p] || (src.d[4 * p] < 200)) irisVis[p] = 1;
  }
  const irisCol = medianColor(src, minus(irisVis, dilate(eye.shine, w, h, 2)));
  // the lash: dark pixels touching the whites from above (not glasses / brows / hair / iris)
  const cand = minus(minus(C.dark, excl), irisVis);
  const comps = components(cand, w, h);
  const touch = dilate(Uint8Array.from(full, (v) => (v > 0 ? 1 : 0)), w, h, 2);
  const ids = new Set();
  for (let p = 0; p < w * h; p++) if (touch[p] && comps.lab[p]) {
    const y = (p / w) | 0, x = p % w;
    if (y < yTop(x) + 3) ids.add(comps.lab[p]);
  }
  const lash = compMask(comps.lab, [...ids]);
  const lashCol = medianColor(src, lash);
  // eye texture: lash + completed whites; edges unmixed against skin
  const fullHard = Uint8Array.from(full, (v) => (v > 0 ? 1 : 0));
  const body = or(lash, fullHard);
  const bb = bbox(dilate(body, w, h, 3), w, h);
  const box = [bb[0], bb[1], bb[2] - bb[0] + 1, bb[3] - bb[1] + 1];
  const eyeTex = blank(box[2], box[3]), maskTex = new Uint8Array(box[2] * box[3]);
  const lashNear = dilate(lash, w, h, 2), dl = distTo(lash, w, h), dw = distTo(fullHard, w, h);
  for (let j = 0; j < box[3]; j++) for (let i = 0; i < box[2]; i++) {
    const x = box[0] + i, y = box[1] + j, p = y * w + x, t = (j * box[2] + i) * 4;
    const o = [src.d[4 * p], src.d[4 * p + 1], src.d[4 * p + 2]];
    maskTex[j * box[2] + i] = Math.round(255 * Math.max(0, Math.min(1, full[p] > 0 ? (Wv[p] ? 1 : full[p]) : 0)));
    let col, a;
    if (lash[p]) { col = o; a = 1; }
    else if (irisVis[p]) {
      // under the removed iris: white (the gap's lower edge from the fitted curve)
      col = whiteC; a = full[p] > 0 ? full[p] : 0;
      if (dl[p] < 1.5 && a > 0) { a = 1; }
    }
    // visible whites: near-white goes flat (the iris's antialiased ring would show as a seam once the iris moves)
    else if (Wv[p]) { col = Math.hypot(o[0] - whiteC[0], o[1] - whiteC[1], o[2] - whiteC[2]) < 30 ? whiteC : o; a = 1; }
    else if (full[p] > 0) { col = whiteC; a = full[p]; }
    else if (dl[p] <= 2.5 && !excl[p]) { a = unmix(o, lashCol, skin); col = lashCol; }
    else if (dw[p] <= 2.5 && !excl[p] && !C.dark[p]) { a = unmix(o, whiteC, skin); col = whiteC; }
    else { a = 0; col = [0, 0, 0]; }
    eyeTex.d[t] = col[0]; eyeTex.d[t + 1] = col[1]; eyeTex.d[t + 2] = col[2]; eyeTex.d[t + 3] = Math.round(255 * a);
  }
  // whites mask: lossless coverage; the lash pixels are excluded so the iris never covers the lash
  for (let j = 0; j < box[3]; j++) for (let i = 0; i < box[2]; i++) {
    const p = (box[1] + j) * w + box[0] + i;
    if (lash[p]) maskTex[j * box[2] + i] = 0;
  }
  // iris texture: inside the eye's opening exactly the drawn iris (its darkness over the whites, the highlight as
  // drawn), so the eye at rest is the portrait; where the lash hid it, the fitted ellipse in the iris colour
  const ib = [ix0 - 2, iy0 - 2, ix1 - ix0 + 5, iy1 - iy0 + 5];
  const irisTex = blank(ib[2], ib[3]);
  const shineNear = dilate(eye.shine, w, h, 1);
  const opening = (p) => full[p] > 0 || irisVis[p];
  for (let j = 0; j < ib[3]; j++) for (let i = 0; i < ib[2]; i++) {
    const x = ib[0] + i, y = ib[1] + j, p = y * w + x, t = (j * ib[2] + i) * 4;
    const cov = ellipseCover(iris, x + 0.5, y + 0.5);
    const o = [src.d[4 * p], src.d[4 * p + 1], src.d[4 * p + 2]];
    let col = irisCol, a = cov;
    if (opening(p) && !lash[p]) {
      if (shineNear[p] && cov > 0) { col = o; a = 1; }
      else {
        a = unmix(o, irisCol, whiteC);
        if (cov <= 0 && !irisVis[p]) a = 0; // the whites beside the iris
        if (a > 0.97) { col = o; a = 1; }
      }
    }
    if (a <= 0.01) continue;
    irisTex.d[t] = col[0]; irisTex.d[t + 1] = col[1]; irisTex.d[t + 2] = col[2]; irisTex.d[t + 3] = Math.round(255 * a);
  }
  // the lid line: the whites' fitted top/bottom at the iris centre; the eye squashes toward its middle-low point
  const cx = iris.cx;
  const lidY = yTop(Math.round(cx)) + 0.62 * (yBot(Math.round(cx)) - yTop(Math.round(cx)));
  return {
    box, tex: eyeTex, mask: maskTex, irisBox: ib, irisTex, irisCol, lashCol, lash, irisVis, full, fullHard,
    region: or(body, irisVis), pivot: [+cx.toFixed(1), +lidY.toFixed(1)], yTop, yBot,
    width: bx1 - bx0 + 1, height: Math.round(yBot(Math.round(cx)) - yTop(Math.round(cx))),
  };
}
