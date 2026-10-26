#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 配音之后改旁白里的空白，两件事，可以只做一件：
// 1. 留白：让带原声的实拍片段（当事人原话、现场声音）单独放。clips.json 里 gap 为 true 的片段，
//    在 seg 段第 line 句（从 0 数；等于句数时放在段尾）之前插一段静音，长度 = 片段长 + pad，后面的句子整体往后挪。
//    几个留白片段给同一个 line 时，按 clips.json 里的先后背靠背连着放（中间不插旁白，也不回到代码画面），共用一段静音。
// 2. 压停顿：给了 voice.maxPause（或 --max-pause 秒数）时，句与句之间长于它的静音压到这么长（前后各留一半），
//    句内的停顿（逗号）不动，留白的那个接缝不压。固定口播的段（fixedLines）不压。
// 3. 停一拍：旁白稿里单独一行 `@beat`（或 `@beat 0.6`，秒，缺省 0.6）写在哪两句之间，那里的静音就调到这么长：
//    长了压到这么长，短了在静音中间补上，不随 maxPause 一起压。揭晓、让观众先猜之前用；同一处有留白片段时以留白为准。
//   node tools/gaps.mjs [id …] [--max-pause 0.3]   不给 id 就处理有留白片段的段、要压停顿或停一拍的段，以及以前处理过、现在要还原的段
// 输入是 voice.mjs 的配音与 align.mjs 的 timing/<id>.json；第一次处理时把它们存成 timing/<id>.voice.json，之后都从这份算，可以反复跑。
// 输出：audio/<id>.gaps.<格式>（改好空白的旁白），timing/<id>.json 改成挪过的时间，并带上
//   gaps: [{ clip, line, at, dur }]（at 是片段在段内的起点）、tightened: [{ line, at, cut }]（压掉的静音）、
//   beats: [{ line, at, pause, was }]（停一拍：第 line 句之前的静音从 was 秒调到 pause 秒，at 是静音的起点）与 gapAudio（上面那个文件，预览页与 assemble.mjs 用它）。
//   三件事都不用做的段还原成原始对齐。重新配音、重新对齐之后要再跑一次。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadConfig, parseArgs, readJson, writeJson, scriptBeats } from './lib.mjs';

const cfg = loadConfig();
const { ids, flags } = parseArgs(process.argv, ['max-pause']);
const cl = readJson(cfg.abs(cfg.footage?.clips || 'clips.json'), { clips: [] });
const voice = readJson(cfg.abs(cfg.dirs.audio, 'voice.json'), {});
const PAD_BEFORE = 0.25, PAD_AFTER = 0.35;   // 上一句说完停一下再进片段（用原音频里本来的停顿）；片段完了停一下再接旁白
const maxPause = flags['max-pause'] != null ? +flags['max-pause'] : cfg.voice.maxPause ?? 0;
if (!(maxPause >= 0)) throw new Error(`max pause must be a number of seconds, got ${flags['max-pause'] ?? cfg.voice.maxPause}`);
const RATE = 16000, WIN = 0.01, SILENT = 0.012;   // 检测静音：16 kHz 单声道，10 ms 一个窗口，RMS 低于约 -38 dBFS 算静音
const bySeg = {};
for (const c of cl.clips) if (c.gap) (bySeg[c.seg] ||= []).push(c);
const tighten = id => maxPause > 0 && !cfg.fixedLines[id];
const beats = fs.existsSync(cfg.abs(cfg.script.path)) ? scriptBeats(cfg) : {};
const beatsOf = id => beats[id] || {};
const hasBeats = id => Object.keys(beatsOf(id)).length > 0;
const timingOf = id => readJson(cfg.abs(cfg.dirs.timing, `${id}.json`));
const todo = ids.length ? ids : cfg.order.filter(id => bySeg[id] || ((tighten(id) || hasBeats(id)) && timingOf(id)) || timingOf(id)?.gapAudio);
if (!todo.length) { console.log('no clips with gap: true, no voice.maxPause and no @beat; nothing to do'); process.exit(0); }

// 每 10 ms 一个窗口是不是静音
function quietWindows(file) {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
  const n = pcm.length >> 1, win = Math.round(WIN * RATE), out = [];
  for (let s = 0; s < n; s += win) {
    let acc = 0, k = 0;
    for (let j = s; j < Math.min(n, s + win); j++, k++) { const v = pcm.readInt16LE(j * 2) / 32768; acc += v * v; }
    out.push(Math.sqrt(acc / k) < SILENT);
  }
  return out;
}

for (const id of todo) {
  const tf = cfg.abs(cfg.dirs.timing, `${id}.json`), rawTf = cfg.abs(cfg.dirs.timing, `${id}.voice.json`);
  const cur = readJson(tf);
  if (!cur) throw new Error(`timing/${id}.json missing; run align.mjs ${id}`);
  if (!cur.gapAudio) writeJson(rawTf, cur);   // fresh from align.mjs: this is the raw timing
  const raw = readJson(rawTf);
  const audioRel = voice[id]?.file || `${cfg.dirs.audio}/${id}.${cfg.voice.format || 'wav'}`;
  const clips = (bySeg[id] || []).slice().sort((a, b) => a.line - b.line);
  if (!clips.length && !tighten(id) && !hasBeats(id)) { writeJson(tf, raw); console.log(`${id}: no gap clips, pause limit or beats, timing restored`); continue; }
  const n = raw.lines.length;
  // 留白：插在原音频的哪一刻、插多长
  const groups = [];
  for (const c of clips) {
    if (!(c.line >= 0 && c.line <= n)) throw new Error(`${c.id}: line ${c.line} out of range (segment has ${n} lines)`);
    const g = groups.at(-1);
    if (g && g.c.line === c.line) g.all.push(c); else groups.push({ c, all: [c] });
  }
  const inserts = groups.map(({ c, all }) => {
    const prevEnd = c.line > 0 ? raw.lines[c.line - 1].end : 0, next = c.line < n ? raw.lines[c.line].start : raw.audio;
    const p = c.line === 0 ? 0 : Math.min(prevEnd + PAD_BEFORE, next);
    return { line: c.line, all, p, dur: +(all.reduce((s, x) => s + x.to - x.from, 0) + PAD_AFTER).toFixed(3) };
  });
  // 压停顿与停一拍：第 i 句与第 i + 1 句之间最长的一段静音（对齐的句首句尾不一定准，前后各放宽一点找），
  // 有 @beat 的调到拍子的长度（长了压、短了在中间补静音），其余长于 maxPause 的压到 maxPause
  const cuts = [], pads = [], beatLog = [];
  const want = beatsOf(id);
  for (const k of Object.keys(want).map(Number)) {
    if (k < 1 || k >= n) console.warn(`${id}: @beat before line ${k} ignored: a beat sits between two lines (segment has ${n}; use hold to stay longer at the end)`);
    else if (inserts.some(x => x.line === k)) console.warn(`${id}: @beat before line ${k} ignored: a gap clip already opens a pause there`);
  }
  if (tighten(id) || hasBeats(id)) {
    const quiet = quietWindows(cfg.abs(audioRel));
    for (let i = 0; i + 1 < n; i++) {
      if (inserts.some(k => k.line === i + 1)) continue;
      const beat = want[i + 1];
      if (beat === undefined && !tighten(id)) continue;
      const a = Math.max(0, Math.floor((raw.lines[i].end - 0.3) / WIN)), b = Math.ceil((raw.lines[i + 1].start + 0.25) / WIN);
      let best = null, run = null;
      for (let w = a; w <= b && w < quiet.length; w++) {
        if (!quiet[w]) { run = null; continue; }
        run = run ? [run[0], w + 1] : [w, w + 1];
        if (!best || run[1] - run[0] > best[1] - best[0]) best = run;
      }
      const len = best ? (best[1] - best[0]) * WIN : 0, limit = beat ?? maxPause;
      if (len > limit + 0.02) cuts.push({ line: i + 1, from: +(best[0] * WIN + limit / 2).toFixed(3), to: +(best[1] * WIN - limit / 2).toFixed(3) });
      else if (beat !== undefined && len < beat - 0.02) {
        const p = best ? (best[0] + best[1]) / 2 * WIN : (raw.lines[i].end + raw.lines[i + 1].start) / 2;
        pads.push({ line: i + 1, p: +p.toFixed(3), dur: +(beat - len).toFixed(3) });
      }
      if (beat !== undefined) beatLog.push({ line: i + 1, from: best ? best[0] * WIN : raw.lines[i].end, pause: beat, was: +len.toFixed(2) });
    }
  }
  // 时间换算：压掉的那段里的时刻落到它的起点；第 i 句及之后加上它前面插的留白与补的拍子（按句号算，不按时刻，句尾正好碰到插入点时不会挪错）
  const cutBefore = t => cuts.reduce((s, c) => s + (t >= c.to ? c.to - c.from : t > c.from ? t - c.from : 0), 0);
  const addBefore = i => [...inserts, ...pads].reduce((s, k) => s + (i >= k.line ? k.dur : 0), 0);
  const map = (t, i) => +(t - cutBefore(t) + addBefore(i)).toFixed(3);
  const lines = raw.lines.map((l, i) => ({ ...l, start: map(l.start, i), end: map(l.end, i), chars: l.chars?.map(x => map(x, i)) }));
  let before = 0;
  const gaps = inserts.flatMap(k => {
    let off = 0;
    const base = k.p - cutBefore(k.p) + before + pads.reduce((s, x) => s + (x.line < k.line ? x.dur : 0), 0);
    const out = k.all.map((x, i) => {
      const len = x.to - x.from, g = { clip: x.id, line: x.line, at: +(base + off).toFixed(3), dur: +(len + (i === k.all.length - 1 ? PAD_AFTER : 0)).toFixed(3) };
      off += len;
      return g;
    });
    before += k.dur;
    return out;
  });
  const added = [...inserts, ...pads].reduce((s, k) => s + k.dur, 0), removed = cuts.reduce((s, c) => s + c.to - c.from, 0);
  // 音频：按原音频的时刻依次拼原段、静音，跳过压掉的部分
  const info = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels', '-of', 'csv=p=0', cfg.abs(audioRel)], { encoding: 'utf8' }).trim().split(',');
  const [sr, ch] = [+info[0], +info[1]];
  const ops = [...[...inserts, ...pads].map(k => ({ at: k.p, add: k.dur })), ...cuts.map(c => ({ at: c.from, skipTo: c.to }))].sort((x, y) => x.at - y.at);
  const parts = [], labels = [];
  let from = 0;
  ops.forEach((o, i) => {
    if (o.at > from) { parts.push(`[0:a]atrim=${from}:${o.at},asetpts=PTS-STARTPTS[a${i}]`); labels.push(`[a${i}]`); }
    if (o.add) { parts.push(`anullsrc=r=${sr}:cl=${ch === 1 ? 'mono' : 'stereo'},atrim=0:${o.add}[s${i}]`); labels.push(`[s${i}]`); from = Math.max(from, o.at); }
    else from = o.skipTo;
  });
  parts.push(`[0:a]atrim=${from},asetpts=PTS-STARTPTS[z]`); labels.push('[z]');
  const outRel = `${cfg.dirs.audio}/${id}.gaps.${cfg.voice.format || 'wav'}`;
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', cfg.abs(audioRel), '-filter_complex', `${parts.join(';')};${labels.join('')}concat=n=${labels.length}:v=0:a=1[o]`, '-map', '[o]', cfg.abs(outRel)]);
  const dur = Math.ceil((raw.dur + added - removed) * cfg.fps) / cfg.fps;
  const tightened = cuts.map(c => ({ line: c.line, at: +(c.from - cutBefore(c.from) + addBefore(c.line)).toFixed(3), cut: +(c.to - c.from).toFixed(3) }));
  const beatsOut = beatLog.map(x => ({ line: x.line, at: +(x.from - cutBefore(x.from) + addBefore(x.line - 1)).toFixed(3), pause: x.pause, was: x.was }));
  writeJson(tf, { ...raw, dur, audio: +(raw.audio + added - removed).toFixed(3), lines, ...(gaps.length ? { gaps } : {}), ...(tightened.length ? { tightened } : {}), ...(beatsOut.length ? { beats: beatsOut } : {}), gapAudio: outRel });
  const pauses = lines.slice(1).filter((l, i) => !inserts.some(k => k.line === i + 1) && want[i + 1] === undefined).map(l => l.start - lines[lines.indexOf(l) - 1].end), longest = pauses.length ? Math.max(...pauses) : 0;
  console.log(`${id}: ${gaps.map(g => `${g.clip} @${g.at.toFixed(2)} +${g.dur.toFixed(2)}`).join(', ') || 'no gap clips'}` +
    `${cuts.length ? `  pauses -${removed.toFixed(2)}s in ${cuts.length} cuts` : ''}` +
    `${beatsOut.length ? `  beats ${beatsOut.map(x => `before line ${x.line} ${x.was.toFixed(2)}→${x.pause.toFixed(2)}s`).join(', ')}` : ''}  → ${dur.toFixed(2)}s (raw ${raw.dur.toFixed(2)}s)` +
    `${tighten(id) && longest > maxPause + 0.5 ? `  longest pause between aligned lines ${longest.toFixed(2)}s (no silence found there)` : ''}`);
}
