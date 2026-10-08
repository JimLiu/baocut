const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-loudness.js');
const L = global.window.BC_LOUD;

test('缺省关，打开后 −16 LUFS / −1.2 dBTP', () => {
  assert.equal(L.DEFAULT.on, false);
  assert.deepEqual(L.options(L.DEFAULT), {});
  assert.deepEqual(L.options({...L.DEFAULT, on: true}), {loudness: -16, truePeak: -1.2});
});

test('数值夹进内核范围', () => {
  assert.deepEqual(L.options({on: true, lufs: -90, truePeak: 3}), {loudness: -70, truePeak: 0});
});

test('排版减号，小数只在需要时出现', () => {
  assert.equal(L.fmtDb(-16), '−16');
  assert.equal(L.fmtDb(-1.2), '−1.2');
  assert.equal(L.fmtDb(0), '0');
});

test('下拉档：当前值不在常用档里时补进去', () => {
  assert.deepEqual(L.choices(L.LUFS_CHOICES, -18), [-14, -16, -18, -19, -23, -24]);
  assert.deepEqual(L.choices(L.LUFS_CHOICES, -16), [-14, -16, -19, -23, -24]);
});

test('说明句：App 提光速修正，Web 不提；开着不走光速修正', () => {
  const on = {on: true, lufs: -16, truePeak: -1.2};
  assert.match(L.note(on, true), /光速修正/);
  assert.doesNotMatch(L.note(on, false), /光速修正/);
  assert.match(L.note(L.DEFAULT, true), /原样导出/);
  assert.equal(L.allowsFlash(on), false);
  assert.equal(L.allowsFlash(L.DEFAULT), true);
});
