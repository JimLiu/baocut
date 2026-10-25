#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本；表头从配置来
// 素材出处的唯一一份表：sources.json。画面上的出处（build.mjs 写进 TIMING.credits）、交付的 sources.csv 与说明都从它来，不各写各的。
//   node tools/sources.mjs            查漏并写 sources.csv
//   node tools/sources.mjs --check    只查漏，有缺的退出码 1
// sources.json：{ items: [{ file?, id?, kind, title, creator?, date?, url, license, credit?, use?, ai? }] }
//   file：shared/ 下的文件名（img/house.jpg 写 house.jpg 就行）或原片路径；没有文件的条目（核对用的网页、目录记录）给 id。
//   credit：画面上的出处一行，成片语言（例如「照片：<机构>，CC BY 4.0」），CC BY 这类要署名的必须有；公有领域可省。
//   use：用在哪里、画面出不出现；ai 为 true 的是 AI 生成的图（license 写生成它的模型，画面要标明）。
//   match：场景源码里认它的字样（字符串或数组，例如地图数据的全局名 GEO110）；不是图片、音视频的数据与脚本（地图轮廓、字体之外的 .js / .json）
//   场景不按文件名引用，给了 match 就按它找用在哪几段，没给时 shared/ 下确有这个文件就记作每个包都带着。
// 查漏：场景源码引号里提到、shared/ 下确有的图片、视频、音频，clips.json 用到的原片，在 sources.json 里没有条目的；
//   有条目但缺 url 或 license 的；要署名的许可（CC BY 系列）没有 credit 的。
// sources.csv：UTF-8 带 BOM（Excel 直接打开不乱码），一条一行，最后一列是用在哪几段（场景引用、片段所在段与时刻）。
//   表头取配置 sources.columns（{ kind, title, creator, date, url, license, credit, use, usedIn } 的显示名），缺省英文；
//   成片给中文观众时在配置里写中文表头。输出路径取 sources.csv（配置 sources.csv 可改）。
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, parseArgs, readJson } from './lib.mjs';

const cfg = loadConfig();
const { flags } = parseArgs(process.argv);
const conf = cfg.sources || {};
const table = readJson(cfg.abs(conf.file || 'sources.json'), null);
if (!table) throw new Error(`${conf.file || 'sources.json'} missing; list every image, clip, recording and AI picture there first`);
const items = table.items || [];
const cl = readJson(cfg.abs(cfg.footage?.clips || 'clips.json'), { clips: [] });
const SHARED = cfg.abs(cfg.dirs.shared);
const MEDIA = /\.(png|jpe?g|webp|gif|bmp|tiff?|svg|mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac|flac|ogg|opus)$/i;
const base = f => path.basename(f || '');
const keyOf = it => base(it.file) || it.id;

function sharedMedia(rel = '') {
  const dir = path.join(SHARED, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? (e.name === 'fonts' ? [] : sharedMedia(p)) : MEDIA.test(e.name) ? [p] : [];
  });
}

// 用在哪里：场景源码引号里提到文件名（或去掉扩展名的名字）的段；片段的原片记段与段内时刻
const media = sharedMedia();
const used = new Map();
const note = (k, where) => { if (!used.has(k)) used.set(k, []); if (!used.get(k).includes(where)) used.get(k).push(where); };
for (const id of cfg.order) {
  const file = cfg.abs(cfg.dirs.scenes, `${id}.js`);
  if (!fs.existsSync(file)) continue;
  const lits = new Set([...fs.readFileSync(file, 'utf8').matchAll(/(['"`])([^'"`\n]{1,200})\1/g)].map(m => base(m[2])));
  for (const rel of media) {
    const b = base(rel), stem = b.replace(/\.[^.]+$/, '');
    if (lits.has(b) || lits.has(stem)) note(b, id);
  }
}
// 数据与脚本：按 match 的字样找段；没给 match、shared/ 下有这个文件的，记作每个包都带着（build.mjs 把 shared/ 原样拷进包）
const sceneSource = id => { const f = cfg.abs(cfg.dirs.scenes, `${id}.js`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };
for (const it of items) {
  const k = base(it.file);
  if (!k || MEDIA.test(k)) continue;
  const words = [].concat(it.match || []);
  if (words.length) { for (const id of cfg.order) if (words.some(w => sceneSource(id).includes(w))) note(k, id); }
  else if (fs.existsSync(path.join(SHARED, it.file)) || fs.existsSync(path.join(SHARED, k))) note(k, 'every bundle (shared/)');
}
for (const c of cl.clips) {
  const src = c.source || cl.source;
  if (src) note(base(src), `${c.seg}:${c.id} (${c.from}–${c.to}s of the source)`);
}

const byKey = new Map(items.map(it => [keyOf(it), it]));
const problems = [];
for (const k of used.keys()) if (!byKey.has(k)) problems.push(`${k}: used in ${used.get(k).join(', ')} but not in sources.json`);
for (const it of items) {
  const k = keyOf(it);
  if (!k) { problems.push(`an item has neither file nor id: ${JSON.stringify(it).slice(0, 120)}`); continue; }
  if (!it.url && !it.ai) problems.push(`${k}: no url`);
  if (!it.license) problems.push(`${k}: no license`);
  if (/\bCC[ -]?BY\b/i.test(it.license || '') && !it.credit) problems.push(`${k}: ${it.license} needs attribution; add credit (shown on screen)`);
  if (it.file && !used.has(k)) console.log(`note: ${k} is in sources.json but no scene or clip uses it`);
}
for (const p of problems) console.log('MISSING ' + p);
if (flags.check) process.exit(problems.length ? 1 : 0);

const cols = { kind: 'kind', title: 'title', creator: 'creator', date: 'date', url: 'url', license: 'license', credit: 'credit', use: 'use', usedIn: 'used in', ...conf.columns };
const keys = Object.keys(cols);
const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const rows = items.map(it => keys.map(k => cell(k === 'usedIn' ? (used.get(keyOf(it)) || []).join('; ') : it[k])).join(','));
const csv = cfg.abs(conf.csv || 'sources.csv');
fs.writeFileSync(csv, '﻿' + [keys.map(k => cell(cols[k])).join(','), ...rows].join('\n') + '\n');
console.log(`wrote ${path.relative(process.cwd(), csv)}: ${items.length} items${problems.length ? `, ${problems.length} problems above` : ''}`);
if (!items.some(it => it.credit)) console.log('note: no item has a credit line; scenes get no TIMING.credits');
