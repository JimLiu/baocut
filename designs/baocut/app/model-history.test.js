const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-history.js');
const H = global.window.BC_HIST;

test('空栈两头都不可用', () => {
  const h = H.create();
  assert.ok(!H.canUndo(h) && !H.canRedo(h));
  assert.equal(H.undo(h, {n: 0}), null);
  assert.equal(H.redo(h, {n: 0}), null);
});

test('push 记一条并清空 future', () => {
  let h = H.push(H.create(), {n: 0});
  const back = H.undo(h, {n: 1});
  assert.deepEqual(back.snap, {n: 0});
  assert.ok(H.canRedo(back.h));
  h = H.push(back.h, {n: 9});
  assert.ok(!H.canRedo(h));
});

test('undo / redo 往返回到同一处', () => {
  let h = H.push(H.push(H.create(), {n: 0}), {n: 1});
  const u1 = H.undo(h, {n: 2});
  assert.deepEqual(u1.snap, {n: 1});
  const u2 = H.undo(u1.h, u1.snap);
  assert.deepEqual(u2.snap, {n: 0});
  assert.ok(!H.canUndo(u2.h));
  const r1 = H.redo(u2.h, u2.snap);
  assert.deepEqual(r1.snap, {n: 1});
  const r2 = H.redo(r1.h, r1.snap);
  assert.deepEqual(r2.snap, {n: 2});
  assert.ok(!H.canRedo(r2.h));
});

test('上限从最老的一端丢', () => {
  let h = H.create();
  for (let i = 0; i < 5; i++) h = H.push(h, {n: i}, 3);
  assert.equal(H.depth(h), 3);
  assert.deepEqual(h.past[0], {n: 2});
  let hh = H.create();
  for (let i = 0; i < 120; i++) hh = H.push(hh, {n: i});
  assert.equal(H.depth(hh), H.LIMIT);
});

/* 第 122 轮验收补的一条守门测试：**离散写入必须记快照**。
   `editor-elements.jsx` 是视图层，没法在这一层跑起来，但「哪几个写口子进历史栈」
   是纯粹的源码事实，读源码断言即可（同 data-elements / model-svgfill 两处的做法）。
   挡住的具体回归：`setElStyle` 曾是唯一不 `mark()` 的写口，于是改完颜色按 ⌘Z，
   撤掉的是**上一件事**（刚新建的那条元素），颜色纹丝不动。 */
const fs = require('node:fs');
const path = require('node:path');
test('元素 store 的每个离散写口都记一条历史快照', () => {
  const src = fs.readFileSync(path.join(__dirname, 'editor-elements.jsx'), 'utf8');
  ['setElDoc', 'setElPose', 'setElStyle'].forEach((name) => {
    const i = src.indexOf('const ' + name + ' = useCallback(');
    assert.ok(i > 0, name + ' 不见了：写口改了名就得同步这条测试');
    const j = src.indexOf('\n    const ', i + 1);
    const body = src.slice(i, j < 0 ? src.length : j);
    assert.match(body, /\bmark\(/, name + ' 没有 mark() —— ⌘Z 会跳过它去撤上一件事');
  });
});
