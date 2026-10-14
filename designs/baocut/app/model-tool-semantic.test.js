const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
['substyle', 'pose', 'shape-paths', 'elements', 'textpresets', 'wordanim', 'subanim', 'subpresets', 'motioncaption', 'template', 'cut', 'defaultsub']
  .forEach((m) => require(`./model-${m}.js`));
require('./data.js');
require('./model-semantic.js');
require('./model-writing-cites.js');
require('./model-tool-semantic.js');
const D = window.BC_DATA;
const S = window.BC_SEMANTIC;
const T = window.BC_TOOL_SEMANTIC;
const SEM = D.semantic;
const ready = S.status({});
const none = S.status({install: 'none'});

test('章节边界：装了模型缺省按话题，没装由模型决定（§2.3）', () => {
  assert.deepEqual(T.BOUNDARY.map((b) => b.label), ['按话题自动检测', '由模型决定']);
  assert.equal(T.boundaryDefault(ready), 'topic');
  assert.equal(T.boundaryDefault(none), 'model');
});

test('章节自检：只比同一部视频的几章，标题明显不贴的、与上一章几乎重复的给提示；没装模型或索引没好时不查（§3.6）', () => {
  const r = T.chapterHints(D.chapters, SEM.chapterCheck, ready);
  assert.equal(r.available, true);
  assert.deepEqual(r.hints.map((h) => [h.k, h.id]), [['title', 'c3'], ['merge', 'c4']]);
  assert.equal(r.hints[1].prev, 'c3');
  assert.match(r.hints[1].text, /产品演示/);
  // 几章都偏低时不单挑哪一章：相对中位数不够低
  assert.deepEqual(T.chapterHints(D.chapters, {titleFit: {c1: 0.40, c2: 0.38, c3: 0.36, c4: 0.41}}, ready).hints, []);
  assert.deepEqual(T.chapterHints(D.chapters, SEM.chapterCheck, none), {available: false, hints: []});
  assert.equal(T.chapterHints(D.chapters, SEM.chapterCheck, S.status({index: 'stale'})).available, false);
});

test('术语候选：没装模型只剩记下的误听写法并说明；勾选的一次改完（§2.5）', () => {
  const all = T.termRows(SEM.termCands, ready);
  assert.equal(all.rows.length, SEM.termCands.length);
  assert.equal(all.note, null);
  const ex = T.termRows(SEM.termCands, none);
  assert.ok(ex.rows.every((r) => r.mode === 'exact'));
  assert.ok(ex.hidden > 0);
  assert.match(ex.note, /只做了精确匹配/);
  const a = T.applyTerms(all.rows, {tc3: true, tc5: true});
  assert.equal(a.n, 4);
  assert.match(a.receipt, /改了 4 处/);
  assert.equal(T.applyTerms(all.rows, {}).receipt, null);
  assert.equal(T.variantLine(SEM.termVariants[0]), '「科浪」5 次，「柯浪」2 次');
  // 润色结果只有一张「发现术语」清单：写法不一致的排前、带误听写法；同名合并；库里有的不列
  const cands = [{source: '推测解码', count: 5, sample: '推测解码这条路'}, {source: '科浪', count: 7, sample: '欢迎来到科浪'}];
  const rows = T.harvestRows(cands, SEM.termVariants, []);
  assert.deepEqual(rows.map((r) => r.source), ['科浪', '推测解码']);
  assert.deepEqual(rows[0].variants, ['柯浪']);
  assert.match(rows[0].line, /写法不一致.*建议统一成「科浪」/);
  assert.deepEqual(T.harvestRows(cands, SEM.termVariants, [{source: '科浪', variants: []}]).map((r) => r.source), ['推测解码']);
  assert.deepEqual(T.harvestRows(cands, null, []).map((r) => r.variants.length), [0, 0]);
});

test('重录：建议保留最后一遍完整的，不预先勾；数字与否定不同的列进相似但有差异（§3.8）', () => {
  const g1 = T.retakeGroup(SEM.retakes[0]);
  assert.equal(g1.keep, 'b');
  assert.equal(g1.differ, false);
  assert.equal(g1.takes[0].meta, '3.1 秒 · 没说完');
  const g2 = T.retakeGroup(SEM.retakes[1]);
  assert.equal(g2.keep, 'c');
  const d = T.retakeGroup(SEM.retakesDiffer[0]);
  assert.equal(d.differ, true);
  assert.deepEqual(d.kinds, ['数字', '否定']);
  assert.deepEqual(d.takes[1].pieces.filter((p) => p.hl).map((p) => p.t), ['不会', '5']);
  assert.deepEqual(d.takes[0].pieces.filter((p) => p.hl).map((p) => p.t), ['3']);
  /* 没确认的组不剪；确认后剪掉保留之外的各遍，算一笔 */
  assert.equal(T.applyRetakes([g1, g2], {}).receipt, null);
  const r = T.applyRetakes([g1, g2], {rt2: true}, {rt2: 'a'});
  assert.deepEqual(r.cuts.map((c) => c.take), ['b', 'c']);
  assert.match(r.receipt, /剪掉 2 遍重录/);
  assert.equal(T.retakeRows(SEM.retakes, none).length, 0);
});

test('专有名词按术语表比较', () => {
  assert.deepEqual(T.diff('林澈说的', '苏黎说的', ['林澈', '苏黎']).kinds, ['专有名词']);
  assert.deepEqual(T.diff('同一份工程，两台机器', '同一份工程，两台机器，对').kinds, []);
});

test('插图：没装多模态按出处时间取帧并写明；装了按内容（§2.3）', () => {
  const W = window.BC_WRCITES;
  const bs = W.blocks(W.demo('blog'), new Set(D.cues.map((c) => c.id)), 'p1');
  const lookup = (id) => D.cues.find((c) => c.id === id);
  const a = T.illustrations(bs, lookup, 'text');
  assert.equal(a.note, '按时间取帧，未按内容挑选');
  assert.ok(a.frames.length >= 2);
  assert.equal(a.frames[0].t, lookup('g5').start);
  assert.equal(T.illustrations(bs, lookup, 'full').note, null);
  const f = T.nextFrame(a.frames[0]);
  assert.notEqual(f.t, a.frames[0].t);
  assert.notEqual(f.caption, a.frames[0].caption);
  assert.match(f.caption, new RegExp(T.mmss(f.t)));
});

test('短视频主题：可空；没装模型时写了也不生效并说明（§2.8）', () => {
  assert.equal(T.shortsTopic('', ready).extra, null);
  assert.match(T.shortsTopic('为什么做本地', ready).extra, /为什么做本地/);
  assert.ok(T.shortsTopic('x', none).blocked);
});

test('按主题：长视频或超出上下文才缺省按主题；没装模型置灰（§2.2、§4 第 2 条）', () => {
  assert.equal(T.topicDefault({usable: true, duration: 206}).k, 'all');
  assert.equal(T.topicDefault({usable: true, duration: 3600}).k, 'topic');
  assert.match(T.topicDefault({usable: true, duration: 600, words: 90000, budget: 60000}).why, /上下文/);
  assert.equal(T.topicDefault({usable: false, duration: 3600}).k, 'all');
  assert.equal(T.chaptersCovered(SEM.topicPick, D.cues, D.chapters), 2);
  const off = T.topicScope(none, 12, 2);
  assert.ok(off.disabled);
  assert.equal(off.sub, '需要本机语义模型');
  assert.match(T.topicScope(ready, 12, 2).sub, /12 段，覆盖 2 章/);
});
