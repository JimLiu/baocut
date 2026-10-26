#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 老录音的两件事：拉平音量（讲者离话筒远近、主持与问答比正文轻几个分贝），量处理前后的时间差。
//
//   node tools/level.mjs <录音> --out <拉平后.wav> [--lift 9] [--cut 2] [--window 45] [--smooth 15] [--cmds <文件>]
//   node tools/level.mjs --dump <ebur128 的 S 记录> --cmds <文件>（只算增益，不读写音频）
//   node tools/level.mjs --lag <原录音> <处理后> [--at 15,600,1800]
//
// 拉平：用 ffmpeg 的 ebur128 每 100 ms 量一次短时响度（3 秒窗），取前后各 window 秒里有人声的部分的中位数当
// 这一处的「本地音量」，往全片的 75 分位拉：最多提 lift dB、最多压 cut dB，再按前后各 smooth 秒平滑，听不出在变。
// 掌声、笑声、碰话筒这类比讲话响得多的地方另加一道顶：提过之后还超过人声 95 分位 + 3 dB 的部分压回去，
// 不让它们跟着被提上来。增益写成 asendcmd 的命令文件（每 100 ms 一行），再用 volume 滤镜作用到录音上，
// 输出 32 位浮点 wav，留给下一步统一提到目标响度、压缩与限幅（不在这里做）。这一步不改时间。
//
// --lag：降噪、滤波常带几十个采样的延迟，字幕与原声逐词时间都按原录音的时钟，处理完要量回来。在几个时刻各取
// 8 秒，两边都滤到 300–3000 Hz、降到 8 kHz，互相关找峰值，打印处理后比原录音晚多少（44.1 kHz 的采样数与毫秒）；
// 晚了 N 个采样就 atrim=start_sample=N,asetpts=PTS-STARTPTS,apad=pad_len=N 挪回去，再量一遍到 0 附近。
// 不读配置、不连 Runtime，只要本机有 ffmpeg。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.mjs';

const { ids, flags } = parseArgs(process.argv, ['out', 'lift', 'cut', 'window', 'smooth', 'cmds', 'dump', 'lag', 'at']);
const ffmpeg = args => execFileSync('ffmpeg', ['-nostdin', '-v', 'error', ...args], { maxBuffer: 1 << 30 });

// numpy 的 median / percentile（linear）
const sorted = a => Float64Array.from(a).sort();
const pct = (a, p) => {
  const s = sorted(a), i = (s.length - 1) * p / 100, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const median = a => pct(a, 50);
// 两端按边上的值补齐的滑动平均（numpy convolve(pad(x, r, 'edge'), ones/(2r+1), 'valid')）
const smooth = (x, r) => {
  const n = x.length, out = new Float64Array(n), at = i => x[Math.min(n - 1, Math.max(0, i))];
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i - r; j <= i + r; j++) s += at(j); out[i] = s / (2 * r + 1); }
  return out;
};

// ametadata print 的 lavfi.r128.S，每 100 ms 一个值；-inf 记 -120
export function readDump(text) {
  const S = []; let seen = false;
  for (const line of text.split('\n')) {
    if (/pts_time:/.test(line)) { seen = true; continue; }
    const m = /lavfi\.r128\.S=(-?[\d.]+|-inf)/.exec(line);
    if (m && seen) S.push(m[1] === '-inf' ? -120 : +m[1]);
  }
  return Float64Array.from(S);
}

// 每 100 ms 一个增益（dB）与统计
export function gainCurve(S, { lift = 9, cut = 2, window = 45, smooth: sm = 15 } = {}) {
  const n = S.length, WIN = Math.round(window * 10), SM = Math.round(sm * 10);
  if (n < 100) throw new Error(`only ${n} loudness steps; is the recording shorter than 10 s?`);
  const gate = median(S.filter(v => v > -70)) - 12;
  // 本地音量：每秒取一次，窗里有人声（高过 gate）的秒数够 10 个才算，其余插值
  const L = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i += 10) {
    const w = [];
    for (let j = Math.max(0, i - WIN); j < Math.min(n, i + WIN + 1); j += 10) if (S[j] > gate) w.push(S[j]);
    if (w.length >= 10) L[i] = median(w);
  }
  const known = [...L.keys()].filter(i => !Number.isNaN(L[i]));
  if (!known.length) throw new Error('no stretch with enough speech to level against');
  for (let i = 0, k = 0; i < n; i++) {
    if (!Number.isNaN(L[i])) continue;
    while (k < known.length - 1 && known[k + 1] < i) k++;
    const a = known[k], b = known[k + 1];
    L[i] = i <= known[0] ? L[known[0]] : b === undefined || i >= known.at(-1) ? L[known.at(-1)] : L[a] + (L[b] - L[a]) * (i - a) / (b - a);
  }
  const ref = pct(L, 75);
  const g = smooth(L.map(v => Math.min(lift, Math.max(-cut, ref - v))), SM);
  // 顶：步 i 的 S 是它之前 3 秒，含步 j 的窗的响度取 S[j..j+30] 的最大值
  const ceil = pct(S.filter(v => v > gate), 95) + 3;
  const excess = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let e = -Infinity;
    for (let k = j; k < Math.min(n, j + 31); k++) e = Math.max(e, S[k]);
    excess[j] = Math.max(0, e + g[j] - ceil);
  }
  const ev = smooth(excess, 3);
  const G = g.map((v, i) => v - ev[i]);
  let gmin = Infinity, gmax = -Infinity, evmax = 0, evsec = 0;
  for (let i = 0; i < n; i++) { gmin = Math.min(gmin, g[i]); gmax = Math.max(gmax, g[i]); evmax = Math.max(evmax, ev[i]); if (ev[i] > 1) evsec += 0.1; }
  return { G, stats: { steps: n, gate, ref, ceil, lift: [gmin, gmax], eventCutMax: evmax, eventCutSeconds: evsec } };
}

export const cmdsOf = G => [...G].map((v, i) => `${(i / 10).toFixed(1)} volume@lev volume ${(10 ** (v / 20)).toFixed(5)};\n`).join('');

function report(s) {
  console.log(`steps ${s.steps} (100 ms)  speech gate ${s.gate.toFixed(1)}  level ref ${s.ref.toFixed(1)}  ceiling ${s.ceil.toFixed(1)} LUFS(S)`);
  console.log(`lift ${s.lift[0] >= 0 ? '+' : ''}${s.lift[0].toFixed(1)}..+${s.lift[1].toFixed(1)} dB  loud events cut up to ${s.eventCutMax.toFixed(1)} dB, ${Math.round(s.eventCutSeconds)} s cut by more than 1 dB`);
}

// 处理后比原录音晚多少：8 kHz、300–3000 Hz 的 8 秒片段互相关，峰值所在的偏移
function lagAt(ref, out, t) {
  const RATE = 8000, MAX = 400;   // ±50 ms
  const grab = f => {
    const b = ffmpeg(['-ss', String(t), '-t', '8', '-i', f, '-vn', '-ac', '1', '-af', 'highpass=f=300,lowpass=f=3000', '-ar', String(RATE), '-f', 'f32le', '-']);
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~3)));
  };
  const a = grab(ref), b = grab(out), n = Math.min(a.length, b.length);
  let ea = 0, eb = 0;
  for (let i = 0; i < n; i++) { ea += a[i] * a[i]; eb += b[i] * b[i]; }
  const c = new Float64Array(2 * MAX + 1);
  let k = MAX;
  for (let lag = -MAX; lag <= MAX; lag++) {
    let s = 0;
    for (let i = Math.max(0, -lag); i < Math.min(n, n - lag); i++) s += a[i] * b[i + lag];
    c[lag + MAX] = s;
    if (s > c[k]) k = lag + MAX;
  }
  // 峰值两侧抛物线插值，精到不足一个 8 kHz 采样
  const [l, m, r] = [c[k - 1] ?? c[k], c[k], c[k + 1] ?? c[k]], den = l - 2 * m + r;
  const lag = k - MAX + (den < 0 ? (l - r) / (2 * den) : 0);
  return { t, ms: lag / RATE * 1000, corr: m / Math.sqrt(ea * eb || 1) };
}

const main = () => {
  if (flags.lag) {
    const [out] = ids;
    if (!out) throw new Error('usage: level.mjs --lag <original> <processed> [--at 15,600,1800]');
    const at = (typeof flags.at === 'string' ? flags.at : '15,600,1800').split(',').map(Number);
    for (const r of at.map(t => lagAt(flags.lag, out, t))) {
      console.log(`t=${r.t}s  processed is ${r.ms >= 0 ? 'late' : 'early'} by ${Math.abs(r.ms).toFixed(2)} ms (${Math.round(Math.abs(r.ms) * 44.1)} samples at 44.1 kHz)  corr ${r.corr.toFixed(3)}`);
    }
    console.log('a correlation under about 0.5 means that window had little speech; check another time');
    return;
  }
  const opts = { lift: +(flags.lift ?? 9), cut: +(flags.cut ?? 2), window: +(flags.window ?? 45), smooth: +(flags.smooth ?? 15) };
  for (const [k, v] of Object.entries(opts)) if (!(v >= 0)) throw new Error(`--${k} must be a number of ${k === 'lift' || k === 'cut' ? 'dB' : 'seconds'}, got ${flags[k]}`);
  if (flags.dump) {
    if (!flags.cmds) throw new Error('usage: level.mjs --dump <S dump> --cmds <file>');
    const { G, stats } = gainCurve(readDump(fs.readFileSync(flags.dump, 'utf8')), opts);
    fs.writeFileSync(flags.cmds, cmdsOf(G));
    report(stats);
    return;
  }
  const [file] = ids;
  if (!file || !flags.out) throw new Error('usage: level.mjs <audio> --out <leveled.wav> [--lift 9] [--cut 2] [--window 45] [--smooth 15] [--cmds <file>]');
  const outAbs = path.resolve(flags.out);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const dump = `${outAbs}.r128.txt`, cmds = path.resolve(flags.cmds || `${outAbs}.cmds.txt`);
  ffmpeg(['-i', file, '-vn', '-ac', '1', '-af', `ebur128=metadata=1,ametadata=print:key=lavfi.r128.S:file=${dump.replace(/([\\':])/g, '\\$1')}`, '-f', 'null', '-']);
  const { G, stats } = gainCurve(readDump(fs.readFileSync(dump, 'utf8')), opts);
  fs.writeFileSync(cmds, cmdsOf(G));
  fs.rmSync(dump, { force: true });
  ffmpeg(['-y', '-i', file, '-vn', '-ac', '1', '-af', `asendcmd=f=${cmds.replace(/([\\':])/g, '\\$1')},volume@lev=volume=1.0:eval=frame`, '-c:a', 'pcm_f32le', outAbs]);
  report(stats);
  console.log(`${flags.out}: leveled (32-bit float), gain curve in ${flags.cmds || `${flags.out}.cmds.txt`}`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
