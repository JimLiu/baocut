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
import fs from 'node:fs';
import path from 'node:path';
import { fontCmap, loadConfig, parseArgs, readJson, scriptLines, units } from './lib.mjs';

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
  // 查字形的源码：场景本身，加上拷进包的 shared/ 顶层 .js 与 bundle.scripts 列的脚本（子目录里的库不查，字符串多半不上画布）
  const checked = copied.filter(rel => rel.endsWith('.js') && (!rel.includes('/') || scripts.includes(rel)));
  checkGlyphs(id, [src, ...checked.map(rel => fs.readFileSync(path.join(SHARED, rel), 'utf8'))]);
  fs.writeFileSync(path.join(out, 'scene.js'), src);
  fs.writeFileSync(path.join(out, 'timing.js'), 'window.TIMING = ' + JSON.stringify({ ...timing, dur }) + ';\n');
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
  return { id, dur, frames: Math.round(dur * cfg.fps), estimated: !!timing.estimated };
}

const all = scriptLines(cfg);
for (const id of ids.length ? ids : cfg.order) console.log(JSON.stringify(build(id, all)));
