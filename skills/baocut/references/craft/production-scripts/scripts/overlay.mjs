#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文，给人看的名字与标签从配置来
// 叠在代码画面之上的两层：实拍片段（footage 轨）与水印（watermark 轨）。都是可选的：没有 clips.json、配置里没有 watermark 就跳过。
//   node tools/overlay.mjs [--dry]          打印每个片段与水印在时间线上的起止（默认）
//   node tools/overlay.mjs --preview [id …] [--force]   从原片剪出静音小片段到 <work>/clips/，给 preview.mjs 与预览页用；clips.json 里这一段的来源、起止或裁法改了就重剪
//   node tools/overlay.mjs --render [id…]   按画幅剪出成片用的片段（铺满裁切，画中画剪成框的大小，对到整帧），把来源标签烧进去，写到 <work>/footage/
//   node tools/overlay.mjs --place          新建两条视觉轨（footage.layer 为 under 时实拍轨挪到代码包下面），导入片段铺满或放成画中画，再放水印；记在 overlay.json，已放过的（同一 id、同一帧）不重放
//   node tools/overlay.mjs --check          对照视频里的片段与现在算出的起点（assemble 波纹挪过、段落改过之后跑）
// clips.json：{ source, label, clips: [{ id, seg, line, cue?, head?, gap?, from, to, source?, label?, audio?, subs?, note? }] }
//   from / to 是原片的秒数；片段从 seg 段第 line 句（从 0 数）开始放；cue 可省，给了就从这句里 cue 这几个字被说到的时刻开始。
//   同一段里下一个片段开始时截断，不越过段尾。label 是烧进画面一角的来源标签（成片语言写，例如「画面：<来源>」），
//   单个片段可以另给 source 与 label；audio 为 true 时保留原声（当事人原话、现场声），否则静音；给数字是放到时间线上的音量（0–1）。
//   follow 为 true 的片段不看 line / cue，紧接着 clips.json 里上一个片段的原长之后放（几段素材连成一整块，中间硬切）。
//   head 为 true 的片段不看 line / cue，从段首放：段首到第一句之间有零点几秒的空，实拍垫底（under）时这段露出画布底色，
//   每段的第一个镜头带上 head 就盖住了（片段长度要算到段首起）。
//   gap 为 true 的片段让旁白停下来单独放：先跑 gaps.mjs 在旁白里留白，片段放在留白的起点（line 是插在哪一句之前）。
//   subs：[{ from, to, text, tr, who? }]，from / to 是原片秒数，text 成片语言、tr 原话、who 说话人；--render 时烧成双语字幕。
//   in / out：{ kind, dur?, easing? } 单侧转场（kind 取 dissolve / wipe / slide / zoom / iris，dur 秒数缺省 0.5，easing 缺省 ease-in-out），
//   片段从下面的代码画面里渐入、渐出；和前后片段首尾相接的那一侧不做（同一条轨上背靠背只能硬切）。原声的淡入淡出跟着转场的长度走。
//   crop：[x, y, w, h] 先按原片像素裁掉黑边、色条；fit 为 contain 时整幅放进画面、两侧补黑（4:3 的老转播），缺省 cover 铺满裁切。
//   pip：{ x, y, w } 画中画，不铺满：x、y 是框中心、w 是框宽（画布宽高的百分比），高按原片（裁过之后）的宽高比；代码画面在下面照常讲。
//   画中画按框的像素大小剪，来源标签烧在框的右上角；不能带 subs（字幕要在画面底部，压在框里太小）。转场作用在框上。
//   原声在成片片段里做淡入淡出、响度对到 footage.loudness（LUFS）。
//   来源是图片（png / jpg / webp / bmp / tif）时 from / to 只定时长（写 0 和秒数），整段停在这张图上；不能带 audio。
//   motion：{ kind, scale? } 给图片做 Ken Burns（kind 取 zoom-in / zoom-out / pan-left / pan-right，scale 缺省 1.08，1–2 之间）：
//   推近从整幅推到 scale 倍、拉远反过来；平移固定放大 scale 倍，pan-left 镜头从右往左移（画里的东西往右走），pan-right 反过来。
//   匀速走完整个片段；不能和 pip 一起用。--dry 打印要用的滤镜。
// 配置 footage：{ clips, layer, font, label: { size, margin }, loudness, subs: { fontsDir, font, size, trFont, trSize, whoSize, marginV } }；watermark：{ file, dur, w, y, x: { left, right }, at: [...] }，
//   layer 缺省 over（实拍盖在代码画面上面）；under 时实拍轨放到代码包那条轨的下面当底，包要透明（bundle.alpha 为 true，场景只画要叠的卡片与标注），
//   实拍之外的时刻露出的是画布底色（空），用 coverage.mjs 看有多少空着。
//   at 的每一项是 { seg, line, cue?, side } 或 { t, side }（时间线秒数），side 取 left / right；x、y、w 是画面宽高的百分比。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig, parseArgs, makeBc, readJson, writeJson, layout, atOf, cueTime, clipTimes, allItems } from './lib.mjs';

const cfg = loadConfig();
const { ids, flags } = parseArgs(process.argv);
const FPS = cfg.fps, V = cfg.video, { width: W, height: H } = cfg.canvas;
const fo = { clips: 'clips.json', font: null, loudness: -17, ...cfg.footage, label: { size: 28, margin: 46, ...cfg.footage?.label },
  subs: { fontsDir: null, font: 'sans-serif', size: 54, trFont: null, trSize: 32, whoSize: 36, marginV: 64, ...cfg.footage?.subs } };
const wm = cfg.watermark ? { dur: 5, w: 6, y: 70, x: { left: 5, right: 95 }, at: [], ...cfg.watermark } : null;
if (fo.layer && !['over', 'under'].includes(fo.layer)) throw new Error(`footage.layer "${fo.layer}" not one of over, under`);
const under = fo.layer === 'under';
if (under && !cfg.bundle.alpha) console.log('warning: footage.layer is under but bundle.alpha is not true; opaque code scenes will hide the footage (set bundle.alpha and rebuild)');
const cl = readJson(cfg.abs(fo.clips), { clips: [] });
const work = sub => cfg.abs(cfg.dirs.work, sub);
const logFile = cfg.abs('overlay.json');
const log = readJson(logFile, { video: V, footage: {}, watermarks: [] });
if (log.video !== V) throw new Error(`overlay.json belongs to ${log.video}, config says ${V}`);
const save = () => writeJson(logFile, log);
const ffmpeg = args => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const src = c => c.source || cl.source;
// 裁边与放进画面：cover 铺满裁切，contain 整幅放进、补黑边
const fitVf = (c, w, h) => [
  ...(c.crop ? [`crop=${c.crop[2]}:${c.crop[3]}:${c.crop[0]}:${c.crop[1]}`] : []),
  ...(c.pip ? [`scale=${Math.round(w * c.pip.w / 100 / 2) * 2}:-2:flags=lanczos`] : c.fit === 'contain'
    ? [`scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`]
    : [`scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${w}:${h}`]),
];
const KINDS = ['dissolve', 'wipe', 'slide', 'zoom', 'iris'];
for (const c of cl.clips) for (const side of ['in', 'out']) if (c[side] && !KINDS.includes(c[side].kind)) throw new Error(`${c.id}: ${side}.kind "${c[side].kind}" not one of ${KINDS.join(', ')}`);
const IMAGE = /\.(png|jpe?g|webp|bmp|tiff?)$/i, MOTIONS = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right'];
const isImage = c => IMAGE.test(src(c));
for (const c of cl.clips) {
  if (isImage(c) && c.audio) throw new Error(`${c.id}: ${src(c)} is a still image and has no sound; drop audio`);
  if (!c.motion) continue;
  if (!MOTIONS.includes(c.motion.kind)) throw new Error(`${c.id}: motion.kind "${c.motion.kind}" not one of ${MOTIONS.join(', ')}`);
  if (c.motion.scale !== undefined && !(c.motion.scale > 1 && c.motion.scale <= 2)) throw new Error(`${c.id}: motion.scale ${c.motion.scale} must be above 1 and at most 2`);
  if (!isImage(c)) throw new Error(`${c.id}: motion is for still images (png, jpg, webp, bmp, tif); ${src(c)} is not one`);
  if (c.pip) throw new Error(`${c.id}: motion needs a full-screen clip; drop pip or the motion`);
}
// Ken Burns：先按 cover / contain 放进 SUPER 倍大的画幅（zoompan 的 x、y 取整到输入像素，放大了才不抖），再用 zoompan 让一张图出 n 帧
const SUPER = 4;
const motionVf = (c, w, h, n) => {
  const s = c.motion.scale ?? 1.08, d = +(s - 1).toFixed(6), p = n > 1 ? `on/${n - 1}` : '0';
  const z = { 'zoom-in': `1+${d}*${p}`, 'zoom-out': `${s}-${d}*${p}` }[c.motion.kind] ?? String(s);
  const x = { 'pan-left': `(iw-iw/zoom)*(1-${p})`, 'pan-right': `(iw-iw/zoom)*${p}` }[c.motion.kind] ?? '(iw-iw/zoom)/2';
  return [...fitVf(c, w * SUPER, h * SUPER), `zoompan=z='${z}':x='${x}':y='(ih-ih/zoom)/2':d=${n}:s=${w}x${h}:fps=${FPS}`];
};
// 输入与画面滤镜：视频从 from 起剪；图片一张出 n 帧（有 motion 走 zoompan，没有就循环同一帧）
// 视频多读一帧再截到 n 帧：源的时间戳和 1/FPS 对不齐时，-t n/FPS 经 fps 滤镜常只出 n-1 帧，放上时间线后和下一段之间空一帧（实拍垫底时这一帧是黑的）
const inputArgs = (c, n) => !isImage(c) ? ['-ss', String(c.from), '-i', src(c), '-t', ((n + 1) / FPS).toFixed(4), '-frames:v', String(n)]
  : [...(c.motion ? [] : ['-loop', '1', '-framerate', String(FPS)]), '-i', src(c), '-frames:v', String(n)];
const pictureVf = (c, w, h, n) => c.motion ? motionVf(c, w, h, n) : [...fitVf(c, w, h), `fps=${FPS}`];
for (const c of cl.clips) if (c.pip) {
  if (!['x', 'y', 'w'].every(k => Number.isFinite(c.pip[k])) || c.pip.w <= 0) throw new Error(`${c.id}: pip needs numeric x, y and a positive w (percent of the canvas)`);
  if (c.subs?.length) throw new Error(`${c.id}: subs need a full-screen clip; drop pip or the subs`);
}

// 1. 预览用的小片段：不需要代码包，只按 clips.json 剪
if (flags.preview) {
  fs.mkdirSync(work('clips'), { recursive: true });
  for (const c of cl.clips) {
    if (ids.length && !ids.includes(c.id)) continue;
    const out = path.join(work('clips'), c.id + '.mp4'), keyFile = out.replace(/\.mp4$/, '.json');
    const key = JSON.stringify({ src: src(c), from: c.from, to: c.to, crop: c.crop ?? null, fit: c.fit ?? null, pip: c.pip ?? null, audio: !!c.audio, motion: c.motion ?? null });
    if (fs.existsSync(out) && !flags.force && fs.existsSync(keyFile) && fs.readFileSync(keyFile, 'utf8') === key) continue;
    const audio = c.audio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an'];
    const n = Math.max(1, Math.round((c.to - c.from) * FPS));
    ffmpeg([...inputArgs(c, n), ...audio, '-vf', pictureVf(c, 1280, 720, n).join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-movflags', '+faststart', out]);
    fs.writeFileSync(keyFile, key);
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
  const mine = cl.clips.filter(c => c.seg === s.id), t0 = mine.length ? clipTimes(timing(s.id), mine) : {};
  const cs = mine.map(c => ({ ...c, at: s.from / FPS + t0[c.id] })).sort((a, b) => a.at - b.at);
  const lead = cs.find(c => !c.pip);
  if (under && lead && lead.at - s.from / FPS >= 1 / FPS) console.log(`warning: ${s.id} has no footage for its first ${(lead.at - s.from / FPS).toFixed(2)}s (the canvas shows); give ${lead.id} head: true`);
  cs.forEach((c, i) => {
    const end = (s.from + s.frames) / FPS, stop = Math.min(cs[i + 1]?.at ?? Infinity, end);
    if (c.at + c.to - c.from > end + 0.5 / FPS && stop === end) console.log(`warning: ${c.id} runs ${(c.at + c.to - c.from - end).toFixed(2)}s past the end of ${s.id}; cut at the segment end (shorten to, or move the clip earlier)`);
    const f0 = Math.round(c.at * FPS), f1 = Math.min(Math.round((c.at + c.to - c.from) * FPS), Math.round(stop * FPS));
    if (f1 > f0) plan.push({ ...c, f0, frames: f1 - f0 });
  });
}
// 转场：首尾和别的片段相接的一侧不做；长度不超过片段的一半
plan.sort((a, b) => a.f0 - b.f0);
plan.forEach((c, i) => {
  const prev = plan[i - 1], next = plan[i + 1];
  const tr = (t, touching) => t && !touching ? { kind: t.kind, easing: t.easing || 'ease-in-out', frames: Math.min(Math.round((t.dur ?? 0.5) * FPS), Math.floor(c.frames / 2)) } : null;
  c.tin = tr(c.in, prev && prev.f0 + prev.frames >= c.f0);
  c.tout = tr(c.out, next && c.f0 + c.frames >= next.f0);
});
const stray = cl.clips.filter(c => !seg[c.seg]).map(c => c.id);
if (stray.length) throw new Error(`clips in segments not in order: ${stray.join(', ')}`);
const marks = (wm?.at || []).map(m => {
  if (!wm.x[m.side]) throw new Error(`watermark side "${m.side}" not in watermark.x`);
  const f = Math.round((m.t ?? at(m.seg, m.line, m.cue)) * FPS);
  return { side: m.side, f, t: +(f / FPS).toFixed(4) };
});
for (const c of plan) console.log(`${c.id.padEnd(16)} ${(c.f0 / FPS).toFixed(2).padStart(8)}s  +${(c.frames / FPS).toFixed(2)}s  src ${c.from}${c.gap ? '  gap' : ''}${c.audio ? `  audio${typeof c.audio === 'number' ? ' ' + c.audio : ''}` : ''}${c.subs ? `  subs:${c.subs.length}` : ''}${c.pip ? `  pip ${c.pip.x},${c.pip.y} w${c.pip.w}` : ''}${c.motion ? `  motion ${c.motion.kind} ${c.motion.scale ?? 1.08}` : isImage(c) ? '  still' : ''}${c.tin ? `  in ${c.tin.kind} ${(c.tin.frames / FPS).toFixed(2)}` : ''}${c.tout ? `  out ${c.tout.kind} ${(c.tout.frames / FPS).toFixed(2)}` : ''}`);
for (const c of plan) if (c.motion) console.log(`${c.id.padEnd(16)} vf ${motionVf(c, W, H, c.frames).join(',')}`);
for (const m of marks) console.log(`watermark ${m.side.padEnd(5)} ${m.t}s  +${wm.dur}s`);
if (!flags.render && !flags.place && !flags.check) process.exit(0);

// 双语字幕：一条事件两行，上面成片语言（前面小一号灰字写说话人），下面原话；底部居中，和旁白字幕同一块地方
function assFile(c) {
  const t = x => { const s = Math.max(0, x); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return `${h}:${String(m).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`; };
  const q = x => String(x).replace(/[{}\\]/g, '').replace(/\n/g, ' ');
  const S = fo.subs, tr = S.trFont || S.font;
  const ev = c.subs.map(x => `Dialogue: 0,${t(x.from - c.from)},${t(x.to - c.from)},Sub,,0,0,0,,` +
    `${x.who ? `{\\fs${S.whoSize}\\c&HBBBBBB&}${q(x.who)}  {\\r}` : ''}${q(x.text)}${x.tr ? `\\N{\\fn${tr}\\fs${S.trSize}}${q(x.tr)}` : ''}`);
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n` +
    `[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Sub,${S.font},${S.size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2.5,1.5,2,${Math.round(W * 0.08)},${Math.round(W * 0.08)},${S.marginV},1\n\n` +
    `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${ev.join('\n')}\n`;
}

// 3. 成片用的片段：铺满裁切到画幅（画中画按框的像素大小）、整帧时长，标签用 textfile 读进 drawtext（任何语言、标点都不用转义）
const esc = p => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
if (flags.render) {
  fs.mkdirSync(work('footage'), { recursive: true });
  for (const c of plan) {
    if (ids.length && !ids.includes(c.id)) continue;
    const out = path.join(work('footage'), `${c.id}.mp4`);
    const vf = pictureVf(c, W, H, c.frames);
    const label = c.label ?? cl.label;
    if (label) {
      const tf = path.join(work('footage'), `${c.id}.label.txt`);
      fs.writeFileSync(tf, label);
      if (fo.font && !fs.existsSync(cfg.abs(fo.font))) throw new Error(`footage.font ${fo.font} not found`);
      const font = fo.font ? `fontfile='${esc(cfg.abs(fo.font))}':` : '';
      const { size } = fo.label, margin = c.pip ? Math.min(fo.label.margin, Math.round(size * 0.8)) : fo.label.margin;   // 画中画的框小，标签贴近一角
      vf.push(`drawtext=${font}textfile='${esc(tf)}':expansion=none:fontsize=${size}:fontcolor=0xdddddd:box=1:boxcolor=0x000000@0.55:boxborderw=${Math.round(size / 2)}:x=w-tw-${margin + Math.round(size / 2)}:y=${margin}`);
    }
    if (c.subs?.length) {
      const af = path.join(work('footage'), `${c.id}.ass`);
      fs.writeFileSync(af, assFile(c));
      vf.push(`subtitles=filename='${esc(af)}'${fo.subs.fontsDir ? `:fontsdir='${esc(cfg.abs(fo.subs.fontsDir))}'` : ''}`);
    }
    const len = c.frames / FPS;
    const fin = c.tin ? c.tin.frames / FPS : 0.15, fout = c.tout ? c.tout.frames / FPS : 0.3;
    const audio = c.audio ? ['-af', `afade=t=in:d=${fin.toFixed(3)},afade=t=out:st=${Math.max(0, len - fout).toFixed(3)}:d=${fout.toFixed(3)},loudnorm=I=${fo.loudness}:TP=-1.5:LRA=11,aresample=48000`, '-c:a', 'aac', '-b:a', '192k'] : ['-an'];
    ffmpeg([...inputArgs(c, c.frames), ...audio, '-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
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
  // footage.layer 为 under：实拍轨挪到代码包那条轨下面（包要透明，bundle.alpha）；tracks 按叠放次序从下到上列
  if (under) {
    const vs = inspect().tracks.filter(x => x.kind === 'visual');
    const base = cfg.tracks?.visual || vs.find(x => ![cfg.names.footage, cfg.names.watermark].includes(x.name))?.id;
    if (base && vs.findIndex(x => x.id === T) > vs.findIndex(x => x.id === base)) {
      apply(`Move ${cfg.names.footage} track under the code scenes`, [{ type: 'moveTrack', trackId: T, target: base, position: 'below' }]);
      console.log('footage track moved under', base);
    }
  }
  for (const c of plan) {
    if (log.footage[c.id]) continue;
    const file = path.join(work('footage'), `${c.id}.mp4`);
    if (!fs.existsSync(file)) throw new Error(`${file} missing; run --render first`);
    const a = bc(['assets', 'import', V, '--path', file, '--storage', 'managed', '--name', `${cfg.names.footage} ${c.id}`, '--place', JSON.stringify({ track: T, at: atOf(c.f0, FPS) })]);
    const seq = inspect().sequence.id;
    const trans = [['tin', 'rightItemId'], ['tout', 'leftItemId']].filter(([k]) => c[k]).map(([k, side]) => ({
      type: 'setTransition', sequenceId: seq, [side]: a.itemId, kind: c[k].kind, params: {}, easing: c[k].easing,
      duration: { unit: 'frames', value: c[k].frames }, alignment: 'exact-frame',
    }));
    const look = c.pip ? [{ type: 'setStyle', itemId: a.itemId, mode: 'pip', fit: 'cover' }, { type: 'setTransform', itemId: a.itemId, x: c.pip.x, y: c.pip.y, w: c.pip.w }]
      : [{ type: 'setStyle', itemId: a.itemId, mode: 'fullscreen', fit: 'cover' }];
    apply(`Style ${c.id}`, [...look, ...(typeof c.audio === 'number' ? [{ type: 'setAudioMix', itemId: a.itemId, volume: c.audio }] : []), ...trans]);
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
