/* model-textanim.js —— 逐帧求值的边界。这一层的价值全在「时间点 → 画面状态」是不是
   稳的：入场结束那一刻必须完全到位，出场最后一帧必须走干净，区间外必须不画。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-textanim.js');
require('./model-textpresets.js');
const TA = window.BC_TA;
const TP = window.BC_TP;

const A = (i, o, l) => ({in: i || {k: 'none'}, out: o || {k: 'none'}, loop: l || {k: 'none'}});

test('区间之外不画（带动画的元素在自己的时间段外本来就该看不见）', () => {
  const a = A({k: 'fade', dur: 0.6});
  assert.ok(TA.at(a, -0.01, 4).hidden);
  assert.ok(TA.at(a, 4.01, 4).hidden);
  assert.ok(!TA.at(a, 0, 4).hidden);
  assert.ok(!TA.at(a, 4, 4).hidden);
});

test('三个槽全是「无」= 静止的，画布靠它决定一直画着', () => {
  assert.ok(TA.isStatic(A()));
  assert.ok(TA.isStatic(null));
  assert.ok(!TA.isStatic(A({k: 'fade'})));
  assert.ok(!TA.isStatic(A(null, null, {k: 'rotate'})));
});

test('入场结束那一刻完全到位：不透明度 1、无位移、无缩放', () => {
  ['fade', 'slide', 'zoom', 'ascent', 'stomp', 'burst', 'compress', 'block', 'scale',
   'flipboard', 'billboard', 'roll', 'skid', 'bounce', 'wave', 'fall', 'dragonfly'].forEach((k) => {
    const s = TA.at(A({k: k, dur: 0.6}), 0.6, 4);
    assert.strictEqual(Math.round(s.op * 1000) / 1000, 1, k + ' 收尾时还没不透明');
    assert.ok(Math.abs(s.tx) < 0.01 && Math.abs(s.ty) < 0.01, k + ' 收尾时还有位移');
    assert.ok(Math.abs(s.sx - 1) < 0.01 && Math.abs(s.sy - 1) < 0.01, k + ' 收尾时还有缩放');
    assert.ok(Math.abs(s.rot) < 0.01 && Math.abs(s.rotX) < 0.01 && Math.abs(s.rotY) < 0.01,
      k + ' 收尾时还有旋转');
  });
});

test('入场第一帧是「还没进来」：要么透明，要么在框外', () => {
  ['fade', 'slide', 'zoom', 'ascent', 'stomp', 'block'].forEach((k) => {
    const s = TA.at(A({k: k, dur: 0.6}), 0, 4);
    const away = s.op < 0.2 || Math.abs(s.tx) > 50 || Math.abs(s.ty) > 30 || s.clip;
    assert.ok(away, k + ' 的第一帧看不出「还没进来」');
  });
});

test('出场最后一帧走干净', () => {
  ['fade', 'slide', 'zoom', 'ascent', 'burst', 'scale', 'roll'].forEach((k) => {
    const s = TA.at(A(null, {k: k, dur: 0.5}), 4, 4);
    assert.ok(s.op < 0.01, k + ' 出场结束还看得见');
  });
});

test('入场与出场不重叠：出场一开始就以出场为准', () => {
  const s = TA.at(A({k: 'fade', dur: 0.6}, {k: 'slide', dir: 'left', dur: 0.5}), 3.75, 4);
  assert.ok(s.tx < 0, '半程应当已经往左走了');
  assert.ok(s.op < 1);
});

test('中段（入场之后、出场之前）是完全到位的静态帧', () => {
  const s = TA.at(A({k: 'zoom', dur: 0.6}, {k: 'fade', dur: 0.5}), 2, 4);
  assert.deepStrictEqual({op: s.op, tx: s.tx, sx: s.sx}, {op: 1, tx: 0, sx: 1});
});

test('loop 是叠在基态上的：位移相加、缩放相乘，不动不透明度', () => {
  const s = TA.at(A(null, null, {k: 'scale', dur: 2}), 0.5, 10);
  assert.ok(Math.abs(s.sx - 1.07) < 0.001, '四分之一相位正好是峰值');
  assert.strictEqual(s.op, 1);
  const r = TA.at(A(null, null, {k: 'rotate', dur: 2}), 1, 10);
  assert.strictEqual(r.rot, 180);
});

test('loop 一轮走完回到原处', () => {
  ['rotate', 'wavey', 'scale', 'heartBeat', 'vogue', 'dragonfly', 'billboard', 'roll'].forEach((k) => {
    const a = TA.at(A(null, null, {k: k, dur: 2}), 0, 10);
    const b = TA.at(A(null, null, {k: k, dur: 2}), 2, 10);
    assert.deepStrictEqual([b.tx, b.ty, b.sx, b.sy], [a.tx, a.ty, a.sx, a.sy], k + ' 一轮之后没回到原处');
  });
});

test('打字机按字符数露出，与核心的 PartUnit::Char 同口径', () => {
  assert.strictEqual(TA.revealText('一二三四', 0), '');
  assert.strictEqual(TA.revealText('一二三四', 0.5), '一二');
  assert.strictEqual(TA.revealText('一二三四', 0.26), '二'.length ? '一二' : '');
  assert.strictEqual(TA.revealText('一二三四', 1), '一二三四');
  assert.strictEqual(TA.revealText(null, 0.5), '');
});

test('擦除的裁剪框四个方向都露对了边', () => {
  assert.strictEqual(TA.wipeClip('right', 0), 'inset(0 100% 0 0)');
  assert.strictEqual(TA.wipeClip('right', 1), 'inset(0 0% 0 0)');
  assert.strictEqual(TA.wipeClip('left', 0), 'inset(0 0 0 100%)');
  assert.strictEqual(TA.wipeClip('up', 0), 'inset(0 0 100% 0)');
  assert.strictEqual(TA.wipeClip('down', 0), 'inset(100% 0 0 0)');
});

test('滑入的方向是从哪一侧来，滑出的方向是往哪一侧去（第 156 轮，与核心 slideL/R/Up/Down 同义）', () => {
  const from = (dir) => TA.at(A({k: 'slide', dir: dir, dur: 0.6}), 0, 4);
  assert.ok(from('left').tx < 0, '左 = 从左边来（起点在左）');
  assert.ok(from('right').tx > 0, '右 = 从右边来');
  assert.ok(from('up').ty < 0, '上 = 从上面来');
  assert.ok(from('down').ty > 0);
  const to = (dir) => TA.at(A(null, {k: 'slide', dir: dir, dur: 0.6}), 3.9, 4);
  assert.ok(to('left').tx < 0, '左 = 往左边去');
  assert.ok(to('right').tx > 0);
  assert.ok(to('up').ty < 0, '上 = 往上面去');
  assert.ok(to('down').ty > 0);
});

test('css() 只写非恒等的那几项', () => {
  assert.deepStrictEqual(TA.css(TA.ID), {});
  const c = TA.css(TA.at(A({k: 'fade', dur: 0.6}), 0.3, 4));
  assert.ok(c.opacity > 0 && c.opacity < 1);
  assert.ok(!c.transform, '淡入不该产出 transform');
  assert.ok(/^translate\(-50%, -50%\)/.test(TA.css(TA.at(A({k: 'slide', dur: 0.6}), 0.2, 4),
    'translate(-50%, -50%)').transform), '基准变换要排在最前面');
});

test('预设里的动画拿过来能直接求值（两层之间没有断口）', () => {
  const p = TP.get('lowerThird.01');
  p.els.forEach((e) => {
    const a = TP.animOf(e);
    const s = TA.at(a, 0.3, p.dur - (e.d || 0));
    assert.ok(typeof s.op === 'number' && !Number.isNaN(s.op), p.id + ' 求不出不透明度');
  });
});
