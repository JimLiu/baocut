#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本
// 交付字幕：BaoCut 的字幕导出一次只取一份文档，同一语言有几份时按语言导出会以 EXPORT_SOURCE_AMBIGUOUS 拒绝。
// 前插片头的工程就是这样：片头每段旁白一份字幕文档，正片一份，原声片段的字幕又各一份。本脚本逐份导出
// （导出的时间已是时间线上的时间），按语言合并、按时间排序、重新编号，每种语言写一个 SRT。
//   node tools/srt.mjs [--lang zh-Hans,en] [--dir <目录>] [--name <文件名前缀>] [--max-chars <n>] [--dry] [--config <配置>]
// 只取时间线上在用的字幕文档（kind caption，usedBy 大于 0）。语言分组：zh、zh-CN、zh-SG、zh-Hans 归 zh-Hans，
// zh-TW、zh-HK、zh-MO、zh-Hant 归 zh-Hant，其余取主语言子标签（en-US 归 en）。--lang 只出这几组，缺省全出。
// 写 <dir>/<name>.<语言>.srt：dir 缺省是工程根目录下的 export/，name 缺省是视频名；已有的同名文件替换。
// --max-chars 传给导出的 --max-chars-per-line（一行的最大宽度，全角字算 2，导出缺省 42）。
// --dry 只列每组有哪几份文档、各几条，不导出。合并后前后重叠的条打印出来，不改。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, parseArgs, listFlag, makeBc } from './lib.mjs';

// 字幕文档的语言 → 交付文件的语言标签
export function langGroup(tag) {
  const t = String(tag || '').trim();
  if (!t) return 'und';
  const [base, ...rest] = t.split(/[-_]/);
  const lower = base.toLowerCase();
  if (lower === 'zh') {
    const sub = rest.map(s => s.toLowerCase());
    if (sub.includes('hant') || sub.some(s => ['tw', 'hk', 'mo'].includes(s))) return 'zh-Hant';
    return 'zh-Hans';
  }
  return lower;
}

const ms = t => {
  const m = /^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/.exec(t.trim());
  if (!m) throw new Error(`bad SRT time ${t}`);
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
};
export const fmt = x => {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(x / 3600000))}:${p(Math.floor(x / 60000) % 60)}:${p(Math.floor(x / 1000) % 60)},${p(x % 1000, 3)}`;
};

// SRT 正文 → [{ start, end, text }]（毫秒）；编号不要，空块跳过
export function parseSrt(body) {
  return body.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim().split(/\n{2,}/).flatMap(block => {
    const lines = block.split('\n');
    const at = lines.findIndex(l => l.includes('-->'));
    if (at < 0) return [];
    const [a, z] = lines[at].split('-->');
    const text = lines.slice(at + 1).join('\n').trim();
    return text ? [{ start: ms(a), end: ms(z.trim().split(/\s+/)[0]), text }] : [];
  });
}

// 几份的条合在一起：按开始、结束排序，重新编号；overlaps 是和前一条重叠的条
export function mergeCues(lists) {
  const cues = lists.flat().sort((a, b) => a.start - b.start || a.end - b.end);
  const overlaps = cues.flatMap((c, i) => (i && c.start < cues[i - 1].end ? [{ prev: cues[i - 1], cue: c }] : []));
  const text = cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}`).join('\n\n') + '\n';
  return { cues, overlaps, text };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const { flags } = parseArgs(process.argv, ['lang', 'dir', 'name', 'max-chars']);
  const want = listFlag(flags.lang);
  const bc = makeBc(cfg);
  const head = bc(['videos', 'inspect', cfg.video, '--limit', '1']);
  const docs = (head.documents || []).filter(d => d.kind === 'caption' && d.usedBy > 0);
  if (!docs.length) throw new Error(`${cfg.video} has no caption documents on the timeline`);
  const groups = new Map();
  for (const d of docs) {
    const g = langGroup(d.language);
    if (want.length && !want.includes(g)) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(d);
  }
  if (!groups.size) throw new Error(`no caption documents in ${want.join(', ')}; the video has ${[...new Set(docs.map(d => langGroup(d.language)))].join(', ')}`);
  const name = flags.name || head.name || cfg.video;
  const dir = flags.dir ? path.resolve(flags.dir) : cfg.abs('export');
  for (const [g, list] of groups) console.log(g, list.length, 'documents:', list.map(d => `${d.id}${d.summary?.cueCount != null ? ` (${d.summary.cueCount})` : ''}`).join(' '));
  if (flags.dry) process.exit(0);

  const tmp = cfg.abs(cfg.dirs.work, 'srt');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [g, list] of groups) {
    const parts = list.map(d => {
      const r = bc(['export', cfg.video, '--kind', 'subtitles', '--format', 'srt', '--document-id', d.id, '--purpose', 'preview',
        '--dir', tmp, '--file-name', `${d.id}.srt`, '--overwrite', ...(flags['max-chars'] ? ['--max-chars-per-line', String(flags['max-chars'])] : [])]);
      const out = r.outputs?.[0]?.path || path.join(tmp, `${d.id}.srt`);
      if (r.state && r.state !== 'completed') throw new Error(`export ${d.id}: ${r.state}`);
      return parseSrt(fs.readFileSync(out, 'utf8'));
    });
    const { cues, overlaps, text } = mergeCues(parts);
    const file = path.join(dir, `${name}.${g}.srt`);
    fs.writeFileSync(file, text);
    console.log(`${g}: ${cues.length} cues from ${list.length} documents -> ${file}` + (cues.length ? ` (${fmt(cues[0].start)} – ${fmt(cues.at(-1).end)})` : ''));
    for (const { prev, cue } of overlaps.slice(0, 10)) console.log(`  overlap: ${fmt(prev.start)}–${fmt(prev.end)} ${JSON.stringify(prev.text.slice(0, 20))} / ${fmt(cue.start)} ${JSON.stringify(cue.text.slice(0, 20))}`);
    if (overlaps.length > 10) console.log(`  … ${overlaps.length - 10} more overlaps`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
