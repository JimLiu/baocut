#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本
// 给场景里要逐词点亮的原声对出词时间：clips.json 里带 words: true 的片段（多半是只有声音的原声，见 overlay.mjs）。
//   node tools/quotes.mjs [clip-id ...] [--fresh] [--config <配置>]      不给 id 时做全部带 words 的片段
// 每个片段：
//   1. ffmpeg 从原片切出 from–to 这一段（16 kHz 单声道 wav，响度标准化到 -20 LUFS），放在 <work>/quotes/<id>.wav；
//   2. bc transcribe 转写，拿到词级时间（已有 <work>/quotes/<id>.words.json 时不重转，--fresh 强制重转）；
//   3. said（原话全文，照录音一字不差地写，标点照写）按词拆开（中文、日文按字，标点跟着前一个字），
//      用编辑距离把字对到转写上（同 align.mjs），没对上的按前后插值；没给 said 时用转写的原文，并把它打出来，校对后写回 said；
//   4. 写 quotes.json：{ <id>: { said, text?, words: [{ t, s, e }] } }，s / e 是原片里的秒数，text 是成片语言的译文（clips.json 里的 text）。
// build.mjs 把它换成相对段首的秒数写进这一段的 TIMING.clips[].words，场景按 t ≥ s 点亮第几个词。
// 片段字段：words: true、said、text、language（原话的语言，缺省 footage.subs.language，再缺省 en）。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadConfig, parseArgs, makeBc, readJson, writeJson, isCjk, isSpoken } from './lib.mjs';

const cfg = loadConfig();
const { ids, flags } = parseArgs(process.argv);
const cl = readJson(cfg.abs(cfg.footage?.clips || 'clips.json'), { clips: [] });
const DIR = `${cfg.dirs.work}/quotes`;
const outFile = cfg.abs('quotes.json');
const out = readJson(outFile, {});
const want = cl.clips.filter(c => c.words && (!ids.length || ids.includes(c.id)));
const unknown = ids.filter(id => !cl.clips.some(c => c.id === id));
if (unknown.length) throw new Error(`not in clips.json: ${unknown.join(', ')}`);
if (!want.length) { console.log('no clips with words: true'); process.exit(0); }
const bc = makeBc(cfg);
const fold = c => c.toLowerCase();
fs.mkdirSync(cfg.abs(DIR), { recursive: true });

// 词：空白分开；中文、日文每个字一个词；标点跟着前一个词（开头的引号跟着后一个）
function tokens(text) {
  const out = [];
  let lead = '';
  for (const piece of text.trim().split(/\s+/)) {
    let cur = null;
    for (const ch of piece) {
      if (!isSpoken(ch)) {
        if (cur) cur.t += ch;
        else lead += ch;
        continue;
      }
      if (!cur || isCjk(ch) || isCjk([...cur.t].filter(isSpoken).at(-1) || '')) {
        if (cur) out.push(cur);
        cur = { t: lead + ch };
        lead = '';
      } else cur.t += ch;
    }
    if (cur) out.push(cur);
  }
  if (lead && out.length) out.at(-1).t += lead;
  return out;
}

function transcribe(c) {
  const words = `${DIR}/${c.id}.words.json`;
  if (fs.existsSync(cfg.abs(words)) && !flags.fresh) return JSON.parse(fs.readFileSync(cfg.abs(words), 'utf8'));
  const source = c.source || cl.source;
  if (!source || !fs.existsSync(source)) throw new Error(`${c.id}: source ${source} not found`);
  const wav = `${DIR}/${c.id}.wav`;
  // 安静的老录音（-40 LUFS 上下）整段会被转写的语音检测当成没有人声：切的时候先把这一段提到讲话的响度；
  // loudnorm 只改增益，词时间仍在原片的时钟上（实测前后错开 0 ms）
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(c.from), '-t', String(c.to - c.from), '-i', source, '-vn', '-af', 'loudnorm=I=-20:TP=-2:LRA=11', '-ac', '1', '-ar', '16000', cfg.abs(wav)]);
  const language = c.language || cfg.footage?.subs?.language || 'en';
  const r = bc(['transcribe', '--file', wav, '--no-video', '--out-dir', DIR, '--language', language, '--provider', cfg.asr.provider, '--model', cfg.asr.model, ...cfg.asr.args]);
  const ji = bc(['jobs', 'inspect', r.job.pipeline.summary.transcribeJobId]), art = (ji.result || ji.outputs || {}).artifactId;
  bc(['artifacts', 'save', '--artifact-id', art, '--path', words, '--overwrite']);
  return JSON.parse(fs.readFileSync(cfg.abs(words), 'utf8'));
}

for (const c of want) {
  const res = transcribe(c), ts = res.timescale;
  const heard = res.segments.map(s => s.text).join(' ').trim();
  const said = c.said || heard;
  if (!c.said) console.log(`${c.id}: no said in clips.json; using the transcript, check it against the recording and copy it into said:\n  ${heard}`);
  // 转写的字，时间在词内均分；原话的字带回指到第几个词
  const A = [];
  for (const seg of res.segments) for (const w of seg.words) {
    const cs = [...w.text].filter(isSpoken), a = w.start / ts, b = w.end / ts;
    cs.forEach((ch, i) => A.push({ c: ch, s: a + (b - a) * i / cs.length, e: a + (b - a) * (i + 1) / cs.length }));
  }
  const T = tokens(said), S = [];
  T.forEach((tok, ti) => { for (const ch of tok.t) if (isSpoken(ch)) S.push({ c: ch, ti }); });
  const n = S.length, m = A.length, D = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 0; i <= n; i++) D[i][0] = i;
  for (let j = 0; j <= m; j++) D[0][j] = j;
  const cost = (i, j) => (fold(S[i - 1].c) === fold(A[j - 1].c) ? 0 : 1);
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j - 1] + cost(i, j), D[i - 1][j] + 1, D[i][j - 1] + 1);
  const map = new Array(n).fill(null), subs = new Array(n).fill(false);
  let differs = 0;
  for (let i = n, j = m; i > 0 && j > 0;) {
    // 替换的字是转写听成了别的（口音、旧录音）：它也占那段时间，逐词点亮才不漏字
    if (D[i][j] === D[i - 1][j - 1] + cost(i, j)) { map[i - 1] = A[j - 1]; if (cost(i, j)) { differs++; subs[i - 1] = true; } i--; j--; }
    else if (D[i][j] === D[i - 1][j] + 1) i--;
    else j--;
  }
  // 没对上的字按前后对上的字插值
  const t0 = new Array(n), t1 = new Array(n);
  map.forEach((a, i) => { if (a) { t0[i] = a.s; t1[i] = a.e; } });
  for (let i = 0; i < n; i++) if (t0[i] == null) {
    let p = i - 1; while (p >= 0 && t0[p] == null) p--;
    let q = i + 1; while (q < n && t0[q] == null) q++;
    const a = p >= 0 ? t1[p] : q < n ? t0[q] : 0, b = q < n ? t0[q] : a;
    t0[i] = t1[i] = a + (b - a) * (i - p) / (q - p);
  }
  const words = T.map((tok, ti) => {
    const idx = S.map((s, i) => (s.ti === ti ? i : -1)).filter(i => i >= 0);
    return { t: tok.t, s: +(c.from + Math.min(...idx.map(i => t0[i]))).toFixed(3), e: +(c.from + Math.max(...idx.map(i => t1[i]))).toFixed(3) };
  });
  const matched = map.filter((a, i) => a && !subs[i]).length;
  out[c.id] = { said, ...(c.text ? { text: c.text } : {}), words };
  writeJson(outFile, out);
  console.log(`## ${c.id}  ${c.from}–${c.to}s  ${words.length} words  ${matched}/${n} chars matched${differs ? `, ${differs} differ` : ''}`);
  console.log('  ' + words.map(w => `${w.t}@${(w.s - c.from).toFixed(2)}`).join(' '));
  if (n && matched < n * 0.8) console.log(`  warning: only ${Math.round(matched / n * 100)}% of said matched the transcript; check from / to and said against the recording`);
  if (words.length && words.at(-1).e > c.to - 0.05) console.log('  note: the last word ends at the clip end; the clip may cut it off, check to');
}
