#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文，给人看的名字与标签从配置来
// 叠在代码画面之上的几层：实拍片段（footage 轨）、来源标签（label 轨）、原声的双语字幕（字幕轨）与水印（watermark 轨）。
// 全部写在时间线上，不剪、不烧、不转码：每个原片链接导入一次，每个镜头是一个视频片段，原片区间在 timeMap、裁剪与取景在
// crop / focalPoint、原声的音量与淡入淡出在 embeddedAudio，转场是时间线转场。都是可选的：没有 clips.json、配置里没有 watermark 就跳过。
//   node tools/overlay.mjs [--dry]          打印每个片段与水印在时间线上的起止（默认，不连 Runtime）
//   node tools/overlay.mjs --place [seg …]  导入原片（linked）、按段放片段与标签、建原声字幕、放水印；记在 overlay.json，已放过的不重放
//   node tools/overlay.mjs --check          对照视频里的片段、标签与字幕和现在算出的计划（assemble 波纹挪过、段落改过之后跑）
// clips.json：{ source, label, clips: [{ id, seg, line, cue?, head?, gap?, follow?, from, to, source?, label?, audio?, subs?, note? }] }
//   from / to 是原片的秒数；片段从 seg 段第 line 句（从 0 数）开始放；cue 可省，给了就从这句里 cue 这几个字被说到的时刻开始。
//   同一段里下一个片段开始时截断，不越过段尾。label 是画面一角的来源标签（成片语言写，例如「画面：<来源>」），
//   单个片段可以另给 source 与 label；audio 为 true 时保留原声（当事人原话、现场声），否则静音；给数字是在响度对齐之上再乘的音量（0–1）。
//   follow 为 true 的片段不看 line / cue，紧接着 clips.json 里上一个片段的原长之后放（几段素材连成一整块，中间硬切）。
//   head 为 true 的片段不看 line / cue，从段首放：段首到第一句之间有零点几秒的空，实拍垫底（under）时这段露出画布底色，
//   每段的第一个镜头带上 head 就盖住了（片段长度要算到段首起）。
//   gap 为 true 的片段让旁白停下来单独放：先跑 gaps.mjs 在旁白里留白，片段放在留白的起点（line 是插在哪一句之前）。
//   subs：[{ from, to, text, tr, who? }]，from / to 是原片秒数，text 成片语言、tr 原话、who 说话人。同一原片的 subs 写成一份转写
//   （原话，按 subs 的起止摊开词时间）和一份译文（text），再建成双语字幕层：成片语言在上、原话在下、说话人名字在最上面，样式与旁白字幕分开。
//   after：从第 after 句念完的时刻放（负数从末句倒数，true 是末句），用在段尾 hold 里放一句原声；offset（秒）在任何起点之上再挪。
//   只有声音的片段：来源是录音文件（mp3 / wav / m4a / aac / flac / ogg / opus），或视频片段写 video: false。要带 audio，
//   放在单独一条音频轨（names.quote）上，起点精确到子帧（原声与场景里逐词点亮的字对得上），没有画面、裁剪、画中画与转场；
//   来源标签只在片段自己写了 label 时放（顶层的 label 不套用，通常由场景画出处）。asset 可给已在视频里的素材 ID（例如正片的录音），
//   这时不再按 source 导入，source 仍用来量响度。words 为 true 时 quotes.mjs 给它对出逐词时间，build.mjs 写进这一段的 TIMING.clips。
//   in / out：{ kind, dur?, easing? } 单侧转场（kind 取 dissolve / wipe / slide / zoom / iris，dur 秒数缺省 0.5，easing 缺省 ease-in-out），
//   片段从下面的代码画面里渐入、渐出；和前后片段首尾相接的那一侧不做（同一条轨上背靠背只能硬切）。原声的淡入淡出跟着转场的长度走，没有转场时 0.15 / 0.3 秒。
//   crop：[x, y, w, h] 按原片像素裁掉黑边、色条，按素材记录里的原片宽高换成四边比例；focus：[s, dx, dy] 放大 s 倍、画面中心挪到离正中
//   dx%、dy%（正数往左、往上），换成 focalPoint。fit 为 contain 时整幅放进画面、两侧补黑（4:3 的老转播），缺省 cover 铺满裁切。
//   pip：{ x, y, w } 画中画，不铺满：x、y 是框中心、w 是框宽（画布宽高的百分比），高按原片（裁过之后）的宽高比；代码画面在下面照常讲。
//   画中画的来源标签贴在框的一角。转场作用在框上。
//   原声的响度：放上之前用 ffmpeg 的 ebur128 只读地量一遍放上去的那段原片（不写文件），换成片段音量 10^((footage.loudness − 实测) / 20)，夹在 0–4。
//   来源是图片（png / jpg / webp / bmp / tif）时 from / to 只定时长（写 0 和秒数），整段停在这张图上；不能带 audio。
//   图片推拉（Ken Burns，旧版的 motion）现在没有时间线上的写法：带 motion 的片段报错，换成不动的图或一段视频。
// 配置 footage：{ clips, layer, loudness, label: { size, corner, inset: { x, y }, w, color, background, font }, subs: { y, fontSize, font, speaker: { scale, color }, language } }；
//   watermark：{ file, dur, w, y, x: { left, right }, at: [...] }。
//   layer 缺省 over（实拍盖在代码画面上面）；under 时实拍轨放到代码包那条轨的下面当底，包要透明（bundle.alpha 为 true，场景只画要叠的卡片与标注），
//   实拍之外的时刻露出的是画布底色（空），用 coverage.mjs 看有多少空着。标签轨总在最上面。
//   label.corner 取 top-right（缺省）/ top-left / bottom-right / bottom-left，inset 是离画面边的距离（画面宽高的百分比），size 是画布像素。
//   subs.language 是原话的语言（缺省 en）；译文的语言是配置的 language。
//   at 的每一项是 { seg, line, cue?, side } 或 { t, side }（时间线秒数），side 取 left / right；x、y、w 是画面宽高的百分比。
//   单个水印可以另给 x、y（百分比）放在别处：穿插在片中、换着位置放，裁掉一角也去不掉。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadConfig, parseArgs, makeBc, readJson, writeJson, layout, atOf, cueTime, clipTimes, allItems, cropFraction, focalOf, mediaTime, isAudioOnly } from './lib.mjs';

const cfg = loadConfig();
const { ids, flags } = parseArgs(process.argv);
if (flags.render || flags.preview) throw new Error('--render and --preview are gone: footage is placed straight from the source files (--place), nothing is cut ahead');
const FPS = cfg.fps, V = cfg.video, { width: W, height: H } = cfg.canvas;
const fo = {
  clips: 'clips.json', loudness: -17, ...cfg.footage,
  label: { size: 26, corner: 'top-right', w: 40, color: '#DDDDDD', background: '#0000008C', font: null, ...cfg.footage?.label, inset: { x: 2.4, y: 4, ...cfg.footage?.label?.inset } },
  subs: { y: 88, fontSize: null, font: null, language: 'en', ...cfg.footage?.subs, speaker: { scale: 0.62, color: '#BBBBBB', ...cfg.footage?.subs?.speaker } },
};
const wm = cfg.watermark ? { dur: 5, w: 6, y: 70, x: { left: 5, right: 95 }, at: [], ...cfg.watermark } : null;
if (fo.layer && !['over', 'under'].includes(fo.layer)) throw new Error(`footage.layer "${fo.layer}" not one of over, under`);
const CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
if (!CORNERS.includes(fo.label.corner)) throw new Error(`footage.label.corner "${fo.label.corner}" not one of ${CORNERS.join(', ')}`);
const under = fo.layer === 'under';
if (under && !cfg.bundle.alpha) console.log('warning: footage.layer is under but bundle.alpha is not true; opaque code scenes will hide the footage (set bundle.alpha and rebuild)');
const cl = readJson(cfg.abs(fo.clips), { clips: [] });
const logFile = cfg.abs('overlay.json');
const log = { video: V, assets: {}, footage: {}, loudness: {}, bites: {}, watermarks: [], ...readJson(logFile, {}) };
if (log.video !== V) throw new Error(`overlay.json belongs to ${log.video}, config says ${V}`);
const save = () => writeJson(logFile, log);
const src = c => c.source || cl.source;
const audioOnly = c => isAudioOnly(c, src(c));
// 只有声音的片段不套用顶层的 label（出处通常由场景画），自己写了才放
const labelOf = c => (audioOnly(c) ? (typeof c.label === 'string' ? c.label : null) : c.label ?? cl.label ?? null);
const KINDS = ['dissolve', 'wipe', 'slide', 'zoom', 'iris'];
const IMAGE = /\.(png|jpe?g|webp|bmp|tiff?)$/i;
const isImage = c => IMAGE.test(src(c));
for (const c of cl.clips) {
  for (const side of ['in', 'out']) if (c[side] && !KINDS.includes(c[side].kind)) throw new Error(`${c.id}: ${side}.kind "${c[side].kind}" not one of ${KINDS.join(', ')}`);
  if (isImage(c) && c.audio) throw new Error(`${c.id}: ${src(c)} is a still image and has no sound; drop audio`);
  if (audioOnly(c) && !c.audio) throw new Error(`${c.id}: ${src(c)} is placed as sound only (an audio file, or video: false); give it audio: true`);
  if (audioOnly(c) && (c.pip || c.crop || c.focus || c.in || c.out)) throw new Error(`${c.id}: a sound-only clip has no picture; drop pip, crop, focus, in and out`);
  if (c.motion) throw new Error(`${c.id}: motion (Ken Burns) has no timeline form yet; drop it, or use a video clip`);
  if (c.crop && !(Array.isArray(c.crop) && c.crop.length === 4)) throw new Error(`${c.id}: crop is [x, y, w, h] in source pixels`);
  if (c.focus) focalOf(c.focus);
  if (c.pip && (!['x', 'y', 'w'].every(k => Number.isFinite(c.pip[k])) || c.pip.w <= 0)) throw new Error(`${c.id}: pip needs numeric x, y and a positive w (percent of the canvas)`);
  for (const s of c.subs || []) if (!(s.to > s.from && s.from >= c.from - 0.05 && s.to <= c.to + 0.05) || !s.text || !s.tr) throw new Error(`${c.id}: each sub needs text, tr and from < to inside the clip (${c.from}–${c.to})`);
}

// 1. 排时间：段起点（与 assemble.mjs 同一套整帧累加）+ 这一句或 cue 的对齐时刻
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
  const mine = cl.clips.filter(c => c.seg === s.id), t0 = mine.length ? clipTimes(timing(s.id), mine) : {};
  const cs = mine.map(c => ({ ...c, at: s.from / FPS + t0[c.id] })).sort((a, b) => a.at - b.at);
  const lead = cs.find(c => !c.pip);
  if (under && lead && lead.at - s.from / FPS >= 1 / FPS) console.log(`warning: ${s.id} has no footage for its first ${(lead.at - s.from / FPS).toFixed(2)}s (the canvas shows); give ${lead.id} head: true`);
  cs.forEach((c, i) => {
    const end = (s.from + s.frames) / FPS, stop = Math.min(cs[i + 1]?.at ?? Infinity, end);
    if (c.at + c.to - c.from > end + 0.5 / FPS && stop === end) console.log(`warning: ${c.id} runs ${(c.at + c.to - c.from - end).toFixed(2)}s past the end of ${s.id}; cut at the segment end (shorten to, or move the clip earlier)`);
    // 只有声音的片段按精确时刻放（整帧 + 子帧），画面片段按最近的整帧
    const f0 = audioOnly(c) ? Math.floor(c.at * FPS + 1e-9) : Math.round(c.at * FPS), f1 = Math.min(Math.round((c.at + c.to - c.from) * FPS), Math.round(stop * FPS));
    if (f1 > f0) plan.push({ ...c, f0, frames: f1 - f0, play: Math.min(c.to - c.from, stop - c.at) });
  });
}
// 转场：首尾和别的片段相接的一侧不做；长度不超过片段的一半
plan.sort((a, b) => a.f0 - b.f0);
plan.forEach((c, i) => {
  const prev = plan[i - 1], next = plan[i + 1];
  if (audioOnly(c)) { c.tin = c.tout = null; return; }
  const tr = (t, touching) => t && !touching ? { kind: t.kind, easing: t.easing || 'ease-in-out', frames: Math.min(Math.round((t.dur ?? 0.5) * FPS), Math.floor(c.frames / 2)) } : null;
  c.tin = tr(c.in, prev && prev.f0 + prev.frames >= c.f0);
  c.tout = tr(c.out, next && c.f0 + c.frames >= next.f0);
});
const stray = cl.clips.filter(c => !seg[c.seg]).map(c => c.id);
if (stray.length) throw new Error(`clips in segments not in order: ${stray.join(', ')}`);
const marks = (wm?.at || []).map(m => {
  if (m.x == null && !wm.x[m.side]) throw new Error(`watermark side "${m.side}" not in watermark.x (or give the mark its own x)`);
  const f = Math.round((m.t ?? at(m.seg, m.line, m.cue)) * FPS);
  return { side: m.side, f, t: +(f / FPS).toFixed(4), x: m.x ?? wm.x[m.side], y: m.y ?? wm.y };
});
for (const c of plan) console.log(`${c.id.padEnd(16)} ${(c.f0 / FPS).toFixed(2).padStart(8)}s  +${(c.frames / FPS).toFixed(2)}s  src ${c.from}${c.gap ? '  gap' : ''}${c.audio ? `  audio${typeof c.audio === 'number' ? ' ' + c.audio : ''}` : ''}${c.subs ? `  subs:${c.subs.length}` : ''}${c.pip ? `  pip ${c.pip.x},${c.pip.y} w${c.pip.w}` : ''}${c.crop ? `  crop ${c.crop.join(',')}` : ''}${c.focus ? `  focus ${c.focus.join(',')}` : ''}${isImage(c) ? '  still' : ''}${audioOnly(c) ? '  sound only' : ''}${c.tin ? `  in ${c.tin.kind} ${(c.tin.frames / FPS).toFixed(2)}` : ''}${c.tout ? `  out ${c.tout.kind} ${(c.tout.frames / FPS).toFixed(2)}` : ''}`);
for (const m of marks) console.log(`watermark ${String(m.side ?? '').padEnd(5)} ${m.t}s  +${wm.dur}s  at ${m.x},${m.y}`);
if (!flags.place && !flags.check) process.exit(0);

// 原声的响度：只读地量放上去的那一段（ebur128 的积分响度），按来源与起止缓存在 overlay.json
const spanKey = c => `${src(c)}|${c.from}|${(audioOnly(c) ? c.play : c.frames / FPS).toFixed(3)}`;
function ebur(c) {
  const key = spanKey(c);
  if (log.loudness[key] !== undefined) return log.loudness[key];
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-ss', String(c.from), '-t', (audioOnly(c) ? c.play : c.frames / FPS).toFixed(3), '-i', src(c), '-vn', '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const hit = [...(r.stderr || '').matchAll(/I:\s+(-?[\d.]+|-inf)\s+LUFS/g)].at(-1);
  if (!hit) throw new Error(`${c.id}: loudness of ${src(c)} not measured (ffmpeg exit ${r.status}): ${(r.stderr || '').slice(-400)}`);
  const lufs = hit[1] === '-inf' ? null : +hit[1];
  log.loudness[key] = lufs;
  save();
  return lufs;
}
const volumeOf = c => {
  const lufs = ebur(c), gain = typeof c.audio === 'number' ? c.audio : 1;
  if (lufs === null) return { volume: gain, lufs };
  const raw = Math.pow(10, (fo.loudness - lufs) / 20) * gain;
  if (raw > 4) console.log(`warning: ${c.id} measures ${lufs} LUFS; reaching ${fo.loudness} needs ×${raw.toFixed(2)}, clamped to ×4`);
  return { volume: +Math.min(Math.max(raw, 0), 4).toFixed(4), lufs };
};

const bc = makeBc(cfg);
const inspect = (limit = 1) => bc(['videos', 'inspect', V, '--limit', String(limit)]);
const subsHash = list => 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(list.map(({ c, s }) => [c.id, s.from, s.to, s.who ?? null, s.text, s.tr]))).digest('hex').slice(0, 24);
const bitesBySource = () => {
  const out = new Map();
  for (const c of plan) for (const s of c.subs || []) {
    if (!out.has(src(c))) out.set(src(c), []);
    out.get(src(c)).push({ c, s });
  }
  for (const list of out.values()) list.sort((a, b) => a.s.from - b.s.from);
  return out;
};
const labelText = c => labelOf(c);

// 2. 核对：记录里的片段、标签与字幕还在不在、起点与现在算出的是否一致
if (flags.check) {
  const items = new Map(allItems(bc, V).items.map(it => [it.id, it]));
  const bad = [];
  for (const c of plan) {
    const r = log.footage[c.id], it = r && items.get(r.itemId);
    if (!r) { bad.push(`${c.id}: not placed`); continue; }
    if (!it) bad.push(`${c.id}: item ${r.itemId} gone`);
    else if (it.startFrame !== c.f0) bad.push(`${c.id}: at frame ${it.startFrame}, plan says ${c.f0} (${((c.f0 - it.startFrame) / FPS).toFixed(2)} s off)`);
    else if (r.frames !== c.frames) bad.push(`${c.id}: ${r.frames} frames long, plan says ${c.frames}`);
    if (r.from !== undefined && r.from !== c.from) bad.push(`${c.id}: plays the source from ${r.from}s, clips.json says ${c.from}s`);
    if (c.audio && log.loudness[spanKey(c)] === undefined) bad.push(`${c.id}: loudness not measured for the current span`);
    const label = labelText(c);
    if (label && !r.labelItemId) bad.push(`${c.id}: no source label`);
    else if (r.labelItemId && !items.get(r.labelItemId)) bad.push(`${c.id}: label item ${r.labelItemId} gone`);
    else if (r.labelItemId && r.label !== label) bad.push(`${c.id}: label says "${r.label}", clips.json says "${label}"`);
  }
  for (const [id, r] of Object.entries(log.footage)) if (!plan.some(c => c.id === id)) bad.push(`${id}: placed but no longer in clips.json (item ${r.itemId})`);
  for (const [file, list] of bitesBySource()) {
    const b = log.bites[file];
    if (!b) bad.push(`subs of ${path.basename(file)}: no captions`);
    else {
      if (b.hash !== subsHash(list)) bad.push(`subs of ${path.basename(file)}: changed since the captions were made (delete the caption items ${b.itemIds.join(', ')} and its entry in overlay.json bites, then --place)`);
      for (const id of b.itemIds) if (!items.get(id)) bad.push(`subs of ${path.basename(file)}: caption item ${id} gone`);
    }
  }
  for (const r of log.watermarks) {
    const it = items.get(r.itemId);
    if (!it) bad.push(`watermark ${r.t}s: item ${r.itemId} gone`);
    else if (!marks.some(m => m.f === it.startFrame)) bad.push(`watermark ${r.t}s: at frame ${it.startFrame}, not where watermark.at puts one now`);
  }
  for (const m of marks) if (!log.watermarks.some(r => Math.round(r.t * FPS) === m.f)) bad.push(`watermark ${m.t}s: not placed`);
  console.log(bad.length ? 'CHECK FAILED\n' + bad.join('\n') : `check ok: ${plan.length} clips, ${Object.keys(log.bites).length} sound-bite caption layers, ${log.watermarks.length} watermarks`);
  process.exit(bad.length ? 1 : 0);
}

// 3. 放上时间线
const apply = (label, ops) => bc(['edits', 'apply', V, '--expected-revision', String(inspect().revision), '--label', label, '--operations', JSON.stringify(ops)]);
const trackId = (name, kind = 'visual') => {
  const find = () => inspect().tracks.find(x => x.kind === kind && x.name === name);
  let t = find();
  if (!t) { apply(`Add ${name} track`, [{ type: 'addTrack', kind, name }]); t = find(); }
  return t.id;
};
const labelName = `${cfg.names.footage} · label`;
const todoClips = plan.filter(c => !log.footage[c.id] && (!ids.length || ids.includes(c.seg)));

// 3a. 每个原片链接导入一次；宽高与版本取素材记录
const assetOf = (file, { needSize = true, assetId = null } = {}) => {
  if (assetId) {
    const rec = inspect().assets?.find(a => a.id === assetId);
    if (!rec?.revision) throw new Error(`asset ${assetId} not in videos inspect`);
    return { assetId, ...(rec.size ? sizeOf(rec) : { revision: rec.revision }) };
  }
  const known = log.assets[file];
  const listed = inspect().assets?.find(a => a.id === known?.assetId);
  if (listed?.revision && (listed.size || !needSize)) return { ...known, ...(listed.size ? sizeOf(listed) : { revision: listed.revision }) };
  if (!known) {
    if (!fs.existsSync(file)) throw new Error(`source ${file} not found`);
    const a = bc(['assets', 'import', V, '--path', file, '--storage', 'linked', '--name', path.basename(file)]);
    log.assets[file] = { assetId: a.assetId };
    save();
    console.log('linked', path.basename(file), a.assetId);
  }
  const rec = inspect().assets?.find(a => a.id === log.assets[file].assetId);
  if (!rec?.revision) throw new Error(`asset ${log.assets[file].assetId} for ${file} not in videos inspect; was it removed?`);
  if (!rec.size && needSize) throw new Error(`asset ${rec.id} (${path.basename(file)}) has no picture size in its record; crop and pip need it`);
  return { ...log.assets[file], ...(rec.size ? sizeOf(rec) : { revision: rec.revision }) };
};
const sizeOf = rec => { const [w, h] = rec.size.split('x').map(Number); return { revision: rec.revision, w, h }; };

if (todoClips.length) {
  const T = todoClips.some(c => !audioOnly(c)) ? trackId(cfg.names.footage) : null;
  const QA = todoClips.some(audioOnly) ? trackId(cfg.names.quote, 'audio') : null;
  // footage.layer 为 under：实拍轨挪到代码包那条轨下面（包要透明，bundle.alpha）；tracks 按叠放次序从下到上列
  if (under && T) {
    const vs = inspect().tracks.filter(x => x.kind === 'visual');
    const base = cfg.tracks?.visual || vs.find(x => ![cfg.names.footage, cfg.names.watermark, labelName].includes(x.name))?.id;
    if (base && vs.findIndex(x => x.id === T) > vs.findIndex(x => x.id === base)) {
      apply(`Move ${cfg.names.footage} track under the code scenes`, [{ type: 'moveTrack', trackId: T, target: base, position: 'below' }]);
      console.log('footage track moved under', base);
    }
  }
  const needLabels = todoClips.some(labelText);
  const L = needLabels ? trackId(labelName) : null;
  if (L) {
    const vs = inspect().tracks.filter(x => x.kind === 'visual');
    const top = vs.at(-1);
    if (top && top.id !== L) apply(`Move ${labelName} track to the top`, [{ type: 'moveTrack', trackId: L, target: top.id, position: 'above' }]);
  }
  const fontSize = px => +(px * 540 / Math.min(W, H)).toFixed(2);
  for (const segId of [...new Set(todoClips.map(c => c.seg))]) {
    const batch = todoClips.filter(c => c.seg === segId);
    const items = [], meta = [];
    for (const c of batch) {
      if (audioOnly(c)) {
        // 只有声音：一个音频片段，起点 = 整帧 + 子帧，长度按原片秒数（不越过下一个片段与段尾）
        const a = assetOf(src(c), { needSize: false, assetId: c.asset || null });
        const audio = volumeOf(c), name = `${cfg.names.quote} ${c.id}`;
        const fadeIn = c.fadeIn ?? 0.08, fadeOut = c.fadeOut ?? 0.45;
        items.push({
          type: 'audio', trackId: QA, name, assetRef: { id: a.assetId, revision: a.revision },
          fromFrame: c.f0, subframeOffset: mediaTime(Math.max(0, c.at - c.f0 / FPS)), playDuration: mediaTime(c.play),
          timeMap: { kind: 'linear', sourceIn: mediaTime(c.from), rate: { num: 1, den: 1 } },
          mix: { volume: audio.volume, fadeIn: mediaTime(fadeIn), fadeOut: mediaTime(fadeOut) },
        });
        const label = labelText(c);
        if (label) items.push(labelItem(c, label, L, null, null, fontSize));
        meta.push({ c, name, label, audio, assetId: a.assetId });
        continue;
      }
      const a = assetOf(src(c));
      const image = isImage(c);
      const crop = c.crop ? cropFraction(c.crop, a.w, a.h) : null;
      const audio = c.audio ? volumeOf(c) : null;
      const fadeIn = c.tin ? c.tin.frames / FPS : 0.15, fadeOut = c.tout ? c.tout.frames / FPS : 0.3;
      const name = `${cfg.names.footage} ${c.id}`;
      items.push({
        type: image ? 'image' : 'video', trackId: T, name, role: 'broll',
        assetRef: { id: a.assetId, revision: a.revision },
        span: { fromFrame: c.f0, durationFrames: c.frames },
        place: c.pip ? { x: c.pip.x, y: c.pip.y, w: c.pip.w } : {},
        mode: c.pip ? 'pip' : 'fullscreen', fit: c.fit ?? 'cover',
        ...(crop ? { crop } : {}),
        ...(c.focus ? { focalPoint: focalOf(c.focus) } : {}),
        ...(image ? {} : {
          timeMap: { kind: 'linear', sourceIn: mediaTime(c.from), rate: { num: 1, den: 1 } },
          embeddedAudio: audio ? { enabled: true, volume: audio.volume, fadeIn: mediaTime(fadeIn), fadeOut: mediaTime(fadeOut) } : { enabled: false, volume: 1 },
        }),
      });
      const label = labelText(c);
      if (label) items.push(labelItem(c, label, L, a, crop, fontSize));
      meta.push({ c, name, label, audio, assetId: a.assetId });
    }
    const r = apply(`${cfg.names.footage} ${segId}`, [{ type: 'insertItems', items }]);
    // 回执的 createdIds 不一定和 items 同序：按名字与起点在视频里认回片段
    const created = new Set(r.createdIds || []);
    const placed = allItems(bc, V, Math.max(0, Math.min(...batch.map(c => c.f0)) / FPS - 1)).items.filter(it => created.has(it.id));
    const find = (name, f0) => placed.find(it => it.name === name && it.startFrame === f0)?.id;
    const trans = [];
    for (const m of meta) {
      const itemId = find(m.name, m.c.f0);
      if (!itemId) throw new Error(`${m.c.id}: placed item not found in the receipt (${JSON.stringify(r).slice(0, 400)})`);
      const labelItemId = m.label ? find(`${labelName} ${m.c.id}`, m.c.f0) : null;
      log.footage[m.c.id] = { itemId, assetId: m.assetId, f0: m.c.f0, frames: m.c.frames, from: m.c.from, ...(m.audio ? { volume: m.audio.volume, lufs: m.audio.lufs } : {}), ...(m.label ? { labelItemId, label: m.label } : {}) };
      for (const [k, side] of [['tin', 'rightItemId'], ['tout', 'leftItemId']]) if (m.c[k]) trans.push({
        type: 'setTransition', [side]: itemId, kind: m.c[k].kind, params: {}, easing: m.c[k].easing,
        duration: { unit: 'frames', value: m.c[k].frames }, alignment: 'exact-frame',
      });
    }
    save();
    if (trans.length) apply(`${cfg.names.footage} ${segId} transitions`, trans);
    console.log('placed', segId, batch.map(c => c.id).join(' '));
  }
}

// 来源标签：一个文字片段，和镜头同起同止，贴在画面（画中画时是框）的一角
function labelItem(c, text, trackId, a, crop, fontSize) {
  const { corner, inset, w } = fo.label;
  const right = corner.endsWith('right'), top = corner.startsWith('top');
  let box = { l: 0, t: 0, r: 100, b: 100 };
  if (c.pip) {
    const cw = a.w * (1 - (crop?.left ?? 0) - (crop?.right ?? 0)), ch = a.h * (1 - (crop?.top ?? 0) - (crop?.bottom ?? 0));
    const hPct = c.pip.w * W / 100 * ch / cw / H * 100;
    box = { l: c.pip.x - c.pip.w / 2, r: c.pip.x + c.pip.w / 2, t: c.pip.y - hPct / 2, b: c.pip.y + hPct / 2 };
  }
  const ix = c.pip ? inset.x / 2 : inset.x, iy = c.pip ? inset.y / 2 : inset.y;
  const lw = Math.min(w, box.r - box.l);
  const x = right ? box.r - ix - lw / 2 : box.l + ix + lw / 2;
  const y = top ? box.t + iy : box.b - iy;
  return {
    type: 'text', trackId, name: `${labelName} ${c.id}`, role: 'screentext', text,
    span: { fromFrame: c.f0, durationFrames: c.frames },
    place: { x: +x.toFixed(3), y: +y.toFixed(3), w: +lw.toFixed(3) },
    verticalAlign: top ? 'top' : 'bottom',
    style: {
      fontSize: fontSize(fo.label.size), fontColor: fo.label.color, textAlign: right ? 'right' : 'left',
      ...(fo.label.background ? { backgroundColor: fo.label.background, backgroundPadding: Math.round(fontSize(fo.label.size) * 0.45) } : {}),
      ...(fo.label.font ? { fontFamily: fo.label.font } : {}),
    },
  };
}

// 3b. 原声字幕：同一原片的 subs 写成一份转写（原话）和一份译文（成片语言），建成双语字幕层，样式与旁白字幕分开
const work = cfg.abs(cfg.dirs.work, 'bites');
for (const [file, list] of bitesBySource()) {
  if (log.bites[file]) continue;
  if (!list.every(({ c }) => log.footage[c.id])) continue;   // 这一原片的片段还没放完（--place 只放了部分段）
  const assetId = log.assets[file].assetId;
  const speakers = [...new Set(list.map(({ s }) => s.who).filter(Boolean))].map((name, i) => ({ id: `spk-${i + 1}`, name }));
  const spk = who => speakers.find(x => x.name === who)?.id;
  const words = [], paragraphBreaks = [];
  list.forEach(({ s }, k) => {
    const toks = s.tr.trim().split(/\s+/);
    const total = toks.reduce((n, t) => n + t.length + 1, 0);
    let t = s.from * 1000, step = (s.to - s.from) * 1000 / total;
    toks.forEach((text, j) => {
      const len = (text.length + 1) * step, id = `b${k}_${j}`;
      if (j === 0) paragraphBreaks.push(id);
      words.push({ id, start: Math.round(t), end: Math.round(t + len - Math.min(step, len / 4)), text, ...(spk(s.who) ? { speaker: spk(s.who) } : {}) });
      t += len;
    });
  });
  const body = { schema: 'baocut.speech/1', clock: 'source-asset', timescale: 1000, engine: { kind: 'sound-bite-subs' }, speakers, words, sentences: null, chapters: [], paragraphBreaks };
  fs.mkdirSync(work, { recursive: true });
  const name = path.basename(file).replace(/\.[^.]+$/, '');
  const speechFile = path.join(work, `${name}.speech.json`);
  writeJson(speechFile, body);
  const sp = bc(['documents', 'put', V, '--kind', 'speech', '--name', `${cfg.names.footage} ${name}`, '--language', fo.subs.language, '--source-asset', assetId, '--body', '@' + speechFile]);
  const speechDoc = sp.documentId;
  const basis = bc(['documents', 'read', V, '--document-id', speechDoc]).translationBasis;
  if (!basis?.sentences?.length) throw new Error(`speech ${speechDoc}: no sentences in translationBasis`);
  // 一条 sub 的原话里有句末标点时会切成几句：成片语言按自己的句末标点分成同样多份，分不齐时按原话的词数比例切
  const units = [];
  list.forEach(({ s }, k) => {
    const mine = basis.sentences.filter(x => x.wordIds[0].startsWith(`b${k}_`));
    const parts = splitText(s.text, mine.map(x => x.wordIds.length));
    mine.forEach((x, i) => units.push({ id: `t-${x.id}`, sourceSentenceId: x.id, sourceFingerprint: x.fingerprint, naturalText: parts[i], alignment: null, status: 'draft' }));
  });
  const trFile = path.join(work, `${name}.translation.json`);
  writeJson(trFile, { schema: 'baocut.translation/2', language: cfg.language, sourceBasis: basis.sourceBasis, units });
  const tr = bc(['documents', 'put', V, '--kind', 'translation', '--name', `${cfg.names.footage} ${name} (${cfg.language})`, '--language', cfg.language, '--source-document', speechDoc, '--body', '@' + trFile]);
  const style = { y: fo.subs.y, verticalAlign: 'bottom', speakerLabel: { on: true, scale: fo.subs.speaker.scale, color: fo.subs.speaker.color },
    ...(fo.subs.fontSize ? { fontSize: fo.subs.fontSize } : {}), ...(fo.subs.font ? { fontFamily: fo.subs.font } : {}) };
  // 先给原话单建一层原文字幕（带自己的样式）：转写没有原文层时，双语会配上画面上已有的旁白字幕、改掉旁白的样式
  const orig = bc(['captions', 'create', V, '--document-id', speechDoc, '--style', JSON.stringify(style)]);
  if (!orig.styleDocumentId) throw new Error(`captions for ${speechDoc}: no style document in receipt`);
  const cap = bc(['captions', 'create', V, '--document-id', tr.documentId, '--bilingual']);
  if (cap.pairedOriginal?.documentId !== orig.documentId || cap.styleDocumentId !== orig.styleDocumentId) {
    throw new Error(`bilingual captions for ${name} paired with ${cap.pairedOriginal?.documentId}, not the sound-bite layer ${orig.documentId}`);
  }
  // 原声字幕跟着原话走：显示的提前与拖尾都收短，不越过片段
  apply(`${cfg.names.footage} ${name} caption timing`, [{ type: 'patchDocument', documentId: orig.styleDocumentId, changes: [{ path: ['style', 'displayTiming'], value: { leadIn: 0, tail: 0.1 } }] }]);
  log.bites[file] = { hash: subsHash(list), speechDoc, translationDoc: tr.documentId, styleDocumentId: orig.styleDocumentId, itemIds: [...(cap.itemIds || []), ...(orig.itemIds || [])] };
  save();
  console.log('sound-bite captions', name, `${list.length} subs, ${units.length} sentences`, log.bites[file].itemIds.join(' '));
}

function splitText(text, counts) {
  if (counts.length === 1) return [text];
  let parts = text.split(/(?<=[。！？!?])/).map(s => s.trim()).filter(Boolean);
  if (parts.length === counts.length) return parts;
  const chars = [...text], total = counts.reduce((a, b) => a + b, 0), out = [];
  let from = 0, acc = 0;
  counts.forEach((n, i) => {
    acc += n;
    const to = i === counts.length - 1 ? chars.length : Math.max(from + 1, Math.round(chars.length * acc / total));
    out.push(chars.slice(from, to).join('').trim() || '…');
    from = to;
  });
  return out;
}

// 3c. 水印
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
