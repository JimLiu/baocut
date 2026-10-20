#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文，给人看的名字从配置来
// 量一遍时间线上「观众在看什么」：每一帧最上面铺满画面的是实拍、代码画面还是空的；镜头多长、实拍用了几段、哪段素材反复用。
// 只报数，不判对错：像幻灯片的片子（一张卡片停很久、实拍只是点缀）和纪录片式的片子（实拍打底、卡片压在上面）数出来差别很大，
// 哪一种对要看这期定的形态（SKILL.md 第 3 节）。
//   node tools/coverage.mjs                  连 Runtime 读 explainer.json 里的视频
//   node tools/coverage.mjs --from <file>    读 `baocut videos inspect <video> --limit 1000 --json` 存下的文件，不连 Runtime
//   node tools/coverage.mjs --json           结果以 JSON 打印（给别的脚本或报告用）
//   --bin <秒>                               分段条的粒度，默认 60
// 分类：video / image 片段铺满时算实拍（footage），放成画中画算 pip（不算谁拥有这一帧）；composition 算代码画面（code）；其余算 other。
// 一帧的「主人」是最上面一条可见视觉轨上铺满画面的片段（videos inspect 的 tracks 按叠放次序从下到上列）。
import fs from 'node:fs';
import { loadConfig, parseArgs, makeBc, allItems } from './lib.mjs';

const { flags } = parseArgs(process.argv, ['from', 'bin']);
let cfg = null;
try { cfg = loadConfig(); } catch (e) { if (!flags.from) throw e; }

let snap;
if (flags.from) {
  const raw = JSON.parse(fs.readFileSync(flags.from, 'utf8'));
  snap = raw.result ?? raw;
  if (snap.itemsCoverage?.truncated) throw new Error(`${flags.from} lists only part of the timeline; dump it with --limit 1000 or run without --from`);
} else {
  const bc = makeBc(cfg);
  const head = bc(['videos', 'inspect', cfg.video, '--limit', '1']);
  snap = { ...head, items: allItems(bc, cfg.video).items };
}
const fps = parseFloat(snap.sequence.fps) || cfg?.fps || 30;
const total = snap.sequence.durationFrames;
if (!(total > 0)) throw new Error('timeline is empty');

// 视觉轨从下到上；每条轨上的片段按起点排
const visual = snap.tracks.filter(t => t.kind === 'visual' && t.visible !== false);
const rank = new Map(visual.map((t, i) => [t.id, i]));
const kindOf = it => (it.type === 'video' || it.type === 'image') ? (it.place?.mode === 'pip' ? 'pip' : 'footage') : it.type === 'composition' ? 'code' : 'other';
const items = snap.items.filter(it => rank.has(it.trackId) && it.enabled !== false && it.durationFrames > 0)
  .map(it => ({ ...it, kind: kindOf(it), end: it.startFrame + it.durationFrames }));

// 逐帧找主人：先按轨道从上到下，第一条在这一帧有铺满片段的轨道
const byTrack = visual.map(t => items.filter(it => it.trackId === t.id && it.kind !== 'pip').sort((a, b) => a.startFrame - b.startFrame));
const owner = new Array(total).fill(null);
for (let r = byTrack.length - 1; r >= 0; r--) for (const it of byTrack[r]) {
  for (let f = Math.max(0, it.startFrame); f < Math.min(total, it.end); f++) if (!owner[f]) owner[f] = it;
}
const pipOn = new Uint8Array(total);
for (const it of items) if (it.kind === 'pip') for (let f = Math.max(0, it.startFrame); f < Math.min(total, it.end); f++) pipOn[f] = 1;

const secs = n => n / fps;
const pct = n => `${(100 * n / total).toFixed(0)}%`;
const share = { footage: 0, code: 0, other: 0, empty: 0 };
for (const o of owner) share[o ? o.kind : 'empty']++;
const pipFrames = pipOn.reduce((a, b) => a + b, 0);

// 镜头：主人连续不变的一段；空的不算镜头，但算进「多久没有实拍」
const shots = [];
for (let f = 0; f < total; f++) {
  const o = owner[f];
  if (shots.length && shots.at(-1).item === o) shots.at(-1).frames++;
  else shots.push({ item: o, kind: o ? o.kind : 'empty', start: f, frames: 1 });
}
const real = shots.filter(s => s.item);
const lens = real.map(s => s.frames).sort((a, b) => a - b);
const median = lens.length ? secs(lens[lens.length >> 1]) : 0;
const longest = real.length ? real.reduce((a, b) => (b.frames > a.frames ? b : a)) : null;
// 连续没有实拍（铺满的 video / image）的最长一段
let noFootage = { start: 0, frames: 0 }, run = null;
for (let f = 0; f <= total; f++) {
  const isFootage = f < total && owner[f]?.kind === 'footage';
  if (!isFootage && f < total) { run ??= { start: f, frames: 0 }; run.frames++; }
  else if (run) { if (run.frames > noFootage.frames) noFootage = run; run = null; }
}

// 实拍片段：几段、多长、带原声的几段（素材本身有音轨且没静音）、同一素材用了几次（画中画的水印、角标不算）
const footage = items.filter(it => it.kind === 'footage' || it.kind === 'pip');
const hasAudio = it => it.embeddedAudio?.enabled && (snap.assets?.find(a => a.id === it.asset?.id)?.hasAudio ?? true);
const withAudio = footage.filter(hasAudio);
const uses = new Map();
for (const it of footage) if (it.kind === 'footage') { const k = it.asset?.id ?? it.id; uses.set(k, (uses.get(k) || 0) + 1); }
const repeated = [...uses.entries()].filter(([, n]) => n >= 3).map(([id, n]) => ({ assetId: id, name: footage.find(it => it.asset?.id === id)?.asset?.name ?? id, uses: n }));

// 分段条：每一格里实拍占多少
const binSec = Number(flags.bin) > 0 ? Number(flags.bin) : 60;
const binFrames = Math.round(binSec * fps);
const bins = [];
for (let f = 0; f < total; f += binFrames) {
  const n = Math.min(binFrames, total - f);
  let fo = 0, co = 0;
  for (let i = f; i < f + n; i++) { const k = owner[i]?.kind; if (k === 'footage') fo++; else if (k === 'code') co++; }
  bins.push({ at: secs(f), footage: fo / n, code: co / n });
}

const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const report = {
  durationSeconds: +secs(total).toFixed(2), fps,
  screen: { footage: share.footage / total, code: share.code / total, other: share.other / total, empty: share.empty / total, pip: pipFrames / total },
  shots: { count: real.length, medianSeconds: +median.toFixed(2), longest: longest ? { seconds: +secs(longest.frames).toFixed(2), at: +secs(longest.start).toFixed(2), kind: longest.kind, name: longest.item.name } : null },
  longestWithoutFootage: { seconds: +secs(noFootage.frames).toFixed(2), at: +secs(noFootage.start).toFixed(2) },
  footage: { items: footage.length, seconds: +secs(footage.reduce((a, it) => a + it.durationFrames, 0)).toFixed(2), withAudio: withAudio.length, withAudioSeconds: +secs(withAudio.reduce((a, it) => a + it.durationFrames, 0)).toFixed(2), distinctAssets: uses.size, repeated },
  bins,
};
if (flags.json) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

console.log(`runtime ${mmss(report.durationSeconds)}  fps ${fps}  visual tracks ${visual.length}`);
console.log(`on screen: footage ${pct(share.footage)}  code ${pct(share.code)}  other ${pct(share.other)}  empty ${pct(share.empty)}  (pip on top ${pct(pipFrames)})`);
console.log(`shots ${real.length}  median ${median.toFixed(1)}s  longest ${longest ? `${secs(longest.frames).toFixed(1)}s ${longest.kind} "${longest.item.name}" at ${mmss(secs(longest.start))}` : '-'}  (a shot = one full-frame item on top; a code bundle is one shot however much it animates inside)`);
console.log(`longest stretch without full-frame footage ${secs(noFootage.frames).toFixed(1)}s at ${mmss(secs(noFootage.start))}`);
console.log(`footage items ${footage.length} (${secs(footage.reduce((a, it) => a + it.durationFrames, 0)).toFixed(0)}s), with original audio ${withAudio.length} (${report.footage.withAudioSeconds}s), distinct assets ${uses.size}${repeated.length ? `, used 3+ times: ${repeated.map(r => `${r.name}×${r.uses}`).join(', ')}` : ''}`);
const bar = x => '█'.repeat(Math.round(x * 10)).padEnd(10, '·');
for (const b of bins) console.log(`${mmss(b.at).padStart(6)} ${bar(b.footage)} footage ${(b.footage * 100).toFixed(0).padStart(3)}%  code ${(b.code * 100).toFixed(0).padStart(3)}%`);
console.log('\nfor reference: a documentary-style cut usually measures footage 80–95% with cards on top, median shot 3–6s, no stretch over ~20s without footage;');
console.log('a code-visual explainer measures code 80%+ by design — which is right depends on the form chosen for this episode (SKILL.md §3).');
