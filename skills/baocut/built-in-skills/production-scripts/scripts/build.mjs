#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本
// 把 scenes/<id>.js 打成 BaoCut 代码包 bundles/<id>/（baocut/1 合同，入口里不出现注册词，导入时要带 manifest）。
//   node tools/build.mjs [id ...] [--config <配置>]      不给 id 时打 order 里的全部
// 包里有：index.html（根元素的 data-* 是清单）、timing.js（window.TIMING）、shared/ 下的文件、scene.js。
//   旁白时间取 timing/<id>.json（align.mjs 写的）；还没有时按 estimateRate 估一份（TIMING.estimated 为 true），只用于配音前的样帧。
//   包的时长 = timing.dur + hold[id]（例如片尾卡在最后一句之后多停几秒），对齐到整帧。
//   shared/ 下的文件原样拷进包；bundle.pick 列出的子目录（默认 img）只拷场景源码里用引号提到的文件
//   （'name.png' 或 'name'；带 * 的字面量如 'bug-*' 当通配），bundle.keep 里的相对路径总拷，bundle.exclude 里的不拷。
//   入口按顺序加载 timing.js → bundle.scripts（默认 shared/ 顶层的 .js，按名字排序）→ scene.js。
//   bundle.module 为 true 时 scene.js 以 <script type="module"> 加载，能 import 包里的模块（例如 ./engine.js、./vendor/three.module.js）；
//   这时 bundle.scripts 默认为空：shared/ 里的 .js 由场景自己 import，不再当经典 <script> 加载（模块按经典脚本跑会报错）。
//   要混入经典脚本（只挂全局变量、不 import / export 的）时在 bundle.scripts 里列出。
//   bundle.fonts 是 { 字体族名: 包内相对路径 }，写成入口里的 @font-face，给 DOM 或 WebGL 之上的 2D 画布用。
//   bundle.alpha 为 true 时根元素 data-alpha="true"、页面底色透明：实拍铺在下面一条轨上（footage.layer 为 under），场景只画卡片、标注这些要叠上去的东西，不铺底色。
//   给了 bundle.fonts 时查字形：场景与 shared/ 顶层 .js 的字符串、模板字面量里的字，哪款带进包的字体都没有就打一行 warn（只提醒，不停）。
//   烘焙遇到缺字会退回逐帧截图（text-missing-glyph），在这里先报出来省一轮烘焙；字符串也可能是不上画布的数据，所以不当错误。
//   bundle.fonts 的族名不要用 serif、sans-serif 这类 CSS 通用名：页面会拿系统字体顶替，和烘焙用的字对不上，这里报一行 warn。
// 这一段的片段与出处也写进 timing.js，场景照着画，不用自己再算一遍（只改了这一段的片段时只有这一段的包变）：
//   TIMING.clips：clips.json 里 seg 是这一段的片段，按 overlay.mjs 同一套算法排好：{ id, at, end, from, to, audio, soundOnly, label,
//     box?（画中画框在画布上的像素 { x, y, w, h }，按裁剪或原片宽高算）, words?, said?, text? }。at / end 是相对段首的秒数，
//     截在下一个片段与段尾。words 来自 quotes.json（quotes.mjs 写的，原片秒数），换成相对段首的秒数 [{ t, s, e }]；said / text 是原话与成片语言的译文。
//     片段越过包的结尾时报 warn（段尾的原声要放进 hold）。timing 还是估的、或片段的起点算不出来（还没跑 gaps.mjs）时不写 clips。
//   TIMING.credits：{ 文件名: 出处 }，场景源码用引号提到的文件与这一段片段的原片，在 sources.json 里有 credit 的（sources.mjs 管这份表）。
//   这些字符串也查字形。
//   TIMING.ambient：只给 continues 里的段（{ 段: 它接着演的前一段 }，同一个场景跨包接着演）。值 = 前一段的 ambient + 从前一段到这一段之前
//     各段的时长，场景的环境动画（闪烁、自转、漂浮）用 (TIMING.ambient || 0) + t，接缝处不跳回 0。打一段时，接着它演的段一起重打。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { clipTimes, fontCmap, isAudioOnly, loadConfig, parseArgs, readJson, scriptLines, units } from './lib.mjs';

const cfg = loadConfig();
const { ids } = parseArgs(process.argv);
const { width: W, height: H, background } = cfg.canvas;
const SHARED = cfg.abs(cfg.dirs.shared);

function estimate(lines) {
  let t = 0.15;
  const out = lines.map(text => {
    const d = units(text) / cfg.estimateRate, l = { text, start: +t.toFixed(3), end: +(t + d).toFixed(3) };
    t += d + 0.35;
    return l;
  });
  return { dur: Math.ceil((t + 0.2) * cfg.fps) / cfg.fps, estimated: true, lines: out };
}

const glob = pat => new RegExp('^' + pat.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
const matchAny = (rel, pats) => pats.some(p => glob(p).test(rel));

function sharedFiles(rel = '') {
  if (!fs.existsSync(path.join(SHARED, rel))) return [];
  return fs.readdirSync(path.join(SHARED, rel), { withFileTypes: true }).flatMap(e => {
    const p = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? sharedFiles(p) : e.name.startsWith('.') ? [] : [p];
  });
}

// 源码里字符串、模板字面量（不含 ${} 里的表达式）用到的字符。跳过 // 与 /* */ 注释；
// 转义 \uXXXX、\u{…}、\xXX 解成字符；空白与控制字符不算。正则字面量不识别，里面的引号可能让一小段错位，只影响提醒。
function stringChars(src) {
  const out = new Set(), n = src.length;
  const add = ch => { if (!/[\s\p{Cc}]/u.test(ch)) out.add(ch); };
  const escape = i => {
    const c = src[i + 1];
    let m;
    if (c === 'u' && src[i + 2] === '{' && (m = /^\{([0-9a-fA-F]{1,6})\}/.exec(src.slice(i + 2, i + 11)))) return [+('0x' + m[1]), i + 2 + m[0].length];
    if (c === 'u' && (m = /^[0-9a-fA-F]{4}/.exec(src.slice(i + 2, i + 6)))) return [+('0x' + m[0]), i + 6];
    if (c === 'x' && (m = /^[0-9a-fA-F]{2}/.exec(src.slice(i + 2, i + 4)))) return [+('0x' + m[0]), i + 4];
    return ['nrtbfv0\r\n'.includes(c) ? null : src.codePointAt(i + 1), i + 1 + (src.codePointAt(i + 1) > 0xffff ? 2 : 1)];
  };
  // 读一个字面量里的字：碰到转义解开，别的按码位加进去；返回下一个下标
  const take = i => {
    if (src[i] === '\\') {
      let [cp, j] = escape(i);
      // 😀 这样成对写的代理项合成一个码位
      if (cp >= 0xd800 && cp <= 0xdbff && src[j] === '\\') {
        const [lo, k] = escape(j);
        if (lo >= 0xdc00 && lo <= 0xdfff) [cp, j] = [0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00), k];
      }
      if (cp != null && cp <= 0x10ffff) add(String.fromCodePoint(cp));
      return j;
    }
    const cp = src.codePointAt(i);
    add(String.fromCodePoint(cp));
    return i + (cp > 0xffff ? 2 : 1);
  };
  // 栈：代码层记花括号深度（${ 开的那层回到 0 时遇 } 就回模板），模板层什么也不记
  const stack = [{ code: true, depth: 0 }];
  for (let i = 0; i < n;) {
    const top = stack.at(-1), c = src[i];
    if (!top.code) {
      if (c === '`') { stack.pop(); i++; }
      else if (c === '$' && src[i + 1] === '{') { stack.push({ code: true, depth: 0 }); i += 2; }
      else i = take(i);
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || c === '"') {
      for (i++; i < n && src[i] !== c && src[i] !== '\n';) i = take(i);
      i++;
      continue;
    }
    if (c === '`') stack.push({ code: false });
    else if (c === '{') top.depth++;
    else if (c === '}') { if (top.depth) top.depth--; else if (stack.length > 1) stack.pop(); }
    i++;
  }
  return out;
}

// 字体按路径只读一次；读不了的（.ttc、WOFF、文件不在）打一行说明，之后不再参与检查
const cmaps = new Map();
function cmapOf(rel) {
  if (cmaps.has(rel)) return cmaps.get(rel);
  const file = path.join(SHARED, rel);
  let c = null;
  if (!fs.existsSync(file)) console.warn(`note: bundle.fonts ${rel} not found under ${cfg.dirs.shared}/; glyph check skips it`);
  else {
    const r = fontCmap(file);
    if (r.skip) console.warn(`note: ${rel}: ${r.skip}; glyph check skips it`);
    else c = r;
  }
  cmaps.set(rel, c);
  return c;
}

// 一个包里字符串用到、但带进包的字体都没有的字：打一行 warn
function checkGlyphs(id, sources) {
  const fonts = Object.values(cfg.bundle.fonts || {}).map(cmapOf).filter(Boolean);
  if (!fonts.length) return;
  const chars = new Set(sources.flatMap(s => [...stringChars(s)]));
  const lack = [...chars].filter(ch => !fonts.some(f => f.has(ch.codePointAt(0)))).sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  if (!lack.length) return;
  const list = lack.map(ch => `${ch} U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(', ');
  console.warn(`warn ${id}: fonts lack ${list} — the bake will fall back to pixels; draw marks or reword (code-scenes 2.1)`);
}

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong']);
for (const fam of Object.keys(cfg.bundle.fonts || {})) if (GENERIC.has(fam.toLowerCase())) console.warn(`warn: bundle.fonts family "${fam}" is a CSS generic name; the page and the bake may pick different fonts. Give it its own name (e.g. "Body${fam[0].toUpperCase()}${fam.slice(1)}") and use that in the scenes`);

// 片段、原声逐词时间与出处：没有这些文件时都是空的
const clipsFile = readJson(cfg.abs(cfg.footage?.clips || 'clips.json'), { clips: [] });
const quotes = readJson(cfg.abs('quotes.json'), {});
const sources = readJson(cfg.abs('sources.json'), { items: [] });
const creditOf = new Map((sources.items || []).filter(x => x.credit).flatMap(x => [x.file, x.id].filter(Boolean).map(k => [path.basename(k), x.credit])));
const sizes = new Map();
function sourceSize(file) {
  if (sizes.has(file)) return sizes.get(file);
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const [w, h] = (r.stdout || '').trim().split(',').map(Number);
  const size = w && h ? { w, h } : null;
  sizes.set(file, size);
  return size;
}
const round = x => +x.toFixed(3);

function clipsOf(id, timing, dur) {
  const mine = clipsFile.clips.filter(c => c.seg === id);
  if (!mine.length || timing.estimated) return null;
  let at;
  try { at = clipTimes(timing, mine); } catch (e) { console.warn(`note ${id}: TIMING.clips left out (${e.message})`); return null; }
  const list = mine.map(c => ({ c, at: at[c.id] })).sort((a, b) => a.at - b.at);
  return list.map(({ c, at: t }, i) => {
    const source = c.source || clipsFile.source;
    const end = Math.min(t + c.to - c.from, list[i + 1]?.at ?? Infinity, dur);
    if (t + c.to - c.from > dur + 0.5 / cfg.fps && !list[i + 1]) console.warn(`warn ${id}: clip ${c.id} runs ${(t + c.to - c.from - dur).toFixed(2)}s past the end of the bundle; raise hold.${id} to at least ${(cfg.hold[id] || 0) + Math.ceil((t + c.to - c.from - dur) * 10) / 10} or shorten the clip`);
    const out = { id: c.id, at: round(t), end: round(end), from: c.from, to: c.to, audio: !!c.audio, soundOnly: isAudioOnly(c, source) };
    const label = c.label ?? (out.soundOnly ? null : clipsFile.label ?? null);
    if (typeof label === 'string') out.label = label;
    if (c.pip) {
      const size = c.crop ? { w: c.crop[2], h: c.crop[3] } : sourceSize(source);
      const w = c.pip.w * W / 100, h = size ? w * size.h / size.w : null;
      if (h) out.box = { x: round(c.pip.x * W / 100 - w / 2), y: round(c.pip.y * H / 100 - h / 2), w: round(w), h: round(h) };
      else console.warn(`note ${id}: ${c.id} pip box left out (no crop and ffprobe could not read ${source})`);
    }
    const q = quotes[c.id];
    if (q) {
      if (q.words) out.words = q.words.map(w => ({ t: w.t, s: round(t + w.s - c.from), e: round(t + w.e - c.from) }));
      if (q.said) out.said = q.said;
      if (q.text) out.text = q.text;
    } else if (c.words) console.warn(`note ${id}: ${c.id} wants words but quotes.json has none; run quotes.mjs ${c.id}`);
    return out;
  });
}

// 接着演的段的环境时间偏移：前面那几段的时长取这一轮刚打的，没打的读已有包的 data-duration
const durs = new Map();
function bundleDur(id) {
  if (durs.has(id)) return durs.get(id);
  const f = cfg.abs(cfg.dirs.bundles, id, 'index.html');
  const m = fs.existsSync(f) && fs.readFileSync(f, 'utf8').match(/data-duration="([\d.]+)"/);
  if (!m) throw new Error(`continues: ${id} has no bundle yet; build it first`);
  return +m[1];
}
function ambientOf(id) {
  const prev = cfg.continues[id];
  if (!prev) return 0;
  const span = cfg.order.slice(cfg.order.indexOf(prev), cfg.order.indexOf(id));
  return round(ambientOf(prev) + span.reduce((s, x) => s + bundleDur(x), 0));
}

function build(id, all) {
  const scene = cfg.abs(cfg.dirs.scenes, id + '.js');
  if (!fs.existsSync(scene)) throw new Error('missing ' + scene);
  const src = fs.readFileSync(scene, 'utf8');
  const timing = readJson(cfg.abs(cfg.dirs.timing, id + '.json'), null) || estimate(all[id] || []);
  const dur = Math.round((timing.dur + (cfg.hold[id] || 0)) * cfg.fps) / cfg.fps;
  const out = cfg.abs(cfg.dirs.bundles, id);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  // 场景源码里的字符串字面量：决定 pick 目录里拷哪些文件
  const literals = new Set([...src.matchAll(/(['"`])([^'"`\n]{1,200})\1/g)].map(m => m[2]));
  const wild = [...literals].filter(s => s.includes('*')).map(glob);
  const files = sharedFiles(), copied = [];
  for (const rel of files) {
    if (matchAny(rel, cfg.bundle.exclude)) continue;
    const top = rel.split('/')[0], base = path.basename(rel), stem = base.replace(/\.[^.]+$/, '');
    const picked = rel.includes('/') && cfg.bundle.pick.includes(top);
    if (picked && !matchAny(rel, cfg.bundle.keep) && !literals.has(base) && !literals.has(stem) && !wild.some(r => r.test(stem) || r.test(base))) continue;
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.copyFileSync(path.join(SHARED, rel), path.join(out, rel));
    copied.push(rel);
  }
  const scripts = cfg.bundle.scripts || (cfg.bundle.module ? [] : files.filter(f => !f.includes('/') && f.endsWith('.js')).sort());
  const clips = clipsOf(id, timing, dur);
  // 出处：场景提到的文件与这一段片段的原片
  const credits = {};
  for (const k of [...literals].map(x => path.basename(x)).concat((clips || []).map(c => path.basename(clipsFile.clips.find(x => x.id === c.id).source || clipsFile.source || '')))) if (creditOf.has(k)) credits[k] = creditOf.get(k);
  const ambient = cfg.continues[id] ? ambientOf(id) : null;
  const extra = { ...(clips ? { clips } : {}), ...(Object.keys(credits).length ? { credits } : {}), ...(ambient !== null ? { ambient } : {}) };
  // 查字形的源码：场景本身，加上拷进包的 shared/ 顶层 .js 与 bundle.scripts 列的脚本（子目录里的库不查，字符串多半不上画布），和写进 TIMING 的出处与原话
  const checked = copied.filter(rel => rel.endsWith('.js') && (!rel.includes('/') || scripts.includes(rel)));
  checkGlyphs(id, [src, ...checked.map(rel => fs.readFileSync(path.join(SHARED, rel), 'utf8')), JSON.stringify(extra)]);
  fs.writeFileSync(path.join(out, 'scene.js'), src);
  fs.writeFileSync(path.join(out, 'timing.js'), 'window.TIMING = ' + JSON.stringify({ ...timing, dur, ...extra }) + ';\n');
  const tags = ['timing.js', ...scripts].map(s => `<script src="./${s}"></script>`).join('') +
    `<script${cfg.bundle.module ? ' type="module"' : ''} src="./scene.js"></script>`;
  const faces = Object.entries(cfg.bundle.fonts || {}).map(([fam, rel]) => `@font-face{font-family:'${fam}';src:url('./${rel}')}`).join('');
  // bundle.alpha 为 true 时包是透明的：场景只画要叠在实拍上的东西，底色由下面那条轨上的实拍给
  const alpha = !!cfg.bundle.alpha;
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8"><style>${faces}html,body{margin:0;padding:0;overflow:hidden;background:${alpha ? 'transparent' : background}}#root{position:relative;width:${W}px;height:${H}px}</style></head>
<body><div id="root" data-composition-id="${cfg.compositionId}" data-width="${W}" data-height="${H}" data-fps="${cfg.fps}" data-duration="${dur}" data-alpha="${alpha}"></div>
${tags}</body></html>
`);
  return { id, dur, frames: Math.round(dur * cfg.fps), estimated: !!timing.estimated, ...(ambient !== null ? { ambient } : {}) };
}

const all = scriptLines(cfg);
const want = new Set(ids.length ? ids : cfg.order);
// 接着演的段跟着它前面那几段一起重打：前面任何一段的时长变了，它的 ambient 就变了
for (let grew = true; grew;) {
  grew = false;
  for (const [id, prev] of Object.entries(cfg.continues)) {
    if (want.has(id) || !cfg.order.slice(cfg.order.indexOf(prev), cfg.order.indexOf(id)).some(x => want.has(x))) continue;
    want.add(id);
    grew = true;
  }
}
for (const id of [...cfg.order.filter(x => want.has(x)), ...[...want].filter(x => !cfg.order.includes(x))]) {
  const r = build(id, all);
  durs.set(id, r.dur);
  console.log(JSON.stringify(r));
}
