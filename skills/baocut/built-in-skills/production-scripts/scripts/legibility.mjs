#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 看得清没有：两件事，都不读配置、不连 Runtime。
//
//   node tools/legibility.mjs --bg '#F1E9D8' ink=#24211C muted=#8A8172 accent=#6E8B74@0.8 [--bg '#1D2A25' …]
//   node tools/legibility.mjs --frames <成片或预览.mp4> --at 12,40,262 [--scale 0.33] [--blur 0] [--out phone.png]
//   node tools/legibility.mjs --frames <a.png> <b.png> … [--scale 0.33] [--out phone.png]
//
// 对比度：每个「名字=颜色」对每个底色算 WCAG 对比度。颜色写 #RGB 或 #RRGGBB，`@0.6` 表示不透明度，先按它叠在
// 那个底色上再算（淡出、没念到、压暗的字就这么量）。照片、地图上的字用 --bg 给它下面最亮或最暗的那块颜色。
// 结论三档：≥ 4.5 什么字都能用；3–4.5 只够 64 px 以上的大字、线条与图形；< 3 只能做装饰，不能承载要读的信息。
//
// 小屏：从视频的几个时刻（或几张图）各取一帧，按 --scale 缩小（缺省 1/3，横版成 640×360，约是手机竖握时横版
// 视频的大小），--blur 可再加一点高斯模糊（像素，缩小后的尺寸上量），拼成一张图写到 --out。看这张图：要读的字
// 认不出、要分轻重的几级看着一样大一样黑，就是字太小、太淡或层级没拉开。要本机有 ffmpeg。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs, listFlag } from './lib.mjs';

// --bg 可以给多次，parseArgs 只留最后一个，这里自己收
const bgs = [];
const rest = [process.argv[0], process.argv[1]];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--bg') bgs.push(process.argv[++i]);
  else if (a.startsWith('--bg=')) bgs.push(a.slice(5));
  else rest.push(a);
}
const { ids, flags } = parseArgs(rest, ['frames', 'at', 'scale', 'blur', 'out', 'cols']);

function hex(s) {
  const m = String(s).trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) throw new Error(`not a #RGB or #RRGGBB colour: ${s}`);
  const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
const lin = v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const over = (fg, alpha, bg) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));
const toHex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();

function contrast() {
  const fgs = ids.map(s => {
    const m = s.match(/^([^=]+)=([^@]+)(?:@([\d.]+))?$/);
    if (!m) throw new Error(`expected name=#colour[@alpha], got ${s}`);
    return { name: m[1], color: hex(m[2]), alpha: m[3] === undefined ? 1 : Math.min(1, Math.max(0, +m[3])) };
  });
  if (!fgs.length) throw new Error('give at least one name=#colour after --bg');
  const verdict = r => (r >= 4.5 ? 'any text' : r >= 3 ? 'large text (64 px+), lines, shapes only' : 'decoration only');
  for (const b of bgs) {
    const bg = hex(b);
    console.log(`on ${toHex(bg)}`);
    for (const f of fgs) {
      const c = f.alpha < 1 ? over(f.color, f.alpha, bg) : f.color, r = ratio(c, bg);
      const shown = f.alpha < 1 ? `${toHex(f.color)}@${f.alpha} -> ${toHex(c)}` : toHex(c);
      console.log(`  ${f.name.padEnd(12)} ${shown.padEnd(26)} ${r.toFixed(2).padStart(5)}:1  ${verdict(r)}`);
    }
  }
}

function sheet() {
  const src = flags.frames === true ? null : flags.frames;
  const scale = flags.scale ? +flags.scale : 1 / 3, blur = flags.blur ? +flags.blur : 0;
  if (!(scale > 0 && scale <= 1)) throw new Error('--scale must be in (0, 1]');
  const out = path.resolve(flags.out || 'legibility-sheet.png');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'legibility-'));
  const vf = [`scale=trunc(iw*${scale}/2)*2:-2:flags=area`, ...(blur > 0 ? [`gblur=sigma=${blur}`] : [])].join(',');
  const ffmpeg = args => execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });
  const shots = [];
  try {
    if (src && !/\.(png|jpe?g|webp)$/i.test(src)) {
      const at = listFlag(flags.at).map(Number);
      if (!at.length || at.some(t => !(t >= 0))) throw new Error('--frames <video> needs --at <seconds,…>');
      at.forEach((t, i) => {
        const f = path.join(tmp, `${String(i).padStart(3, '0')}.png`);
        ffmpeg(['-ss', String(t), '-i', src, '-frames:v', '1', '-vf', vf, f]);
        shots.push(f);
      });
    } else {
      const files = [...(src ? [src] : []), ...ids];
      if (!files.length) throw new Error('--frames needs a video with --at, or image files');
      files.forEach((file, i) => {
        const f = path.join(tmp, `${String(i).padStart(3, '0')}.png`);
        ffmpeg(['-i', file, '-frames:v', '1', '-vf', vf, f]);
        shots.push(f);
      });
    }
    const cols = Math.max(1, Math.min(shots.length, flags.cols ? +flags.cols : 3)), rows = Math.ceil(shots.length / cols);
    ffmpeg(['-framerate', '1', '-i', path.join(tmp, '%03d.png'), '-vf', `tile=${cols}x${rows}:padding=12:margin=12:color=white`, '-frames:v', '1', out]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${shots.length} frame(s) at ${Math.round(scale * 100)}%${blur ? `, blur ${blur}px` : ''} -> ${out}`);
}

try {
  if (flags.frames) sheet();
  else if (bgs.length) contrast();
  else throw new Error('use --bg <colour> name=<colour> … for contrast, or --frames … for the small-screen sheet');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
