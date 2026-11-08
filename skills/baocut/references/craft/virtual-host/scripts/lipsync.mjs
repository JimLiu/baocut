#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 配音 + 逐字时间 → 角色的动作轨（人偶格式规范 §4 的 JSON）：嘴型与元音、每句的朝向、音节上的点头、表情区间。
// 眨眼、呼吸、视线交给播放器的待机动作。
//   node lipsync.mjs --timing timing/intro.json --audio audio/intro.wav --out host/intro.track.json
//   node lipsync.mjs --words intro.words.json --audio intro.wav --out intro.track.json --lang ja
//   node lipsync.mjs --audio intro.wav --out intro.track.json            # 只有声音：按音量与元音线索出口型
// 选项：--lang（BCP 47，缺省 auto）--dur 秒 --faces faces.json --readings readings.json（{ 词: 读音 }，纠正读错或读不出的词）
//       --seed 1 --fps 30（核对表按这个帧率列口型）--check 核对表路径（缺省与 --out 同目录的 lipsync-check.txt）
// 轨的 0 秒是配音的 0 秒；放进视频时角色贴纸的 motionIn 对上配音的开头。
// 读音决定闭唇、咬唇还是圆唇，音量决定张多大并兜住对齐误差（静音就闭嘴）。音量包络与元音线索移植自 LivLiv Player
// （Apache-2.0，见 THIRD_PARTY_NOTICES.md）。只依赖 Node 自带的模块与 ffmpeg；结果只由输入与 --seed 决定。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { OPEN, layoutPlan, planLabel, planText } from './visemes.mjs';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
export const STEP = 0.01; // 细时间轴 10 毫秒一格，与音量包络同步
const LEAD = 0.03; // 嘴比声音早 30 毫秒
const GAP_CLOSE = 0.15; // 字与字之间停顿超过 150 毫秒就闭嘴
const PHRASE_GAP = 0.35; // 停顿超过这么久算新的一句
const SILENT = 0.05, SILENT_RUN = 8; // 音量低于它连续 80 毫秒算静音
const VOICELESS = 15; // 清辅音声母最长按 150 毫秒算
const LOUD = 0.25, LOUD_RUN = 4; // 读音这里不说话，声音却有 40 毫秒响过它：逐字时间偏了或漏了字，这段按声音出口型
// 张多大跟音量走：音量分小、中、大三档，上下各留 0.04 的回差，免得在门槛附近来回跳
const LEVELS = [0.25, 0.5], HYST = 0.04;
// 读音给的口型在各档实际画哪张：D 小声是 B、中等是 C；C 小声是 B；E 小声是 F。其余口型不随音量变
const BY_LEVEL = { D: ['B', 'C', 'D'], C: ['B', 'C', 'C'], E: ['F', 'E', 'E'] };
const HOLD_S = 0.055; // 每种口型至少停 55 毫秒，与播放器换嘴帧的最短停留一样（120 fps 是 7 步；A 闭唇至少 1 步）

// ---------- 读音频 ----------
export function decodeAudio(file, rate = 16000) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 2 ** 31 });
  if (r.status !== 0) throw new Error(`cannot decode ${file}: ${String(r.stderr).trim().split('\n').slice(-2).join(' ')}`);
  const buf = r.stdout;
  if (!buf.length) throw new Error(`no audio decoded from ${file}`);
  return { x: new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)), sr: rate };
}

// ---------- 音量包络（LivLiv speech.ts envelope()）----------
/** 人声频段（150–1500 Hz）的张嘴程度，每 10 毫秒一个 0..1，已经提前 30 毫秒 */
export function envelope(x, sr) {
  const FPS = 100, LEADF = 3;
  const hop = Math.max(1, Math.round(sr / FPS)), n = Math.ceil(x.length / hop);
  const lp = 1 - Math.exp((-2 * Math.PI * 1500) / sr), hp = 1 - Math.exp((-2 * Math.PI * 150) / sr);
  const sum = new Float32Array(n);
  let a = 0, b = 0;
  for (let i = 0; i < x.length; i++) {
    a += (x[i] - a) * lp; b += (a - b) * hp;
    const v = a - b;
    sum[Math.floor(i / hop)] += v * v;
  }
  const e = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) { e[i] = Math.sqrt((sum[i] + (sum[i + 1] ?? 0)) / (2 * hop)); max = Math.max(max, e[i]); }
  if (!max) return new Float32Array(n);
  const voiced = Array.from(e).filter(v => v > max * 0.05).sort((p, q) => p - q);
  const ref = voiced[Math.floor(voiced.length * 0.9)] || max, gate = ref * 0.1;
  const lv = e.map(v => Math.pow(Math.min(1, Math.max(0, (v - gate) / Math.max(ref - gate, 1e-6))), 0.75));
  const K = 10, out = new Float32Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    let avg = 0;
    for (let j = i - K; j <= i + K; j++) avg += lv[Math.min(n - 1, Math.max(0, j))];
    avg /= 2 * K + 1;
    const o = Math.min(1, Math.max(0, lv[i] * 0.6 + (lv[i] - avg) * 1.2));
    s += (o - s) * (o > s ? 0.6 : 0.45);
    out[i] = s;
  }
  return Float32Array.from({ length: n }, (_, i) => out[i + LEADF] ?? 0);
}

// ---------- 元音线索（LivLiv vowel.ts）----------
const BACK = [300, 900, 1800, 3500], CLOSE = [250, 650, 650, 1300];
const PRIOR = 15, ROUND_AT = 10, WIDE_AT = 3, CLOSE_AT = 8;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2;
        const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const c2 = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = c2;
      }
    }
  }
}

/** 每 10 毫秒一个 -1（圆唇 o u）.. +1（扁唇 i e），0 是 a 或拿不准；与 envelope() 同一套帧 */
export function vowelTrack(x, sr, env) {
  const FPS = 100, LEADF = 3, hop = sr / FPS;
  const size = 1 << Math.round(Math.log2(0.0213 * sr));
  const win = Float32Array.from({ length: size }, (_, i) => 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (size - 1)));
  const re = new Float32Array(size), im = new Float32Array(size), pw = new Float32Array(size / 2), out = new Float32Array(env.length);
  const hz = sr / size, dt = 1 / FPS;
  const band = (lo, hi) => { let s = 1e-12; for (let k = Math.ceil(lo / hz); k * hz < hi && k < pw.length; k++) s += pw[k]; return s; };
  let center = PRIOR, value = 0, seen = 0;
  for (let f = 0; f < env.length; f++) {
    const c = Math.round((f + LEADF) * hop);
    for (let i = 0; i < size; i++) { const j = c - size / 2 + i; re[i] = (j >= 0 && j < x.length ? x[j] : 0) * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) pw[k] = re[k] * re[k] + im[k] * im[k];
    const back = 10 * Math.log10(band(BACK[0], BACK[1]) / band(BACK[2], BACK[3]));
    const close = 10 * Math.log10(band(CLOSE[0], CLOSE[1]) / band(CLOSE[2], CLOSE[3]));
    const level = env[f];
    let target = 0;
    if (level > 0.15) {
      if (level > 0.3) { seen += dt; const k = Math.min(1, dt / Math.min(3, 0.3 + seen)); center += (Math.min(24, Math.max(8, back)) - center) * k; }
      const round = (back - center) / ROUND_AT;
      const wide = ((center - back) / WIDE_AT) * Math.min(1, Math.max(0, (close - CLOSE_AT + 4) / 4));
      target = Math.max(-1, Math.min(1, wide > 0 ? wide : -Math.max(0, round)));
    }
    value += (target - value) * Math.min(1, dt / 0.035);
    out[f] = value;
  }
  return out;
}

// ---------- 输入 ----------
const syllableGuess = u => (u.beats != null ? u.beats : u.kind === 'latin' ? Math.max(1, (u.text.toLowerCase().match(/[aeiouy]+/g) || []).length) : u.kind === 'number' || u.kind === 'other' ? Math.max(1, Math.round(u.text.length / 2)) : 1);

/** 句中停顿（标点后）与对不上的长字，按这段的语速收短，免得嘴在停顿里一直张着 */
function capUnits(units) {
  const per = units.filter(u => !u.pauseAfter && !u.last && u.t1 > u.t0).map(u => (u.t1 - u.t0) / syllableGuess(u)).sort((a, b) => a - b);
  const med = per.length ? per[per.length >> 1] : 0.22;
  for (const u of units) {
    const want = med * syllableGuess(u);
    const cap = u.pauseAfter ? Math.min(Math.max(0.15, want * 1.6), 0.6) : u.last ? Infinity : Math.max(0.3, want * 3);
    if (u.t1 - u.t0 > cap) u.t1 = u.t0 + cap;
  }
  return units;
}

/**
 * 对齐器偶尔把一个字压成零长度（0.1 毫秒），它的口型会被下一个字盖掉。这样的字与紧跟着的字平分后者的时长；
 * 后面没有紧跟的字时往后借一拍（不超过下一个字开始前 50 毫秒）
 */
function fillCollapsed(units) {
  const live = units.filter(u => u.t1 - u.t0 >= 0.04).map(u => (u.t1 - u.t0) / syllableGuess(u)).sort((a, b) => a - b);
  const beat = live.length ? live[live.length >> 1] : 0.2;
  for (let k = 0; k < units.length; k++) {
    const u = units[k];
    if (u.t1 - u.t0 >= 0.04) continue;
    let g = k + 1;
    while (g < units.length && units[g].line === u.line && units[g].t0 - u.t0 < 0.05 && units[g].t1 - units[g].t0 < 0.04) g++;
    const next = units[g];
    const group = units.slice(k, g);
    if (next && next.line === u.line && next.t0 - u.t0 < 0.05) {
      group.push(next);
      const t0 = u.t0, t1 = next.t1, w = group.map(syllableGuess), total = w.reduce((a, b) => a + b, 0);
      let t = t0;
      group.forEach((v, i) => { v.t0 = t; t += ((t1 - t0) * w[i]) / total; v.t1 = t; });
      k = g;
    } else {
      let t = u.t0;
      const limit = next ? next.t0 - 0.05 : Infinity;
      for (const v of group) { v.t0 = t; v.t1 = Math.max(t, Math.min(t + beat * syllableGuess(v), limit)); t = v.t1; }
      k = g - 1;
    }
  }
  return units;
}

/** production-scripts 的 timing/<id>.json：{dur, audio, lines:[{text, start, end, chars:[每个字符的开始时刻]}]} */
export function unitsFromTiming(timing, lang, readings = null) {
  if (!timing || !Array.isArray(timing.lines)) throw new Error('timing file has no lines[]');
  const units = [];
  timing.lines.forEach((line, li) => {
    if (!Array.isArray(line.chars) || line.chars.length !== line.text.length) throw new Error(`timing line ${li + 1} has chars[] of a different length than its text`);
    const toks = planText(line.text, lang, readings);
    toks.forEach((t, k) => {
      const t0 = Number(line.chars[t.at]);
      const next = k + 1 < toks.length ? Number(line.chars[toks[k + 1].at]) : Number(line.end);
      units.push({ ...t, line: li, t0, t1: Math.max(t0, next), last: k === toks.length - 1 });
    });
  });
  return capUnits(fillCollapsed(units));
}

/** asr-result v1（segments[].words[]，整数刻度 + timescale）或 WORDS 数组 [{w, t0, t1}]（秒） */
export function unitsFromWords(data, lang, readings = null) {
  let lines;
  if (data && Array.isArray(data.segments)) {
    const ts = Number(data.timescale) || 1;
    lines = data.segments.map(seg => (seg.words?.length ? seg.words : [{ text: seg.text ?? '', start: seg.start, end: seg.end }]).map(w => ({ text: String(w.text ?? ''), t0: w.start / ts, t1: w.end / ts })));
  } else {
    const list = Array.isArray(data) ? data : Array.isArray(data?.words) ? data.words : null;
    if (!list) throw new Error('words file is neither asr-result v1 nor a [{w, t0, t1}] list');
    lines = [];
    let cur = [];
    list.forEach((w, i) => {
      const word = { text: String(w.w ?? w.text ?? ''), t0: Number(w.t0 ?? w.start), t1: Number(w.t1 ?? w.end) };
      if (cur.length && word.t0 - cur[cur.length - 1].t1 > 0.6) { lines.push(cur); cur = []; }
      cur.push(word);
      if (/[。！？.!?]$/.test(word.text) && i < list.length - 1) { lines.push(cur); cur = []; }
    });
    if (cur.length) lines.push(cur);
  }
  const units = [];
  lines.forEach((words, li) => {
    let text = '';
    const spans = [];
    for (const w of words) {
      if (text && /[\p{Script=Latin}\p{N}]$/u.test(text) && /^[\p{Script=Latin}\p{N}]/u.test(w.text)) text += ' ';
      spans.push({ a: text.length, b: text.length + w.text.length, t0: w.t0, t1: Math.max(w.t0, w.t1) });
      text += w.text;
    }
    const toks = planText(text, lang, readings);
    for (const s of spans) {
      const inside = toks.filter(t => t.at >= s.a && t.at < s.b);
      const total = inside.reduce((n, t) => n + syllableGuess(t), 0) || 1;
      let t = s.t0;
      for (const tok of inside) {
        const d = ((s.t1 - s.t0) * syllableGuess(tok)) / total;
        units.push({ ...tok, line: li, t0: t, t1: t + d, last: false });
        t += d;
      }
    }
    if (units.length && units[units.length - 1].line === li) units[units.length - 1].last = true;
  });
  return capUnits(fillCollapsed(units));
}

// ---------- 确定性随机数 ----------
export function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 口型 ----------
const pickUnknown = (e, cue) => {
  if (e < 0.1) return 'X';
  if (e < 0.3) return 'B';
  if (cue <= -0.35) return e > 0.55 ? 'E' : 'F';
  if (cue >= 0.35) return e > 0.6 ? 'C' : 'B';
  return e > 0.65 ? 'D' : 'C';
};

/** 每格音量的档位 0/1/2，带回差 */
export function levelsOf(env, n) {
  const out = new Uint8Array(n);
  let lv = 0;
  for (let i = 0; i < n; i++) {
    const e = env[i] ?? 0;
    while (lv < LEVELS.length && e >= LEVELS[lv] + HYST / 2) lv++;
    while (lv > 0 && e < LEVELS[lv - 1] - HYST / 2) lv--;
    out[i] = lv;
  }
  return out;
}

/** 细时间轴（10 毫秒一格）：读音给的口型，再按音量闭嘴、降档；读音不明的格子、读音说这里不说话而声音响着的格子按音量与元音线索选 */
export function fineTimeline(units, n, env, cue, audioOnly = false) {
  const fine = new Array(n).fill(audioOnly ? '?' : 'X');
  const owner = new Int32Array(n).fill(-1);
  const at = t => Math.round(t / STEP);
  units.forEach((u, k) => {
    // 同一句里相邻的字之间的短停顿算进前一个字
    const next = units[k + 1];
    const t1 = next && next.line === u.line && next.t0 - u.t1 <= GAP_CLOSE ? next.t0 : u.t1;
    const a = Math.max(0, at(u.t0 - LEAD)), b = Math.min(n, at(t1 - LEAD));
    if (!u.plan) { for (let i = a; i < b; i++) { fine[i] = '?'; owner[i] = k; } return; }
    for (const s of layoutPlan(u.plan, u.t0 - LEAD, t1 - LEAD)) {
      for (let i = Math.max(0, at(s.t0)); i < Math.min(n, at(s.t1)); i++) { fine[i] = s.shape; owner[i] = k; }
    }
  });
  if (env) {
    // 连续 80 毫秒的静音闭嘴。清辅音（s、sh、z、f、h、p 这类）在人声频段里几乎没有能量：
    // 静音之后同一个字紧接着出声时，静音的最后 150 毫秒算这个字的声母，保留读音给的口型
    for (let i = 0; i < n;) {
      if ((env[i] ?? 0) >= SILENT) { i++; continue; }
      let j = i;
      while (j < n && (env[j] ?? 0) < SILENT) j++;
      if (j - i >= SILENT_RUN) {
        const k = j < n ? owner[j] : -1;
        let loud = 0;
        for (let m = j; m < Math.min(n, j + 12); m++) if ((env[m] ?? 0) >= SILENT) loud++;
        const keepFrom = k >= 0 && loud >= 6 ? Math.max(i, j - VOICELESS) : j;
        for (let m = i; m < j; m++) if (m < keepFrom || owner[m] !== k) fine[m] = 'X';
      }
      i = j;
    }
    for (let i = 0; i < n;) {
      if (fine[i] !== 'X' || (env[i] ?? 0) < SILENT) { i++; continue; }
      let j = i, loud = 0;
      for (; j < n && fine[j] === 'X' && (env[j] ?? 0) >= SILENT; j++) if (env[j] >= LOUD) loud++;
      if (loud >= LOUD_RUN) fine.fill('?', i, j);
      i = j;
    }
    const lv = levelsOf(env, n);
    for (let i = 0; i < n; i++) {
      const e = env[i] ?? 0;
      if (fine[i] === '?') fine[i] = pickUnknown(e, cue ? cue[i] ?? 0 : 0);
      else if (BY_LEVEL[fine[i]]) fine[i] = BY_LEVEL[fine[i]][lv[i]];
    }
  } else {
    // 没有声音：读音不明的字按 0.12 秒一拍半开、微开交替
    for (let i = 0; i < n; i++) if (fine[i] === '?') fine[i] = Math.floor((i * STEP) / 0.12) % 2 ? 'B' : 'C';
  }
  return { fine, owner };
}

/** 细时间轴量化到一步一步（fps 是动作轨的采样率）：每步取占时最长的口型；A 闭唇不会被并掉，其余口型至少停 55 毫秒；大跨度的开合中间补一步过渡 */
export function quantize(fine, fps, frames) {
  const shapes = new Array(frames).fill('X'), mustA = new Uint8Array(frames);
  const acc = new Map();
  for (let f = 0; f < frames; f++) {
    acc.clear();
    const a = f / fps, b = (f + 1) / fps;
    for (let i = Math.floor(a / STEP); i < Math.ceil(b / STEP) && i < fine.length; i++) {
      const ov = Math.min(b, (i + 1) * STEP) - Math.max(a, i * STEP);
      if (ov > 0) acc.set(fine[i], (acc.get(fine[i]) ?? 0) + ov);
    }
    let best = 'X', bestV = -1;
    for (const [s, v] of acc) if (v > bestV + 1e-9 || (Math.abs(v - bestV) <= 1e-9 && OPEN[s] > OPEN[best])) { best = s; bestV = v; }
    shapes[f] = best;
  }
  // 每段 20 毫秒以上的闭唇，它中点所在的帧必须是 A
  for (let i = 0; i < fine.length;) {
    if (fine[i] !== 'A') { i++; continue; }
    let j = i;
    while (j < fine.length && fine[j] === 'A') j++;
    if (j - i >= 2) { const f = Math.floor((((i + j) / 2) * STEP) * fps); if (f < frames) { mustA[f] = 1; shapes[f] = 'A'; } }
    i = j;
  }
  const hold = Math.max(1, Math.ceil(HOLD_S * fps - 1e-6));
  const runsOf = () => {
    const out = [];
    for (let f = 0; f < frames;) { let g = f; while (g < frames && shapes[g] === shapes[f]) g++; out.push([f, g]); f = g; }
    return out;
  };
  // 过短的段：夹在两段中间、比两边都闭（或都开）的，从两边够长的段借帧补到 hold，保住这一下开合；
  // 借不到、或者只是从小到大一路过去的中间档，并进相邻、张得更开的那段。必须保留的闭唇只借不并：
  // 播放器换嘴帧至少停 55 毫秒，短于 hold 的闭唇会把下一下张嘴推迟
  const stuck = new Set();
  for (let guard = 0; guard < 4 * frames; guard++) {
    const runs = runsOf();
    if (runs.length === 1) break;
    let pick = -1;
    for (let r = 0; r < runs.length; r++) {
      const [f, g] = runs[r];
      if (g - f >= hold || stuck.has(f)) continue;
      if (pick < 0 || g - f < runs[pick][1] - runs[pick][0]) pick = r;
    }
    if (pick < 0) break;
    const [f, g] = runs[pick], prev = runs[pick - 1], next = runs[pick + 1];
    const ps = prev ? shapes[prev[0]] : null, ns = next ? shapes[next[0]] : null, o = OPEN[shapes[f]];
    const keepA = shapes[f] === 'A' && mustA.subarray(f, g).some(Boolean);
    if (prev && next && ((o < OPEN[ps] && o < OPEN[ns]) || (o > OPEN[ps] && o > OPEN[ns]))) {
      let a = f, b = g, pl = prev[1] - prev[0], nl = next[1] - next[0];
      while (b - a < hold) {
        const canP = pl > hold && !mustA[a - 1], canN = nl > hold && !mustA[b];
        if (canP && (!canN || pl >= nl)) { a--; pl--; } else if (canN) { b++; nl--; } else break;
      }
      if (b - a >= hold || keepA) {
        for (let k = a; k < b; k++) shapes[k] = shapes[f];
        if (b - a < hold) stuck.add(a);
        continue;
      }
    }
    if (keepA) { stuck.add(f); continue; }
    const into = ps == null ? ns : ns == null ? ps : OPEN[ns] > OPEN[ps] ? ns : ps;
    for (let k = f; k < g; k++) shapes[k] = into;
  }
  // 一下从闭嘴到大张（或从噘嘴到张开）时中间补一帧过渡：闭与 D 之间是 C，F 与 C、D 之间是 E。
  // 两边都比 hold 长时才补，由张得更开的一边让出一帧（张嘴时先过渡再张满，闭嘴时先收一点再闭上）
  const closed = s => s === 'X' || s === 'A' || s === 'B' || s === 'G';
  const tween = (p, q) => ((closed(p) && q === 'D') || (p === 'D' && closed(q)) ? 'C'
    : (p === 'F' && (q === 'C' || q === 'D')) || ((p === 'C' || p === 'D') && q === 'F') ? 'E' : null);
  const runs = runsOf();
  for (let r = 0; r + 1 < runs.length; r++) {
    const L = runs[r], R = runs[r + 1], t = tween(shapes[L[0]], shapes[R[0]]);
    if (!t || L[1] - L[0] <= hold || R[1] - R[0] <= hold) continue;
    if (OPEN[shapes[L[0]]] > OPEN[shapes[R[0]]] && !mustA[L[1] - 1]) { L[1]--; shapes[L[1]] = t; }
    else if (!mustA[R[0]]) { shapes[R[0]] = t; R[0]++; }
  }
  return shapes;
}

// ---------- 句子 ----------
function phrasesOf(units, env, dur) {
  const out = [];
  if (units.length) {
    for (const u of units) {
      const last = out[out.length - 1];
      if (last && u.line === last.line && u.t0 - last.t1 < PHRASE_GAP) last.t1 = Math.max(last.t1, u.t1);
      else out.push({ t0: u.t0, t1: u.t1, line: u.line });
    }
    return out;
  }
  if (!env) return out;
  // 只有声音：音量高于 0.2 的段，间隔不到 0.35 秒的连起来
  for (let i = 0; i < env.length; i++) {
    if (env[i] <= 0.2) continue;
    const t = i * STEP, last = out[out.length - 1];
    if (last && t - last.t1 < PHRASE_GAP) last.t1 = t + STEP;
    else out.push({ t0: t, t1: t + STEP, line: out.length });
  }
  return out.filter(p => p.t1 - p.t0 >= 0.1 && p.t0 < dur);
}

/**
 * faces.json：[{line, face, act}]（line 从 1 数，与核对表一致）或 [{t0, t1, face, act}]，也可以 {default, items:[…]}。
 * face 是角色包里的表情，act 是一次性动作（ACTS），在这句第一个字（或 t0）开始；两者至少有一个
 */
export function facesOf(spec, units) {
  if (!spec) return { def: null, list: [], acts: [] };
  const items = Array.isArray(spec) ? spec : Array.isArray(spec.items) ? spec.items : [];
  const list = [], acts = [];
  const isId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
  for (const it of items) {
    if (!it || !(isId(it.face) || it.act != null)) throw new Error(`every faces entry needs a face (the id of an expression in the character package: letters, digits, _ or -) or an act (${Object.keys(ACTS).join(', ')})`);
    if (it.face != null && !isId(it.face)) throw new Error('faces: a face is the id of an expression in the character package (letters, digits, _ or -)');
    if (it.act != null && !Object.hasOwn(ACTS, it.act)) throw new Error(`faces: act must be one of ${Object.keys(ACTS).join(', ')}`);
    let t0, t1, at;
    if (it.line != null) {
      const us = units.filter(u => u.line === Number(it.line) - 1);
      if (!us.length) throw new Error(`faces: line ${it.line} has no spoken text`);
      [t0, t1, at] = [Math.max(0, us[0].t0 - 0.15), us[us.length - 1].t1 + 0.3, us[0].t0];
    } else if (it.t0 != null && it.t1 != null) [t0, t1, at] = [Number(it.t0), Number(it.t1), Number(it.t0)];
    else throw new Error('a faces entry needs line, or t0 and t1');
    if (it.face != null) list.push([t0, t1, it.face]);
    if (it.act != null) acts.push([at, it.act]);
  }
  acts.sort((a, b) => a[0] - b[0]);
  list.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const f of list) {
    const last = merged[merged.length - 1];
    if (last && last[2] === f[2] && f[0] - last[1] < 0.4) last[1] = Math.max(last[1], f[1]);
    else merged.push([...f]);
  }
  if (spec.default != null && !(typeof spec.default === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(spec.default))) throw new Error('faces: default must be an expression id');
  return { def: spec.default ?? null, list: merged, acts };
}

// ---------- 动作轨 ----------
/** 动作轨的采样率：与播放器 1/120 秒的步长对齐，每个采样正好落在一步上 */
export const TRACK_FPS = 120;
/**
 * 口型在角色上的画法：[mouthOpen, vowel]。张嘴越过 0.12、0.5 换半张、张开（播放器的门槛，各有 0.04 回差），张着嘴时
 * vowel 低于 −0.65 换圆嘴、高于 0.65 换扁嘴；角色没有圆嘴、扁嘴就按张嘴的档。A 闭唇与 X 静止都闭上；B 半张；C、D 张开；
 * E 圆嘴；F 小圆嘴（半张的圆嘴）；G 咬唇（扁嘴那一帧画的是上齿压下唇）
 */
export const MOUTH = { X: [0, 0], A: [0, 0], B: [0.3, 0], C: [0.85, 0], D: [1, 0], E: [0.85, -1], F: [0.3, -1], G: [0.3, 1] };
/**
 * 有声音时张多大跟着音量连续走（LivLiv 的做法：一个字里嘴随声音张开再收拢，字与字之间、声音停下就合上），口型只定
 * [下限, 上限]：B 不过半张、C 不过张开；圆唇、咬唇留一点开口，不然小声时那两帧出不来；X、A 闭上。没有声音时用 MOUTH
 */
export const OPEN_RANGE = { X: [0, 0], A: [0, 0], B: [0, 0.45], C: [0, 0.85], D: [0, 1], E: [0.2, 1], F: [0.2, 0.45], G: [0.3, 0.3] };
/**
 * 一次性动作和它们的长度（秒），曲线移植自 LivLiv actions.ts：叠在说话的动作上，前 0.18 秒渐入、后 0.22 秒渐出；同一个
 * 动作还没做完又来一次，前一个在 0.15 秒里淡出。nod 点头两下，shake 摇头，tilt 歪头想一想，hop 蹲一下再跳起（半身角色
 * 不会露出下面的切口，只往下沉），shy 低头侧脸、眼睛看向一边
 */
export const ACTS = { nod: 0.95, shake: 1.05, tilt: 1.8, hop: 0.65, shy: 2.4 };
const FACE_RAMP = 0.25;

const smooth = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ss = (a, b, x) => smooth((x - a) / (b - a));
const r2 = v => Math.round(v * 100) / 100;
const r4 = t => Math.round(t * 1e4) / 1e4;
const r3 = v => Math.round(v * 1000) / 1000;
/** 最后一个采样之后保持它的值：去掉末尾重复的采样 */
function trimTail(a) {
  let k = a.length - 1;
  while (k > 0 && a[k - 1] === a[k]) k--;
  return a.slice(0, k + 1);
}

/** 包络在 t 秒的值（10 毫秒一格之间线性插值） */
const envAt = (env, t) => {
  const x = t / STEP, i = Math.floor(x), a = env[i] ?? 0, b = env[i + 1] ?? a;
  return a + (b - a) * (x - i);
};
/** 这一步的口型在这个音量下张多大 */
export const openAt = (shape, e) => {
  const [lo, hi] = OPEN_RANGE[shape];
  return r3(Math.min(hi, Math.max(lo, e)));
};

/** 动作开始后 t 秒加在角色上的量：角度是度，moveY 是画面高度的份额（向上为正） */
export function actAt(id, t) {
  const d = ACTS[id];
  if (!(t >= 0 && t < d)) return {};
  const e = smooth(t / 0.18) * (1 - smooth((t - d + 0.22) / 0.22));
  if (id === 'nod') return { angleY: -(t < 0.45 ? 11 * Math.sin((Math.PI * t) / 0.45) : 6 * Math.sin((Math.PI * Math.min(t - 0.45, 0.45)) / 0.45)) * e };
  if (id === 'shake') { const x = 13 * Math.sin((2 * Math.PI * t) / 0.5) * e; return { angleX: x, bodyX: x * 0.15 }; }
  if (id === 'tilt') return { angleZ: 11 * e, angleX: 3 * e, angleY: 2 * e };
  if (id === 'hop') {
    return {
      moveY: t < 0.2 ? -0.025 * Math.sin((Math.PI * t) / 0.2) : t < 0.6 ? 0.04 * Math.sin((Math.PI * (t - 0.2)) / 0.4) : 0,
      angleY: t > 0.2 && t < 0.6 ? 5 * Math.sin((Math.PI * (t - 0.2)) / 0.4) * e : 0,
    };
  }
  return { angleY: -12 * e, angleX: 9 * e, angleZ: -4 * e, eyeBallX: 0.7 * e, eyeBallY: -0.5 * e };
}

/**
 * 说话时头和眉毛怎么动，移植自 LivLiv talk.ts 的 TalkMotion，按每一步的张嘴程度（level，0..1）走：
 * - 音节起点：比上一个低点高出 0.25、且张过 0.35；回落 0.15 后才认下一个
 * - 一句的第一个音节（说话程度还低）点一下头、换个朝向，其余音节三成五的概率轻点，两次至少隔 0.35 秒
 * - 说话时头慢慢漂、朝着这句的方向，停下后慢慢回正；身体跟着转一点
 * - 音节上偶尔扬一下眉；bounce 时每个音节整个人跳一下（只往下沉再回来，半身角色不露切口）
 * 结果是加在播放器待机动作上的偏移；说话时眼睛回看镜头、停顿后眨眼由播放器自己按嘴算。amount 0..2 是强度
 */
export function talkOffsets(level, seed = 1, { amount = 1, bounce = false } = {}) {
  const R = rng(seed), n = level.length, dt = 1 / TRACK_FPS;
  const RISE = 0.25, ONSET = 0.35, FALL = 0.15, QUIET = 0.2;
  const ph = [R() * 9, R() * 9, R() * 9];
  const o = { angleX: new Array(n), angleY: new Array(n), angleZ: new Array(n), bodyX: new Array(n), browLY: new Array(n), moveY: new Array(n) };
  const nods = [];
  let act = 0, armed = true, valley = 0, peak = 0, quiet = 10, sinceNod = 10, sinceBrow = 10, browAge = 10;
  const nod = { x: 0, v: 0 }, lift = { x: 0, v: 0 }, dir = { x: 0, y: 0 };
  let aim = { x: 0, y: 0 };
  const step = (s, k, c) => { s.v += (-k * s.x - c * s.v) * dt; s.x += s.v * dt; };
  for (let k = 0; k < n; k++) {
    const v = level[k], t = (k + 1) * dt;
    quiet += dt; sinceNod += dt; sinceBrow += dt;
    if (v > QUIET) quiet = 0;
    act += ((quiet < 0.35 ? 1 : 0) - act) * Math.min(1, dt * (quiet < 0.35 ? 6 : 1.2));
    if (!armed) {
      peak = Math.max(peak, v);
      if (v < peak - FALL) { armed = true; valley = v; }
    } else if ((valley = Math.min(valley, v)), v - valley > RISE && v > ONSET) {
      armed = false; peak = v;
      const phrase = act < 0.3;
      if (phrase) aim = { x: (R() * 2 - 1) * 5, y: (R() - 0.3) * 2.5 };
      if (sinceNod > 0.35 && (phrase || R() < 0.35)) {
        const kick = phrase ? 70 : 35 + R() * 30;
        nod.v -= kick * amount; sinceNod = 0; nods.push([r4(k * dt), r2(kick / 70)]);
      }
      if (sinceBrow > 1.2 && R() < (phrase ? 0.5 : 0.18)) { browAge = 0; sinceBrow = 0; }
      if (bounce) lift.v += (0.3 + R() * 0.12) * amount;
    }
    step(nod, 150, 15); step(lift, 230, 19);
    browAge += dt;
    const a = act * amount, talking = quiet < 0.35, back = Math.min(1, dt * (talking ? 3 : 0.45));
    dir.x += ((talking ? aim.x : 0) - dir.x) * back;
    dir.y += ((talking ? aim.y : 0) - dir.y) * back;
    const driftX = (Math.sin(t * 0.9 + ph[0]) * 0.6 + Math.sin(t * 1.7 + ph[1]) * 0.4) * 3.5 * a;
    const driftZ = (Math.sin(t * 0.7 + ph[2]) * 0.6 + Math.sin(t * 1.3 + ph[0]) * 0.4) * 2.5 * a;
    o.angleX[k] = dir.x * amount + driftX;
    o.angleY[k] = nod.x + dir.y * amount;
    o.angleZ[k] = driftZ;
    o.bodyX[k] = o.angleX[k] * 0.15;
    o.browLY[k] = ss(0, 0.12, browAge) * (1 - ss(0.3, 0.65, browAge)) * 0.55 * amount;
    const cap = 0.02 * amount;
    o.moveY[k] = bounce ? Math.min(cap, Math.max(0, lift.x)) - cap : 0;
  }
  return { offsets: o, nods };
}

/** acts（[[开始秒, id]]，按时间排）在每一步加上的量；同一个动作又来一次时前一个 0.15 秒淡出 */
function actOffsets(ticks, acts) {
  const out = {};
  const ends = acts.map(([ta, id], i) => {
    const again = acts.find(([tb, jd], j) => j > i && jd === id && tb >= ta && tb < ta + ACTS[id]);
    return again ? again[0] : Infinity;
  });
  for (let k = 0; k < ticks; k++) {
    const t = k / TRACK_FPS;
    acts.forEach(([ta, id], i) => {
      const f = t < ends[i] ? 1 : 1 - ss(0, 0.15, t - ends[i]);
      if (f <= 0) return;
      for (const [ch, v] of Object.entries(actAt(id, t - ta))) {
        if (!v) continue;
        (out[ch] ??= new Array(ticks).fill(0))[k] += v * f;
      }
    });
  }
  return out;
}

/**
 * 表情权重：每段前后各 0.25 秒渐变；default 是没有别的表情的时候（1 减去别的表情之和）。前后两段相隔不到 0.25 秒时
 * 不各自渐变，在间隔的正中共用一个 0.25 秒的窗口交接：走的那段是 1 − s，来的那段是 s，任何时刻各表情的权重加起来
 * 不超过 1。各自渐变时两段都满着重叠过一阵，两张补丁都不透明，前一张露在后一张外面的嘴角、眉毛就是残影
 */
function expressionChannels(ticks, fc) {
  const ids = [...new Set([...fc.list.map(f => f[2]), ...(fc.def ? [fc.def] : [])])];
  // 每段的淡入窗口从 a 开始、淡出窗口从 b 开始，各长 FACE_RAMP
  const spans = fc.list.filter(f => f[2] !== fc.def).map(([t0, t1, f]) => ({ f, a: t0 - FACE_RAMP, b: t1 }));
  for (let i = 1; i < spans.length; i++) {
    const A = spans[i - 1], B = spans[i];
    const t1 = A.b, t0 = B.a + FACE_RAMP;
    if (t0 - t1 < FACE_RAMP) A.b = B.a = (t1 + t0) / 2 - FACE_RAMP / 2;
    // 窗口按时间排好：后一段的淡入不早于前一段的淡出，这样权重之和不超过 1
    B.a = Math.max(B.a, A.b);
    B.b = Math.max(B.b, B.a);
  }
  const out = {};
  for (const id of ids) out[id] = new Array(ticks).fill(0);
  for (let k = 0; k < ticks; k++) {
    const t = k / TRACK_FPS;
    let sum = 0;
    for (const s of spans) {
      const w = smooth((t - s.a) / FACE_RAMP) - smooth((t - s.b) / FACE_RAMP);
      out[s.f][k] += w;
      sum += w;
    }
    if (fc.def) out[fc.def][k] = 1 - Math.min(1, sum);
  }
  for (const id of ids) out[id] = trimTail(out[id].map(v => r3(Math.min(1, Math.max(0, v)))));
  return out;
}

/**
 * 主体：units（unitsFromTiming / unitsFromWords 的结果，可以是空数组 = 只有声音）+ 音量包络与元音线索 → 动作轨
 * （人偶格式规范 §4）。轨的 0 秒是配音的 0 秒。返回 { track, shapes（每一步的口型字母）, fine, owner, phrases, nods, acts }
 */
export function buildTrack({ units = [], env = null, cue = null, dur, seed = 1, faces = null, motion = 1, bounce = false }) {
  const audioOnly = !units.length;
  if (audioOnly && !env) throw new Error('need --timing, --words or --audio');
  if (!(motion >= 0 && motion <= 2)) throw new Error('motion must be between 0 and 2');
  const end = dur ?? Math.max(units.length ? units[units.length - 1].t1 + 0.5 : 0, env ? env.length * STEP : 0);
  if (!(end > 0)) throw new Error('the voice has no length');
  const duration = r4(end);
  const n = Math.ceil(end / STEP) + 1, ticks = Math.floor(duration * TRACK_FPS) + 1;
  const { fine, owner } = fineTimeline(units, n, env, cue, audioOnly);
  const shapes = quantize(fine, TRACK_FPS, ticks);
  const phrases = phrasesOf(units, env, end);
  const fc = facesOf(faces, units);
  const mouth = shapes.map((s, k) => (env ? openAt(s, envAt(env, k / TRACK_FPS)) : MOUTH[s][0]));
  const params = { mouthOpen: trimTail(mouth), vowel: trimTail(shapes.map(s => MOUTH[s][1])) };
  // 头、身体、眉毛和整个人的上下：说话的动作加上 faces.json 的一次性动作，都是加在待机上的偏移
  const talk = motion > 0 ? talkOffsets(mouth, seed, { amount: motion, bounce }) : { offsets: {}, nods: [] };
  const sum = { ...talk.offsets };
  for (const [ch, a] of Object.entries(actOffsets(ticks, fc.acts))) sum[ch] = sum[ch] ? sum[ch].map((v, k) => v + a[k]) : a;
  if (sum.browLY) sum.browRY = sum.browLY;
  const round = ch => (ch === 'moveY' ? r4 : ch.startsWith('eyeBall') || ch.startsWith('brow') ? r3 : r2);
  const offsets = {};
  for (const ch of ['angleX', 'angleY', 'angleZ', 'bodyX', 'browLY', 'browRY', 'eyeBallX', 'eyeBallY', 'moveY']) {
    const a = sum[ch]?.map(round(ch));
    if (a && a.some(v => v !== 0)) offsets[ch] = trimTail(a);
  }
  const expressions = expressionChannels(ticks, fc);
  const track = {
    format: 'baocut-puppet-track',
    version: 1,
    fps: TRACK_FPS,
    duration,
    params,
    ...(Object.keys(offsets).length ? { offsets } : {}),
    ...(Object.keys(expressions).length ? { expressions } : {}),
  };
  return { track, shapes, fine, owner, phrases, nods: talk.nods, acts: fc.acts };
}

/** 口型核对表：每句的每个字下面写读音、读音给的口型和按视频帧率看到的口型 */
export function checkTable(units, result, lines, header, fps = 30) {
  const { shapes, track } = result;
  const frames = Array.from({ length: Math.max(1, Math.ceil(track.duration * fps)) }, (_, f) => shapes[Math.min(shapes.length - 1, Math.round((f / fps) * TRACK_FPS))]);
  const count = {};
  for (const s of frames) count[s] = (count[s] ?? 0) + 1;
  const pct = Object.keys(count).sort().map(s => `${s} ${Math.round((count[s] / frames.length) * 100)}%`).join('  ');
  let changes = 0;
  for (let k = 1; k < shapes.length; k++) if (shapes[k] !== shapes[k - 1]) changes++;
  const out = [header, `${track.duration}s, ${shapes.length} steps at ${TRACK_FPS} fps (shown below at ${fps} fps), mouth changes ${changes}, nods ${result.nods.length}${result.acts?.length ? `, acts ${result.acts.map(([t, id]) => `${id}@${t.toFixed(2)}`).join(' ')}` : ''}, phrases ${result.phrases.length}`, `shapes: ${pct}`];
  const unknown = units.filter(u => !u.plan).length;
  if (unknown) out.push(`units without a reading (mouth from loudness and vowel colour): ${unknown} of ${units.length}`);
  let li = -1;
  for (const u of units) {
    if (u.line !== li) {
      li = u.line;
      const us = units.filter(v => v.line === li);
      out.push('', `line ${li + 1}  ${us[0].t0.toFixed(2)}–${us[us.length - 1].t1.toFixed(2)}  ${lines?.[li] ?? us.map(v => v.text).join(' ')}`);
    }
    const a = Math.max(0, Math.floor((u.t0 - LEAD) * fps)), b = Math.max(a + 1, Math.ceil((u.t1 - LEAD) * fps));
    const shown = frames.slice(a, Math.min(frames.length, b)).join('');
    out.push(`  ${u.t0.toFixed(2).padStart(6)}  ${u.text.padEnd(4)} ${String(u.reading === u.text ? '' : u.reading).padEnd(7)} ${planLabel(u.plan).padEnd(10)} ${shown}`);
  }
  return out.join('\n') + '\n';
}

const USAGE = 'usage: lipsync.mjs (--timing timing.json | --words words.json | --audio voice.wav) [--audio voice.wav] --out voice.track.json [--lang auto] [--dur s] [--faces faces.json] [--readings readings.json] [--seed 1] [--motion 1] [--bounce] [--fps 30] [--check file]';
const FLAGS = ['timing', 'words', 'audio', 'out', 'lang', 'dur', 'faces', 'readings', 'seed', 'motion', 'bounce', 'fps', 'check'];
/** 不带值的开关 */
const SWITCHES = ['bounce'];

function parseArgs(argv) {
  const flags = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}\n${USAGE}`);
    const k = a.slice(2);
    if (!FLAGS.includes(k)) throw new Error(`unknown option --${k}${k === 'offset' ? ' (the track starts with the voice; place it with the sticker\'s motionIn)' : ''}\n${USAGE}`);
    if (SWITCHES.includes(k)) { flags[k] = true; continue; }
    if (argv[i + 1] == null) throw new Error(`--${k} needs a value\n${USAGE}`);
    flags[k] = argv[i + 1];
    i++;
  }
  return flags;
}

function readJsonish(file) {
  const text = fs.readFileSync(file, 'utf8');
  // 也认 window.WORDS = [...]; 这样的 JS 数据文件
  const m = /=\s*([[{][\s\S]*[\]}])\s*;?\s*$/.exec(text.trim());
  return JSON.parse(file.endsWith('.js') && m ? m[1] : text);
}

function main() {
  const f = parseArgs(process.argv);
  if (!f.out || !(f.timing || f.words || f.audio)) throw new Error(USAGE);
  const lang = f.lang || 'auto', fps = f.fps ? Number(f.fps) : 30;
  if (!(fps > 0)) throw new Error('--fps must be positive');
  let units = [], lines = null, dur = f.dur ? Number(f.dur) : undefined;
  const readings = f.readings ? JSON.parse(fs.readFileSync(f.readings, 'utf8')) : null;
  if (readings && (typeof readings !== 'object' || Array.isArray(readings))) throw new Error('--readings must be a JSON object { "word": "reading" }');
  if (f.timing) {
    const timing = JSON.parse(fs.readFileSync(f.timing, 'utf8'));
    units = unitsFromTiming(timing, lang, readings);
    lines = timing.lines.map(l => l.text);
    if (dur == null && Number(timing.dur) > 0) dur = Number(timing.dur);
  } else if (f.words) units = unitsFromWords(readJsonish(f.words), lang, readings);
  let env = null, cue = null;
  if (f.audio) {
    const { x, sr } = decodeAudio(f.audio);
    env = envelope(x, sr);
    cue = vowelTrack(x, sr, env);
    if (dur == null) dur = x.length / sr;
  }
  const faces = f.faces ? JSON.parse(fs.readFileSync(f.faces, 'utf8')) : null;
  const result = buildTrack({ units, env, cue, dur, seed: f.seed ? Number(f.seed) : 1, faces, motion: f.motion != null ? Number(f.motion) : 1, bounce: !!f.bounce });
  const src = [f.timing || f.words, f.audio].filter(Boolean).map(p => path.basename(p)).join(' + ');
  fs.mkdirSync(path.dirname(path.resolve(f.out)), { recursive: true });
  fs.writeFileSync(f.out, JSON.stringify(result.track) + '\n');
  const check = f.check || path.join(path.dirname(f.out), 'lipsync-check.txt');
  fs.writeFileSync(check, checkTable(units, result, lines, `lipsync check: ${src}  lang ${lang}`, fps));
  const t = result.track;
  console.log(`${f.out}: motion track, ${t.duration}s at ${t.fps} fps, ${result.nods.length} nods, ${result.phrases.length} phrases${result.acts.length ? `, acts ${result.acts.map(a => a[1]).join(' ')}` : ''}${t.expressions ? `, expressions ${Object.keys(t.expressions).join(' ')}` : ''}`);
  console.log(`${check}: per-character check table${units.length ? '' : ' (audio only: no text)'}`);
  if (!env) console.log('note: no --audio, so silences inside lines are not closed and loud/quiet syllables are not told apart');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
