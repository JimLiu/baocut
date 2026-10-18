#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 写 preview.json，给 video-production 的 examples/bundle-preview.html 用（页面拷到工程根目录，在根目录起静态服务打开）。
//   node tools/preview.mjs [--config explainer.json]
// 每段：代码包、旁白音频（audio/<id>.<格式>；gaps.mjs 留过白的用 timing 里的 gapAudio）、对齐好的句子（timing/<id>.json），稿子里这一段的备注行当 note。
// 有 clips.json 时，落在这一段的实拍片段换算成 clips: [{ src, at, dur, label, audio }]（at 是相对段首的秒数，
// 取所在句的开头，给了 cue 取 cue 被说到的时刻，gap 片段取旁白里留出的空白；同一段里后一个开始时截断）。src 是 overlay.mjs --preview 剪出的小片段。
// 片段带 subs 时换算成相对片段开头的 [{ start, end, text, tr, who }]，页面画在字幕带上；audio 为数字时是原声音量。
// 片段的 in / out 转场照抄成 { kind, dur, easing }（长度不超过片段一半），和后一个片段首尾相接的那一侧去掉，与 overlay.mjs 放上时间线的一致。
// 字幕带的样式取配置的 preview.caption（与字幕样式同一套键），不给就不画。
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, readJson, writeJson, scriptNotes, clipAt } from './lib.mjs';

const cfg = loadConfig();
const cl = readJson(cfg.abs(cfg.footage?.clips || 'clips.json'), { clips: [] });
const notes = scriptNotes(cfg);
const rel = p => path.relative(cfg.root, cfg.abs(p)).split(path.sep).join('/');
const missing = [];

const segments = cfg.order.map(id => {
  const tf = cfg.abs(cfg.dirs.timing, `${id}.json`);
  const tm = readJson(tf);
  if (!tm) missing.push(id);
  const clips = !tm ? [] : cl.clips.filter(c => c.seg === id).map(c => ({
    src: rel(path.join(cfg.dirs.work, 'clips', `${c.id}.mp4`)),
    at: +clipAt(tm, c).toFixed(3),
    dur: +(c.to - c.from).toFixed(3),
    label: c.label ?? cl.label ?? '',
    ...(c.audio ? { audio: true } : {}),
    ...(typeof c.audio === 'number' ? { volume: c.audio } : {}),
    ...(c.in ? { in: { kind: c.in.kind, dur: c.in.dur ?? 0.5, easing: c.in.easing || 'ease-in-out' } } : {}),
    ...(c.out ? { out: { kind: c.out.kind, dur: c.out.dur ?? 0.5, easing: c.out.easing || 'ease-in-out' } } : {}),
    ...(c.subs ? { subs: c.subs.map(x => ({ start: +(x.from - c.from).toFixed(3), end: +(x.to - c.from).toFixed(3), text: x.text, tr: x.tr, ...(x.who ? { who: x.who } : {}) })) } : {}),
  }));
  clips.sort((x, y) => x.at - y.at);
  clips.forEach((c, i) => { if (clips[i + 1]) c.dur = +Math.min(c.dur, clips[i + 1].at - c.at).toFixed(3); });
  clips.forEach((c, i) => {
    const n = clips[i + 1];
    if (n && c.at + c.dur >= n.at - 1e-3) { delete c.out; delete n.in; }
    for (const k of ['in', 'out']) if (c[k]) c[k].dur = +Math.min(c[k].dur, c.dur / 2).toFixed(3);
  });
  for (const c of clips) if (!fs.existsSync(cfg.abs(c.src))) console.log(`${id}: ${c.src} missing; run overlay.mjs --preview`);
  const audio = tm?.gapAudio || path.join(cfg.dirs.audio, `${id}.${cfg.voice.format || 'wav'}`);
  return {
    id,
    bundle: rel(path.join(cfg.dirs.bundles, id)),
    ...(fs.existsSync(cfg.abs(audio)) ? { audio: rel(audio) } : {}),
    ...(tm ? { lines: rel(path.join(cfg.dirs.timing, `${id}.json`)) } : {}),
    note: notes[id] || '',
    ...(clips.length ? { clips } : {}),
  };
});
writeJson(cfg.abs('preview.json'), { ...(cfg.preview?.caption ? { caption: cfg.preview.caption } : {}), segments });
if (missing.length) console.log(`no timing yet for ${missing.join(', ')}; those play on the page clock`);
console.log(segments.map(s => `${s.id}${s.clips ? ` clips:${s.clips.length}` : ''}`).join('  '));
