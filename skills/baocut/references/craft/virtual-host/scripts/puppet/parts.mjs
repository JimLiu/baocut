// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// Finding the parts of a front-facing flat cartoon portrait: eyes (whites, iris, lash), brows, glasses, mouth.
import { components, compMask, dilate, distTo, not, and, or, minus, count, bbox, grow } from './ops.mjs';

/** eye whites: white components in the upper part of the face, clustered into two eyes (image left first). A white
 *  component enclosed by dark on all sides (no skin near) is an iris highlight */
export function findEyes(C, w, h, hairBox) {
  const W = components(C.white, w, h);
  const cand = W.comps.filter((c) => c.area > 40 && c.cy > hairBox[1] && c.cy < hairBox[3] + 0.15 * h);
  const skinNear = dilate(C.skin, w, h, 3);
  const whites = [], shines = [];
  for (const c of cand) {
    let touch = 0;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (W.lab[y * w + x] === c.id && skinNear[y * w + x]) touch++;
    (touch > 0 ? whites : shines).push(c);
  }
  whites.sort((a, b) => b.area - a.area);
  const mid = (hairBox[0] + hairBox[2]) / 2;
  const side = (c) => (c.cx < mid ? 0 : 1);
  const eyes = [0, 1].map((s) => {
    const ws = whites.filter((c) => side(c) === s && c.area > 0.08 * whites[0].area);
    const sh = shines.filter((c) => side(c) === s);
    const box = ws.reduce((b, c) => [Math.min(b[0], c.x0), Math.min(b[1], c.y0), Math.max(b[2], c.x1), Math.max(b[3], c.y1)], [w, h, -1, -1]);
    return { whites: compMask(W.lab, ws.map((c) => c.id)), shine: compMask(W.lab, sh.map((c) => c.id)), box, pieces: ws };
  });
  if (eyes.some((e) => !e.pieces.length)) throw new Error('did not find two open eyes with white eyeballs next to skin (the portrait needs both eyes open, whites showing)');
  return eyes;
}

/**
 * The iris of one eye from its whites: per row, the whites' left piece ends and the right piece starts; the gap
 * between them (dark or a colour fill) (inside the whites' outer extent) is the iris. Fit an axis-aligned ellipse to the gap's edge points
 * (rows where both edges are white: the sides), with its bottom where the gap meets skin.
 */
export function fitIris(eye, C, w, h) {
  const [x0, y0, x1, y1] = eye.box;
  const pts = [];
  const rows = [];
  for (let y = y0; y <= y1; y++) {
    // white runs in this row
    const runs = []; let x = x0;
    while (x <= x1) {
      if (!eye.whites[y * w + x]) { x++; continue; }
      const s = x; while (x <= x1 && eye.whites[y * w + x]) x++;
      runs.push([s, x - 1]);
    }
    rows.push({ y, runs });
    // the widest dark gap between two white runs
    let best = null;
    for (let i = 0; i + 1 < runs.length; i++) {
      const g0 = runs[i][1] + 1, g1 = runs[i + 1][0] - 1;
      if (g1 - g0 < 4) continue;
      // the iris is the line colour or a colour of its own (brown, blue: the fill class)
      let dark = 0; for (let X = g0; X <= g1; X++) dark += C.dark[y * w + X] || C.fill[y * w + X] || eye.shine[y * w + X] ? 1 : 0;
      if (dark < 0.8 * (g1 - g0 + 1)) continue;
      if (!best || g1 - g0 > best[1] - best[0]) best = [g0, g1];
    }
    if (best) { pts.push([best[0] - 0.5, y]); pts.push([best[1] + 0.5, y]); }
  }
  if (pts.length < 10) throw new Error('no iris found between the eye whites (each eye needs a visible iris with white on both sides)');
  // axis-aligned ellipse: A x^2 + B y^2 + C x + D y = 1 (least squares)
  const M = Array.from({ length: 4 }, () => new Float64Array(4)), v = new Float64Array(4);
  for (const [x, y] of pts) {
    const r = [x * x, y * y, x, y];
    for (let i = 0; i < 4; i++) { v[i] += r[i]; for (let j = 0; j < 4; j++) M[i][j] += r[i] * r[j]; }
  }
  const s = solve(M, v);
  const cx = -s[2] / (2 * s[0]), cy = -s[3] / (2 * s[1]);
  const F = 1 + s[0] * cx * cx + s[1] * cy * cy;
  let rx = Math.sqrt(F / s[0]), ry = Math.sqrt(F / s[1]);
  // a tall ellipse from short side arcs can blow up: keep it no rounder than a circle-ish iris and no taller than 1.6x wide
  if (!(ry > 0) || ry > 1.6 * rx) ry = 1.25 * rx;
  // bottom: the lowest dark pixel in the iris column above the skin
  return { cx, cy, rx, ry, pts };
}

function solve(M, v) {
  const n = v.length, A = M.map((r, i) => [...r, v[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p]] = [A[p], A[i]];
    for (let k = 0; k < n; k++) if (k !== i) { const f = A[k][i] / A[i][i]; for (let j = i; j <= n; j++) A[k][j] -= f * A[i][j]; }
  }
  return A.map((r, i) => r[n] / r[i]);
}

/** search an axis-aligned ellipse that runs along dark pixels (a glasses rim) round centre (cx, cy) */
export function fitRim(score, w, h, cx, cy, o = {}) {
  const N = 160, cs = [], sn = [];
  for (let k = 0; k < N; k++) { cs.push(Math.cos((2 * Math.PI * k) / N)); sn.push(Math.sin((2 * Math.PI * k) / N)); }
  const S = (ex, ey, rx, ry) => {
    let s = 0;
    for (let k = 0; k < N; k++) {
      const x = Math.round(ex + rx * cs[k]), y = Math.round(ey + ry * sn[k]);
      if (x >= 0 && y >= 0 && x < w && y < h) s += score[y * w + x];
    }
    return s / N;
  };
  const rMin = o.rMin ?? 40, rMax = o.rMax ?? 110, span = o.span ?? 30;
  let best = { s: -1 };
  for (let ey = cy - span; ey <= cy + span; ey += 3) for (let ex = cx - span; ex <= cx + span; ex += 3)
    for (let rx = rMin; rx <= rMax; rx += 3) for (let ry = rMin; ry <= rMax; ry += 3) {
      const s = S(ex, ey, rx, ry);
      if (s > best.s) best = { s, ex, ey, rx, ry };
    }
  for (let it = 0; it < 3; it++) {
    const b = best;
    for (let ey = b.ey - 2; ey <= b.ey + 2; ey += 0.5) for (let ex = b.ex - 2; ex <= b.ex + 2; ex += 0.5)
      for (let rx = b.rx - 2; rx <= b.rx + 2; rx += 0.5) for (let ry = b.ry - 2; ry <= b.ry + 2; ry += 0.5) {
        const s = S(ex, ey, rx, ry);
        if (s > best.s) best = { s, ex, ey, rx, ry };
      }
  }
  return { cx: best.ex, cy: best.ey, rx: best.rx, ry: best.ry, score: best.s };
}

/** pixels within `band` of an axis-aligned ellipse's curve (approximate distance) */
export function ellipseBand(e, w, h, band) {
  const m = new Uint8Array(w * h);
  const x0 = Math.max(0, Math.floor(e.cx - e.rx - band - 1)), x1 = Math.min(w - 1, Math.ceil(e.cx + e.rx + band + 1));
  const y0 = Math.max(0, Math.floor(e.cy - e.ry - band - 1)), y1 = Math.min(h - 1, Math.ceil(e.cy + e.ry + band + 1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = (x - e.cx) / e.rx, dy = (y - e.cy) / e.ry, r = Math.hypot(dx, dy);
    if (r < 1e-6) continue;
    // radial distance scaled by the local radius
    const rad = Math.hypot((dx / r) * e.rx, (dy / r) * e.ry);
    if (Math.abs(r - 1) * rad <= band) m[y * w + x] = 1;
  }
  return m;
}

/** signed "inside" of an ellipse with an antialiased edge: coverage 0..1 at (x, y) (pixel centre) */
export function ellipseCover(e, x, y) {
  const dx = (x - e.cx) / e.rx, dy = (y - e.cy) / e.ry, r = Math.hypot(dx, dy);
  const rad = r > 1e-6 ? Math.hypot((dx / r) * e.rx, (dy / r) * e.ry) : Math.min(e.rx, e.ry);
  const d = (1 - r) * rad; // px inside the curve
  return Math.max(0, Math.min(1, d + 0.5));
}
