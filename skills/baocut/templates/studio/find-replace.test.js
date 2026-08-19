const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./find-replace.js');

test('findTextRanges 默认忽略大小写并整体转义', () => {
  assert.deepEqual(F.findTextRanges('Agent agentic AGENT', 'agent'),
    [{ start: 0, end: 5 }, { start: 6, end: 11 }, { start: 14, end: 19 }]);
  // 非正则查询里的元字符是字面量
  assert.deepEqual(F.findTextRanges('a.c abc', 'a.c'), [{ start: 0, end: 3 }]);
  assert.deepEqual(F.findTextRanges('abc', ''), []);
});

test('findTextRanges 支持区分大小写 / 全词 / 正则', () => {
  assert.deepEqual(F.findTextRanges('Agent agent', 'agent', { caseSens: true }), [{ start: 6, end: 11 }]);
  // 全词：命中不含边界字符
  assert.deepEqual(F.findTextRanges('agent agentic', 'agent', { word: true }), [{ start: 0, end: 5 }]);
  assert.deepEqual(F.findTextRanges('a1 b2', '[a-z]\\d', { regex: true }),
    [{ start: 0, end: 2 }, { start: 3, end: 5 }]);
});

test('findTextRanges 的全词边界按字母数字判定，中文相邻词也能整词命中', () => {
  assert.deepEqual(F.findTextRanges('代理 代理人', '代理', { word: true }), [{ start: 0, end: 2 }]);
});

test('findTextRanges 对半成品正则和空匹配不抛异常', () => {
  assert.deepEqual(F.findTextRanges('abc', '(', { regex: true }), []);
  assert.deepEqual(F.findTextRanges('abc', 'x*', { regex: true }), []);   // 空命中被跳过
});

test('collect 按条目顺序编号并带回原条目', () => {
  const items = [{ key: 'a', text: 'one two', kind: 'piece' }, { key: 'b', text: 'two' }];
  const matches = F.collect(items, 'two');
  assert.deepEqual(matches.map((m) => [m.key, m.start, m.index]), [['a', 4, 0], ['b', 0, 1]]);
  assert.equal(matches[0].item.kind, 'piece');
  assert.deepEqual(F.collect(items, ''), []);
  assert.deepEqual(F.collect([{ text: 'two' }], 'two'), []);   // 没有 key 的条目被跳过
});

test('groupByKey / currentOf / cycle', () => {
  const items = [{ key: 'a', text: 'x x' }, { key: 'b', text: 'x' }];
  const matches = F.collect(items, 'x');
  const byKey = F.groupByKey(matches);
  assert.equal(byKey.get('a').length, 2);
  assert.equal(byKey.get('b').length, 1);

  assert.equal(F.currentOf(matches, 1).index, 1);
  assert.equal(F.currentOf(matches, 99).index, 2);   // 越界收敛到末尾
  assert.equal(F.currentOf([], 0), null);

  assert.equal(F.cycle(2, 3, 1), 0);
  assert.equal(F.cycle(0, 3, -1), 2);
  assert.equal(F.cycle(9, 3, 1), 0);
  assert.equal(F.cycle(0, 0, 1), 0);
});

test('countLabel 空查询给空串，无命中给无结果', () => {
  assert.equal(F.countLabel('', [], 0), '');
  assert.equal(F.countLabel('x', [], 0), '无结果');
  assert.equal(F.countLabel('x', [1, 2, 3], 1), '2 / 3');
  assert.equal(F.countLabel('x', [1, 2, 3], 9), '3 / 3');
});

test('replaceRanges 从后往前落笔，偏移不串位', () => {
  const r = F.replaceRanges('one two two', [{ start: 4, end: 7 }, { start: 8, end: 11 }], 'ZZZZ');
  assert.equal(r.text, 'one ZZZZ ZZZZ');
  assert.equal(r.changed, 2);
  assert.deepEqual(F.replaceRanges('abc', [], 'x'), { text: 'abc', changed: 0 });
  // 空替换 = 删除
  assert.deepEqual(F.replaceRanges('abc', [{ start: 1, end: 2 }], ''), { text: 'ac', changed: 1 });
  // 越界区间被忽略
  assert.deepEqual(F.replaceRanges('abc', [{ start: 2, end: 9 }], 'x'), { text: 'abc', changed: 0 });
});

test('replacePlan 每个条目折成一次整文本替换', () => {
  const items = [
    { key: 'a', text: 'one two two', kind: 'sentence' },
    { key: 'b', text: 'nothing here' },
    { key: 'c', text: 'two' },
  ];
  const plan = F.replacePlan(F.collect(items, 'two'), '2');
  assert.deepEqual(plan.map((p) => [p.key, p.text, p.changed]),
    [['a', 'one 2 2', 2], ['c', '2', 1]]);
  assert.equal(plan[0].item.kind, 'sentence');
});

test('replacePlan 文本没变化的条目不产出事务', () => {
  const items = [{ key: 'a', text: 'two' }];
  assert.deepEqual(F.replacePlan(F.collect(items, 'two'), 'two'), []);
});
