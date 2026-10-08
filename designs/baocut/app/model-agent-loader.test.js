const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.window = {};
require('./model-agent-loader.js');
require('./model-agent-turn.js');
const L = global.window.BC_AGENT_LOADER;
const TURN = global.window.BC_AGENT_TURN;

/* 字母类图形拼的是第三方字标：名字以这个前缀开头的一律不用 */
const LETTERS = /^adobe/;
const sequences = () => [['THINKING', L.THINKING], ['FALLBACK', L.FALLBACK], ...Object.entries(L.KINDS)];

test('每个序列里的名字都在 ICONS 里，没有字母类图形', () => {
  assert.equal(new Set(L.ICONS).size, L.ICONS.length);
  L.ICONS.forEach((n) => assert.doesNotMatch(n, LETTERS));
  for (const [key, seq] of sequences()) {
    assert.ok(seq.length >= 1, key);
    seq.forEach((n) => assert.ok(L.ICONS.includes(n), `${key}: ${n} 不在 ICONS 里`));
  }
});

test('类别序列 2–4 个图，能轮换；FALLBACK 也是', () => {
  for (const [key, seq] of Object.entries(L.KINDS)) {
    assert.ok(seq.length >= 2 && seq.length <= 4, `${key} 有 ${seq.length} 个图`);
    assert.equal(new Set(seq).size, seq.length, `${key} 有重复`);
  }
});

test('ICONS 与装好的 @react-spectrum/ai 导出的图案类图形一一对应', (t) => {
  const file = path.join(__dirname, '..', 'node_modules/@react-spectrum/ai/src/loader/data.ts');
  if (!fs.existsSync(file)) return t.skip('没有 node_modules/@react-spectrum/ai');
  const src = fs.readFileSync(file, 'utf8');
  /* 单个图形是 Cell[]；预设序列声明成 Cell[][]，不算 */
  const names = [...src.matchAll(/^export const (\w+)(.*)$/gm)].filter((m) => !/Cell\[\]\[\]/.test(m[2])).map((m) => m[1]);
  assert.deepEqual([...L.ICONS].sort(), names.filter((n) => !LETTERS.test(n)).sort());
});

test('THINKING 用到全部图形，aiLogo 打头；每个图形至少出现在一个类别里或 THINKING 里', () => {
  assert.equal(L.THINKING[0], 'aiLogo');
  assert.deepEqual([...L.THINKING].sort(), [...L.ICONS].sort());
  const themed = new Set(Object.values(L.KINDS).flat());
  const missing = L.ICONS.filter((n) => !themed.has(n));
  assert.deepEqual(missing, [], `没进任何类别：${missing.join(', ')}`);
});

test('model-agent-tools.js 与 model-agent-turn.js 产出的每个类别都有自己的序列（other 明确走 FALLBACK）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'model-agent-tools.js'), 'utf8');
  const own = [...new Set([...src.matchAll(/kind: '([a-z-]+)'/g)].map((m) => m[1]))];
  assert.ok(own.length >= 20, `只找到 ${own.length} 个工具类别`);
  const generic = Object.keys(TURN.TOOL_LABELS);
  for (const kind of [...own, ...generic]) {
    assert.ok(Object.prototype.hasOwnProperty.call(L.KINDS, kind), `${kind} 没有序列`);
    if (kind === 'other') assert.equal(L.forKind(kind), L.FALLBACK);
    else assert.notEqual(L.forKind(kind), L.FALLBACK, `${kind} 落到了 FALLBACK`);
  }
});

test('forKind：同一类别每次返回同一个冻结数组；认不出的类别与空值走 FALLBACK', () => {
  assert.equal(L.forKind('transcribe'), L.forKind('transcribe'));
  assert.ok(Object.isFrozen(L.forKind('transcribe')));
  assert.ok(Object.isFrozen(L.THINKING));
  assert.equal(L.forKind('no-such-kind'), L.FALLBACK);
  assert.equal(L.forKind(undefined), L.FALLBACK);
  assert.equal(L.forKind('toString'), L.FALLBACK);
});

test('resolve：按表取像素格，缺的跳过，一个都没有返回 null', () => {
  const a = [{cx: 120, cy: 120}];
  const b = [{cx: 160, cy: 120}];
  assert.deepEqual(L.resolve(['aiLogo', 'nope', 'wand'], {aiLogo: a, wand: b}), [a, b]);
  assert.equal(L.resolve(['nope'], {aiLogo: a}), null);
  assert.equal(L.resolve(['aiLogo'], null), null);
  assert.equal(L.resolve(null, {aiLogo: a}), null);
});
