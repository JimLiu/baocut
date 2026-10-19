#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 在旁白里留白，让带原声的实拍片段（当事人原话、现场声音）单独放：clips.json 里 gap 为 true 的片段，
// 在 seg 段第 line 句（从 0 数；等于句数时放在段尾）之前插一段静音，长度 = 片段长 + pad，后面的句子整体往后挪。
// 几个留白片段给同一个 line 时，按 clips.json 里的先后背靠背连着放（中间不插旁白，也不回到代码画面），共用一段静音。
//   node tools/gaps.mjs [id …]      不给 id 就处理所有有留白片段的段
// 输入是 voice.mjs 的配音与 align.mjs 的 timing/<id>.json；第一次处理时把它们存成 timing/<id>.voice.json，之后都从这份算，可以反复跑。
// 输出：audio/<id>.gaps.<格式>（插好静音的旁白），timing/<id>.json 改成挪过的时间，并带上
//   gaps: [{ clip, line, at, dur }]（at 是片段在段内的起点）与 gapAudio（上面那个文件，预览页与 assemble.mjs 用它）。
// 重新配音、重新对齐之后要再跑一次。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadConfig, parseArgs, readJson, writeJson } from './lib.mjs';

const cfg = loadConfig();
const { ids } = parseArgs(process.argv);
const cl = readJson(cfg.abs(cfg.footage?.clips || 'clips.json'), { clips: [] });
const voice = readJson(cfg.abs(cfg.dirs.audio, 'voice.json'), {});
const PAD_BEFORE = 0.25, PAD_AFTER = 0.35;   // 上一句说完停一下再进片段（用原音频里本来的停顿）；片段完了停一下再接旁白
const bySeg = {};
for (const c of cl.clips) if (c.gap) (bySeg[c.seg] ||= []).push(c);
const todo = ids.length ? ids : Object.keys(bySeg);
if (!todo.length) { console.log('no clips with gap: true'); process.exit(0); }

for (const id of todo) {
  const tf = cfg.abs(cfg.dirs.timing, `${id}.json`), rawTf = cfg.abs(cfg.dirs.timing, `${id}.voice.json`);
  const cur = readJson(tf);
  if (!cur) throw new Error(`timing/${id}.json missing; run align.mjs ${id}`);
  if (!cur.gaps) writeJson(rawTf, cur);   // fresh from align.mjs: this is the raw timing
  const raw = readJson(rawTf);
  const audioRel = voice[id]?.file || `${cfg.dirs.audio}/${id}.${cfg.voice.format || 'wav'}`;
  const clips = (bySeg[id] || []).slice().sort((a, b) => a.line - b.line);
  if (!clips.length) { writeJson(tf, raw); console.log(`${id}: no gap clips, timing restored`); continue; }
  const n = raw.lines.length;
  // cut points in the raw audio, each with the silence to insert there
  const groups = [];
  for (const c of clips) {
    if (!(c.line >= 0 && c.line <= n)) throw new Error(`${c.id}: line ${c.line} out of range (segment has ${n} lines)`);
    const g = groups.at(-1);
    if (g && g.c.line === c.line) g.all.push(c); else groups.push({ c, all: [c] });
  }
  const cuts = groups.map(({ c, all }) => {
    const prevEnd = c.line > 0 ? raw.lines[c.line - 1].end : 0, next = c.line < n ? raw.lines[c.line].start : raw.audio;
    const p = c.line === 0 ? 0 : Math.min(prevEnd + PAD_BEFORE, next);
    return { c, all, p, dur: +(all.reduce((s, x) => s + x.to - x.from, 0) + PAD_AFTER).toFixed(3) };
  });
  // shifted timing
  const lines = raw.lines.map((l, i) => {
    const d = cuts.reduce((s, k) => s + (i >= k.c.line ? k.dur : 0), 0);
    return { ...l, start: +(l.start + d).toFixed(3), end: +(l.end + d).toFixed(3), chars: l.chars?.map(x => +(x + d).toFixed(3)) };
  });
  let before = 0;
  const gaps = cuts.flatMap(k => {
    let off = 0;
    const out = k.all.map((x, i) => {
      const len = x.to - x.from, g = { clip: x.id, line: x.line, at: +(k.p + before + off).toFixed(3), dur: +(len + (i === k.all.length - 1 ? PAD_AFTER : 0)).toFixed(3) };
      off += len;
      return g;
    });
    before += k.dur;
    return out;
  });
  const total = cuts.reduce((s, k) => s + k.dur, 0);
  // audio: raw pieces with silence between
  const info = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'csv=p=0', cfg.abs(audioRel)], { encoding: 'utf8' }).trim().split(',');
  const [sr, ch] = [+info[0], +info[1]];
  const parts = [], labels = [];
  let from = 0;
  cuts.forEach((k, i) => {
    parts.push(`[0:a]atrim=${from}:${k.p},asetpts=PTS-STARTPTS[a${i}]`, `anullsrc=r=${sr}:cl=${ch === 1 ? 'mono' : 'stereo'},atrim=0:${k.dur}[s${i}]`);
    labels.push(`[a${i}]`, `[s${i}]`);
    from = k.p;
  });
  parts.push(`[0:a]atrim=${from},asetpts=PTS-STARTPTS[z]`); labels.push('[z]');
  const outRel = `${cfg.dirs.audio}/${id}.gaps.${cfg.voice.format || 'wav'}`;
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', cfg.abs(audioRel), '-filter_complex', `${parts.join(';')};${labels.join('')}concat=n=${labels.length}:v=0:a=1[o]`, '-map', '[o]', cfg.abs(outRel)]);
  const dur = Math.ceil((raw.dur + total) * cfg.fps) / cfg.fps;
  writeJson(tf, { ...raw, dur, audio: +(raw.audio + total).toFixed(3), lines, gaps, gapAudio: outRel });
  console.log(`${id}: ${gaps.map(g => `${g.clip} @${g.at.toFixed(2)} +${g.dur.toFixed(2)}`).join(', ')}  → ${dur.toFixed(2)}s`);
}
