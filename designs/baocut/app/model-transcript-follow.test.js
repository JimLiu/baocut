const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-cut.js');
require('./model-transcript-follow.js');
const F = window.BC_FOLLOW;
const C = window.BC_CUT;

test('progress：词元内、间隙、边界、播完', () => {
  const times = [{start: 0, end: 1}, {start: 1, end: 2}, {start: 3, end: 4}];
  assert.deepEqual(F.progress(times, -0.5), {now: -1, played: 0});
  assert.deepEqual(F.progress(times, 0.5), {now: 0, played: 0});
  // 正好等于上一个词元的 end：它已念完，下一个接上
  assert.deepEqual(F.progress(times, 1), {now: 1, played: 1});
  // 停顿：没有当前词，之前的都算念过
  assert.deepEqual(F.progress(times, 2.5), {now: -1, played: 2});
  assert.deepEqual(F.progress(times, 3.2), {now: 2, played: 2});
  assert.deepEqual(F.progress(times, 9), {now: -1, played: 3});
});

test('progress：取不到时间的词元不崩、不挡后面的', () => {
  const times = [{start: 0, end: 1}, null, {start: 2, end: 3}];
  assert.deepEqual(F.progress(times, 2.5), {now: 2, played: 1});
  assert.deepEqual(F.progress(times, 5), {now: -1, played: 3});
  assert.deepEqual(F.progress([], 1), {now: -1, played: 0});
  assert.deepEqual(F.progress(null, 1), {now: -1, played: 0});
});

test('unhide：投影位置映射回全文', () => {
  // 全文「我们嗯今天」抠掉「嗯」→ 投影「我们今天」，被抠的字排在投影第 2 个字之前
  const hidden = [{at: 2, text: '嗯'}];
  assert.equal(F.unhide(hidden, 0), 0);
  assert.equal(F.unhide(hidden, 1), 1);
  assert.equal(F.unhide(hidden, 2), 3);          // 「今」在全文第 3 位
  assert.equal(F.unhide(hidden, 2, true), 2);    // 「们」的右端仍是 2
  assert.equal(F.unhide(hidden, 4, true), 5);    // 「天」的右端
  assert.equal(F.unhide(null, 3), 3);
});

test('paraWords：按 cue 字符比例插值，抠掉的字不吃时间', () => {
  const cues = {a: {start: 10, end: 14}, b: {start: 20, end: 22}};
  const cueOf = (id) => cues[id];
  // 全文「我们今天」+「好的」两条 cue
  const spans = [{id: 'a', start: 0, end: 4}, {id: 'b', start: 4, end: 6}];
  let w = F.paraWords('我们今天好的', spans, cueOf, 11.5);
  assert.equal(w.toks.length, 6);
  assert.deepEqual([w.now, w.played], [1, 1]);
  // 两条 cue 之间的停顿
  w = F.paraWords('我们今天好的', spans, cueOf, 16);
  assert.deepEqual([w.now, w.played], [-1, 4]);
  // 改字态投影：抠掉「今」，投影「我们天好的」的第 2 个词元是「天」（全文第 3 个字，13–14s）
  w = F.paraWords('我们天好的', spans, cueOf, 13.5, [{at: 2, text: '今'}]);
  assert.deepEqual([w.now, w.played], [2, 2]);
});

test('paraWords：拉丁按词，与 BC_CUT.tokens 同一份切分', () => {
  const text = 'Hello there, world.';
  const spans = [{id: 'a', start: 0, end: text.length}];
  const w = F.paraWords(text, spans, () => ({start: 0, end: text.length}), 7);
  assert.deepEqual(w.toks, C.tokens(text));
  assert.equal(text.slice(w.toks[w.now].s, w.toks[w.now].e), 'there, ');
  assert.equal(w.played, 1);
});

test('centerTop：居中并夹紧', () => {
  // 容器高 400、内容 2000：元素 top 1000 高 20 → 中心 1010 落在视口中线 200
  assert.equal(F.centerTop(2000, 400, 1000, 20), 810);
  assert.equal(F.centerTop(2000, 400, 50, 20), 0);
  assert.equal(F.centerTop(2000, 400, 1990, 10), 1600);
  // 内容比视口矮
  assert.equal(F.centerTop(300, 400, 100, 20), 0);
});

test('nearestTop：已可见不动、上方顶对齐、下方底对齐', () => {
  // 视口 100 高、内容 1000、当前 scrollTop 200 → 可见 [200, 300)
  assert.equal(F.nearestTop(200, 100, 220, 40, 1000), 200);
  assert.equal(F.nearestTop(200, 100, 200, 100, 1000), 200);   // 正好填满也算可见
  assert.equal(F.nearestTop(200, 100, 150, 40, 1000), 150);    // 在上方 → 顶边对齐
  assert.equal(F.nearestTop(200, 100, 190, 40, 1000), 190);    // 上边露出一截也算
  assert.equal(F.nearestTop(200, 100, 280, 40, 1000), 220);    // 在下方 → 底边对齐
  assert.equal(F.nearestTop(200, 100, 600, 40, 1000), 540);
});

test('nearestTop：比视口高时顶对齐，结果夹在可滚范围内', () => {
  assert.equal(F.nearestTop(200, 100, 250, 300, 1000), 250);
  assert.equal(F.nearestTop(0, 100, 960, 60, 1000), 900);       // 超出底部 → 夹到 max
  assert.equal(F.nearestTop(500, 100, -10, 20, 1000), 0);       // 负数夹到 0
  assert.equal(F.nearestTop(0, 300, 10, 20, 200), 0);           // 内容比视口矮
  assert.equal(F.nearestTop(0, 100, 150.6, 10, 1000), 61);      // 取整
});

test('activeAt：区间内、空隙、边界、缺时间', () => {
  const spans = [{start: 0, end: 2}, {start: 2, end: 3}, null, {start: 5, end: 6}];
  assert.equal(F.activeAt(spans, 1), 0);
  assert.equal(F.activeAt(spans, 2), 1);       // 正好等于上一条 end：归下一条
  assert.equal(F.activeAt(spans, 4), -1);      // 空隙
  assert.equal(F.activeAt(spans, 5.5), 3);
  assert.equal(F.activeAt(spans, 6), -1);
  assert.equal(F.activeAt([], 1), -1);
  assert.equal(F.activeAt(null, 1), -1);
});
