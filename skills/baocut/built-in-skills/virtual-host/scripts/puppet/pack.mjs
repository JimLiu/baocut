// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// Writing a built character: the layers (full-canvas images) cut to their boxes, model.json, and the zipped packages.
// One set of layers gives two packages: <name>.bcpuppet (BaoCut, format baocut-puppet) and, on request,
// <name>.livliv (the LivLiv v4 package, format livliv-model), which the LivLiv player opens as it is.
import fs from 'node:fs';
import path from 'node:path';
import { writePng, readImage } from './png.mjs';
import { blank, crop } from './ops.mjs';
import { alphaBox, unionBox, cut, bleed } from './layers.mjs';
import { zip } from './zip.mjs';

/** the standard expressions (LivLiv FORMAT Appendix A) and every language's label for them */
export const STANDARD_EXPRESSIONS = JSON.parse(fs.readFileSync(new URL('./expression-labels.json', import.meta.url), 'utf8'));

/** a LivLiv expression id for one of ours: standard ids stay, others become x_<id> in its id alphabet */
export function livlivExpressionId(id) {
  if (STANDARD_EXPRESSIONS[id]) return id;
  const s = id.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+/, '');
  return `x_${s || 'expr'}`.slice(0, 32);
}

/** the rig both builds write: the neck under the chin goes half way with a head turn; the rest is the players' defaults */
export const RIG = { neck: { twist: 0.5 } };
/** how far above the chin the neck line (anchors.neck_y) may be, as a share of the face's height: the head turns and
 *  tilts round it and its ellipse ends there, so a line up in the face swings the chin off the neck */
export const NECK_UP_MAX = 0.2;

const ORDER = ['id', 'texture', 'frames', 'visemes', 'mask', 'talk', 'brow_tex', 'x', 'y', 'w', 'h', 'group', 'depth', 'role', 'expression', 'brows', 'pivot', 'clip', 'range'];

/**
 * layers: [{ id, L, def, frames?, visemes?, mask?, talk?, browTex? }] bottom first (L full-canvas RGBA; mask full-canvas,
 * its coverage in the red channel; talk and browTex full-canvas, cut to the layer's box). Writes pkgDir/textures/*.png
 * and returns the layer defs (key order like LivLiv's).
 */
export function writeLayers(layers, pkgDir, w, h) {
  fs.rmSync(pkgDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(pkgDir, 'textures'), { recursive: true });
  const defs = [];
  for (const Lr of layers) {
    let box;
    if (Lr.frames) box = unionBox(Lr.frames.map((f) => alphaBox(f, w, h, 3)));
    else box = Lr.browTex ? unionBox([alphaBox(Lr.L, w, h, 2), alphaBox(Lr.browTex, w, h, 2)]) : alphaBox(Lr.L, w, h, 2);
    if (!box) continue;
    const def = { id: Lr.id, texture: `textures/${Lr.id}.png`, x: box[0], y: box[1], w: box[2], h: box[3], ...Lr.def };
    if (Lr.frames) {
      def.frames = Lr.visemes.map((v) => `textures/${Lr.id}_${v}.png`);
      def.visemes = Lr.visemes;
      Lr.frames.forEach((f, k) => writePng(path.join(pkgDir, def.frames[k]), bleed(cut(f, box))));
      def.texture = def.frames[0];
    } else writePng(path.join(pkgDir, def.texture), bleed(cut(Lr.L, box)));
    if (Lr.talk) {
      def.talk = `textures/${Lr.id}_talk.png`;
      writePng(path.join(pkgDir, def.talk), bleed(cut(Lr.talk, box)));
    }
    if (Lr.browTex) {
      def.brow_tex = `textures/${Lr.id}_brows.png`;
      writePng(path.join(pkgDir, def.brow_tex), bleed(cut(Lr.browTex, box)));
    }
    if (Lr.mask) {
      def.mask = `textures/${Lr.id}_mask.png`;
      const mc = cut(Lr.mask, box);
      // the whites' coverage is the mask's ALPHA (white RGB), as LivLiv reads it
      for (let k = 0; k < box[2] * box[3]; k++) { const v = mc.d[4 * k]; mc.d[4 * k] = mc.d[4 * k + 1] = mc.d[4 * k + 2] = 255; mc.d[4 * k + 3] = v; }
      writePng(path.join(pkgDir, def.mask), mc);
    }
    defs.push(Object.fromEntries(ORDER.filter((k) => def[k] !== undefined).map((k) => [k, def[k]])));
  }
  return defs;
}

/** the files a package's layers name, model.json first */
function packageFiles(pkgDir, defs, extra = []) {
  const files = [['model.json', fs.readFileSync(path.join(pkgDir, 'model.json'))]];
  for (const d of defs) for (const f of [d.texture, ...(d.frames ?? []), d.mask, d.talk, d.brow_tex].filter(Boolean)) if (!files.some(([n]) => n === f)) files.push([f, fs.readFileSync(path.join(pkgDir, f))]);
  for (const f of extra) files.push([f, fs.readFileSync(path.join(pkgDir, f))]);
  return files;
}

/** problems with a written package: boxes in the canvas, every image its box's size, frames and visemes alike */
export function packageErrors(pkgDir, model) {
  const [w, h] = model.canvas, errs = [];
  const ids = new Set();
  for (const d of model.layers) {
    if (ids.has(d.id)) errs.push(`${d.id}: id used twice`);
    ids.add(d.id);
    if (d.x < 0 || d.y < 0 || d.x + d.w > w || d.y + d.h > h) errs.push(`${d.id}: box outside the canvas`);
    for (const f of [d.texture, ...(d.frames ?? []), d.mask, d.talk, d.brow_tex].filter(Boolean)) {
      const t = readImage(path.join(pkgDir, f));
      if (t.w !== d.w || t.h !== d.h) errs.push(`${d.id}: ${f} is ${t.w}x${t.h}, box ${d.w}x${d.h}`);
    }
    if (d.frames && d.frames.length !== d.visemes.length) errs.push(`${d.id}: frames/visemes`);
    if (d.clip && !model.layers.some((L) => L.id === d.clip)) errs.push(`${d.id}: clip ${d.clip} is not a layer`);
    if (d.expression && !(model.expressions ?? []).some((e) => e.id === d.expression)) errs.push(`${d.id}: expression ${d.expression} is not listed`);
  }
  const keys = (model.expressions ?? []).map((e) => e.hotkey).filter(Boolean);
  if (new Set(keys).size !== keys.length) errs.push('expression hotkeys repeat');
  const A = model.anchors, inCanvas = (b) => b[0] >= 0 && b[1] >= 0 && b[2] < w && b[3] < h;
  for (const b of [A.face, ...(A.eyes ?? []), ...(A.brows ?? []).filter(Boolean)]) if (!inCanvas(b)) errs.push(`anchor box ${b} outside the canvas`);
  return errs;
}

/**
 * Write the BaoCut package (and the LivLiv one when o.livliv). model: { name, canvas, profile, anchors, expressions
 * ([{id}] in our ids), layers (defs) }. rest: the layers composited at rest (full canvas), for the cover and avatar.
 * o.whole: by layer id, an expression patch with its eyes still in it ({ L, talk }, full canvas), for the LivLiv
 * package, which has no expr_eye roles. Returns { bcpuppet, livliv?, errors }.
 */
export function writePackages(outDir, pkgDir, model, rest, o = {}) {
  const [w, h] = model.canvas;
  const base = model.name.replace(/[^\w.-]+/g, '-') || 'character';
  const exprs = (model.expressions ?? []).map((e, i) => ({
    id: e.id,
    label: STANDARD_EXPRESSIONS[e.id] ?? { und: e.id },
    ...(i < 9 ? { hotkey: String(i + 1) } : {}),
  }));
  const bc = { format: 'baocut-puppet', version: 1, name: model.name, canvas: [w, h], profile: model.profile, anchors: model.anchors, rig: RIG, expressions: exprs, layers: model.layers };
  fs.writeFileSync(path.join(pkgDir, 'model.json'), JSON.stringify(bc, null, 1) + '\n');
  const errors = packageErrors(pkgDir, bc);
  const out = { errors, bcpuppet: path.join(outDir, `${base}.bcpuppet`) };
  fs.writeFileSync(out.bcpuppet, zip(packageFiles(pkgDir, model.layers)));
  if (!o.livliv) return out;
  // the LivLiv package: the same layers, anchors and rig; the tuning left to the player's defaults. LivLiv would draw
  // an expression's own eyes (roles expr_eye_*, ours) as a plain layer, always on: they go back into the patch
  const lvDir = path.join(outDir, 'livliv');
  fs.rmSync(lvDir, { recursive: true, force: true });
  fs.mkdirSync(lvDir, { recursive: true });
  fs.cpSync(path.join(pkgDir, 'textures'), path.join(lvDir, 'textures'), { recursive: true });
  const ownEyes = (d) => (d.role ?? '').startsWith('expr_eye_');
  for (const d of model.layers) {
    if (ownEyes(d)) for (const f of [d.texture, d.mask].filter(Boolean)) fs.rmSync(path.join(lvDir, f), { force: true });
    const W = o.whole?.[d.id];
    if (!W) continue;
    const box = [d.x, d.y, d.w, d.h];
    writePng(path.join(lvDir, d.texture), bleed(cut(W.L, box)));
    if (d.talk) writePng(path.join(lvDir, d.talk), bleed(cut(W.talk, box)));
  }
  // the cover: the character at rest on transparent, cut to its box; the avatar: the face in a ~96 px square
  const cb = alphaBox(rest, w, h, 4);
  writePng(path.join(lvDir, 'cover.png'), crop(rest, ...cb));
  const f = model.anchors.face, side = Math.round(1.5 * Math.max(f[2] - f[0], f[3] - f[1]));
  const ax = Math.max(0, Math.min(w - side, Math.round((f[0] + f[2]) / 2 - side / 2))), ay = Math.max(0, Math.min(h - side, Math.round((f[1] + f[3]) / 2 - side / 2)));
  writePng(path.join(lvDir, 'avatar.png'), downscale(crop(rest, ax, ay, side, side), 96));
  const lvExprs = exprs.map((e) => ({ ...e, id: livlivExpressionId(e.id) }));
  const idMap = Object.fromEntries(exprs.map((e, i) => [e.id, lvExprs[i].id]));
  const lv = {
    format: 'livliv-model', version: 4, name: model.name,
    meta: { generator: { name: 'BaoCut', ...(o.build ? { build: o.build } : {}) }, created: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), ...(o.meta ?? {}) },
    requires: [],
    files: { cover: 'cover.png', avatar: 'avatar.png' },
    canvas: [w, h], profile: model.profile, anchors: model.anchors, rig: RIG, expressions: lvExprs,
    layers: model.layers.filter((d) => !ownEyes(d)).map((d) => (d.expression ? { ...d, expression: idMap[d.expression] ?? d.expression } : d)),
  };
  fs.writeFileSync(path.join(lvDir, 'model.json'), JSON.stringify(lv, null, 1) + '\n');
  errors.push(...packageErrors(lvDir, lv).map((e) => `livliv ${e}`));
  out.livliv = path.join(outDir, `${base}.livliv`);
  fs.writeFileSync(out.livliv, zip(packageFiles(lvDir, lv.layers, ['cover.png', 'avatar.png'])));
  return out;
}

/** box-filter an RGBA image (premultiplied) down to a size x size square */
function downscale(im, size) {
  const out = blank(size, size), s = im.w / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const acc = [0, 0, 0, 0];
    let n = 0;
    for (let j = Math.floor(y * s); j < Math.min(im.h, Math.ceil((y + 1) * s)); j++) for (let i = Math.floor(x * s); i < Math.min(im.w, Math.ceil((x + 1) * s)); i++) {
      const t = 4 * (j * im.w + i), a = im.d[t + 3] / 255;
      acc[0] += im.d[t] * a; acc[1] += im.d[t + 1] * a; acc[2] += im.d[t + 2] * a; acc[3] += a; n++;
    }
    const a = acc[3] / Math.max(1, n), t = 4 * (y * size + x);
    if (acc[3] > 0) for (let k = 0; k < 3; k++) out.d[t + k] = acc[k] / acc[3];
    out.d[t + 3] = Math.round(255 * a);
  }
  return out;
}
