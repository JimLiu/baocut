/* node --test designs/baocut/app/model-find.test.js */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-find.js');
const F = window.BC_FIND;

const at = (rs) => rs.map((r) => r.start + '-' + r.end).join(',');

test('默认不区分大小写；开 Aa 之后只认原样', () => {
  assert.equal(at(F.ranges('abc ABC abcd', 'abc', {})), '0-3,4-7,8-11');
  assert.equal(at(F.ranges('abc ABC abcd', 'abc', {case: true})), '0-3,8-11');
});

test('全词把词内命中挡掉', () => {
  assert.equal(at(F.ranges('abc ABC abcd', 'abc', {word: true})), '0-3,4-7');
});

test('全词用 Unicode 词类，不是 \\b——中文靠标点断词，被汉字黏着就不算整词', () => {
  // \b 只认 [A-Za-z0-9_]，对中文会把每个字缝都判成边界，等于这个开关没开
  assert.equal(at(F.ranges('本机。本机', '本机', {word: true})), '0-2,3-5');
  // 中文没有空格，词被别的汉字黏着时「全词」查不到——这是全词的定义，不是 bug，
  // 所以 UI 要在 0 条时提示「关掉全词有 N 条」，见 useFind 的 relaxed 计数
  assert.deepEqual(F.ranges('搬到本机跑得动', '本机', {word: true}), []);
  assert.equal(at(F.ranges('搬到本机跑得动', '本机', {})), '2-4');
});

test('正则模式下元字符生效，普通模式下按字面转义', () => {
  assert.equal(at(F.ranges('aXbXXc', 'X+', {regex: true})), '1-2,3-5');
  assert.equal(at(F.ranges('a.b axb', '.', {})), '1-2');
});

test('正则语法错误报错，而不是静默 0 条', () => {
  const bad = F.compile('a(', {regex: true});
  assert.ok(bad.error);
  assert.equal(bad.re, undefined);
  assert.deepEqual(F.ranges('anything', 'a(', {regex: true}), []);
  assert.equal(F.countLabel([], 'a(', bad.error), '正则无效');
});

test('零宽匹配不会原地打转', () => {
  const rs = F.ranges('abc', 'x*', {regex: true});
  assert.deepEqual(rs, []);
});

test('collect 铺成一张有序表，命中带上定位字段', () => {
  const ms = F.collect([{key: 'p1', side: 'o', text: 'ab ab'}, {key: 'p2', side: 't', text: 'ab'}], 'ab', {});
  assert.equal(ms.length, 3);
  assert.deepEqual(ms.map((m) => m.index), [0, 1, 2]);
  assert.deepEqual(ms.map((m) => m.key), ['p1', 'p1', 'p2']);
  assert.equal(ms[2].side, 't');
  assert.equal('text' in ms[0], false);
});

test('byKey 分组给视图层上高亮', () => {
  const g = F.byKey(F.collect([{key: 'a', text: 'xx'}, {key: 'b', text: 'x'}], 'x', {}));
  assert.equal(g.get('a').length, 2);
  assert.equal(g.get('b').length, 1);
});

test('replaceIn 从后往前改，前面的区间不被挪位', () => {
  const text = 'foo bar foo';
  const r = F.replaceIn(text, F.ranges(text, 'foo', {}), 'looong');
  assert.equal(r.text, 'looong bar looong');
  assert.equal(r.changed, 2);
});

test('替换成原样不计入 changed', () => {
  const r = F.replaceIn('foo', F.ranges('foo', 'foo', {}), 'foo');
  assert.equal(r.changed, 0);
});

test('替换文本按字面插入，不解析 $1', () => {
  const r = F.replaceIn('ab', F.ranges('ab', '(a)b', {regex: true}), '[$1]');
  assert.equal(r.text, '[$1]');
});

test('只替换选中的那一条，别的命中原样留着', () => {
  const text = 'foo foo foo';
  const ms = F.ranges(text, 'foo', {});
  assert.equal(F.replaceIn(text, [ms[1]], 'X').text, 'foo X foo');
});

test('上一个 / 下一个到头绕回去；空表停在 0', () => {
  assert.equal(F.step(2, 3, 1), 0);
  assert.equal(F.step(0, 3, -1), 2);
  assert.equal(F.step(0, 0, 1), 0);
  assert.equal(F.step(9, 3, 1), 0);   // 越界的 idx 先夹回表内
});

test('current 在表变短之后夹回最后一条', () => {
  const ms = [{index: 0}, {index: 1}];
  assert.equal(F.current(ms, 5).index, 1);
  assert.equal(F.current([], 0), null);
});

test('计数文案区分「没输入」「无结果」「有结果」', () => {
  assert.equal(F.countLabel([], '', null), '');
  assert.equal(F.countLabel([], 'zz', null), '无结果');
  assert.equal(F.countLabel([{}, {}], 'zz', null), '2 条');
});
