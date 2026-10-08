const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-chapters.js');
const CH = global.window.BC_CH;

const chapters = () => [
  {id: 'c1', title: '开场', start: 0, end: 22},
  {id: 'c2', title: '现场访谈', start: 22, end: 95},
  {id: 'c3', title: '产品演示', start: 95, end: 158},
];
// p1 p2 在 c1，p3 p4 p5 在 c2，p6 在 c3
const paras = [
  {id: 'p1', start: 0, end: 10},
  {id: 'p2', start: 10, end: 22},
  {id: 'p3', start: 22, end: 50},
  {id: 'p4', start: 50, end: 72},
  {id: 'p5', start: 72, end: 95},
  {id: 'p6', start: 95, end: 158},
];

test('段落按中点归章', () => {
  assert.equal(CH.chapterOfPara(chapters(), paras[0]), 0);
  assert.equal(CH.chapterOfPara(chapters(), paras[2]), 1);
  assert.equal(CH.chapterOfPara(chapters(), paras[5]), 2);
});

test('分节保留空章节的头行', () => {
  const secs = CH.sections(chapters(), paras.slice(0, 2));
  assert.equal(secs.length, 3);
  assert.deepEqual(secs.map((s) => s.paras.length), [2, 0, 0]);
});

test('没有章节表时退化成单节', () => {
  const secs = CH.sections([], paras);
  assert.equal(secs.length, 1);
  assert.equal(secs[0].chapter, null);
  assert.equal(secs[0].paras.length, 6);
});

test('改名保留 id 与边界，空标题不写', () => {
  const next = CH.renameChapter(chapters(), 'c2', '  聊本地化  ');
  assert.equal(next[1].title, '聊本地化');
  assert.equal(next[1].start, 22);
  assert.equal(next[1].end, 95);
  assert.equal(next[0].title, '开场');
  assert.equal(CH.renameChapter(chapters(), 'c2', '   '), null);
  assert.equal(CH.renameChapter(chapters(), 'nope', 'x'), null);
});

test('上移带走本章里它及它之前的段，只挪一条边界', () => {
  const plan = CH.movePlan(chapters(), paras, 'p4', -1);
  assert.deepEqual(plan.moving.map((p) => p.id), ['p3', 'p4']);
  const r = CH.moveParaToChapter(chapters(), paras, 'p4', -1);
  assert.equal(r.moved, 2);
  assert.equal(r.chapters[0].end, 72);   // 边界推到 p4.end
  assert.equal(r.chapters[1].start, 72);
  assert.equal(r.chapters[1].end, 95);   // 其余边界原样
  assert.equal(r.chapters[2].start, 95);
  assert.equal(CH.chapterOfPara(r.chapters, paras[2]), 0);
  assert.equal(CH.chapterOfPara(r.chapters, paras[3]), 0);
});

test('下移带走本章里它及它之后的段', () => {
  const plan = CH.movePlan(chapters(), paras, 'p4', 1);
  assert.deepEqual(plan.moving.map((p) => p.id), ['p4', 'p5']);
  const r = CH.moveParaToChapter(chapters(), paras, 'p4', 1);
  assert.equal(r.moved, 2);
  assert.equal(r.chapters[1].end, 50);   // 边界拉到 p4.start
  assert.equal(r.chapters[2].start, 50);
  assert.equal(r.chapters[0].end, 22);   // 其余边界原样
  assert.equal(CH.chapterOfPara(r.chapters, paras[4]), 2);
});

test('端点章与「会掏空本章」的一步不成立', () => {
  assert.equal(CH.movePlan(chapters(), paras, 'p1', -1), null);   // c1 没有上一章
  assert.equal(CH.movePlan(chapters(), paras, 'p6', 1), null);    // c3 没有下一章
  assert.equal(CH.movePlan(chapters(), paras, 'p1', 1), null);    // 会把 c1 掏空
  assert.equal(CH.movePlan(chapters(), paras, 'p3', 1), null);    // 首段下移同样掏空本章
  assert.equal(CH.movePlan(chapters(), paras, 'p6', -1), null);   // c3 只有一段
  assert.equal(CH.moveParaToChapter(chapters(), paras, 'p1', -1), null);
});
