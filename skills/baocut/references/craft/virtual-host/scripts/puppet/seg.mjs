// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// Flat-colour segmentation of a cartoon portrait on a solid key background.
import { distTo, components, compMask, grow, dilate, erode, and, or, minus, not, count, bbox } from './ops.mjs';
import { smoothFill } from './fill.mjs';

// a band pixel is unmixed against the colour round it only when that colour is this far from the backdrop (an iris
// or a mint sleeve nearer the key reads no better that way) and the pixel lies within MIX_FIT of their mix
const MIX_SEP = 80, MIX_FIT = 24, SPILL_TOL = 20;
// a colour of the drawing leans at most LEAN_FREE towards the key (key excess over the key's own excess)
const LEAN_FREE = 0.1;
// a mix deeper in the hair than the band: within DEEP px of the backdrop, a colour of the hair within DEEP_OWN px, and
// joined to the backdrop through such mixes or leaning GAP_LEAN further towards the key than the hair ever does
const DEEP = 24, DEEP_OWN = 16, GAP_LEAN = 0.1;
// a pixel right by such a mix is one too when at least BY_GAP of it is the backdrop (with less, a shade painted beside
// the gap could explain it as well)
const BY_GAP = 0.1;

export const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

function median(a) { const s = Array.from(a).sort((x, y) => x - y); return s[s.length >> 1] ?? 0; }
function quantile(a, t) { const s = Array.from(a).sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(t * s.length))] ?? 0; }
// P as a shade of O over U, P = s*O + b*U: the backdrop U shows through at b, behind a drawing s/(1-b) times O. It is
// such a mix when 0 < b < 1, s >= 0, it fits within MIX_FIT, and that drawing is a colour (within MIX_FIT: a white
// highlight at the edge of pink hair fits half pink, half backdrop only behind a drawing twice as light as white).
// Returns the drawing's shade s/(1-b) and alpha 1-b, or null
function shadeMix(P, O, U) {
  const dot = (A, B) => A[0] * B[0] + A[1] * B[1] + A[2] * B[2], oo = dot(O, O), ou = dot(O, U), uu = dot(U, U), det = oo * uu - ou * ou;
  if (det <= 1e-6 * oo * uu) return null;
  const s = (uu * dot(O, P) - ou * dot(U, P)) / det, b = (oo * dot(U, P) - ou * dot(O, P)) / det;
  if (!(b > 0 && b < 1 && s >= 0)) return null;
  const fit = Math.hypot(...[0, 1, 2].map((k) => P[k] - s * O[k] - b * U[k])), shade = s / (1 - b);
  return fit <= MIX_FIT && shade * Math.max(...O) <= 255 + MIX_FIT ? { shade, alpha: 1 - b } : null;
}

/** the key colour: median of the border */
export function borderColor(im) {
  const r = [], g = [], b = [];
  const push = (x, y) => { const i = (y * im.w + x) * 4; r.push(im.d[i]); g.push(im.d[i + 1]); b.push(im.d[i + 2]); };
  for (let x = 0; x < im.w; x += 2) { push(x, 0); push(x, im.h - 1); }
  for (let y = 0; y < im.h; y += 2) { push(0, y); push(im.w - 1, y); }
  return [median(r), median(g), median(b)];
}

/**
 * Character alpha against a saturated key colour, by unmixing: a pixel p = a*fg + (1-a)*key. The key's dominant
 * channel(s) excess over the others measures how much key is in the pixel (spill-free foreground has no such excess
 * beyond what its own colour has). Returns { alpha: Float32Array, fg: RGBA image with key removed, key, bg: Uint8Array,
 * under(p): the backdrop colour behind pixel p (the mean of the background round it), clean: the portrait with the
 * spill taken out (fg over the backdrop where that changed a pixel; what the layers must give back at rest) }.
 */
export function keyOut(im, o = {}) {
  const key = o.key ?? borderColor(im), { w, h, d } = im, n = w * h;
  const top = Math.max(...key), hi = [0, 1, 2].filter((i) => key[i] >= top * 0.65), lo = [0, 1, 2].filter((i) => !hi.includes(i));
  const keyEx = Math.min(...hi.map((k) => key[k])) - Math.max(...lo.map((k) => key[k]));
  // the direction a colour leans towards the key in: its key channels up, the others down
  const lean = [0, 1, 2].map((k) => (hi.includes(k) ? 1 / hi.length : lo.length ? -1 / lo.length : 0));
  const spillDir = lean.map((v) => v / Math.hypot(...lean));
  const ex = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    ex[p] = (Math.min(...hi.map((k) => d[i + k])) - Math.max(...lo.map((k) => d[i + k]))) / keyEx;
  }
  // solid background: strong key excess, connected to the border (enclosed key-coloured holes too, when very close)
  const cand = Uint8Array.from(ex, (v) => (v > 0.55 ? 1 : 0));
  const border = new Uint8Array(n);
  for (let x = 0; x < w; x++) { border[x] = 1; border[(h - 1) * w + x] = 1; }
  for (let y = 0; y < h; y++) { border[y * w] = 1; border[y * w + w - 1] = 1; }
  let bg = grow(and(cand, border), cand, w, h);
  bg = or(bg, Uint8Array.from(ex, (v) => (v > 0.85 ? 1 : 0)));
  // a gap the backdrop shows through that the drawing closes off (between locks of hair) is background too where the
  // caller says such gaps can be (o.holes) and its colour is near the key's (a green-haired character is not)
  if (o.holes) {
    const cc = components(and(minus(cand, bg), o.holes), w, h), dist = new Float64Array(cc.comps.length + 1);
    for (let p = 0; p < n; p++) if (cc.lab[p]) dist[cc.lab[p]] += Math.hypot(d[4 * p] - key[0], d[4 * p + 1] - key[1], d[4 * p + 2] - key[2]);
    const keep = new Set(cc.comps.filter((c) => dist[c.id] / c.area < 75).map((c) => c.id));
    for (let p = 0; p < n; p++) if (keep.has(cc.lab[p])) bg[p] = 1;
  }
  // the band near the background is where the edge is mixed: unmix there only. Soft or painted art blends hair tips and
  // thin gaps into the key deeper than that, so pixels still clearly key-tinted and joined to the background through
  // such pixels unmix too (a character colour near the key, a mint hoodie say, carries less excess and stays solid)
  const near = distTo(bg, w, h);
  const soft = grow(bg, Uint8Array.from(ex, (v) => (v > 0.35 ? 1 : 0)), w, h, 12);
  const band = Uint8Array.from(near, (v, p) => (!bg[p] && (v <= 3 || soft[p]) ? 1 : 0));
  // the key's excess reads a colour with none of its own (a line, skin, white) right, but one with less than none
  // (orange, pink or red hair against green) too solid, and the key left in it turns a thin strand olive. So the band
  // also sees the drawing's own colour round each pixel: the solid colours just inside it that lean no way towards the
  // key, spread out over the band (a shaded pocket of backdrop is no colour of the drawing; nor, here, is green hair)
  const own = { w, h, d: new Uint8ClampedArray(d) };
  const ownFrom = and(erode(not(or(bg, band)), w, h, 1), Uint8Array.from(ex, (v) => (v <= LEAN_FREE ? 1 : 0)));
  smoothFill(own, band, ownFrom, w, h, { iters: 8 });
  // the key behind a pixel: the mean of the background round it, since a generated backdrop is not one flat colour
  // (8 px round it, or as far as the nearest background when that is further)
  const under = (p) => {
    const x = p % w, y = (p - x) / w;
    for (const r of [8, Math.ceil(near[p]) + 2]) {
      const s = [0, 0, 0];
      let m = 0;
      for (let j = Math.max(0, y - r); j <= Math.min(h - 1, y + r); j++) for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r); i++) {
        const q = j * w + i;
        if (bg[q]) { m++; s[0] += d[4 * q]; s[1] += d[4 * q + 1]; s[2] += d[4 * q + 2]; }
      }
      if (m) return s.map((v) => v / m);
      if (r > 8 || near[p] <= 8) break;
    }
    return key;
  };
  // painted hair shows the backdrop between its outer locks further in than the band, darkened by the locks (an olive
  // between brown locks) and too little keyed to join it. Where the caller says gaps can be (o.holes) and the hair's
  // own colour has no key excess (the median of its core: dark green or olive hair would read as such a mix), a pixel
  // within DEEP of the backdrop is such a gap when
  // - it leans further towards the key than the hair does away from the backdrop (lim: the 99th percentile of the core
  //   beyond DEEP, at most LEAN_FREE; brown hair leans well short of 0.1, its olive mixes past it), and joins the
  //   backdrop through such pixels or leans GAP_LEAN further still (a highlight inside the line round a cartoon's hair
  //   does neither), and
  // - the backdrop behind it and a lighter or darker shade of the hair's colour right by it explain it.
  // A green streak in the hair is no such mix and stays solid.
  const deepA = new Float32Array(n);
  let hairMix = false;
  if (o.holes) {
    const core = erode(and(o.holes, not(or(bg, band))), w, h, 4), hx = [], fx = [];
    for (let p = 0; p < n; p++) if (core[p]) { hx.push(ex[p]); if (near[p] > DEEP) fx.push(ex[p]); }
    hairMix = hx.length > 0 && median(hx) <= 0;
    if (hairMix) {
      const lim = Math.min(LEAN_FREE, fx.length ? quantile(fx, 0.99) : LEAN_FREE);
      const known = Uint8Array.from(ex, (v, p) => (!bg[p] && !band[p] && v <= lim ? 1 : 0)), byKnown = distTo(known, w, h);
      const reach = grow(bg, Uint8Array.from(ex, (v, p) => (bg[p] || (o.holes[p] && v > lim && near[p] <= DEEP) ? 1 : 0)), w, h);
      const deep = Uint8Array.from(reach, (v, p) => ((v || (o.holes[p] && ex[p] > lim + GAP_LEAN && near[p] <= DEEP)) && !bg[p] && !band[p] && byKnown[p] <= DEEP_OWN ? 1 : 0));
      smoothFill(own, deep, known, w, h, { iters: 8 });
      let found = 0;
      for (let p = 0; p < n; p++) {
        if (!deep[p]) continue;
        const i = 4 * p, m = shadeMix([d[i], d[i + 1], d[i + 2]], [own.d[i], own.d[i + 1], own.d[i + 2]], under(p));
        if (m) { deepA[p] = m.alpha; found++; }
      }
      // a strand right by such a gap is partly the gap: the backdrop shows through it less, too little to lean past lim,
      // olive all the same (a sunlit strand a quarter backdrop). Under lim it counted as a colour of the hair, so the gap
      // beside it took it for the hair's own colour too. A pixel by a gap (one of its 8 neighbours a mix above) is such
      // a mix where the backdrop and a shade of the hair explain it with at least BY_GAP of backdrop: a shade of the
      // core's colour (the half of the core leaning least towards the key, itself no mix; the colour round it is these
      // strands). A light rim inside the line round a cartoon's hair has no gap by it and stays the drawing. The gaps
      // then read their colour again without these strands
      const hm = median(hx), pure = Uint8Array.from(ex, (v, p) => (core[p] && v <= hm ? 1 : 0)), byGap = new Uint8Array(n);
      for (let p = 0; p < n; p++) {
        if (!known[p] || pure[p] || !o.holes[p] || near[p] > DEEP) continue;
        const x = p % w, y = (p - x) / w;
        for (let j = Math.max(0, y - 1); j <= Math.min(h - 1, y + 1); j++) for (let i = Math.max(0, x - 1); i <= Math.min(w - 1, x + 1); i++) if (deepA[j * w + i] > 0) byGap[p] = 1;
      }
      if (count(byGap)) {
        const ref = { w, h, d: new Uint8ClampedArray(d) }, strand = new Uint8Array(n);
        smoothFill(ref, byGap, pure, w, h, { iters: 8 });
        for (let p = 0; p < n; p++) {
          if (!byGap[p]) continue;
          const i = 4 * p, O = [ref.d[i], ref.d[i + 1], ref.d[i + 2]], m = shadeMix([d[i], d[i + 1], d[i + 2]], O, under(p));
          if (m && m.alpha <= 1 - BY_GAP) { deepA[p] = m.alpha; strand[p] = 1; for (let k = 0; k < 3; k++) own.d[i + k] = O[k]; }
        }
        if (count(strand)) {
          const again = { w, h, d: new Uint8ClampedArray(d) };
          smoothFill(again, deep, and(known, not(strand)), w, h, { iters: 8 });
          for (let p = 0; p < n; p++) {
            if (!deep[p]) continue;
            const i = 4 * p, O = [again.d[i], again.d[i + 1], again.d[i + 2]], m = shadeMix([d[i], d[i + 1], d[i + 2]], O, under(p));
            if (m) { if (!(deepA[p] > 0)) found++; deepA[p] = m.alpha; for (let k = 0; k < 3; k++) own.d[i + k] = O[k]; }
          }
        }
      }
      // nor is such a mix a colour of the drawing for the band: read from it, the band's own colour turns olive and so
      // keeps a thin strand olive. In the hair the band takes the colour round it again without them
      if (found) {
        const again = { w, h, d: new Uint8ClampedArray(d) };
        smoothFill(again, band, and(ownFrom, Uint8Array.from(deepA, (v) => (v > 0 ? 0 : 1))), w, h, { iters: 8 });
        for (let p = 0; p < n; p++) if (band[p] && o.holes[p]) for (let k = 0; k < 3; k++) own.d[4 * p + k] = again.d[4 * p + k];
      }
    }
  }
  const alpha = new Float32Array(n), fg = { w, h, d: new Uint8ClampedArray(n * 4) }, clean = { w, h, d: new Uint8ClampedArray(d) };
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (bg[p]) { alpha[p] = 0; continue; }
    let a = 1, u = key, mixed = band[p];
    if (deepA[p] > 0) { u = under(p); a = deepA[p]; mixed = true; }
    if (band[p]) {
      // character colours here (black lines, skin) carry no key excess
      u = under(p);
      const uEx = Math.min(...hi.map((k) => u[k])) - Math.max(...lo.map((k) => u[k]));
      const e = uEx > 0.5 * keyEx ? ex[p] * keyEx / uEx : ex[p];
      a = Math.min(1, Math.max(0, 1 - e));
      // where the pixel is a mix of the backdrop and the colour round it, that mix gives its alpha (a pixel that is
      // neither, a line between the hair and the key say, keeps the key's excess)
      const v = [0, 1, 2].map((k) => own.d[i + k] - u[k]), l2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
      if (l2 >= MIX_SEP * MIX_SEP) {
        const t = Math.min(1, Math.max(0, ((d[i] - u[0]) * v[0] + (d[i + 1] - u[1]) * v[1] + (d[i + 2] - u[2]) * v[2]) / l2));
        if (Math.hypot(...[0, 1, 2].map((k) => d[i + k] - u[k] - t * v[k])) <= MIX_FIT) a = t;
      }
      // that mix takes the strand for the colour round it, right for a strand of that colour. Painted hair's outer
      // strands are often lighter (a sunlit gold over brown): read so, such a strand comes out too solid with the
      // backdrop left in it, olive. In the hair (where the deep mixes are read) a pixel that is a lighter shade of the
      // colour round it over the backdrop takes that mix's alpha. A darker one is most often where the outline meets
      // the backdrop; read as a shade of the hair the line thins and pales, so it keeps the reading above
      if (hairMix && o.holes[p]) {
        const m = shadeMix([d[i], d[i + 1], d[i + 2]], [own.d[i], own.d[i + 1], own.d[i + 2]], u);
        if (m && m.shade >= 1) a = m.alpha;
      }
    }
    alpha[p] = a;
    const c = [0, 1, 2].map((k) => (a > 0.02 ? (d[i + k] - (1 - a) * u[k]) / a : 0));
    if (mixed && a > 0.02) {
      // spill: a mixed pixel leans no further towards the key than the colour round it does, give or take SPILL_TOL (a
      // generated strand can be painted in the backdrop's light, a thin glowing line that no mix explains)
      const s = [0, 1, 2].reduce((t, k) => t + (c[k] - own.d[i + k]) * spillDir[k], 0) - SPILL_TOL;
      if (s > 0) {
        for (let k = 0; k < 3; k++) c[k] -= s * spillDir[k];
        for (let k = 0; k < 3; k++) clean.d[i + k] = Math.max(0, Math.min(255, c[k])) * a + u[k] * (1 - a);
      }
    }
    for (let k = 0; k < 3; k++) fg.d[i + k] = Math.max(0, Math.min(255, c[k]));
    fg.d[i + 3] = Math.round(a * 255);
  }
  return { alpha, fg, key, bg, under, clean };
}

/**
 * Unmix a line colour K over an under colour U: alpha of K in p (0 = pure U, 1 = pure K).
 */
export function unmix(p, K, U) {
  const v0 = K[0] - U[0], v1 = K[1] - U[1], v2 = K[2] - U[2], l2 = v0 * v0 + v1 * v1 + v2 * v2;
  if (l2 < 1) return 1;
  const t = ((p[0] - U[0]) * v0 + (p[1] - U[1]) * v1 + (p[2] - U[2]) * v2) / l2;
  return Math.max(0, Math.min(1, t));
}

/** the line colour: the commonest dark colour of the outline, the ring just inside the background */
export function lineColor(K, w, h) {
  const near = distTo(K.bg, w, h), hist = new Map();
  for (let p = 0; p < w * h; p++) {
    if (K.alpha[p] < 0.99 || near[p] < 2 || near[p] > 5) continue;
    const r = K.fg.d[4 * p], g = K.fg.d[4 * p + 1], b = K.fg.d[4 * p + 2];
    if (luma(r, g, b) >= 80) continue;
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  if (!hist.size) return [20, 20, 20];
  const [k] = [...hist].sort((a, b) => b[1] - a[1])[0];
  return [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4];
}

/** the outline's weight in px: the dark run right after the background, scanned along rows and columns (the lower
 *  quartile: a crossing at a slant reads longer than the line is wide) */
export function lineWidth(dark, bg, w, h) {
  const runs = [];
  const scan = (at, n) => {
    for (let i = 1; i < n; i++) {
      if (!(bg[at(i - 1)] && !bg[at(i)])) continue;
      let k = 0; while (i + k < n && dark[at(i + k)]) k++;
      if (k >= 1 && k <= 30) runs.push(k);
    }
  };
  for (let y = 0; y < h; y += 2) { scan((x) => y * w + x, w); scan((x) => y * w + (w - 1 - x), w); }
  for (let x = 0; x < w; x += 2) { scan((y) => y * w + x, h); scan((y) => (h - 1 - y) * w + x, h); }
  if (!runs.length) return 6;
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length / 4)];
}

/**
 * per-pixel colour classes. `dark` is the line colour (the outline's own colour, or near-black with little colour); a
 * saturated dark that is not the line colour (a navy hoodie, dark brown hair) is a flat fill: it goes to `fill`, with
 * every other flat colour that is not skin, its shade or white (clothes, coloured hair, irises).
 */
export function classes(im, alpha, skinRGB, line = [20, 20, 20]) {
  const n = im.w * im.h, d = im.d;
  const dark = new Uint8Array(n), skin = new Uint8Array(n), white = new Uint8Array(n), shade = new Uint8Array(n), fill = new Uint8Array(n);
  const Ls = luma(...skinRGB);
  for (let p = 0; p < n; p++) {
    if (alpha[p] < 0.5) continue;
    const r = d[4 * p], g = d[4 * p + 1], b = d[4 * p + 2], L = luma(r, g, b);
    if (L < 100) (isLine(r, g, b, line) ? dark : fill)[p] = 1;
    else if (Math.abs(r - skinRGB[0]) < 22 && Math.abs(g - skinRGB[1]) < 26 && Math.abs(b - skinRGB[2]) < 28) skin[p] = 1;
    else if (r > 222 && g > 222 && b > 222) white[p] = 1;
    else if (isShade(r, g, b, L, skinRGB, Ls)) shade[p] = 1;
    else fill[p] = 1;
  }
  return { dark, skin, white, shade, fill, line };
}

/** a dark pixel is a line when it is near the line colour, or not clearly coloured */
export function isLine(r, g, b, line = [20, 20, 20]) {
  if (luma(r, g, b) >= 100) return false;
  if (Math.hypot(r - line[0], g - line[1], b - line[2]) < 36) return true;
  const hi = Math.max(r, g, b), chroma = hi - Math.min(r, g, b);
  return !(chroma >= 24 && chroma >= 0.4 * hi);
}

/** a shading of the skin (nose, ears, the jaw's shadow): darker, and redder or the same hue */
function isShade(r, g, b, L, s, Ls) {
  if (L > Ls - 8 || L < 0.45 * Ls) return false;
  // warm cartoon shading: red stays high while green and blue drop
  if (r > 140 && r - g > 50 && g - b > 10) return true;
  // or the skin scaled down: channel ratios within a band of each other
  const k = [r / Math.max(1, s[0]), g / Math.max(1, s[1]), b / Math.max(1, s[2])];
  return Math.max(...k) - Math.min(...k) < 0.16 && r >= g && g >= b - 6;
}

/** the hair's colour: the commonest colour of the top of the character (null when that is the dark line colour) */
export function hairColor(im, alpha, C, w, h) {
  let top = -1;
  for (let y = 0; y < h && top < 0; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x] > 0.5) { top = y; break; }
  if (top < 0) return null;
  const hist = new Map();
  for (let y = top; y < Math.min(h, top + Math.round(0.08 * h)); y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (alpha[p] < 0.99 || C.skin[p] || C.white[p]) continue;
    const k = ((im.d[4 * p] >> 3) << 10) | ((im.d[4 * p + 1] >> 3) << 5) | (im.d[4 * p + 2] >> 3);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  if (!hist.size) return null;
  const [k] = [...hist].sort((a, b) => b[1] - a[1])[0];
  const c = [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4];
  return isLine(...c, C.line) ? null : c;
}

/** pixels near a colour (Euclidean RGB distance under tol) */
export function nearColor(im, alpha, c, tol) {
  const n = im.w * im.h, m = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (alpha[p] >= 0.5 && Math.hypot(im.d[4 * p] - c[0], im.d[4 * p + 1] - c[1], im.d[4 * p + 2] - c[2]) < tol) m[p] = 1;
  return m;
}

/**
 * hair: thick components of the hair mask (the dark class, or the hair's colour with the lines) that start near the top
 * of the character, the big one(s), grown back over the attached pixels of the mask (strand ends, outlines)
 */
export function findHair(mask, w, h, o = {}) {
  const thickR = o.thick ?? 4, top = o.top ?? 0;
  const thick = Uint8Array.from(distTo(not(mask), w, h), (v) => (v >= thickR ? 1 : 0));
  const { lab, comps } = components(thick, w, h);
  comps.sort((a, b) => b.area - a.area);
  // the hair starts at the top of the character (a big dark hoodie below the head is not hair)
  const big = comps.find((c) => c.y0 <= top + 0.08 * h) ?? comps[0];
  if (!big) return { core: new Uint8Array(w * h), hair: new Uint8Array(w * h), thick, lab, comps };
  // other big thick blobs touching the top hair's box are hair too (tufts cut off by a thin line)
  const ids = comps.filter((c) => c === big || (c.area > 0.02 * big.area && c.cy < big.y1 && c.y0 < big.cy)).map((c) => c.id);
  const core = compMask(lab, ids);
  return { core, hair: grow(core, mask, w, h, o.reach ?? 8), thick, lab, comps };
}

/** horizontal-run strokes for a mask (for bc retouch --mask), every `step` rows, radius `r` */
export function maskStrokes(m, w, h, step = 4, r = 3) {
  const strokes = [];
  for (let y = 0; y < h; y += step) {
    let x = 0;
    while (x < w) {
      // a row band y..y+step-1: any set pixel in the band column counts
      const on = (X) => { for (let k = 0; k < step && y + k < h; k++) if (m[(y + k) * w + X]) return true; return false; };
      if (!on(x)) { x++; continue; }
      const x0 = x; while (x < w && on(x)) x++;
      strokes.push({ radius: r, points: [[x0, y + (step - 1) / 2], [x - 1, y + (step - 1) / 2]] });
    }
  }
  return strokes;
}
