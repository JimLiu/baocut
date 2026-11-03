#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本，日志与报错写英文
// 扫一遍导出的预览：单帧跳变是不是都落在计划的剪点与转场上，有没有黑帧，最长有多久画面不动。
//
//   node jump-scan.mjs <视频文件> <rig-timeline.json> [--offset 秒] [--fps 60] [--still-limit 1]
//
// 代码包在成片里不从 0 开始时给 --offset（包在时间线上的开始）。只依赖 Node 与 ffmpeg。
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const SW = 480, SH = 270;

export function analyse(diffs, dark, fps, timeline, offset = 0, stillLimit = 1) {
  const cuts = timeline.cuts.map(c => c.t + offset), wipes = timeline.wipes.map(w => w + offset);
  const unplanned = [];
  let planned = 0;
  for (let i = 2; i < diffs.length - 2; i++) {
    const around = Math.max(diffs[i - 2], diffs[i - 1], diffs[i + 1], diffs[i + 2]);
    if (!(diffs[i] > 2.5 && diffs[i] > around * 1.8)) continue;
    const t = (i + 1) / fps;
    if (cuts.some(c => Math.abs(t - c) <= 2 / fps) || wipes.some(w => t >= w - 0.22 && t <= w + 0.22)) planned++;
    else unplanned.push(Number(t.toFixed(3)));
  }
  let run = 0, best = 0, at = 0;
  diffs.forEach((d, i) => { run = d < 0.02 ? run + 1 : 0; if (run > best) { best = run; at = i; } });
  return { frames: diffs.length + 1, seconds: (diffs.length + 1) / fps, dark: dark.slice(0, 10), planned, unplanned, longestStillFrames: best, longestStillAt: Number((at / fps).toFixed(2)), stillTooLong: best / fps > stillLimit };
}

function readFrames(file, onFrame) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `scale=${SW}:${SH}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    let buf = Buffer.alloc(0), err = '';
    p.stderr.on('data', d => { err += d; });
    p.stdout.on('data', d => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      let at = 0;
      while (buf.length - at >= SW * SH) { onFrame(buf.subarray(at, at + SW * SH)); at += SW * SH; }
      buf = Buffer.from(buf.subarray(at));
    });
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(err || `ffmpeg exited ${code}`))));
    p.on('error', reject);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, tlFile, ...rest] = process.argv.slice(2);
  const flag = (n, d) => { const i = rest.indexOf(n); return i >= 0 ? Number(rest[i + 1]) : d; };
  if (!file || !tlFile) { console.error('usage: node jump-scan.mjs <video> <rig-timeline.json> [--offset s] [--fps n] [--still-limit s]'); process.exit(2); }
  const fps = flag('--fps', 60), diffs = [], dark = [];
  let prev = null, n = 0;
  await readFrames(file, g => {
    let sum = 0, total = 0;
    for (let i = 0; i < g.length; i++) { total += g[i]; if (prev) sum += Math.abs(g[i] - prev[i]); }
    if (prev) diffs.push(sum / g.length);
    if (total / g.length < 12) dark.push(n);
    prev = Buffer.from(g);
    n++;
  });
  const r = analyse(diffs, dark, fps, JSON.parse(fs.readFileSync(tlFile, 'utf8')), flag('--offset', 0), flag('--still-limit', 1));
  console.log(JSON.stringify(r, null, 1));
  process.exit(r.unplanned.length || r.dark.length || r.stillTooLong ? 1 : 0);
}
