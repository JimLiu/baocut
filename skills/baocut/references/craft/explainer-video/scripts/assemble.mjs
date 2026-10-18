#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本
// 把各段旁白与代码包按 order 摆到视频上：起点按整帧累加，旁白放第一条音频轨（A1），代码包导入烘焙后放第一条视觉轨（V1），同一起点。
//   node tools/assemble.mjs --dry                 只打印排好的起点与要做的事，不连 Runtime、不改视频
//   node tools/assemble.mjs [--background] [--bake auto|ops] [--allow-pixels]
//   node tools/assemble.mjs --verify              不改时间线：补后台烘焙的结果，核对各段首尾相接
// 进度记在 timeline.json，可以重跑：已放好且没变的段跳过。改过的段这样处理（video-production 代码场景细则第 7 节的 ripple 步骤）：
//   - 代码包帧数变了：带 replace.ripple 换包，引擎把这一段旧终点之后各轨的片段（画面、旁白、字幕、音效、音乐）一起挪 Δ 帧，
//     跨过旧终点的片段（全片音乐）不动；几段一起变时从最后一段往前做。代码包内容变了、帧数没变：原地换包，Δ 为 0 什么都不挪。
//   - 旁白换了（voice.json 里的 artifactId 变了）：删掉旧的旁白片段，在同一起点导入新的；字幕由 captions.mjs 发现后重建。
//   - order 里新插进的段：先用 insertRange 在上一段终点腾出它的帧数，再放进去。从 order 里删掉的段不自动处理，报错让你先手动删。
//   章节不跟着挪，改完自己核对。
// 每段记下 bake 的 renderer / fps / seconds；--background 时烘焙在后台排队，之后用 --verify 把结果补进记录。
// 前台烘焙走成 browser-pixels 时停下并打印原因（不带 --allow-pixels），按代码场景细则第 2.1 节改好后重跑会原地换包。
import { loadConfig, parseArgs, makeBc, readJson, writeJson, layout, atOf, frameOf, bundleHash } from './lib.mjs';

const cfg = loadConfig();
const { flags } = parseArgs(process.argv, ['bake']);
const FPS = cfg.fps;
const logFile = cfg.abs('timeline.json');
const rec = readJson(logFile, { video: cfg.video, fps: FPS, segments: {} });
const voice = readJson(cfg.abs(cfg.dirs.audio, 'voice.json'), {});
const lay = layout(cfg);
const total = lay.reduce((n, s) => n + s.frames, 0);
const save = () => writeJson(logFile, rec);

if (rec.video && cfg.video && rec.video !== cfg.video) throw new Error(`timeline.json belongs to ${rec.video}, config says ${cfg.video}; refusing to mix them`);
const stray = Object.keys(rec.segments).filter(id => !cfg.order.includes(id));
if (stray.length) throw new Error(`timeline.json has segments not in order: ${stray.join(', ')}; delete their clips in BaoCut and their entries here first`);

// 记录里每段的现状。旧记录没有 from、audioArtifact、bundleHash 时按 at 与当前文件补上（当作没变）。
const placed = id => { const r = rec.segments[id]; return !!(r && (r.sceneItem || r.audioItem)); };
const cur = {};
const notes = [];
for (const s of lay) {
  if (!placed(s.id)) continue;
  const r = rec.segments[s.id];
  r.from ??= frameOf(r.at, FPS);
  const hash = bundleHash(cfg.abs(cfg.dirs.bundles, s.id));
  if (!r.bundleHash) { r.bundleHash = hash; notes.push(s.id); }
  if (r.audioItem && !r.audioArtifact && voice[s.id]) r.audioArtifact = voice[s.id].artifactId;
  cur[s.id] = {
    from: r.from,
    frames: r.frames,
    resized: r.sceneItem && r.frames !== s.frames,
    rebundled: r.sceneItem && r.bundleHash !== hash,
    revoiced: !!(r.audioItem && voice[s.id] && voice[s.id].artifactId !== r.audioArtifact),
    hash,
  };
}

// 先在记录上推演一遍（不连 Runtime）：倒序处理变长变短与插入，看推演完的起点是否和 layout 一致
function plan() {
  const sim = Object.fromEntries(Object.entries(cur).map(([id, c]) => [id, { from: c.from, frames: c.frames }]));
  const steps = [];
  const endBefore = k => { for (let i = k - 1; i >= 0; i--) { const p = sim[lay[i].id]; if (p) return p.from + p.frames; } return 0; };
  const shift = (boundary, delta) => { for (const p of Object.values(sim)) if (p.from >= boundary) p.from += delta; };
  for (let k = lay.length - 1; k >= 0; k--) {
    const s = lay[k], c = cur[s.id];
    if (c && c.resized) {
      const boundary = c.from + c.frames, delta = s.frames - c.frames;
      steps.push({ kind: 'resize', id: s.id, boundary, delta });
      shift(boundary, delta);
      sim[s.id].frames = s.frames;
    } else if (!c && lay.slice(k + 1).some(x => cur[x.id])) {
      const boundary = endBefore(k);
      steps.push({ kind: 'insert', id: s.id, boundary, delta: s.frames });
      shift(boundary, s.frames);
    }
  }
  const off = lay.filter(s => sim[s.id] && sim[s.id].from !== s.from).map(s => `${s.id} would sit at frame ${sim[s.id].from}, layout says ${s.from}`);
  return { steps, off }; // steps 按执行顺序：从最后一段往前
}

const { steps, off } = plan();

function printPlan() {
  console.log(`video ${cfg.video || '(not set)'}  ${FPS} fps  ${cfg.canvas.width}x${cfg.canvas.height}  total ${total} frames = ${atOf(total, FPS)} s`);
  for (const s of lay) {
    const r = rec.segments[s.id], c = cur[s.id];
    const was = r ? ` was ${r.from}+${r.frames}` : '';
    const act = !c ? 'place' : [c.resized && `resize ${s.frames - c.frames > 0 ? '+' : ''}${s.frames - c.frames}`, !c.resized && c.rebundled && 'replace bundle', c.revoiced && 'replace narration', !r.sceneItem && 'place scene', !r.audioItem && 'place narration'].filter(Boolean).join(', ') || 'ok';
    const bake = r && r.bake ? `  bake ${r.bake.renderer} ${r.bake.fps ?? '?'}fps ${r.bake.seconds ?? '?'}s` : r && r.bakeJobId ? `  bake pending ${r.bakeJobId}` : '';
    console.log(`${s.id.padEnd(8)} from ${String(s.from).padStart(6)}  at ${(s.from / FPS).toFixed(3).padStart(9)}  frames ${String(s.frames).padStart(5)}${was}  ${act}${bake}`);
  }
  for (const st of steps) console.log(`ripple: ${st.kind} ${st.id}: ${st.kind === 'insert' ? 'insertRange' : 'replace.ripple'} shifts clips at frame >= ${st.boundary} by ${st.delta > 0 ? '+' : ''}${st.delta}`);
  if (notes.length) console.log(`note: ${notes.join(', ')} have no recorded bundle hash or narration take; assuming the placed clips match the current files`);
  for (const o of off) console.log('MISMATCH: ' + o);
}

printPlan();
if (flags.dry) process.exit(off.length ? 1 : 0);
if (off.length) throw new Error('recorded starts do not follow from the bundles; fix timeline.json or the timeline by hand first');
if (!cfg.video) throw new Error('config has no video id');

const bc = makeBc(cfg);
const V = cfg.video;

function inspect(extra = []) {
  return bc(['videos', 'inspect', V, ...extra]);
}

// 一笔 edits apply；版本冲突（别处刚改过，或后台烘焙刚写完替身）时重读版本再试
function apply(label, ops) {
  for (let attempt = 0; ; attempt++) {
    const revision = inspect(['--limit', '1']).revision;
    try {
      return bc(['edits', 'apply', V, '--expected-revision', String(revision), '--label', label, '--operations', JSON.stringify(ops)]);
    } catch (e) {
      if (attempt < 4 && /REVISION_CONFLICT/.test(e.message)) continue;
      throw e;
    }
  }
}

// 起点不早于 boundary 帧的全部片段（各轨），分页读到底；spanning 时连跨过 boundary 的也算
function itemsFrom(boundary, spanning = false) {
  const items = [];
  let from = boundary / FPS, limit = 500;
  for (;;) {
    const r = inspect(['--from-seconds', String(from), '--limit', String(limit)]);
    if (r.itemsCoverage && r.itemsCoverage.truncated) { limit *= 4; if (limit <= 32000) continue; throw new Error('too many clips to list'); }
    for (const it of r.items) if (spanning ? it.startFrame + it.durationFrames > boundary : it.startFrame >= boundary) items.push(it);
    return items;
  }
}

// 要挪的轨道或片段锁着时先停下：引擎也会以 TARGET_LOCKED 拒绝，但换包时那已经在烘焙之后
function assertUnlocked(items, boundary) {
  const lockedTracks = new Set(tracks.filter(t => t.locked).map(t => t.id));
  const hit = items.filter(it => lockedTracks.has(it.trackId) || (it.locked && it.startFrame >= boundary)).map(it => `${it.id} (${it.name})`);
  if (hit.length) throw new Error(`locked tracks or clips after frame ${boundary}: ${hit.join(', ')}; unlock them first, nothing was changed`);
}

// 引擎挪完片段后，记录里起点不早于 boundary 的段跟着挪，然后存盘
function shiftRecords(boundary, delta) {
  if (delta) for (const r of Object.values(rec.segments)) if (r.from >= boundary) { r.from += delta; r.at = atOf(r.from, FPS); }
  save();
}

// 插入的段：在 boundary（上一段终点）用 insertRange 腾出 frames 帧。只列这之后还有片段的轨道，
// 跨着 boundary 的片段（全片音乐）留在原处、不剪开；有轨道或片段锁着时引擎以 TARGET_LOCKED 整笔拒绝。
function makeRoom(id, boundary, frames) {
  const items = itemsFrom(boundary);
  assertUnlocked(items, boundary);
  const trackIds = [...new Set(items.map(it => it.trackId))];
  if (!trackIds.length) return;
  const frame = value => ({ unit: 'frames', value });
  apply(`Make room for ${id}`, [{ type: 'insertRange', at: frame(boundary), duration: frame(frames), trackIds, alignment: 'exact-frame', straddle: 'stay' }]);
  shiftRecords(boundary, frames);
  console.log(`inserted ${frames} frames at ${boundary} on ${trackIds.length} tracks for ${id}`);
}

const tracks = inspect(['--limit', '1']).tracks;
const V1 = cfg.tracks?.visual || tracks.find(t => t.kind === 'visual')?.id;
const A1 = cfg.tracks?.audio || tracks.find(t => t.kind === 'audio')?.id;
if (!V1 || !A1) throw new Error('video needs a visual and an audio track (or set tracks.visual / tracks.audio in the config)');

function recordBake(r, c) {
  r.frames = c.item?.durationFrames ?? r.frames;
  r.prerender = c.prerender?.assetId ?? null;
  r.bakeJobId = c.bakeJobId ?? null;
  r.bake = c.bake ? { renderer: c.bake.renderer, fps: c.bake.fps ?? null, seconds: c.bake.seconds ?? null, fallback: c.bake.fallback?.reason ?? null } : null;
}

function checkBake(id, r) {
  if (!r.bake) return;
  console.log(`${id}: bake ${r.bake.renderer} ${r.bake.fps ?? '?'} fps ${r.bake.seconds ?? '?'} s${r.bake.fallback ? ' fallback: ' + r.bake.fallback : ''}`);
  if (r.bake.renderer === 'browser-pixels' && !flags['allow-pixels']) {
    save();
    throw new Error(`${id} fell back to browser-pixels (${r.bake.fallback}); fix the bundle (code-scenes 2.1) and rerun, or pass --allow-pixels`);
  }
}

function importScene(id, place) {
  const args = ['compositions', 'import', V, '--path', `${cfg.dirs.bundles}/${id}`, '--name', id, '--manifest', '{"contract":"baocut/1"}', ...place];
  if (flags.bake) args.push('--bake', flags.bake);
  if (flags.background) args.push('--background');
  const t0 = Date.now();
  const c = bc(args);
  return { c, sec: Math.round((Date.now() - t0) / 1000) };
}

// 原地换包并波纹：引擎把旧终点之后的片段挪 Δ 帧（帧数没变时 Δ 为 0），回执的 replaced.rippleFrames 就是 Δ
function replaceScene(s) {
  const r = rec.segments[s.id];
  const oldEnd = r.from + r.frames, want = s.frames - r.frames;
  if (want) { const b = r.from + Math.min(r.frames, s.frames); assertUnlocked(itemsFrom(b, true), b); }
  const { c, sec } = importScene(s.id, ['--replace', JSON.stringify({ itemId: r.sceneItem, ripple: true })]);
  const moved = c.replaced?.rippleFrames ?? 0;
  recordBake(r, c);
  Object.assign(r, { frames: s.frames, bundleHash: cur[s.id].hash, bakeSec: sec });
  shiftRecords(oldEnd, moved);
  if (moved) console.log(`${s.id}: rippled clips at frame >= ${oldEnd} by ${moved > 0 ? '+' : ''}${moved}`);
  if (moved !== want) throw new Error(`${s.id}: engine rippled ${moved} frames, bundle says ${want}; check data-duration against the clip and timeline.json`);
  checkBake(s.id, r);
}

function placeNarration(s) {
  const r = rec.segments[s.id], v = voice[s.id];
  if (!v) throw new Error(`no narration for ${s.id} in voice.json; run voice.mjs ${s.id}`);
  if (r.audioItem) apply(`Remove old narration ${s.id}`, [{ type: 'deleteItems', itemIds: [r.audioItem] }]);
  const a = bc(['assets', 'import', V, '--artifact-id', v.artifactId, '--name', `${cfg.names.narration} ${s.id}`, '--place', JSON.stringify({ track: A1, at: atOf(r.from, FPS) })]);
  Object.assign(r, { audioArtifact: v.artifactId, audioAsset: a.assetId, audioItem: a.itemId });
  save();
}

function placeScene(s) {
  const r = rec.segments[s.id];
  const { c, sec } = importScene(s.id, ['--place', JSON.stringify({ track: V1, at: atOf(r.from, FPS) })]);
  r.sceneItem = c.itemId;
  recordBake(r, c);
  Object.assign(r, { bundleHash: cur[s.id]?.hash ?? bundleHash(cfg.abs(cfg.dirs.bundles, s.id)), bakeSec: sec });
  save();
  checkBake(s.id, r);
}

// 1. 已放好的段：倒序处理变长变短（换包带 ripple），插入的段先腾出位置
if (!flags.verify) {
  for (const st of steps) {
    const s = lay.find(x => x.id === st.id);
    if (st.kind === 'insert') makeRoom(st.id, st.boundary, st.delta);
    else replaceScene(s);
  }
  // 2. 帧数没变但包或旁白换了的段
  for (const s of lay) {
    const c = cur[s.id];
    if (!c) continue;
    if (c.rebundled && !c.resized) replaceScene(s);
    if (c.revoiced) placeNarration(s);
  }
  // 3. 新段与缺一半的段：按 layout 的起点放
  for (const s of lay) {
    const r = (rec.segments[s.id] ||= {});
    r.from ??= s.from;
    if (r.from !== s.from) throw new Error(`${s.id} recorded at frame ${r.from}, layout says ${s.from}`);
    r.at = atOf(r.from, FPS);
    if (!r.audioItem) placeNarration(s);
    if (!r.sceneItem) placeScene(s);
  }
  rec.video = V;
  rec.fps = FPS;
  save();
}

// 4. 后台烘焙的结果补进记录
for (const s of lay) {
  const r = rec.segments[s.id];
  if (!r || !r.bakeJobId || r.bake) continue;
  const j = bc(['jobs', 'inspect', r.bakeJobId]);
  if (j.state !== 'completed') { console.log(`${s.id}: bake job ${r.bakeJobId} ${j.state}`); continue; }
  const b = (j.result || {}).bake;
  if (b) r.bake = { renderer: b.renderer, fps: b.fps ?? null, seconds: b.seconds ?? null, fallback: b.fallback?.reason ?? null };
  r.prerender = (j.result || {}).prerender?.assetId ?? r.prerender;
  save();
  if (r.bake) console.log(`${s.id}: bake ${r.bake.renderer} ${r.bake.fps ?? '?'} fps ${r.bake.seconds ?? '?'} s${r.bake.fallback ? ' fallback: ' + r.bake.fallback : ''}`);
}

// 5. 核对：每段的画面片段起点、帧数与 layout 一致，首尾相接
const scenes = new Map(itemsFrom(0).map(it => [it.id, it]));
const bad = [];
for (const s of lay) {
  const it = scenes.get(rec.segments[s.id]?.sceneItem);
  if (!it) bad.push(`${s.id}: scene clip not found`);
  else if (it.startFrame !== s.from || it.durationFrames !== s.frames) bad.push(`${s.id}: clip at ${it.startFrame}+${it.durationFrames}, layout ${s.from}+${s.frames}`);
}
console.log(bad.length ? 'CHECK FAILED\n' + bad.join('\n') : `check ok: ${lay.length} segments end to end, ${total} frames`);
if (bad.length) process.exit(1);
