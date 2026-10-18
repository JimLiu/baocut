#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文，给人看的名字与标签从配置来
// 叠在代码画面之上的两层：实拍片段（footage 轨）与水印（watermark 轨）。都是可选的：没有 clips.json、配置里没有 watermark 就跳过。
//   node tools/overlay.mjs [--dry]          打印每个片段与水印在时间线上的起止（默认）
//   node tools/overlay.mjs --preview [id …] [--force]   从原片剪出静音小片段到 <work>/clips/，给 preview.mjs 与预览页用
//   node tools/overlay.mjs --render         按画幅剪出成片用的片段（铺满裁切、对到整帧），把来源标签烧进去，写到 <work>/footage/
//   node tools/overlay.mjs --place          新建两条视觉轨，导入片段铺满放好，再放水印；记在 overlay.json，已放过的（同一 id、同一帧）不重放
//   node tools/overlay.mjs --check          对照视频里的片段与现在算出的起点（assemble 波纹挪过、段落改过之后跑）
// clips.json：{ source, label, clips: [{ id, seg, line, cue?, from, to, source?, label?, audio?, note? }] }
//   from / to 是原片的秒数；片段从 seg 段第 line 句（从 0 数）开始放；cue 可省，给了就从这句里 cue 这几个字被说到的时刻开始。
//   同一段里下一个片段开始时截断，不越过段尾。label 是烧进画面一角的来源标签（成片语言写，例如「画面：<来源>」），
//   单个片段可以另给 source 与 label；audio 为 true 时保留原声（当事人原话），否则静音。
// 配置 footage：{ clips, font, label: { size, margin } }；watermark：{ file, dur, w, y, x: { left, right }, at: [...] }，
//   at 的每一项是 { seg, line, cue?, side } 或 { t, side }（时间线秒数），side 取 left / right；x、y、w 是画面宽高的百分比。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig, parseArgs, makeBc, readJson, writeJson, layout, atOf, cueTime, allItems } from './lib.mjs';

const cfg = loadConfig();
const { ids, flags } = parseArgs(process.argv);
const FPS = cfg.fps, V = cfg.video, { width: W, height: H } = cfg.canvas;
const fo = { clips: 'clips.json', font: null, ...cfg.footage, label: { size: 28, margin: 46, ...cfg.footage?.label } };
const wm = cfg.watermark ? { dur: 5, w: 6, y: 70, x: { left: 5, right: 95 }, at: [], ...cfg.watermark } : null;
const cl = readJson(cfg.abs(fo.clips), { clips: [] });
const work = sub => cfg.abs(cfg.dirs.work, sub);
const logFile = cfg.abs('overlay.json');
const log = readJson(logFile, { video: V, footage: {}, watermarks: [] });
if (log.video !== V) throw new Error(`overlay.json belongs to ${log.video}, config says ${V}`);
const save = () => writeJson(logFile, log);
const ffmpeg = args => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const src = c => c.source || cl.source;

// 1. 预览用的小片段：不需要代码包，只按 clips.json 剪
if (flags.preview) {
  fs.mkdirSync(work('clips'), { recursive: true });
  for (const c of cl.clips) {
    if (ids.length && !ids.includes(c.id)) continue;
    const out = path.join(work('clips'), c.id + '.mp4');
    if (fs.existsSync(out) && !flags.force) continue;
    const audio = c.audio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an'];
    ffmpeg(['-ss', String(c.from), '-i', src(c), '-t', String(c.to - c.from), ...audio, '-vf', 'scale=1280:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-movflags', '+faststart', out]);
    console.log('preview clip', c.id, (c.to - c.from).toFixed(1) + 's');
  }
  process.exit(0);
}

// 2. 排时间：段起点（与 assemble.mjs 同一套整帧累加）+ 这一句或 cue 的对齐时刻
const lay = layout(cfg);
const seg = Object.fromEntries(lay.map(s => [s.id, s]));
const timing = id => readJson(cfg.abs(cfg.dirs.timing, `${id}.json`)) ?? (() => { throw new Error(`timing/${id}.json missing; run align.mjs ${id}`); })();
const at = (segId, line, cue) => {
  const s = seg[segId];
  if (!s) throw new Error(`segment ${segId} not in order`);
  return s.from / FPS + cueTime(timing(segId), line, cue);
};
const plan = [];
for (const s of lay) {
  const cs = cl.clips.filter(c => c.seg === s.id).map(c => ({ ...c, at: at(s.id, c.line, c.cue) })).sort((a, b) => a.at - b.at);
  cs.forEach((c, i) => {
    const stop = Math.min(cs[i + 1]?.at ?? Infinity, (s.from + s.frames) / FPS);
    const f0 = Math.round(c.at * FPS), f1 = Math.min(Math.round((c.at + c.to - c.from) * FPS), Math.round(stop * FPS));
    if (f1 > f0) plan.push({ ...c, f0, frames: f1 - f0 });
  });
}
const stray = cl.clips.filter(c => !seg[c.seg]).map(c => c.id);
if (stray.length) throw new Error(`clips in segments not in order: ${stray.join(', ')}`);
const marks = (wm?.at || []).map(m => {
  if (!wm.x[m.side]) throw new Error(`watermark side "${m.side}" not in watermark.x`);
  const f = Math.round((m.t ?? at(m.seg, m.line, m.cue)) * FPS);
  return { side: m.side, f, t: +(f / FPS).toFixed(4) };
});
for (const c of plan) console.log(`${c.id.padEnd(14)} ${(c.f0 / FPS).toFixed(2).padStart(8)}s  +${(c.frames / FPS).toFixed(2)}s  src ${c.from}${c.audio ? '  audio' : ''}`);
for (const m of marks) console.log(`watermark ${m.side.padEnd(5)} ${m.t}s  +${wm.dur}s`);
if (!flags.render && !flags.place && !flags.check) process.exit(0);

// 3. 成片用的片段：铺满裁切到画幅、整帧时长，标签用 textfile 读进 drawtext（任何语言、标点都不用转义）
const esc = p => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
if (flags.render) {
  fs.mkdirSync(work('footage'), { recursive: true });
  for (const c of plan) {
    const out = path.join(work('footage'), `${c.id}.mp4`);
    const vf = [`scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${W}:${H}`, `fps=${FPS}`];
    const label = c.label ?? cl.label;
    if (label) {
      const tf = path.join(work('footage'), `${c.id}.label.txt`);
      fs.writeFileSync(tf, label);
      if (fo.font && !fs.existsSync(cfg.abs(fo.font))) throw new Error(`footage.font ${fo.font} not found`);
      const font = fo.font ? `fontfile='${esc(cfg.abs(fo.font))}':` : '';
      const { size, margin } = fo.label;
      vf.push(`drawtext=${font}textfile='${esc(tf)}':expansion=none:fontsize=${size}:fontcolor=0xdddddd:box=1:boxcolor=0x000000@0.55:boxborderw=${Math.round(size / 2)}:x=w-tw-${margin + Math.round(size / 2)}:y=${margin}`);
    }
    const audio = c.audio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an'];
    ffmpeg(['-ss', String(c.from), '-i', src(c), '-t', (c.frames / FPS).toFixed(4), ...audio, '-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
    console.log('rendered', c.id);
  }
}

if (!flags.place && !flags.check) process.exit(0);
const bc = makeBc(cfg);
const inspect = (limit = 1) => bc(['videos', 'inspect', V, '--limit', String(limit)]);

// 4. 核对：记录里的片段还在不在、起点与现在算出的是否一致
if (flags.check) {
  const items = new Map(allItems(bc, V).items.map(it => [it.id, it]));
  const bad = [];
  for (const c of plan) {
    const r = log.footage[c.id], it = r && items.get(r.itemId);
    if (!r) bad.push(`${c.id}: not placed`);
    else if (!it) bad.push(`${c.id}: item ${r.itemId} gone`);
    else if (it.startFrame !== c.f0) bad.push(`${c.id}: at frame ${it.startFrame}, plan says ${c.f0} (${((c.f0 - it.startFrame) / FPS).toFixed(2)} s off)`);
  }
  for (const [id, r] of Object.entries(log.footage)) if (!plan.some(c => c.id === id)) bad.push(`${id}: placed but no longer in clips.json (item ${r.itemId})`);
  for (const r of log.watermarks) {
    const it = items.get(r.itemId);
    if (!it) bad.push(`watermark ${r.t}s: item ${r.itemId} gone`);
    else if (!marks.some(m => m.f === it.startFrame)) bad.push(`watermark ${r.t}s: at frame ${it.startFrame}, not where watermark.at puts one now`);
  }
  for (const m of marks) if (!log.watermarks.some(r => Math.round(r.t * FPS) === m.f)) bad.push(`watermark ${m.t}s: not placed`);
  console.log(bad.length ? 'CHECK FAILED\n' + bad.join('\n') : `check ok: ${plan.length} clips, ${log.watermarks.length} watermarks`);
  if (bad.length) process.exit(1);
  process.exit(0);
}

// 5. 放上时间线
const apply = (label, ops) => bc(['edits', 'apply', V, '--expected-revision', String(inspect().revision), '--label', label, '--operations', JSON.stringify(ops)]);
const trackId = name => {
  const find = () => inspect().tracks.find(x => x.kind === 'visual' && x.name === name);
  let t = find();
  if (!t) { apply(`Add ${name} track`, [{ type: 'addTrack', kind: 'visual', name }]); t = find(); }
  return t.id;
};
if (plan.length) {
  const T = trackId(cfg.names.footage);
  for (const c of plan) {
    if (log.footage[c.id]) continue;
    const file = path.join(work('footage'), `${c.id}.mp4`);
    if (!fs.existsSync(file)) throw new Error(`${file} missing; run --render first`);
    const a = bc(['assets', 'import', V, '--path', file, '--storage', 'managed', '--name', `${cfg.names.footage} ${c.id}`, '--place', JSON.stringify({ track: T, at: atOf(c.f0, FPS) })]);
    apply(`Style ${c.id}`, [{ type: 'setStyle', itemId: a.itemId, mode: 'fullscreen', fit: 'cover' }]);
    log.footage[c.id] = { itemId: a.itemId, assetId: a.assetId, f0: c.f0, frames: c.frames };
    save();
    console.log('placed', c.id, a.itemId);
  }
}
const todo = marks.filter(m => !log.watermarks.some(r => Math.round(r.t * FPS) === m.f));
if (wm && todo.length) {
  const S = trackId(cfg.names.watermark);
  const a = inspect().assets?.find(x => x.name === cfg.names.watermark) ?? bc(['assets', 'import', V, '--path', cfg.abs(wm.file), '--storage', 'managed', '--name', cfg.names.watermark]);
  const assetId = a.assetId ?? a.id;
  for (const m of todo) {
    const r = apply(`${cfg.names.watermark} ${m.t}s`, [{ type: 'addItem', asset: assetId, at: m.t, trackId: S, name: `${cfg.names.watermark} ${m.side}` }]);
    const itemId = r.createdIds?.[0];
    if (!itemId) throw new Error(`no item id in receipt: ${JSON.stringify(r).slice(0, 600)}`);
    apply(`${cfg.names.watermark} ${m.t}s layout`, [
      { type: 'trimItem', itemId, edge: 'end', at: m.t + wm.dur },
      { type: 'setStyle', itemId, mode: 'pip' },
      { type: 'setTransform', itemId, x: wm.x[m.side], y: wm.y, w: wm.w },
    ]);
    log.watermarks.push({ t: m.t, side: m.side, itemId });
    save();
    console.log('watermark', m.side, m.t, itemId);
  }
}
