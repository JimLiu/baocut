#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 量一遍时间线上「观众在看什么」：每一帧最上面铺满画面的是实拍、代码画面还是空的；镜头多长、实拍用了几段、哪段素材反复用、哪几段带原声。
// 只报数，不判对错：像幻灯片的片子（一张卡片停很久、实拍只是点缀）和实拍打底、卡片压在上面的片子数出来差别很大。
//   node coverage.mjs <videoId>              连 Runtime：跑 `<bc> videos inspect <videoId> --json` 读时间线
//   node coverage.mjs --from <file>          读 `baocut videos inspect <video> --limit 1000 --json` 存下的文件，不连 Runtime
//   --bc "<命令>"                            baocut CLI 的命令（空格分开），默认取环境变量 BAOCUT_BC，再默认 `baocut`
//   --json                                   结果以 JSON 打印（给别的脚本或报告用）
//   --alpha                                  代码包是透明的叠层（建包时开了 alpha、实拍铺在下面一条轨上）：它不占帧，算它下面的实拍
//   --bin <秒>                               分段条的粒度，默认 60
// 分类：video / image 片段铺满时算实拍（footage），放成画中画算 pip（不算谁拥有这一帧）；composition 算代码画面（code）；其余算 other。
// 一帧的「主人」是最上面一条可见视觉轨上铺满画面的片段（videos inspect 的 tracks 按叠放次序从下到上列）。
// 透明的代码包（只画卡片、底下垫实拍）不当主人：主人取它下面的片段，下面什么都没有时才算代码画面。inspect 不报透明与否，所以要告诉脚本。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2), flags = {}, ids = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) { ids.push(a); continue; }
  const k = a.slice(2);
  if (['from', 'bc', 'bin'].includes(k)) flags[k] = args[++i]; else flags[k] = true;
}

function bc(cmdArgs) {
  const [cmd, ...pre] = (flags.bc || process.env.BAOCUT_BC || 'baocut').split(/\s+/).filter(Boolean);
  let out;
  try {
    out = execFileSync(cmd, [...pre, ...cmdArgs, '--json'], { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'inherit'] });
  } catch (e) {
    out = e.stdout;
    if (!out) throw new Error(`${cmd} ${cmdArgs.slice(0, 2).join(' ')}: ${e.message}`);
  }
  const j = JSON.parse(out);
  if (!j.ok) throw new Error(`${cmdArgs.slice(0, 2).join(' ')}: ${out.slice(0, 1500)}`);
  return j.result ?? j;
}

// 分页读全部片段：一次最多 1000 条，截断时从最后一条的起点继续
function allItems(video) {
  const seen = new Map();
  for (let from = 0; ;) {
    const r = bc(['videos', 'inspect', video, '--from-seconds', String(from), '--limit', '1000']);
    for (const it of r.items) seen.set(it.id, it);
    if (!r.itemsCoverage?.truncated) return [...seen.values()].sort((a, b) => a.startFrame - b.startFrame);
    const next = r.items.at(-1).startSeconds;
    if (!(next > from)) throw new Error(`more than 1000 clips start at ${from}s; cannot page through them`);
    from = next;
  }
}

let snap;
if (flags.from) {
  const raw = JSON.parse(fs.readFileSync(flags.from, 'utf8'));
  snap = raw.result ?? raw;
  if (snap.itemsCoverage?.truncated) throw new Error(`${flags.from} lists only part of the timeline; dump it with --limit 1000 or run against the Runtime`);
} else {
  const video = ids[0];
  if (!video) throw new Error('usage: coverage.mjs <videoId> | --from <inspect json>');
  snap = { ...bc(['videos', 'inspect', video, '--limit', '1']), items: allItems(video) };
}
const fps = parseFloat(snap.sequence.fps) || 30;
const total = snap.sequence.durationFrames;
if (!(total > 0)) throw new Error('timeline is empty');

// 视觉轨从下到上；每条轨上的片段按起点排
const visual = snap.tracks.filter(t => t.kind === 'visual' && t.visible !== false);
const rank = new Map(visual.map((t, i) => [t.id, i]));
const isAlpha = () => !!flags.alpha;
const kindOf = it => (it.type === 'video' || it.type === 'image') ? (it.place?.mode === 'pip' ? 'pip' : 'footage') : it.type === 'composition' ? 'code' : 'other';
const items = snap.items.filter(it => rank.has(it.trackId) && it.enabled !== false && it.durationFrames > 0)
  .map(it => ({ ...it, kind: kindOf(it), overlay: it.type === 'composition' && isAlpha(it), end: it.startFrame + it.durationFrames }));

// 逐帧找主人：先按轨道从上到下，第一条在这一帧有铺满片段的轨道；透明代码包先跳过，这一帧下面什么都没有时再由它占
const byTrack = visual.map(t => items.filter(it => it.trackId === t.id && it.kind !== 'pip').sort((a, b) => a.startFrame - b.startFrame));
const owner = new Array(total).fill(null);
for (const pass of [false, true]) for (let r = byTrack.length - 1; r >= 0; r--) for (const it of byTrack[r]) {
  if (it.overlay !== pass) continue;
  for (let f = Math.max(0, it.startFrame); f < Math.min(total, it.end); f++) if (!owner[f]) owner[f] = it;
}
const overlays = items.filter(it => it.overlay).length;
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
  overlays,
  screen: { footage: share.footage / total, code: share.code / total, other: share.other / total, empty: share.empty / total, pip: pipFrames / total },
  shots: { count: real.length, medianSeconds: +median.toFixed(2), longest: longest ? { seconds: +secs(longest.frames).toFixed(2), at: +secs(longest.start).toFixed(2), kind: longest.kind, name: longest.item.name } : null },
  longestWithoutFootage: { seconds: +secs(noFootage.frames).toFixed(2), at: +secs(noFootage.start).toFixed(2) },
  footage: { items: footage.length, seconds: +secs(footage.reduce((a, it) => a + it.durationFrames, 0)).toFixed(2), withAudio: withAudio.length, withAudioSeconds: +secs(withAudio.reduce((a, it) => a + it.durationFrames, 0)).toFixed(2), distinctAssets: uses.size, repeated },
  bins,
};
if (flags.json) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

console.log(`runtime ${mmss(report.durationSeconds)}  fps ${fps}  visual tracks ${visual.length}`);
if (overlays) console.log(`transparent code bundles ${overlays}: counted as overlays, the item under them owns the frame (cards drawn on them are not measured here)`);
console.log(`on screen: footage ${pct(share.footage)}  code ${pct(share.code)}  other ${pct(share.other)}  empty ${pct(share.empty)}  (pip on top ${pct(pipFrames)})`);
console.log(`shots ${real.length}  median ${median.toFixed(1)}s  longest ${longest ? `${secs(longest.frames).toFixed(1)}s ${longest.kind} "${longest.item.name}" at ${mmss(secs(longest.start))}` : '-'}  (a shot = one full-frame item on top; a code bundle is one shot however much it animates inside)`);
console.log(`longest stretch without full-frame footage ${secs(noFootage.frames).toFixed(1)}s at ${mmss(secs(noFootage.start))}`);
console.log(`footage items ${footage.length} (${secs(footage.reduce((a, it) => a + it.durationFrames, 0)).toFixed(0)}s), with original audio ${withAudio.length} (${report.footage.withAudioSeconds}s), distinct assets ${uses.size}${repeated.length ? `, used 3+ times: ${repeated.map(r => `${r.name}×${r.uses}`).join(', ')}` : ''}`);
const bar = x => '█'.repeat(Math.round(x * 10)).padEnd(10, '·');
for (const b of bins) console.log(`${mmss(b.at).padStart(6)} ${bar(b.footage)} footage ${(b.footage * 100).toFixed(0).padStart(3)}%  code ${(b.code * 100).toFixed(0).padStart(3)}%`);
console.log('\nfor reference: a footage-based clip montage usually measures footage 80–95% with cards on top, median shot 3–6s, no stretch over ~20s without footage;');
console.log('a code-visual explainer measures code 80%+ by design — the numbers only say what is on screen, not whether it is right for this episode.');
