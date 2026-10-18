#!/usr/bin/env node
// i18n-ignore-file: 给智能体拷走用的独立脚本
// 字幕：用稿子原文 + 对齐好的字时间（timing/<id>.json）给每段旁白素材写一份转写（ElevenLabs Scribe 形状），
// documents put 导入后 captions create 建字幕层。用稿子原文而不是识别出的字，专名不会写错。
//   node tools/captions.mjs [--only=id,id] [--dry] [--config explainer.json]
//   --dry 只打印每段切出的词与前几个词的时间，不连 Runtime。
// 结果记在 captions.json（timeline.json 归 assemble.mjs 写）。某段的旁白片段换了（assemble 重放了旁白）或字时间变了，
// 先把所有这样的段的旧字幕片段一起删掉，再逐段重建：逐段「删一段建一段」时，前一段变长后的新字幕会撞上后一段还没删的旧字幕，
// Runtime 就把它放进新建的另一条字幕轨。建好后字幕不在已有的字幕轨上时报出来。
// 字幕默认比每条的第一个字提前一点出现（字幕样式的 displayTiming.leadIn，默认 0.5 秒）：从第 0 帧起的那段，
// 第一条会压在封面上，所以建好后把那个字幕片段的起点裁到第一个字被说到的时刻（整帧，向后取）。
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
  if (!flags.dry) writeJson(log, caps);
}
