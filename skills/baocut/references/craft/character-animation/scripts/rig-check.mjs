#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 不开浏览器跑一遍代码包：画面是时间的纯函数，所以把 Canvas 换成空壳，按每秒 30 次走完全片，查手臂、提示词与节奏，
// 再写出 rig-timeline.json（剪点、转场与音效事件，给 place-sfx.mjs 与 jump-scan.mjs 用）。
//
//   node rig-check.mjs <代码包目录> [--step 0.033] [--max-shot 6] [--out rig-timeline.json]
//
// 退出码：0 没问题，1 有问题（逐条打印），2 跑不起来。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function imageSize(file) {
  if (!fs.existsSync(file)) return null;
  const b = fs.readFileSync(file);
  if (b[0] === 0x89) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] === 0xff) {
    for (let i = 2; i < b.length;) {
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return { width: 1000, height: 1000 };
}

function fakeContext(canvas) {
  const state = { font: '10px sans-serif' };
  return new Proxy(state, {
    get(target, k) {
      if (k === 'canvas') return canvas;
      if (k === 'measureText') return s => { const px = Number(/(\d+(?:\.\d+)?)px/.exec(target.font)?.[1] ?? 10); return { width: Array.from(String(s)).length * px * 0.58 }; };
      if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (k === 'getImageData') return () => { throw new Error('main-canvas readback is not allowed in code scenes'); };
      if (k in target) return target[k];
      return () => {};
    },
    set(target, k, v) { target[k] = v; return true; },
  });
}

export async function loadBundle(dir) {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const attr = name => new RegExp(`data-${name}="([^"]*)"`).exec(html)?.[1];
  const dataset = { compositionId: attr('composition-id'), width: attr('width'), height: attr('height'), fps: attr('fps'), duration: attr('duration') };
  const makeCanvas = () => { const cv = { width: 0, height: 0, getContext: () => ctx }; const ctx = fakeContext(cv); return cv; };
  const main = makeCanvas();
  const rootEl = { dataset, querySelector: () => main };
  const missing = [];
  class FakeImage {
    set src(v) {
      this._src = v;
      const size = imageSize(path.resolve(dir, v));
      if (!size) { missing.push(v); return; }
      this.width = size.width; this.height = size.height;
    }
    get src() { return this._src; }
    decode() { return this.width ? Promise.resolve() : Promise.reject(new Error(`missing ${this._src}`)); }
  }
  const sandbox = {
    Image: FakeImage, console, Intl, URLSearchParams, location: { search: '' }, Promise, Math, Number, String, Array, Object, JSON, Map, Set, Error, Date, parseInt, parseFloat,
    document: { getElementById: () => rootEl, querySelector: () => rootEl, createElement: () => makeCanvas(), fonts: { load: async () => [], ready: Promise.resolve() } },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
  for (const s of scripts) vm.runInContext(fs.readFileSync(path.join(dir, s), 'utf8'), sandbox, { filename: s });
  for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) vm.runInContext(m[1], sandbox);
  const comp = sandbox.__baocutCompositions?.[dataset.compositionId] ?? Object.values(sandbox.__baocutCompositions ?? {})[0];
  if (!comp) throw new Error('no composition registered; does the scene call R.film()?');
  await comp.initialize({ target: rootEl });
  return { sandbox, comp, dataset, missing };
}

const headBoxes = new Map();
function headBox(dir, name) {
  // 头的椭圆取自头部件的 PNG：读像素太重，用脖子以上整块的边界近似。
  if (headBoxes.has(name)) return headBoxes.get(name);
  const size = imageSize(path.join(dir, 'img', `${name}_head.png`));
  headBoxes.set(name, size);
  return size;
}
function hitsHead(a, m, dir) {
  const size = headBox(dir, a.name);
  if (!size || !m.neckY) return false;
  // 头按脖子以上的上半幅算：宽取抠图的 80%，高取脖子以上。
  const cx = m.neckX, cy = m.neckY * 0.52, rx = m.w * 0.4 * 0.92, ry = m.neckY * 0.5 * 0.92;
  for (const [ax, ay, bx, by] of [[a.sx, a.sy, a.ex, a.ey], [a.ex, a.ey, a.hx, a.hy]]) {
    for (let i = 0; i <= 12; i++) {
      const k = i / 12, x = ax + (bx - ax) * k, y = ay + (by - ay) * k;
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1) return true;
    }
  }
  return false;
}

export async function checkBundle(dir, o = {}) {
  const { sandbox, comp, dataset, missing } = await loadBundle(dir);
  const R = sandbox.RigKit, tl = sandbox.RIG_TIMELINE, step = o.step ?? 1 / 30, maxShot = o.maxShot ?? 6;
  const problems = {}, notes = [];
  const note = (key, flag, t) => { const k = key.join(' '); (problems[k] ??= {}); (problems[k][flag] ??= []).push(Number(t.toFixed(2))); };
  let arms = [], across = [], cams = [];
  R.onArm = a => arms.push(a);
  R.onAcross = a => across.push(a.t);
  R.onCamera = a => cams.push(a);
  for (let i = 0; i < tl.cuts.length; i++) {
    const { id, t: t0 } = tl.cuts[i], t1 = tl.cuts[i + 1]?.t ?? tl.end;
    const last = new Map();
    let zLo = Infinity, zHi = -Infinity;
    for (let t = t0 + 0.005; t < t1 - 0.005; t += step) {
      arms = []; cams = [];
      await comp.renderAt({ ticks: Math.round(t * 1e6), timescale: 1e6 });
      const seen = new Map();
      for (const c of cams) { zLo = Math.min(zLo, c.z); zHi = Math.max(zHi, c.z); }
      for (const a of arms) {
        const tag = `${a.name}:${a.out}`, idx = seen.get(tag) ?? 0;
        seen.set(tag, idx + 1);
        const key = [id, a.name, a.out < 0 ? 'left' : 'right', String(idx)], mapKey = key.join(' ');
        if (![a.ex, a.ey, a.hx, a.hy].every(Number.isFinite)) { note(key, 'bad_target', t); continue; }
        if (a.reach > 1.0) note(key, 'overreach', t);
        // 肘朝上：肩到手那条线的上方。下垂的手臂朝外弯是设计如此，接近竖直的手臂没有上下之分。
        const vx = a.hx - a.sx, vy = a.hy - a.sy, vd = Math.hypot(vx, vy) + 1e-6;
        if (Math.abs(vx) > 0.2 * vd && vy < 0.5 * vd) {
          const nx = vx > 0 ? -vy / vd : vy / vd, ny = vx > 0 ? vx / vd : -vx / vd;
          if ((a.ex - a.sx) * nx + (a.ey - a.sy) * ny < -0.05 * a.L) note(key, 'elbow_up', t);
        }
        if (!a.front && hitsHead(a, R.sprites[a.name], dir)) note(key, 'through_head', t);
        const prev = last.get(mapKey);
        if (prev && Math.hypot(a.ex - prev.ex, a.ey - prev.ey) > 0.5 * a.L) note(key, 'elbow_flip', t);
        last.set(mapKey, a);
      }
    }
    if (t1 - t0 > maxShot) notes.push(`shot ${id} runs ${(t1 - t0).toFixed(1)}s (over ${maxShot}s)`);
    if (zLo === Infinity) notes.push(`shot ${id} has no R.camera() call: is it meant to hold still?`);
    else if (zHi - zLo < 0.005) notes.push(`shot ${id} camera barely moves (zoom ${zLo.toFixed(3)}-${zHi.toFixed(3)})`);
  }
  if (across.length) problems['aim across the body'] = { across: [...new Set(across.map(t => Number(t.toFixed(1))))] };
  if (missing.length) problems['missing images'] = { missing };
  // 指令烘焙只认 TTF、OTF：WOFF 与 WOFF2 过不了（font-parse），浏览器里看着却正常。
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const woff = [...html.matchAll(/url\(['"]?([^'")]+\.woff2?)/g)].map(m => m[1]);
  if (woff.length) problems['fonts must be TTF or OTF'] = { woff };
  for (const w of tl.warnings) notes.push(w);
  return { problems, notes, timeline: JSON.parse(JSON.stringify(tl)), dataset };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), dir = args[0];
  const flag = (n, d) => { const i = args.indexOf(n); return i > 0 ? args[i + 1] : d; };
  if (!dir) { console.error('usage: node rig-check.mjs <bundle dir> [--step s] [--max-shot s] [--out file]'); process.exit(2); }
  checkBundle(path.resolve(dir), { step: Number(flag('--step', 1 / 30)), maxShot: Number(flag('--max-shot', 6)) }).then(r => {
    fs.writeFileSync(flag('--out', path.join(dir, 'rig-timeline.json')), JSON.stringify(r.timeline));
    const t = r.timeline;
    console.log(`${t.cuts.length} shots, ${t.wipes.length} wipes, ${t.events.length} sound events, ${t.end.toFixed(2)}s`);
    for (const n of r.notes) console.log(`note ${n}`);
    const keys = Object.keys(r.problems);
    for (const k of keys) console.log(`problem ${k}: ${Object.entries(r.problems[k]).map(([f, v]) => `${f} x${v.length} (${v[0]}..${v[v.length - 1]})`).join(', ')}`);
    console.log(keys.length ? `${keys.length} arm tracks or items with problems` : 'arms ok');
    process.exit(keys.length ? 1 : 0);
  }).catch(e => { console.error(e.stack || String(e)); process.exit(2); });
}
