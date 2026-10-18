#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本
// 把 scenes/<id>.js 打成 BaoCut 代码包 bundles/<id>/（baocut/1 合同，入口里不出现注册词，导入时要带 manifest）。
//   node tools/build.mjs [id ...] [--config explainer.json]      不给 id 时打 order 里的全部
// 包里有：index.html（根元素的 data-* 是清单）、timing.js（window.TIMING）、shared/ 下的文件、scene.js。
//   旁白时间取 timing/<id>.json（align.mjs 写的）；还没有时按 estimateRate 估一份（TIMING.estimated 为 true），只用于配音前的样帧。
//   包的时长 = timing.dur + hold[id]（例如片尾卡在最后一句之后多停几秒），对齐到整帧。
//   shared/ 下的文件原样拷进包；bundle.pick 列出的子目录（默认 img）只拷场景源码里用引号提到的文件
//   （'name.png' 或 'name'；带 * 的字面量如 'bug-*' 当通配），bundle.keep 里的相对路径总拷，bundle.exclude 里的不拷。
//   入口按顺序加载 timing.js → bundle.scripts（默认 shared/ 顶层的 .js，按名字排序）→ scene.js。
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, parseArgs, readJson, scriptLines, units } from './lib.mjs';

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
  const files = sharedFiles();
  for (const rel of files) {
    if (matchAny(rel, cfg.bundle.exclude)) continue;
    const top = rel.split('/')[0], base = path.basename(rel), stem = base.replace(/\.[^.]+$/, '');
    const picked = rel.includes('/') && cfg.bundle.pick.includes(top);
    if (picked && !matchAny(rel, cfg.bundle.keep) && !literals.has(base) && !literals.has(stem) && !wild.some(r => r.test(stem) || r.test(base))) continue;
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.copyFileSync(path.join(SHARED, rel), path.join(out, rel));
  }
  const scripts = cfg.bundle.scripts || files.filter(f => !f.includes('/') && f.endsWith('.js')).sort();
  fs.writeFileSync(path.join(out, 'scene.js'), src);
  fs.writeFileSync(path.join(out, 'timing.js'), 'window.TIMING = ' + JSON.stringify({ ...timing, dur }) + ';\n');
  const tags = ['timing.js', ...scripts, 'scene.js'].map(s => `<script src="./${s}"></script>`).join('');
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:${background}}#root{position:relative;width:${W}px;height:${H}px}</style></head>
<body><div id="root" data-composition-id="${cfg.compositionId}" data-width="${W}" data-height="${H}" data-fps="${cfg.fps}" data-duration="${dur}" data-alpha="false"></div>
${tags}</body></html>
`);
  return { id, dur, frames: Math.round(dur * cfg.fps), estimated: !!timing.estimated };
}

const all = scriptLines(cfg);
for (const id of ids.length ? ids : cfg.order) console.log(JSON.stringify(build(id, all)));
