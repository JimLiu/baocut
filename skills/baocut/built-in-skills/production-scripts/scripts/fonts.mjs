#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本
// 把代码包要用的字体裁成子集，放进 shared/ 下（缺省 shared/fonts/），build.mjs 按 bundle.fonts 写成 @font-face。
// 中文字体整套十几 MB，每个包都带一份太大；只留场景、稿子与片段数据里出现的字，再加一段常用符号。
//   node tools/fonts.mjs [--config <配置>]
// 要本机有 python3 与 fontTools（pip install fonttools）。配置 fonts：
//   { out?: 'fonts', text?: [glob…], unicodes?: 'U+0020-007E,…', features?: 'ccmp,liga,…', faces: { <族名>: { src, index?, axes?, file, subset? } } }
//   out：shared/ 下的目录；text：取字的文件（缺省 scenes/*.js、shared/*.js、稿子、clips.json、quotes.json、sources.json），
//   glob 只认文件名里的 *；unicodes：总要留的码位（缺省 ASCII、拉丁补充、常用标点、箭头、中文标点与全角符号）。
//   faces 的每一项：src 是原字体（.ttf / .otf / .ttc），index 是 .ttc 里的第几款，axes 把可变字体定在一组轴值上（{ wght: 420, opsz: 28 }），
//   file 是写出的文件名，subset 为 range 时只留 unicodes（西文字体用，不按字取）。
//   features 是保留的 OpenType 特性，逗号分隔；缺省是下面 FEATURES 那份，除了 locl 都是浏览器默认会用的。
//   不留 locl：中文字体（Noto、思源的 SC / TC 款）的 locl 会把数字换成等宽字形，浏览器给年份这类纯数字的串用它、
//   烘焙不用，字宽对不上（text-width-mismatch），整段退回逐帧截图；写 <html lang> 只是换成「字母加数字」的串对不上。
//   要按地区换字形的（同一款字体里的繁简、日韩字形）挑对应地区的字体文件，不靠 locl。写 * 全留。
// 写完对一遍：取字的文件里有、哪款字体都没有的字列出来（换一款带它的字体或改字），bundle.fonts 里没写这些文件的也提醒。
// 注意：字体文件一变，所有引用它的包都变了，assemble.mjs 会全部重烘；定稿后加字前先想好要不要整片重烘，
// 只差一两个字时改用已有的字更省（build.mjs 会报缺字）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fontCmap, loadConfig, readJson } from './lib.mjs';

const cfg = loadConfig();
const conf = cfg.fonts;
if (!conf?.faces || !Object.keys(conf.faces).length) throw new Error('config has no fonts.faces; list the fonts to subset (see the header of fonts.mjs)');
if (spawnSync('python3', ['-c', 'import fontTools']).status !== 0) throw new Error('fonts.mjs needs python3 with fontTools: pip install fonttools');
const OUT = path.join(cfg.abs(cfg.dirs.shared), conf.out || 'fonts');
fs.mkdirSync(OUT, { recursive: true });
const FEATURES = 'rvrn,ccmp,liga,mark,mkmk,rlig,calt,clig,curs,kern,rclt,frac,numr,dnom,chws,vchw,halt,vhal,valt,vert,vkrn,vpal,vrt2';
const UNICODES = conf.unicodes || 'U+0020-007E,U+00A0-00FF,U+2000-206F,U+2190-21FF,U+2E3A,U+3000-303F,U+FF00-FFEF';
const patterns = conf.text || [`${cfg.dirs.scenes}/*.js`, `${cfg.dirs.shared}/*.js`, cfg.script?.path, cfg.footage?.clips || 'clips.json', 'quotes.json', 'sources.json'].filter(Boolean);

// 只认文件名里的 *：dir/*.js、shared/*.js
function expand(pat) {
  const abs = cfg.abs(pat), dir = path.dirname(abs), name = path.basename(abs);
  if (!name.includes('*')) return fs.existsSync(abs) ? [abs] : [];
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp('^' + name.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return fs.readdirSync(dir).filter(f => re.test(f)).map(f => path.join(dir, f));
}
const files = [...new Set(patterns.flatMap(expand))];
const chars = new Set();
for (const f of files) for (const ch of fs.readFileSync(f, 'utf8')) if (!/[\s\p{Cc}]/u.test(ch)) chars.add(ch);
const textFile = path.join(OUT, '.subset-chars.txt');
fs.writeFileSync(textFile, [...chars].join(''));
console.log(`${chars.size} distinct characters from ${files.length} files`);

const py = `
import sys, json
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.varLib import instancer
src, index, axes, out, text, unicodes, features = sys.argv[1], int(sys.argv[2]), json.loads(sys.argv[3]), sys.argv[4], sys.argv[5], sys.argv[6], sys.argv[7]
f = TTFont(src, fontNumber=index) if src.lower().endswith(('.ttc', '.otc')) else TTFont(src)
if axes and 'fvar' in f:
    f = instancer.instantiateVariableFont(f, axes)
opts = subset.Options()
opts.layout_features = ['*'] if features == '*' else features.split(',')
opts.name_IDs = ['*']; opts.name_languages = ['*']; opts.notdef_outline = True; opts.hinting = False; opts.glyph_names = False
sub = subset.Subsetter(opts)
cps = set(subset.parse_unicodes(unicodes))
if text: cps |= {ord(c) for c in open(text, encoding='utf-8').read()}
sub.populate(unicodes=cps)
sub.subset(f)
f.save(out)
`;

const written = [];
for (const [family, face] of Object.entries(conf.faces)) {
  if (!face.src || !face.file) throw new Error(`fonts.faces.${family} needs src and file`);
  if (!fs.existsSync(face.src)) throw new Error(`fonts.faces.${family}: ${face.src} not found`);
  const out = path.join(OUT, face.file);
  const r = spawnSync('python3', ['-c', py, face.src, String(face.index ?? 0), JSON.stringify(face.axes || {}), out, face.subset === 'range' ? '' : textFile, UNICODES, conf.features || FEATURES], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`subsetting ${family} failed: ${(r.stderr || '').trim().split('\n').slice(-3).join(' / ')}`);
  written.push({ family, rel: path.relative(cfg.abs(cfg.dirs.shared), out), out, range: face.subset === 'range' });
  console.log(`${family.padEnd(14)} ${path.relative(process.cwd(), out)}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
fs.rmSync(textFile);

// 哪款字体都没有的字（字体本身不带，子集也取不到）
const cmaps = written.map(w => fontCmap(w.out)).filter(c => c && !c.skip);
const lack = [...chars].filter(ch => /[\p{L}\p{N}\p{P}\p{S}]/u.test(ch) && !cmaps.some(c => c.has(ch.codePointAt(0))));
if (lack.length) console.log(`warn: no face has ${lack.slice(0, 60).map(ch => `${ch} U+${ch.codePointAt(0).toString(16).toUpperCase()}`).join(', ')}${lack.length > 60 ? ` and ${lack.length - 60} more` : ''}; these strings fall back to pixels if they reach the canvas (comments and data that never draw are fine)`);
const declared = cfg.bundle?.fonts || {};
for (const w of written) if (declared[w.family] !== w.rel) console.log(`note: bundle.fonts.${w.family} should be "${w.rel}" (it is ${JSON.stringify(declared[w.family] ?? null)})`);
console.log('fonts changed: every bundle that loads them changes too; rebuild and expect assemble.mjs to rebake those segments');
