#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 看合成后的画面：取帧只有素材画面，这里走导出预览，贴纸、文字、字幕、主播、还没烘焙（live）的代码画面都画在里面。
// 只读视频，不改时间线；每次导出都是 purpose: preview 的临时文件，放在 <work>/frames/ 下，用完可以整个删掉。要本机有 ffmpeg。
//   node tools/frames.mjs 0 12.5 s03 s04:3.2      几个时刻各取一帧，拼成一张图 <work>/frames/sheet.png，逐帧另存 NN.png
//       数字是时间线上的秒；<段> 取这一段的开头、中间、结尾附近三帧；<段>:<秒> 是这一段开始后的第几秒
//   node tools/frames.mjs --every 20              整条片子每 20 秒一帧
//   node tools/frames.mjs --cuts                  每一段的第一帧与最后一帧（查段与段相接处的黑帧、空帧、没接上的画面）
//   --width <像素>   每帧的宽度，默认 960；--cols <列数> 拼图一行几帧，默认 4
//   node tools/frames.mjs --still [段…]           找画面长时间不动的地方：把整条片子（或给的几段）导出成小尺寸预览（不画字幕），
//       用 ffmpeg 的 freezedetect 找连续不动超过 --min 秒（默认 3）的区间，报出时间与所在的段。只报候选，不判对错：
//       停在一张图上让观众读，和画面该动却空着，量出来一样，要对着旁白看。
//   --region x,y,w,h  只看画面的这一块（画布百分比，左上角与宽高）。画面上有一直在动的东西（主播、角标动画）时
//       整幅画面永远不算不动，用它圈出内容区；--noise <值> 是「不动」的容差，默认 0.003
// 段的起点取 timeline.json（assemble.mjs 写的）；片子不是这套脚本摆的时只用秒数。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { loadConfig, parseArgs, makeBc, readJson } from './lib.mjs';

const cfg = loadConfig();
const { ids, flags } = parseArgs(process.argv, ['every', 'width', 'cols', 'region', 'noise', 'min']);
if (!cfg.video) throw new Error('config has no video id');
if (spawnSync('ffmpeg', ['-version']).error) throw new Error('frames.mjs needs ffmpeg on PATH');
const bc = makeBc(cfg);
const V = cfg.video, FPS = cfg.fps;
const head = bc(['videos', 'inspect', V, '--limit', '1']);
const total = head.sequence?.durationFrames;
if (!(total > 0)) throw new Error(`${V}: the timeline is empty`);
const segs = readJson(cfg.abs('timeline.json'), { segments: {} }).segments;
const segOf = f => cfg.order.find(id => segs[id] && f >= segs[id].from && f < segs[id].from + segs[id].frames);
const stamp = f => { const id = segOf(f); return `${(f / FPS).toFixed(2)}s${id ? `  ${id} +${((f - segs[id].from) / FPS).toFixed(2)}s` : ''}`; };
const seg = id => { if (!segs[id]) throw new Error(`${id}: not in timeline.json (run assemble.mjs, or give seconds)`); return segs[id]; };
const out = cfg.abs(cfg.dirs.work, 'frames');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const range = (a, b) => `${(a / FPS).toFixed(4)}:${(b / FPS).toFixed(4)}`;
// 导出几段范围，返回每段的文件（按给的次序）
function exportRanges(ranges, extra) {
  const dir = fs.mkdtempSync(path.join(out, 'x-'));
  const args = ['export', V, '--kind', 'video', '--format', 'mp4', '--purpose', 'preview', '--dir', dir, ...extra];
  for (const r of ranges) args.push(ranges.length > 1 ? '--ranges' : '--range', r);
  const r = bc(args);
  if (r.state && r.state !== 'completed') throw new Error(`export did not complete: ${JSON.stringify(r).slice(0, 600)}`);
  const files = (r.files || []).map(f => path.join(r.dir || dir, f));
  if (files.length !== ranges.length) throw new Error(`export returned ${files.length} files for ${ranges.length} ranges: ${JSON.stringify(r).slice(0, 600)}`);
  return { dir, files };
}

if (flags.still) {
  const min = flags.min == null ? 3 : Number(flags.min);
  if (!(min > 0)) throw new Error('--min takes a number of seconds');
  const spans = ids.length ? ids.map(id => ({ from: seg(id).from, frames: seg(id).frames })) : [{ from: 0, frames: total }];
  let crop = '';
  if (flags.region) {
    const [x, y, w, h] = String(flags.region).split(',').map(Number);
    if (![x, y, w, h].every(Number.isFinite) || !(w > 0 && h > 0) || x < 0 || y < 0 || x + w > 100 || y + h > 100) throw new Error('--region is x,y,w,h in percent of the canvas, inside 0–100');
    crop = `crop=iw*${w / 100}:ih*${h / 100}:iw*${x / 100}:ih*${y / 100},`;
  }
  const { dir, files } = exportRanges(spans.map(s => range(s.from, s.from + s.frames)), ['--width', String(flags.width || 480), '--burn-captions=false']);
  let found = 0;
  files.forEach((file, i) => {
    const log = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vf', `${crop}freezedetect=n=${Number(flags.noise) || 0.003}:d=${min}`, '-an', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const starts = [...log.matchAll(/freeze_start: ([\d.]+)/g)].map(m => +m[1]);
    const ends = [...log.matchAll(/freeze_end: ([\d.]+)/g)].map(m => +m[1]);
    starts.forEach((s, k) => {
      const e = ends[k] ?? spans[i].frames / FPS, f0 = spans[i].from + Math.round(s * FPS);
      console.log(`still ${(e - s).toFixed(1).padStart(5)}s  ${stamp(f0)}  to ${((spans[i].from / FPS) + e).toFixed(2)}s`);
      found++;
    });
  });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(found ? `${found} stretches of ${min}s or more without motion${crop ? ' in the region' : ''}; check each against the narration (frames.mjs <seconds> shows the frame)` : `no stretch of ${min}s or more without motion${crop ? ' in the region' : ' (anything that always moves, a host or an animated badge, hides them: give --region)'}`);
  process.exit(0);
}

// 要看的帧
const want = [];
const add = (f, label) => want.push({ f: Math.max(0, Math.min(total - 1, Math.round(f))), label });
if (flags.every) {
  const step = Number(flags.every);
  if (!(step > 0)) throw new Error('--every takes a number of seconds');
  for (let t = 0; t * FPS < total; t += step) add(t * FPS);
}
if (flags.cuts) for (const id of cfg.order) if (segs[id]) { add(segs[id].from, `${id} first`); add(segs[id].from + segs[id].frames - 1, `${id} last`); }
for (const a of ids) {
  const m = /^(.+):(-?[\d.]+)$/.exec(a);
  if (/^[\d.]+$/.test(a)) add(Number(a) * FPS);
  else if (m) add(seg(m[1]).from + Number(m[2]) * FPS);
  else { const s = seg(a); for (const p of [0.08, 0.5, 0.92]) add(s.from + s.frames * p); }
}
if (!want.length) throw new Error('nothing to look at: give seconds, segment ids, <segment>:<seconds>, --every <seconds>, --cuts or --still');

const width = String(flags.width || 960), cols = Math.max(1, Number(flags.cols) || 4);
const BATCH = 24;
let n = 0;
for (let i = 0; i < want.length; i += BATCH) {
  const part = want.slice(i, i + BATCH);
  const { dir, files } = exportRanges(part.map(w => range(w.f, w.f + 1)), ['--width', width]);
  files.forEach((file, k) => {
    const png = path.join(out, `${String(++n).padStart(3, '0')}.png`);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-frames:v', '1', png]);
    console.log(`${path.basename(png)}  ${stamp(part[k].f)}${part[k].label ? `  (${part[k].label})` : ''}`);
  });
  fs.rmSync(dir, { recursive: true, force: true });
}
const rows = Math.ceil(n / cols), sheet = path.join(out, 'sheet.png');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-start_number', '1', '-i', path.join(out, '%03d.png'), '-vf', `tile=${Math.min(cols, n)}x${rows}:padding=6:color=0x202020`, '-frames:v', '1', sheet]);
console.log(`${path.relative(cfg.root, sheet)}: ${n} frames, left to right, top to bottom, in the order listed above (video revision ${head.revision})`);
