#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本
// 字幕：用稿子原文 + 对齐好的字时间（timing/<id>.json）给每段旁白素材写一份转写（ElevenLabs Scribe 形状），
// documents put 导入后 captions create 建字幕层。用稿子原文而不是识别出的字，专名不会写错。
//   node tools/captions.mjs [--only=id,id] [--dry] [--config <配置>]
//   --dry 只打印每段切出的词与前几个词的时间，不连 Runtime。
// 结果记在 captions.json（timeline.json 归 assemble.mjs 写）。某段的旁白片段换了（assemble 重放了旁白）或字时间变了，
// 先把所有这样的段的旧字幕片段一起删掉，再逐段重建：逐段「删一段建一段」时，前一段变长后的新字幕会撞上后一段还没删的旧字幕，
// Runtime 就把它放进新建的另一条字幕轨。建好后字幕不在已有的字幕轨上时报出来。
// 字幕默认比每条的第一个字提前一点出现（字幕样式的 displayTiming.leadIn，默认 0.5 秒）：从第 0 帧起的那段，
// 第一条会压在封面上，所以建好后把那个字幕片段的起点裁到第一个字被说到的时刻（整帧，向后取）。
// 字幕默认在每条说完后再停 1 秒（displayTiming.tail）。旁白停下来放原声片段（clips.json 里 gap 为 true）时，这一秒会压在
// 片段开头烧进去的字幕上，所以建好后按留白收短：tail 不超过任一留白里旁白结尾到片段开始的距离，leadIn 不超过片段结尾到
// 下一句开口的距离（各少一帧）。配置 captions.displayTiming 可以另给 { leadIn, tail }，同样会被收短。
// 配置 captions.style 给旁白字幕的摆放与外观（Studio 样式的键：y、verticalAlign、x、width、fontSize 等，竖版要给，
// 默认的 y 86 落在平台控件区里）。给了 style，或时长和默认不同时：找视频里旁白的字幕样式文档（overlay.json 里原声字幕的
// 样式不算；没有就以默认样式加上 style 建一份），只把和配置不同的键 patchDocument 写进去（都一样时不动），再把各段字幕挂到
// 这份样式上；用的样式记在 captions.json 的 _style，各段记 style（重建的字幕是默认样式，记录里 style 不是这份的挂一遍）。
// 什么都不给时不建样式文档，字幕按默认样式画。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, parseArgs, listFlag, makeBc, readJson, writeJson, isCjk, textHash, allItems } from './lib.mjs';

const OPEN = /[“‘（《「『〈【([{¿¡]/u;
const WORD = c => /[\p{L}\p{N}]/u.test(c) && !isCjk(c);
const JOIN = /['’.,%/+\-_:]/;

// 一句稿子切成词：汉字与假名一个字一个词；其余文字按词（字母数字连着，中间夹的 ' . , % / + - _ : 后面还跟字母数字时算词内）；
// 左引号、左括号贴到后一个词，其余标点贴到前一个词（前面隔着空格的独立标点，例如破折号，连空格一起贴）；空白记为 spacing。
// 时间取词首字的对齐时刻，结尾取下一个词的开始（最后一个取这一句的结尾），全程不往回走（floor 是上一句最后一个词的结尾）。
export function words(line, floor = 0) {
  const s = line.text, out = [];
  let lead = '';
  const last = () => out.findLast(w => w.type === 'word');
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (/\s/.test(c)) { if (out.length && out.at(-1).type !== 'spacing') out.push({ type: 'spacing', text: ' ' }); i++; continue; }
    if (OPEN.test(c) || (/["']/.test(c) && (i === 0 || /\s/.test(s[i - 1])))) { lead += c; i++; continue; } // 直引号在词首算左引号
    if (isCjk(c) || WORD(c)) {
      let j = i + 1;
      if (WORD(c)) while (j < s.length && (WORD(s[j]) || (JOIN.test(s[j]) && j + 1 < s.length && WORD(s[j + 1])))) j++;
      out.push({ type: 'word', text: lead + s.slice(i, j), start: line.chars[i] });
      lead = '';
      i = j;
      continue;
    }
    // 标点与符号
    const prev = last();
    if (!prev) { lead += c; i++; continue; }
    if (out.at(-1).type === 'spacing') { out.pop(); prev.text += ' ' + c; } else prev.text += c;
    i++;
  }
  while (out.length && out.at(-1).type === 'spacing') out.pop();
  const ws = out.filter(w => w.type === 'word');
  let t = floor;
  for (const w of ws) w.start = t = Math.max(t, w.start);
  ws.forEach((w, k) => {
    const next = ws[k + 1] ? ws[k + 1].start : Math.max(line.end, w.start);
    w.end = +Math.max(w.start, next).toFixed(3);
    w.start = +w.start.toFixed(3);
  });
  return out;
}

const TIMING = { leadIn: 0.5, tail: 1 };

// 留白给字幕显示时长的上限（秒）：tail 是旁白结尾到原声片段开始，leadIn 是片段结尾到下一句开口，取所有留白里最小的
export function timingLimits(cfg) {
  const cl = readJson(cfg.abs(cfg.footage?.clips || 'clips.json'), { clips: [] });
  const len = new Map(cl.clips.filter(c => c.gap).map(c => [c.id, c.to - c.from]));
  const lim = { leadIn: Infinity, tail: Infinity };
  for (const id of cfg.order) {
    const tm = readJson(cfg.abs(cfg.dirs.timing, id + '.json'), { lines: [] });
    for (const g of tm.gaps || []) {
      if (!len.has(g.clip)) continue;
      const end = g.at + len.get(g.clip);
      const before = tm.lines.findLast(l => l.end <= g.at + 1e-3), after = tm.lines.find(l => l.start >= end - 1e-3);
      if (before) lim.tail = Math.min(lim.tail, g.at - before.end);
      if (after) lim.leadIn = Math.min(lim.leadIn, after.start - end);
    }
  }
  return lim;
}

// 旁白字幕能配的样式键（setCaptionStyle 的 style 认的键）；描边、投影只比、只改给出的字段
const STYLE_KEYS = ['y', 'verticalAlign', 'x', 'width', 'fontSize', 'fontWeight', 'fontFamily', 'fontColor', 'textOutline', 'dropShadow', 'background', 'backgroundColor'];
const NESTED = new Set(['textOutline', 'dropShadow']);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// 配置里旁白字幕的样式：captions.style，没给时 null
export function styleOf(cfg) {
  const s = cfg.captions?.style;
  if (s == null) return null;
  if (!isObj(s) || !Object.keys(s).length) throw new Error(`captions.style: give an object with some of ${STYLE_KEYS.join(', ')}`);
  const bad = Object.keys(s).filter(k => !STYLE_KEYS.includes(k));
  if (bad.length) throw new Error(`captions.style: unknown key ${bad.join(', ')}; use ${STYLE_KEYS.join(', ')}`);
  return s;
}

// 样式文档的 style 和配置不同的键，写成 patchDocument 的 changes；都一样时为空
export function styleChanges(cur, want) {
  return Object.entries(want).flatMap(([k, v]) => {
    if (NESTED.has(k) && isObj(v)) {
      const base = isObj(cur?.[k]) ? cur[k] : {};
      return Object.entries(v).every(([kk, vv]) => base[kk] === vv) ? [] : [{ path: ['style', k], value: { ...base, ...v } }];
    }
    return cur?.[k] === v ? [] : [{ path: ['style', k], value: v }];
  });
}

export function applyTiming(cfg, bc, caps) {
  const lim = timingLimits(cfg), want = { ...TIMING, ...cfg.captions?.displayTiming }, style = styleOf(cfg);
  for (const k of ['leadIn', 'tail']) {
    const max = Math.max(0, Math.floor((lim[k] - 1 / cfg.fps) * 20) / 20);
    if (want[k] > max) { console.log(`caption ${k} ${want[k]}s -> ${max}s: a sound-bite gap leaves ${lim[k].toFixed(2)}s`); want[k] = max; }
  }
  const segs = cfg.order.filter(id => caps[id]?.items?.length);
  if (!segs.length) return;
  const head = () => bc(['videos', 'inspect', cfg.video, '--limit', '1']);
  const apply = (label, ops) => bc(['edits', 'apply', cfg.video, '--expected-revision', String(head().revision), '--label', label, '--operations', JSON.stringify(ops)]);
  // 原声字幕（overlay.mjs 建的）有自己的样式文档，不是旁白的
  const bites = new Set(Object.values(readJson(cfg.abs('overlay.json'), {}).bites || {}).map(b => b.styleDocumentId));
  // 不是本脚本建的字幕在用的样式（前插项目里正片的字幕）也不是旁白的
  const ours = new Set(segs.flatMap(id => caps[id].items));
  const foreign = new Set(allItems(bc, cfg.video).items.filter(it => it.type === 'caption' && !ours.has(it.id) && it.styleDocumentId).map(it => it.styleDocumentId));
  const styles = (head().documents || []).filter(d => d.kind === 'caption-style' && !bites.has(d.id) && !foreign.has(d.id));
  let doc = styles.find(d => d.id === caps._style?.documentId)?.id ?? (styles.length === 1 ? styles[0].id : null);
  if (!doc && !style && want.leadIn === TIMING.leadIn && want.tail === TIMING.tail) return;   // 默认样式、默认时长，不用样式文档
  if (!doc && styles.length) throw new Error(`video has ${styles.length} caption styles (${styles.map(d => d.id).join(', ')}); put the narration one in captions.json as _style.documentId`);
  if (!doc) {
    // 以默认样式加上配置的 style 建一份（没给 style 时 y 86 就是默认），序列上还没有样式的字幕一起挂上
    const r = apply('Caption style for narration', [{ type: 'setCaptionStyle', itemId: caps[segs[0]].items[0], style: style ?? { y: 86 } }]);
    doc = r.createdIds?.find(x => x.startsWith('doc_'));
    if (!doc) throw new Error(`no style document in receipt: ${JSON.stringify(r).slice(0, 400)}`);
    for (const id of segs) caps[id].style = doc;
    console.log('caption style', doc, 'created', JSON.stringify(style ?? {}));
  }
  const cur = bc(['documents', 'read', cfg.video, '--document-id', doc]).body?.style ?? {};
  const t = cur.displayTiming ?? {};
  const changes = [
    ...(t.leadIn !== want.leadIn || t.tail !== want.tail ? [{ path: ['style', 'displayTiming'], value: { ...t, ...want } }] : []),
    ...(style ? styleChanges(cur, style) : []),
  ];
  if (changes.length) {
    apply('Caption style for narration', [{ type: 'patchDocument', documentId: doc, changes }]);
    console.log('caption style', doc, changes.map(c => `${c.path[1]} ${JSON.stringify(c.value)}`).join(', '));
  }
  const loose = segs.filter(id => caps[id].style !== doc);
  if (loose.length) {
    apply(`Attach caption style ${loose.join(' ')}`, loose.flatMap(id => caps[id].items.map(itemId => ({ type: 'setCaptionStyle', itemId, styleDocumentId: doc }))));
    for (const id of loose) caps[id].style = doc;
    console.log(loose.join(' '), 'captions use style', doc);
  }
  caps._style = { documentId: doc, displayTiming: want, ...(style ? { style } : {}) };
}

export function scribe(lines, language) {
  const ws = [];
  let floor = 0;
  for (const l of lines) {
    const lw = words(l, floor);
    const lastWord = lw.findLast(w => w.type === 'word');
    if (lastWord) floor = lastWord.end;
    if (ws.length && lw.length) ws.push({ type: 'spacing', text: ' ' });
    for (const w of lw) ws.push(w.type === 'word' ? { ...w, speaker_id: 'narrator' } : w);
  }
  return { language_code: language.split('-')[0].toLowerCase(), words: ws };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const { flags } = parseArgs(process.argv, ['only']);
  const only = listFlag(flags.only);
  const log = cfg.abs('captions.json');
  const caps = readJson(log, {});
  const bc = flags.dry ? null : makeBc(cfg);
  const segs = readJson(cfg.abs('timeline.json'), {}).segments || {};
  const style = styleOf(cfg);
  if (flags.dry && style) console.log('caption style', JSON.stringify(style));

  // 1. 每段的字与旁白片段，和记录对一下，找出要重建的段
  const todo = [];
  for (const id of cfg.order) {
    if (only.length && !only.includes(id)) continue;
    const tf = cfg.abs(cfg.dirs.timing, id + '.json');
    if (!fs.existsSync(tf)) throw new Error(`${tf} missing; run align.mjs ${id}`);
    const tm = JSON.parse(fs.readFileSync(tf, 'utf8'));
    const body = scribe(tm.lines, cfg.language);
    const wc = body.words.filter(w => w.type === 'word');
    if (flags.dry) {
      console.log(id, wc.length, 'words', wc.slice(0, 10).map(w => `${w.text}@${w.start}-${w.end}`).join(' '));
      continue;
    }
    const seg = segs[id];
    if (!seg || !seg.audioAsset) throw new Error(`${id} narration not on the timeline yet; run assemble.mjs first`);
    const hash = textHash(JSON.stringify(body));
    const cap = caps[id];
    if (cap && !cap.audioItem) { cap.audioItem = seg.audioItem; cap.wordsHash ??= hash; } // 旧记录：当作和现在一致
    todo.push({ id, body, wc, seg, hash, stale: !!cap && (cap.audioItem !== seg.audioItem || cap.wordsHash !== hash) });
  }

  // 2. 要重建的段，旧字幕片段一起删掉（先记下字幕原来在哪条轨上）
  const home = Object.values(caps).find(c => c.track)?.track;
  const stale = todo.filter(t => t.stale);
  if (stale.length) {
    const v = allItems(bc, cfg.video);
    const live = new Set(v.items.map(it => it.id));
    const still = stale.flatMap(t => (caps[t.id].items || []).filter(itemId => live.has(itemId)));
    if (still.length) bc(['edits', 'apply', cfg.video, '--expected-revision', String(v.revision), '--label', `Remove stale captions ${stale.map(t => t.id).join(' ')}`, '--operations', JSON.stringify([{ type: 'deleteItems', itemIds: still }])]);
    console.log(stale.map(t => t.id).join(' '), 'stale captions removed', still.length);
    for (const t of stale) delete caps[t.id];
    writeJson(log, caps);
  }

  // 3. 逐段建字幕
  for (const { id, body, wc, seg, hash } of todo) {
    const cap = caps[id];
    if (cap) { console.log(id, 'already', cap.caption); continue; }
    const tmp = cfg.abs(cfg.dirs.work, `scribe-${id}.json`);
    writeJson(tmp, body);
    const d = bc(['documents', 'put', cfg.video, '--format', 'elevenlabs', '--kind', 'speech', '--language', cfg.language, '--source-asset', seg.audioAsset, '--name', `${cfg.names.narration} ${id}`, '--body', '@' + tmp]);
    const c = bc(['captions', 'create', cfg.video, '--document-id', d.documentId]);
    caps[id] = { speech: d.documentId, caption: c.documentId, track: c.trackId, items: c.itemIds, cues: c.cueCount, enabled: c.enabled, audioItem: seg.audioItem, wordsHash: hash };
    if (home && c.trackId !== home) console.log(`${id}: captions landed on ${c.trackId}, not ${home}; something on that track overlaps them, move them back with moveItems`);
    const from = seg.from ?? Math.round(parseFloat(seg.at) * cfg.fps);
    if (from === 0 && wc.length && wc[0].start > 0) {
      const v = allItems(bc, cfg.video);
      const cover = v.items.find(it => (c.itemIds || []).includes(it.id) && it.startFrame === 0);
      if (cover) {
        const at = Math.ceil(wc[0].start * cfg.fps) / cfg.fps;
        bc(['edits', 'apply', cfg.video, '--expected-revision', String(v.revision), '--label', `Keep captions off the cover ${id}`, '--operations', JSON.stringify([{ type: 'trimItem', itemId: cover.id, edge: 'start', at }])]);
        caps[id].coverTrim = at;
        console.log(id, 'caption starts at', at, 's, off the cover frame');
      }
    }
    writeJson(log, caps);
    console.log(JSON.stringify({ id, ...caps[id] }));
  }
  if (!flags.dry) { applyTiming(cfg, bc, caps); writeJson(log, caps); }
}
