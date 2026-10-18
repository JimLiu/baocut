#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本
// 把每段旁白音频转写（词级时间），用编辑距离把字对到稿子原文，写 timing/<id>.json，并打印语速、停顿与读错检查。
//   node tools/align.mjs <id ...> [--fresh] [--chunk N] [--config explainer.json]
//   已有 .baocut-out/asr/<id>.words.json 时不重新转写，--fresh 强制重转。
//   --chunk N（或配置 asr.chunkSeconds）：长于 N 秒的段先在停顿处切成 N 秒以内的小段分别转写再合并；
//   整段转写把字时间挤成一团时用（例如 --fresh --chunk 14）。切段要本机有 ffmpeg。
// timing 格式：{dur, audio, lines:[{text, start, end, chars:[每个字符的开始时刻]}]}，chars 与 text 按 JS 下标一一对应。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { loadConfig, parseArgs, makeBc, readJson, writeJson, scriptLines, narrationText, units, isSpoken } from './lib.mjs';

const cfg = loadConfig();
const bc = makeBc(cfg);
const { ids, flags } = parseArgs(process.argv, ['chunk']);
const CHUNK = flags.chunk != null ? +flags.chunk : +cfg.asr.chunkSeconds || 0;
const ASR = `${cfg.dirs.work}/asr`;
const voice = readJson(cfg.abs(cfg.dirs.audio, 'voice.json'), {});
const fold = c => c.toLowerCase();

function transcribeFile(rel, out) {
  const args = ['transcribe', '--file', rel, '--no-video', '--out-dir', ASR, '--language', cfg.language, '--provider', cfg.asr.provider, '--model', cfg.asr.model, ...cfg.asr.args];
  const r = bc(args);
  const inner = r.job.pipeline.summary.transcribeJobId;
  const ji = bc(['jobs', 'inspect', inner]), art = (ji.result || ji.outputs || {}).artifactId;
  bc(['artifacts', 'save', '--artifact-id', art, '--path', out, '--overwrite']);
  return JSON.parse(fs.readFileSync(cfg.abs(out), 'utf8'));
}

function needFfmpeg() {
  if (spawnSync('ffmpeg', ['-version']).error) throw new Error('--chunk needs ffmpeg on PATH; install it or align without chunking');
}

// 停顿的中点作为切点：每块尽量在 MAX 秒以内、不短于 MIN 秒
function cutPoints(file, dur, MAX) {
  const log = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=noise=-35dB:d=0.3', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const sil = [];
  let s0 = null;
  for (const l of log.split('\n')) {
    let m = l.match(/silence_start: ([\d.]+)/);
    if (m) s0 = +m[1];
    m = l.match(/silence_end: ([\d.]+)/);
    if (m && s0 != null) { sil.push((s0 + +m[1]) / 2); s0 = null; }
  }
  const MIN = Math.min(10, MAX / 2), TGT = MAX * 0.73, mids = [...new Set(sil)].sort((a, b) => a - b), cuts = [0];
  let last = 0;
  for (let i = 0; i < mids.length; i++) {
    const m = mids[i], next = mids[i + 1] ?? dur;
    if (m - last >= MIN && (next - last > MAX || m - last >= TGT) && dur - m >= 6) { cuts.push(m); last = m; }
  }
  cuts.push(dur);
  return cuts;
}

function transcribe(id, audioRel, audioDur) {
  const wf = cfg.abs(ASR, id + '.words.json');
  if (fs.existsSync(wf) && !flags.fresh) return JSON.parse(fs.readFileSync(wf, 'utf8'));
  fs.mkdirSync(cfg.abs(ASR, 'chunks'), { recursive: true });
  if (!(CHUNK > 0 && audioDur > CHUNK)) return transcribeFile(audioRel, `${ASR}/${id}.words.json`);
  needFfmpeg();
  if (!Number.isFinite(audioDur)) audioDur = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', cfg.abs(audioRel)], { encoding: 'utf8' }).trim();
  const cuts = cutPoints(cfg.abs(audioRel), audioDur, CHUNK);
  let merged = null;
  for (let k = 0; k + 1 < cuts.length; k++) {
    const rel = `${ASR}/chunks/${id}-${k}.wav`;
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', audioRel, '-ss', String(cuts[k]), '-to', String(cuts[k + 1]), rel], { cwd: cfg.root });
    const r = transcribeFile(rel, `${ASR}/chunks/${id}-${k}.words.json`), off = Math.round(cuts[k] * r.timescale);
    if (!merged) merged = { ...r, segments: [], chunks: [] };
    const sc = merged.timescale / r.timescale, sh = t => Math.round((t + off) * sc);
    for (const seg of r.segments) merged.segments.push({ ...seg, start: sh(seg.start), end: sh(seg.end), words: seg.words.map(w => ({ ...w, start: sh(w.start), end: sh(w.end) })) });
    merged.chunks.push([cuts[k], cuts[k + 1]]);
    console.log(`  chunk ${k} ${cuts[k].toFixed(2)}–${cuts[k + 1].toFixed(2)}`);
  }
  merged.duration = Math.round(audioDur * merged.timescale);
  fs.writeFileSync(wf, JSON.stringify(merged));
  return merged;
}

// 识别出的词拆成字，时间在词内均分
function asrChars(res) {
  const ts = res.timescale, out = [];
  for (const seg of res.segments) for (const w of seg.words) {
    const cs = [...w.text].filter(isSpoken), a = w.start / ts, b = w.end / ts;
    cs.forEach((c, i) => out.push({ c, s: a + (b - a) * i / cs.length, e: a + (b - a) * (i + 1) / cs.length }));
  }
  return out;
}

function align(id, lines) {
  const v = voice[id] || {};
  const audioRel = v.file || `${cfg.dirs.audio}/${id}.wav`;
  if (!fs.existsSync(cfg.abs(audioRel))) throw new Error(`${audioRel} missing; run voice.mjs ${id} first`);
  if (v.text != null && v.text !== narrationText(lines)) console.log(`  warning: ${id} script text changed since it was voiced; re-run voice.mjs ${id}`);
  const res = transcribe(id, audioRel, v.durationSec ?? Infinity);
  const A = asrChars(res);
  // 稿子里要念的字，带回指到行与下标
  const S = [];
  lines.forEach((text, li) => { for (let k = 0; k < text.length; k++) if (isSpoken(text[k])) S.push({ c: text[k], li, k }); });
  const n = S.length, m = A.length, D = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 0; i <= n; i++) D[i][0] = i;
  for (let j = 0; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++)
    D[i][j] = Math.min(D[i - 1][j - 1] + (fold(S[i - 1].c) === fold(A[j - 1].c) ? 0 : 1), D[i - 1][j] + 1, D[i][j - 1] + 1);
  const map = new Array(n).fill(null), extra = [], subs = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (fold(S[i - 1].c) === fold(A[j - 1].c) ? 0 : 1)) {
      map[i - 1] = A[j - 1];
      if (fold(S[i - 1].c) !== fold(A[j - 1].c)) subs.push([S[i - 1], A[j - 1]]);
      i--; j--;
    } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) i--;
    else { extra.push([A[j - 1], i > 0 ? S[i - 1] : null]); j--; }
  }
  // 没对上的字按前后插值
  const t0 = new Array(n), t1 = new Array(n);
  for (let i = 0; i < n; i++) if (map[i]) { t0[i] = map[i].s; t1[i] = map[i].e; }
  for (let i = 0; i < n; i++) if (t0[i] == null) {
    let p = i - 1; while (p >= 0 && t0[p] == null) p--;
    let q = i + 1; while (q < n && t0[q] == null) q++;
    const a = p >= 0 ? t1[p] : (q < n ? t0[q] : 0), b = q < n ? t0[q] : a;
    t0[i] = a + (b - a) * (i - p) / (q - p); t1[i] = t0[i];
  }
  const out = lines.map((text, li) => {
    const idx = S.map((s, i) => [s, i]).filter(([s]) => s.li === li);
    if (!idx.length) throw new Error(`${id} line ${li} has nothing to speak: ${text}`);
    const chars = new Array(text.length);
    for (const [s, i] of idx) chars[s.k] = +t0[i].toFixed(3);
    for (let k = 0; k < text.length; k++) if (chars[k] == null && k > 0) chars[k] = chars[k - 1]; // 标点跟前一个字
    for (let k = text.length - 1; k >= 0; k--) if (chars[k] == null) chars[k] = chars[k + 1];
    return { text, start: +t0[idx[0][1]].toFixed(3), end: +t1[idx[idx.length - 1][1]].toFixed(3), chars };
  });
  const audioDur = res.duration / res.timescale;
  const dur = Math.ceil((Math.max(audioDur, out[out.length - 1].end) + cfg.tail) * cfg.fps) / cfg.fps;
  writeJson(cfg.abs(cfg.dirs.timing, id + '.json'), { dur, audio: audioDur, lines: out });
  // 接缝检查：每句的语速、句间停顿、多念、漏念与念错的字
  const rates = out.map(l => units(l.text) / Math.max(0.1, l.end - l.start));
  const med = [...rates].sort((a, b) => a - b)[rates.length >> 1];
  console.log(`## ${id}  audio ${audioDur.toFixed(2)}s  dur ${dur.toFixed(2)}s  median ${med.toFixed(2)} units/s`);
  let flagged = 0;
  out.forEach((l, i) => {
    const gap = i ? l.start - out[i - 1].end : l.start, dev = rates[i] / med - 1;
    const flag = (Math.abs(dev) > 0.15 ? ' RATE' : '') + (gap > 0.8 ? ' GAP' : '');
    if (flag.includes('RATE')) flagged++;
    console.log(`${String(i).padStart(2)} ${l.start.toFixed(2)}–${l.end.toFixed(2)} gap ${gap.toFixed(2)} ${rates[i].toFixed(2)}${flag}  ${l.text.slice(0, 40)}`);
  });
  if (extra.length) console.log('  extra in audio:', extra.reverse().map(([a, s]) => `${a.c}@${a.s.toFixed(1)}${s ? '(after ' + s.c + ' L' + s.li + ')' : ''}`).join(' '));
  const miss = S.filter((s, i) => !map[i]);
  if (miss.length) console.log('  missing in asr:', miss.map(s => `L${s.li} ${s.c}`).join(' '));
  if (subs.length) console.log('  differs:', subs.reverse().map(([s, a]) => `L${s.li} ${s.c}→${a.c}`).join(' '));
  console.log('  asr:', res.segments.map(s => s.text).join(' / '));
  if (out.length >= 4 && (flagged > out.length / 4 || miss.length > n * 0.15))
    console.log(`  hint: timing may have collapsed; retry with: align.mjs ${id} --fresh --chunk 14`);
}

const all = scriptLines(cfg);
if (!ids.length) { console.error('usage: align.mjs <id ...> [--fresh] [--chunk N]'); process.exit(2); }
for (const id of ids) {
  if (!all[id]) throw new Error(`no narration lines for ${id}`);
  align(id, all[id]);
}
