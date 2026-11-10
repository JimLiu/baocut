#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文，给人看的名字从配置来
// 虚拟主播出镜：按各段的逐字时间与配音算口型，把连续出镜的几段拼成一条动作轨，在时间线上放一个角色贴纸。
//   node tools/host.mjs --dry      只算动作轨、打印每个贴纸的起点与长度，不连 Runtime、不改视频
//   node tools/host.mjs            算完放上时间线；可以重跑：没变的贴纸跳过，只有动作轨变了的原地换动作轨，起点或长度变了的删掉重放
// 在 assemble.mjs 之后跑（要 timeline.json 里各段的起点）；重新配音、改稿子、调段落顺序后，assemble.mjs 跑完再跑一遍本脚本。
// 口型的算法在 virtual-host skill 的 scripts/ 里（lipsync.mjs 及它 import 的文件）：把那个目录整个拷进工程，
// 缺省找 tools/virtual-host/，别处用 host.tools 指。本脚本不调 API、不碰 API Key，要本机有 ffmpeg（解码配音）。
//
// 配置 host：
//   puppet    角色包（.bcpuppet）的路径，相对工程根目录或绝对路径；内置主播的路径照 virtual-host skill 第 2 节取。必填
//   place     贴纸的位置 { x, y, w }（画布百分比，x、y 是中心，w 是宽）。缺省放右下角；横竖版各有缺省
//   skip      不出镜的段（id 数组），例如固定片头片尾、整镜实拍的段。出镜的段里连着的几段共用一个贴纸、一条动作轨：
//             贴纸不在段与段之间重开，头的朝向、头发的摆动和待机动作接得上
//   tools     放 lipsync.mjs 的目录，缺省 tools/virtual-host
//   dir       动作轨、核对表与记录放哪，缺省 host
//   faces     表情与动作的文件：{ "default"?: 表情, "<段 id>": [{ line, face?, act? } | { t0, t1, face?, act? }] }，
//             line 是这一段里的第几句（从 1 数），t0 / t1 是这一段里的秒数；写法同 virtual-host 的 faces.json
//   readings  读音表 { "词": "读音" }，同 virtual-host 的读音表
//   seed、motion、bounce  同 lipsync.mjs 的同名选项
// 轨道名取 names.host（缺省 Host）。每个贴纸旁边写一张核对表 <dir>/<名>.check.txt，读法见 virtual-host 的口型参考。
// 记录在 <dir>/host.json：角色包素材、轨道与每个贴纸的片段 id；用户在编辑器里挪过位置的贴纸，只换动作轨时位置不动。
// 主播轨归本脚本管：这条轨上用这个角色包的贴纸，不在这次保留之列的会被删掉（被剪开的旧贴纸）；别的贴纸放别的轨。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, parseArgs, makeBc, readJson, writeJson, layout, textHash, allItems } from './lib.mjs';

const cfg = loadConfig();
const { flags } = parseArgs(process.argv);
const conf = cfg.host;
if (!conf?.puppet) throw new Error('config has no host.puppet (path to the character package, .bcpuppet); see the header of host.mjs');
const FPS = cfg.fps;
const DIR = conf.dir || 'host';
const toolsDir = cfg.abs(conf.tools || 'tools/virtual-host');
const lipFile = path.join(toolsDir, 'lipsync.mjs');
if (!fs.existsSync(lipFile)) throw new Error(`${lipFile} not found; copy the scripts/ directory of the virtual-host skill there (or point host.tools at it)`);
const lip = await import(pathToFileURL(lipFile).href);
const puppet = cfg.abs(conf.puppet);
if (!fs.existsSync(puppet)) throw new Error(`host.puppet: ${puppet} not found`);
const skip = new Set(conf.skip || []);
const strayOff = [...skip].filter(id => !cfg.order.includes(id));
if (strayOff.length) throw new Error(`host.skip has ids that are not in order: ${strayOff.join(', ')}`);
const landscape = cfg.canvas.width >= cfg.canvas.height;
const place = conf.place || (landscape ? { x: 84, y: 74, w: 30 } : { x: 74, y: 86, w: 50 });
const trackName = cfg.names.host || 'Host';
const readings = conf.readings ? JSON.parse(fs.readFileSync(cfg.abs(conf.readings), 'utf8')) : null;
const facesAll = conf.faces ? JSON.parse(fs.readFileSync(cfg.abs(conf.faces), 'utf8')) : null;
if (facesAll) {
  const stray = Object.keys(facesAll).filter(k => k !== 'default' && !cfg.order.includes(k));
  if (stray.length) throw new Error(`${conf.faces}: ${stray.join(', ')} are not segment ids (keys are segment ids, plus "default")`);
  const hidden = Object.keys(facesAll).filter(k => skip.has(k));
  if (hidden.length) throw new Error(`${conf.faces}: ${hidden.join(', ')} are in host.skip, the host is not on screen there`);
}

// 各段的起点与帧数：放上时间线之后以 timeline.json 为准，还没放（--dry）时按代码包排
const rec = readJson(cfg.abs('timeline.json'), { segments: {} });
const placedAll = cfg.order.every(id => rec.segments[id]?.frames > 0);
if (!placedAll && !flags.dry) throw new Error('timeline.json does not have every segment yet; run assemble.mjs first (or --dry to only compute the tracks)');
const lay = placedAll ? cfg.order.map(id => ({ id, from: rec.segments[id].from, frames: rec.segments[id].frames })) : layout(cfg);

// 出镜的段里连着的归成一组
const groups = [];
for (const s of lay) {
  if (skip.has(s.id)) continue;
  const g = groups.at(-1);
  if (g && g.from + g.frames === s.from) { g.segs.push(s); g.frames += s.frames; }
  else groups.push({ segs: [s], from: s.from, frames: s.frames });
}
if (!groups.length) throw new Error('host.skip leaves no segment for the host');
for (const g of groups) {
  g.key = g.segs.map(s => s.id).join('+');
  g.name = g.segs.length > 1 ? `${g.segs[0].id}-${g.segs.at(-1).id}` : g.segs[0].id;
}

const voice = readJson(cfg.abs(cfg.dirs.audio, 'voice.json'), {});
// 放进视频的那份配音：gaps.mjs 留过白的是 timing 里的 gapAudio，其余是 voice.mjs 存下的那份
function audioOf(id, tm) {
  const file = tm.gapAudio ? cfg.abs(tm.gapAudio) : cfg.abs(voice[id]?.file || path.join(cfg.dirs.audio, `${id}.${cfg.voice.format || 'wav'}`));
  if (!fs.existsSync(file)) throw new Error(`${id}: narration audio ${file} missing; run voice.mjs ${id} (and gaps.mjs when it has gaps)`);
  return file;
}

// 一组的动作轨：各段的读音单位与音量包络挪到这一段在组里的起点，合成一份再算，头与眉毛的动作跨段连着
function trackOf(g) {
  const dur = g.frames / FPS, n = Math.ceil(dur / lip.STEP) + 1;
  const env = new Float32Array(n), cue = new Float32Array(n);
  const units = [], lines = [], faces = [];
  for (const s of g.segs) {
    const off = (s.from - g.from) / FPS, base = lines.length;
    const tm = readJson(cfg.abs(cfg.dirs.timing, `${s.id}.json`), null);
    if (!tm?.lines?.length) throw new Error(`${s.id}: no timing/${s.id}.json; run align.mjs ${s.id} (list segments without narration in host.skip)`);
    for (const u of lip.unitsFromTiming(tm, cfg.language, readings)) units.push({ ...u, line: u.line + base, t0: u.t0 + off, t1: u.t1 + off });
    for (const l of tm.lines) lines.push(l.text);
    const { x, sr } = lip.decodeAudio(audioOf(s.id, tm));
    const e = lip.envelope(x, sr), c = lip.vowelTrack(x, sr, e);
    // 段的起点多半不落在包络的采样格上（帧率与包络的步长不整除）：按起点的小数位置线性取样，不整格挪。
    // （试过在配音前面补不足一格的静音再算：与逐段单算的动作轨相比差得更多，没有采用。）
    // 配音比这一段长出去的尾巴（下一段已经开始）不要：截在这一段的终点
    const kEnd = Math.min(n, Math.round((off + s.frames / FPS) / lip.STEP));
    const at = (arr, p) => { const i = Math.floor(p), f = p - i; return i < 0 || i >= arr.length ? 0 : arr[i] * (1 - f) + (arr[i + 1] ?? arr[i]) * f; };
    for (let k = Math.max(0, Math.floor(off / lip.STEP)); k < kEnd; k++) {
      const p = k - off / lip.STEP;
      if (p < 0) continue;
      if (p > e.length - 1) break;
      env[k] = at(e, p); cue[k] = at(c, p);
    }
    for (const it of facesAll?.[s.id] || []) {
      const moved = { ...it };
      if (it.line != null) {
        if (!(it.line >= 1 && it.line <= tm.lines.length)) throw new Error(`${conf.faces}: ${s.id} has no line ${it.line} (it has ${tm.lines.length})`);
        moved.line = Number(it.line) + base;
      } else if (it.t0 != null && it.t1 != null) { moved.t0 = Number(it.t0) + off; moved.t1 = Number(it.t1) + off; }
      faces.push(moved);
    }
  }
  const spec = facesAll ? { ...(facesAll.default != null ? { default: facesAll.default } : {}), items: faces } : null;
  const result = lip.buildTrack({ units, env, cue, dur, seed: conf.seed ?? 1, faces: spec, motion: conf.motion ?? 1, bounce: !!conf.bounce });
  return { result, units, lines };
}

fs.mkdirSync(cfg.abs(DIR), { recursive: true });
for (const g of groups) {
  const { result, units, lines } = trackOf(g);
  const json = JSON.stringify(result.track) + '\n';
  g.file = path.join(DIR, `${g.name}.track.json`);
  g.hash = textHash(json);
  fs.writeFileSync(cfg.abs(g.file), json);
  fs.writeFileSync(cfg.abs(DIR, `${g.name}.check.txt`), lip.checkTable(units, result, lines, `lipsync check: ${g.key}  lang ${cfg.language}`, FPS));
  console.log(`${g.name.padEnd(14)} from frame ${String(g.from).padStart(6)} (${(g.from / FPS).toFixed(2)}s)  ${String(g.frames).padStart(6)} frames  track ${result.track.duration}s  ${result.nods.length} nods  ${g.file}`);
}
const off = cfg.order.filter(id => skip.has(id));
if (off.length) console.log(`host off screen: ${off.join(', ')}`);

const logFile = cfg.abs(DIR, 'host.json');
const log = readJson(logFile, { video: cfg.video, groups: {} });
if (flags.dry) {
  for (const g of groups) {
    const p = log.groups[g.key];
    console.log(`dry ${g.name}: ${!p ? 'would place a new sticker' : p.from !== g.from || p.frames !== g.frames ? 'would replace the sticker (start or length changed)' : p.hash !== g.hash ? 'would swap the motion track' : 'unchanged'}`);
  }
  for (const k of Object.keys(log.groups)) if (!groups.some(g => g.key === k)) console.log(`dry ${k}: would remove its sticker (the grouping changed)`);
  process.exit(0);
}

if (!cfg.video) throw new Error('config has no video id');
if (log.video && log.video !== cfg.video) throw new Error(`${path.join(DIR, 'host.json')} belongs to ${log.video}, config says ${cfg.video}; refusing to mix them`);
const bc = makeBc(cfg);
const V = cfg.video;
const head = bc(['videos', 'inspect', V, '--limit', '1']);
const items = new Map(allItems(bc, V).items.map(it => [it.id, it]));
const fileHash = f => 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 32);
const puppetHash = fileHash(puppet);

const ops = [], todo = [];
// 角色包：记录里的素材还在、文件没变就接着用，否则重新导入（换了角色时旧贴纸一起重放）
const known = log.puppet?.hash === puppetHash ? head.assets?.find(a => a.id === log.puppet.assetId) : null;
const puppetRef = known ? { assetRef: { id: known.id, revision: known.revision } } : { assetImportRef: 'host' };
if (!known) ops.push({ type: 'importAsset', path: puppet, ref: 'host', storage: 'managed' });
const track = head.tracks.find(t => t.id === log.trackId);
if (track?.locked) throw new Error(`track ${track.name} is locked; unlock it first, nothing was changed`);
const trackRef = track ? { trackId: track.id } : { trackRef: 'hostTrack' };
if (!track) ops.push({ type: 'addTrack', kind: 'visual', name: trackName, ref: 'hostTrack' });

const remove = [], keep = new Set();
for (const [key, p] of Object.entries(log.groups)) if (!groups.some(g => g.key === key) && items.has(p.item)) remove.push(p.item);
groups.forEach((g, i) => {
  const p = log.groups[g.key], it = p && items.get(p.item);
  const sameSpan = it && it.startFrame === g.from && it.durationFrames === g.frames;
  if (it && sameSpan && known && track && p.hash === g.hash) { keep.add(it.id); console.log(`${g.name}: unchanged`); return; }
  const ref = `motion${i}`;
  ops.push({ type: 'importAsset', path: cfg.abs(g.file), ref, storage: 'managed' });
  if (it && sameSpan && known && track) {
    keep.add(it.id);
    todo.push({ g, swap: it.id, ref });
    return;
  }
  if (it) remove.push(it.id);
  todo.push({ g, ref });
});
// 主播轨上别的角色贴纸：时间线在贴纸中间插过空或剪过（改一段后 assemble.mjs 重跑），旧贴纸会被拆成几截，
// 记录里只有其中一截的 id。这条轨上用同一个角色包、又不在保留之列的贴纸都是旧的，一起删掉。
if (track && log.puppet?.assetId) for (const it of items.values()) {
  if (it.trackId === track.id && it.type === 'sticker' && it.asset?.id === log.puppet.assetId && !keep.has(it.id) && !remove.includes(it.id)) remove.push(it.id);
}
if (!todo.length && !remove.length) { console.log('nothing to do'); process.exit(0); }
if (remove.length) ops.push({ type: 'deleteItems', itemIds: remove });
for (const t of todo) if (t.swap) ops.push({ type: 'replaceItemAsset', itemId: t.swap, assetImportRef: t.ref });
const fresh = todo.filter(t => !t.swap);
if (fresh.length) ops.push({
  type: 'insertItems',
  items: fresh.map(t => ({ type: 'sticker', ...trackRef, span: { fromFrame: t.g.from, durationFrames: t.g.frames }, place, sticker: { source: 'asset' }, ...puppetRef, motionImportRef: t.ref })),
});

// 一笔做完；版本冲突（别处刚改过）时重读版本再试
let r;
for (let attempt = 0; ; attempt++) {
  const revision = attempt ? bc(['videos', 'inspect', V, '--limit', '1']).revision : head.revision;
  try {
    r = bc(['edits', 'apply', V, '--expected-revision', String(revision), '--label', `${trackName}: lip-sync ${todo.map(t => t.g.name).join(', ') || 'cleanup'}`, '--operations', JSON.stringify(ops)]);
    break;
  } catch (e) {
    if (attempt < 4 && /REVISION_CONFLICT/.test(e.message)) continue;
    throw e;
  }
}

// 按起点在视频里认回新贴纸；素材与轨道从贴纸上读
const after = bc(['videos', 'inspect', V, '--limit', '1']);
const now = allItems(bc, V).items;
const created = new Set(r.createdIds || []);
for (const key of Object.keys(log.groups)) if (!groups.some(g => g.key === key)) delete log.groups[key];
for (const t of todo) {
  const it = t.swap ? now.find(x => x.id === t.swap) : now.find(x => created.has(x.id) && x.type === 'sticker' && x.startFrame === t.g.from);
  if (!it) throw new Error(`${t.g.name}: sticker not found after the edit (${JSON.stringify(r).slice(0, 400)})`);
  log.groups[t.g.key] = { name: t.g.name, from: t.g.from, frames: t.g.frames, hash: t.g.hash, item: it.id };
  log.trackId = it.trackId;
  log.puppet = { file: conf.puppet, hash: puppetHash, assetId: it.asset?.id ?? log.puppet?.assetId };
  console.log(`${t.g.name}: ${t.swap ? 'motion track swapped' : 'sticker placed'} ${it.id}  frames ${it.startFrame}–${it.startFrame + it.durationFrames}`);
}
log.video = V;
writeJson(logFile, log);
console.log(`video revision ${after.revision}; look at the host in the editor preview or a composited frame (frames.mjs), and ask the user to watch the mouth with the sound on`);
