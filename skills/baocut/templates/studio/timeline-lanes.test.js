const test = require('node:test');
const assert = require('node:assert/strict');

// 与原型 designs/baocut-mac/app/timeline-lanes.test.js 同一组断言：两边同源，
// 任何一边改了 first-fit 或 EPSILON，这份用例都该跟着红。
const LANES = require('./timeline-lanes.js');

const ids = (plan) => plan.lanes.map((lane) => lane.elementIds);

test('首尾相接算不重叠，EPSILON 之外才新开一行', () => {
  const plan = LANES.plan([
    { id: 'a', start: 0, end: 5 },
    { id: 'b', start: 5, end: 8 },
    { id: 'c', start: 7.999, end: 10 },
    { id: 'd', start: 9.9989, end: 12 },
  ], 20);
  assert.deepEqual(ids(plan), [['a', 'b', 'c'], ['d']]);
});

test('行数取最少，同 start 保持数组序', () => {
  const plan = LANES.plan([
    { id: 'later', start: 8, end: 9 },
    { id: 'first', start: 2, end: 6 },
    { id: 'second', start: 2, end: 4 },
    { id: 'touch', start: 6, end: 8 },
  ], 20);
  assert.deepEqual(ids(plan), [['first', 'touch', 'later'], ['second']]);
  assert.deepEqual(plan.laneByElementId, { first: 0, touch: 0, later: 0, second: 1 });
});

test('五条同区间摊成五行，删掉三条只剩两行', () => {
  const elements = Array.from({ length: 5 }, (_, index) => ({ id: 'same-' + index, start: 3, end: 7 }));
  assert.equal(LANES.plan(elements, 20).lanes.length, 5);
  assert.equal(LANES.plan(elements.slice(0, 2), 20).lanes.length, 2);
});

test('end 缺席按片尾算（草稿态可能出现）', () => {
  const plan = LANES.plan([
    { id: 'open', start: 1, end: null },
    { id: 'later', start: 5, end: 6 },
    { id: 'at-end', start: 10, end: 12 },
  ], 10);
  assert.deepEqual(ids(plan), [['open', 'at-end'], ['later']]);
});

test('lane 同时带元素对象，画块不用二次按 id 找回', () => {
  const plan = LANES.plan([{ id: 'a', start: 0, end: 1 }], 10);
  assert.deepEqual(plan.lanes[0].elements, [{ id: 'a', start: 0, end: 1 }]);
  assert.deepEqual(LANES.plan([], 10), { lanes: [], laneByElementId: {} });
});
