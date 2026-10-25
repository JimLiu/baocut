#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 把一段录音量成一排条（RMS 包络），写成场景能直接读的 JS，给 scene-kit 的 K.bars() 画：
//   node tools/envelope.mjs <录音> --out shared/speech-wave.js [--var SPEECH_WAVE] [--bars 240] [--from 秒] [--to 秒]
// 输出：window.<var> = { dur, bars: [0..1, …] }。dur 是量的这段的秒数，bars 按 95 分位归一（最响的几条夹到 1），
// 开头的爆音不会把其余的压扁。不读配置、不连 Runtime，只要本机有 ffmpeg。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from './lib.mjs';

const { ids, flags } = parseArgs(process.argv, ['out', 'var', 'bars', 'from', 'to']);
const [file] = ids;
if (!file || !flags.out) throw new Error('usage: envelope.mjs <audio> --out <file.js> [--var NAME] [--bars 240] [--from s] [--to s]');
const n = Math.round(+(flags.bars ?? 240));
if (!(n >= 8)) throw new Error(`--bars must be a number of bars (8 or more), got ${flags.bars}`);
const name = flags.var || 'SPEECH_WAVE';
if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`--var must be a JavaScript identifier, got ${name}`);

const RATE = 8000;
const range = [...(flags.from != null ? ['-ss', String(+flags.from)] : []), ...(flags.to != null ? ['-to', String(+flags.to)] : [])];
const pcm = execFileSync('ffmpeg', ['-v', 'error', ...range, '-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
const total = pcm.length >> 1;
if (!total) throw new Error(`no audio decoded from ${file}`);
const rms = [];
for (let b = 0; b < n; b++) {
  const s = Math.floor((b * total) / n), e = Math.max(s + 1, Math.floor(((b + 1) * total) / n));
  let acc = 0;
  for (let j = s; j < e; j++) { const v = pcm.readInt16LE(j * 2) / 32768; acc += v * v; }
  rms.push(Math.sqrt(acc / (e - s)));
}
const top = [...rms].sort((a, b) => a - b)[Math.min(n - 1, Math.floor(n * 0.95))] || 1;
const bars = rms.map(v => +Math.min(1, v / top).toFixed(3));
const dur = +(total / RATE).toFixed(2);
fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
fs.writeFileSync(flags.out, `// envelope of ${path.basename(file)} (${dur} s), ${n} RMS bars; drawn with K.bars()\nwindow.${name} = ${JSON.stringify({ dur, bars })};\n`);
console.log(`${flags.out}: window.${name}, ${n} bars over ${dur} s`);
