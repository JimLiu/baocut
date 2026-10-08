const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-subanim.js');
require('./model-subinspector.js');
const I = window.BC_SI;

test('常用优先但19种动画全部可达且没有重复', () => {
  const groups = I.groups(window.BC_SA.ANIMS);
  assert.equal(groups[0].items.length, 6);
  const keys = groups.flatMap((g) => g.items.map((a) => a.k));
  assert.equal(new Set(keys).size, 19);
  assert.deepEqual(keys.slice().sort(), window.BC_SA.ANIMS.map((a) => a.k).sort());
});
test('颜色控件遵循动画真实用途：卡拉OK无颜色，色块与字色分开', () => {
  assert.equal(I.colourLabel('karaoke'), null);
  assert.equal(I.colourLabel('none'), null);
  assert.equal(I.colourLabel('colourHighlight'), '当前词颜色');
  assert.equal(I.colourLabel('rotateHighlight'), '当前词颜色');
  assert.equal(I.colourLabel('paint'), '已读词颜色');
  assert.equal(I.colourLabel('boxHighlight'), '高亮背景色');
});
test('关闭后恢复原有动画或整套配方，不换成卡拉OK', () => {
  for (const old of [{wordAnim: 'dropIn', caption: null}, {wordAnim: 'none', caption: 'custom-caption'}]) {
    const off = I.toggleAnimation(old, false, old);
    assert.deepEqual(off, {wordAnim: 'none', caption: null});
    assert.deepEqual(I.toggleAnimation(off, true, old), old);
  }
  assert.equal(I.toggleAnimation({wordAnim: 'none'}, true).wordAnim, 'karaoke');
});
test('手动强调只作用于所选字幕中的指定词，不污染同名词或其他字幕', () => {
  const original = {on: true, marks: {}};
  const h = {...original, marks: I.toggleMark(original, 'cue-1', '字幕', 2)};
  assert.equal(I.isMarked(h, 'cue-1', '字幕', 2), true);
  assert.equal(I.isMarked(h, 'cue-1', '字幕', 3), false);
  assert.equal(I.isMarked(h, 'cue-2', '字幕', 2), false);
  assert.deepEqual(original.marks, {});
  assert.equal(I.isMarked({...h, on: false}, 'cue-1', '字幕', 2), false);
  assert.deepEqual(I.toggleMark(h, 'cue-1', '字幕', 2), {});
});
test('改写词语后旧强调标记不落到新词上', () => {
  const h = {on: true, marks: {'cue-1': [{index: 2, text: '字幕'}]}};
  assert.equal(I.isMarked(h, 'cue-1', '声音', 2), false);
});
