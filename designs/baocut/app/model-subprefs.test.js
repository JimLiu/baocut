const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-substyle.js');
require('./model-subprefs.js');
const P = window.BC_SUB_PREFS;
const seed = () => ({tracks: [{id: 'zh', role: 'source', y: 93, size: 20}, {id: 'en', role: 'translation', y: 86, size: 32}]});

test('首次新建字幕隐藏逗号句号，用户关闭后持久恢复 false 与零时间', () => {
  const before = P.apply(seed());
  assert.equal(before.punct, true);
  const after = {...before, punct: false, displayTiming: {leadIn: 0, tail: 0}, gap: 0};
  const saved = JSON.stringify(P.remember(null, before, after));
  const restored = P.apply(seed(), P.load({getItem: () => saved}, 'key'));
  assert.equal(restored.punct, false);
  assert.deepEqual(restored.displayTiming, {leadIn: 0, tail: 0});
  assert.equal(restored.gap, 0);
});

test('位置、宽度、双语顺序按角色跨语言恢复，不携带单句或字幕内容', () => {
  const before = P.apply(seed());
  const after = {...before, tracks: window.BC_SUB.flipStack(before).map(t => ({...t, x: 40, width: 70})), cueStyles: {c1: {zh: {size: 80}}}};
  const prefs = P.remember(null, before, after);
  const restored = P.apply({tracks: [{id: 'fr', role: 'source'}, {id: 'de', role: 'translation'}]}, prefs);
  assert.equal(restored.tracks[0].id, 'fr');
  assert.equal(restored.tracks[0].x, 40);
  assert.equal(restored.tracks[0].width, 70);
  assert.equal(window.BC_SUB.stackOrder(restored), 'srcTop');
  assert.equal(restored.cueStyles, undefined);
  assert.equal(JSON.stringify(prefs).includes('c1'), false);
  assert.equal(before.tracks[0].x, 50);
});

test('坏存储、安全禁用存储与非有限选项回到缺省', () => {
  for (const storage of [{getItem: () => '{'}, {getItem: () => {throw Error('denied');}}, {getItem: () => JSON.stringify({root: {punct: 'false', gap: -1, displayTiming: {leadIn: 99, tail: 1}}, roles: {source: {x: 999}}})}]) {
    assert.deepEqual(P.apply(seed(), P.load(storage, 'key')), P.apply(seed()));
  }
});

test('标点显示遵守共享字幕合同，保留数字、网址、缩写与其它标点', () => {
  const contract = require('../../../crates/speech-doc/tests/fixtures/subtitle-render-contract.json');
  for (const row of contract.punctuationProjections) assert.equal(P.displayText(row.text, row.enabled), row.expected, row.text);
});

test('提前与延后只填相邻空档，原句窗口优先，无字幕时为空', () => {
  const cues = [{id: 'a', start: 2, end: 3}, {id: 'b', start: 3.5, end: 4}];
  assert.equal(P.cueAt(cues, 1.5).id, 'a');
  assert.equal(P.cueAt(cues, 3.5).id, 'b');
  assert.equal(P.cueAt(cues, 5), null);
  assert.equal(P.cueAt(cues, 1.5, {leadIn: 0, tail: 0}), null);
});

test('行间距调整原译相对位置并保留另一轨的属性', () => {
  const doc = P.apply(seed());
  const next = P.withGap(doc, 12);
  assert.ok(next.tracks[1].y < doc.tracks[1].y);
  assert.equal(next.tracks[0], doc.tracks[0]);
  assert.equal(P.withGap({...doc, ...next}, 6).tracks[1].y, doc.tracks[1].y);
});
