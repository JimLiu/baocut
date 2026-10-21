#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本
// 按段配音：每段旁白一次 speak（同一个音色、同一套语气说明），存一份音频到 audio/<id>.<格式>，记在 audio/voice.json。
//   node tools/voice.mjs <id ...> [--missing] [--seed N] [--takes N] [--config <配置>]
//   node tools/voice.mjs --check            只量不配：列出每段的音高，标出和全片不一样的段
//   --missing   给 order 里还没配过、或稿子改过的段配音
//   --seed      只有收 seed 的模型能用；不收的模型每次合成本来就不一样，重配直接再跑一次
//   --takes     一段最多合成几次（缺省 3），见下面的音高检查
// 音高检查：同一个音色、同一套说明，模型每次合成仍可能整段漂成另一种嗓音（偏高、偏亮，越长的段越容易），
// 拼在片子里一听就换了人。每配完一段就量它的中位音高（浊音帧的自相关基频），和参照比：参照是 voice.pitchHz，
// 没给时取已经配好的其他段（至少两段）的中位数。偏离超过 voice.pitchTolerance（缺省 0.05，即 5%）就重配，
// 最多 --takes 次，留最接近的一次，都超时报警告。全部配完再对全片量一遍，报出离群的段。
// 任务被打断（Runtime 重启，JOB_INTERRUPTED）时自动重试，最多三次。
// API Key 由 BaoCut 自己的配置管，这里只调 baocut speak，不碰。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadConfig, parseArgs, makeBc, readJson, writeJson, scriptLines, narrationText } from './lib.mjs';

const cfg = loadConfig();
const bc = makeBc(cfg);
const { ids, flags } = parseArgs(process.argv, ['seed', 'takes']);
const log = cfg.abs(cfg.dirs.audio, 'voice.json');
const all = scriptLines(cfg);
const V = cfg.voice;

const TOL = V.pitchTolerance ?? 0.05, TAKES = Math.max(1, +(flags.takes ?? 3));

// 中位音高（Hz）：解成 16 kHz 单声道，40 ms 一帧，取够响的帧做自相关（60–400 Hz），相关够强的算浊音帧
function pitchOf(file) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
  const sr = 16000, N = 640, x = new Float32Array(raw.length >> 1);
  for (let i = 0; i < x.length; i++) x[i] = raw.readInt16LE(i * 2) / 32768;
  const rms = [];
  for (let i = 0; i + N <= x.length; i += N) { let e = 0; for (let k = i; k < i + N; k++) e += x[k] * x[k]; rms.push(Math.sqrt(e / N)); }
  const loud = 0.25 * [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.9)], f0 = [];
  rms.forEach((e, j) => {
    if (e < loud) return;
    const i = j * N; let r0 = 0, best = 0, lag = 0;
    for (let k = i; k < i + N; k++) r0 += x[k] * x[k];
    for (let L = Math.floor(sr / 400); L <= Math.floor(sr / 60); L++) { let r = 0; for (let k = i; k + L < i + N; k++) r += x[k] * x[k + L]; if (r > best) { best = r; lag = L; } }
    if (best / r0 > 0.45) f0.push(sr / lag);
  });
  return f0.length ? +median(f0).toFixed(1) : null;
}
const median = a => { const v = [...a].sort((p, q) => p - q); return v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2; };
// 记录里没有音高的段（旧工程）从存下的音频补量，量到的写回 voice.json
function pitchesOf() {
  const rec = readJson(log, {}), todo = Object.entries(rec).filter(([, r]) => r.pitchHz == null && r.file && fs.existsSync(cfg.abs(r.file)));
  if (todo.length) {
    const hz = Object.fromEntries(todo.map(([id, r]) => [id, pitchOf(cfg.abs(r.file))]));
    const fresh = readJson(log, {});
    for (const [id, v] of Object.entries(hz)) if (fresh[id]?.file === rec[id].file) fresh[id].pitchHz = rec[id].pitchHz = v;
    writeJson(log, fresh);
  }
  return Object.fromEntries(Object.entries(rec).map(([id, r]) => [id, r.pitchHz ?? null]));
}
const off = (hz, ref) => (hz == null || ref == null ? 0 : hz / ref - 1);
function report() {
  const p = pitchesOf(), known = Object.values(p).filter(v => v != null);
  if (known.length < 3) return [];
  const ref = V.pitchHz ?? median(known), bad = [];
  for (const id of cfg.order) if (p[id] != null) {
    const d = off(p[id], ref), flag = Math.abs(d) > TOL;
    if (flag) bad.push(id);
    console.log(`${id.padEnd(10)} ${String(p[id]).padStart(6)} Hz  ${(d >= 0 ? '+' : '') + (d * 100).toFixed(1)}%${flag ? '  <- off' : ''}`);
  }
  console.log(`reference ${ref.toFixed(1)} Hz (${V.pitchHz ? 'voice.pitchHz' : 'median of the segments'}), tolerance ${(TOL * 100).toFixed(0)}%`);
  if (bad.length) console.log(`warning: ${bad.join(', ')} sound${bad.length > 1 ? '' : 's'} like a different voice; listen, then re-voice with: node tools/voice.mjs ${bad.join(' ')}`);
  return bad;
}
if (flags.check) process.exit(report().length ? 1 : 0);

const todo = flags.missing
  ? cfg.order.filter(id => { const r = readJson(log, {})[id]; return !r || r.text !== narrationText(all[id] || []); })
  : ids;
if (!todo.length) { console.error('usage: voice.mjs <id ...> | --missing'); process.exit(ids.length || flags.missing ? 0 : 2); }

fs.mkdirSync(cfg.abs(cfg.dirs.audio), { recursive: true });
for (const id of todo) {
  const lines = all[id];
  if (!lines || !lines.length) throw new Error(`no narration lines for ${id} in ${cfg.script.path} (or fixedLines)`);
  const text = narrationText(lines);
  const args = ['speak', '--text', text, '--language', cfg.language, '--format', V.format];
  for (const k of ['provider', 'model', 'voice', 'instructions', 'speed']) if (V[k] != null) args.push('--' + k, String(V[k]));
  if (flags.seed != null) args.push('--seed', String(flags.seed));
  if (V.attach && cfg.video) args.push('--video', cfg.video, '--name', `${cfg.names.narration} ${id}`);
  const speak = () => {
    for (let k = 1; ; k++) {
      try { return bc(args); } catch (e) {
        if (e.cli?.code === 'JOB_INTERRUPTED' && k < 3) { console.error(`${id}: speak interrupted, retrying (${k}/2)`); continue; }
        if (flags.seed != null && /seed/i.test(e.cli?.message || '')) throw new Error(`${id}: ${e.cli.message}. Re-voice without --seed; if a word is still misread, rewrite the line`);
        throw e;
      }
    }
  };
  const others = Object.entries(pitchesOf()).filter(([k, v]) => k !== id && v != null).map(([, v]) => v);
  const ref = V.pitchHz ?? (others.length >= 2 ? median(others) : null);
  const file = `${cfg.dirs.audio}/${id}.${V.format}`;
  let r, o, pitchHz, best = null;
  for (let take = 1; take <= TAKES; take++) {
    const t = speak(), to = t.outputs[0], tmp = `${cfg.dirs.audio}/${id}.take${take}.${V.format}`;
    bc(['artifacts', 'save', '--artifact-id', to.artifactId, '--path', tmp, '--overwrite']);
    const hz = pitchOf(cfg.abs(tmp)), d = off(hz, ref);
    if (ref != null) console.log(`${id}: take ${take} ${hz} Hz, ${(d >= 0 ? '+' : '') + (d * 100).toFixed(1)}% from ${ref.toFixed(1)} Hz`);
    if (!best || Math.abs(d) < Math.abs(best.d)) { if (best) fs.rmSync(cfg.abs(best.tmp)); best = { r: t, o: to, hz, d, tmp }; } else fs.rmSync(cfg.abs(tmp));
    if (Math.abs(d) <= TOL) break;
  }
  ({ r, o, hz: pitchHz } = best);
  fs.renameSync(cfg.abs(best.tmp), cfg.abs(file));
  if (Math.abs(best.d) > TOL) console.log(`warning: ${id}: every take is off the other segments' pitch; kept the closest (${(best.d * 100).toFixed(1)}%). Listen to it; shorter lines or another run may help`);
  writeJson(cfg.abs(cfg.dirs.audio, `${id}.result.json`), r);
  // 几个进程并行配音时各自重读再写，免得互相覆盖
  const rec = readJson(log, {});
  rec[id] = { text, voice: { ...V }, seed: flags.seed ?? null, jobId: r.jobId, artifactId: o.artifactId, assetId: o.assetId ?? null, durationSec: o.media.durationSec, pitchHz, file };
  writeJson(log, rec);
  console.log(id, o.artifactId, o.media.durationSec);
}
if (todo.length) report();
