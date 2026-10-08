/* model-keyframes.js —— 整段运动 / 多段只读判据、缓动公式、取样、露底、dB、闪避与背景三档。
   缓动数字按 `core/crates/bcut-motion/src/curve.rs` 的公式手算；改公式两端一起改。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-keyframes.js');
const K = global.window.BC_KF;

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

/* 夹具 e-img 的五帧（data.js 同形） */
const FIVE = {y: [
  {t: '0%', v: 68}, {t: '25%', v: 60, ease: 'easeOutCubic'}, {t: '50%', v: 68},
  {t: '75%', v: 60, ease: 'easeOutCubic'}, {t: '100%', v: 68},
]};

test('属性闭集与缓动闭集', () => {
  assert.deepStrictEqual(K.PROPS, ['x', 'y', 'scale', 'scaleY', 'rot', 'opacity', 'radius', 'volume']);
  assert.strictEqual(K.EASE_NAMES.length, 20);
  K.EASE_MENU.forEach((m) => assert.ok(K.EASE_NAMES.includes(m.k), m.k));
});

test('缓动公式端点与抽样值', () => {
  K.EASE_NAMES.forEach((n) => {
    assert.ok(close(K.ease(n, 0), 0, 1e-9), n + '@0');
    assert.ok(close(K.ease(n, 1), 1, 1e-9), n + '@1');
  });
  assert.ok(close(K.ease('easeOutCubic', 0.5), 0.875));
  assert.ok(close(K.ease('easeInOutSine', 0.5), 0.5));
  assert.ok(K.ease('easeOutBack', 0.7) > 1, '回弹越过终点');
  assert.strictEqual(K.ease('noSuchEase', 0.3), 0.3, '未知名字回落恒等');
});

test('只读判据：多于两帧、或时刻不是字面 0% / 100%', () => {
  assert.strictEqual(K.rowState({}, 'x'), 'none');
  assert.strictEqual(K.rowState({x: K.twoFrames(10, 20)}, 'x'), 'simple');
  assert.strictEqual(K.rowState(FIVE, 'y'), 'multi');
  assert.strictEqual(K.rowState({x: [{t: 0, v: 1}, {t: 2, v: 3}]}, 'x'), 'multi', '秒写法的两帧也只读');
  assert.strictEqual(K.rowState({x: [{t: '0%', v: 1}, {t: '80%', v: 3}]}, 'x'), 'multi');
  assert.strictEqual(K.rowState({x: [{t: '0%', v: 1}]}, 'x'), 'multi', '单帧只读');
  assert.strictEqual(K.count(FIVE, 'y'), 5);
  assert.strictEqual(K.total(FIVE), 5);
  assert.ok(K.any(FIVE));
  assert.ok(!K.any({}) && !K.any(null));
});

test('两帧写法：ease 写在止帧上，线性不写', () => {
  assert.deepStrictEqual(K.twoFrames(1, 1.2), [{t: '0%', v: 1}, {t: '100%', v: 1.2}]);
  assert.deepStrictEqual(K.twoFrames(1, 1.2, 'linear'), [{t: '0%', v: 1}, {t: '100%', v: 1.2}]);
  assert.deepStrictEqual(K.twoFrames(0, 1, 'easeOutBack'), [{t: '0%', v: 0}, {t: '100%', v: 1, ease: 'easeOutBack'}]);
});

test('验收：缩放 1 → 1.2（原先没有帧，另一端取静态值）', () => {
  let kf = K.editEnd(null, 'scale', 1, 1.2, 1);
  assert.deepStrictEqual(kf, {scale: [{t: '0%', v: 1}, {t: '100%', v: 1.2}]});
  kf = K.editEase(kf, 'scale', 'easeOutCubic', 1);
  assert.deepStrictEqual(kf.scale[1], {t: '100%', v: 1.2, ease: 'easeOutCubic'});
  kf = K.editEnd(kf, 'scale', 0, 0.9, 1);
  assert.deepStrictEqual(kf.scale, [{t: '0%', v: 0.9}, {t: '100%', v: 1.2, ease: 'easeOutCubic'}], '改起点保留止帧缓动');
});

test('验收：五帧文档上改不透明度，y 的五帧原样', () => {
  const before = JSON.parse(JSON.stringify(FIVE));
  let kf = K.editEnd(FIVE, 'opacity', 0, 0, 1);
  kf = K.editEnd(kf, 'opacity', 1, 1, 1);
  assert.deepStrictEqual(kf.y, before.y);
  assert.strictEqual(kf.y, FIVE.y, '同一数组引用，没被重建');
  assert.deepStrictEqual(FIVE, before, '不改入参');
  assert.deepStrictEqual(kf.opacity, [{t: '0%', v: 0}, {t: '100%', v: 1}]);
  const cleared = K.clearProp(kf, 'opacity');
  assert.deepStrictEqual(cleared, before);
});

test('多段行上改一端会被整段运动取代（界面只在 simple 行给编辑框，这里锁住语义）', () => {
  const kf = K.editEnd(FIVE, 'y', 1, 50, 68);
  assert.deepStrictEqual(kf.y, [{t: '0%', v: 68}, {t: '100%', v: 50}]);
});

test('清空最后一个属性 → null（字段缺席）', () => {
  assert.strictEqual(K.clearProp({x: K.twoFrames(1, 2)}, 'x'), null);
  assert.strictEqual(K.setProp(null, 'x', []), null);
});

test('取样：两端外取端值、段内用目标帧缓动、秒与百分比混写', () => {
  const f = [{t: '0%', v: 0}, {t: '100%', v: 10, ease: 'easeOutCubic'}];
  assert.strictEqual(K.sample(f, -1, 4), 0);
  assert.strictEqual(K.sample(f, 9, 4), 10);
  assert.ok(close(K.sample(f, 2, 4), 8.75));
  const mixed = [{t: 1, v: 0}, {t: '50%', v: 10}];
  assert.strictEqual(K.sample(mixed, 0, 10), 0);
  assert.ok(close(K.sample(mixed, 3, 10), 5));
  assert.strictEqual(K.tOf('25%', 8), 2);
  assert.strictEqual(K.tOf(1.5, 8), 1.5);
  const p = K.poseAt({x: 50, y: 50, scale: 1, rot: 0, opacity: 1}, FIVE, 2.5, 10);
  assert.ok(close(p.y, 60));
  assert.strictEqual(p.x, 50);
});

test('露底：静态盖满、运动中露出 → 回报最早时刻；放大 / 没盖满的不报', () => {
  const frame = {w: 1920, h: 1080};
  const full = {x: 50, y: 50, w: 1920, h: 1080, scale: 1, rot: 0};
  assert.strictEqual(K.uncovered(full, null, 4, frame), null);
  assert.strictEqual(K.uncovered(full, {scale: K.twoFrames(1, 1.2)}, 4, frame), null, '放大仍盖满');
  const shrink = K.uncovered(full, {scale: K.twoFrames(1, 0.8)}, 4, frame);
  assert.ok(shrink && shrink.t > 0 && shrink.t <= 0.2, JSON.stringify(shrink));
  assert.ok(close(shrink.worst, 17.8, 0.05), '缩到 0.8：左右各差 192 px = 短边 1080 的 17.8%');
  assert.ok(shrink.worst >= shrink.gap);
  const pan = K.uncovered(full, {x: K.twoFrames(50, 60)}, 4, frame);
  assert.ok(pan && pan.gap > 0);
  const small = {x: 50, y: 50, w: 400, h: 300, scale: 1, rot: 0};
  assert.strictEqual(K.uncovered(small, {x: K.twoFrames(10, 90)}, 4, frame), null, '静态本就没盖满不检查');
  const big = {x: 50, y: 50, w: 1920 * 1.3, h: 1080 * 1.3, scale: 1.3, rot: 0};
  assert.ok(K.uncovered(big, {rot: K.twoFrames(0, 20)}, 4, frame), '转 20° 露角');
});

test('dB 换算：线性倍数 ↔ dB，0 = −∞', () => {
  assert.strictEqual(K.toDb(1), 0);
  assert.ok(close(K.toDb(2), 6.0206, 1e-4));
  assert.strictEqual(K.toDb(0), -Infinity);
  assert.ok(close(K.fromDb(-6.0206), 0.5, 1e-4));
  assert.strictEqual(K.fromDb(-Infinity), 0);
  assert.strictEqual(K.fmtDb(1), '0.0 dB');
  assert.strictEqual(K.fmtDb(0.5), '−6.0 dB');
  assert.strictEqual(K.fmtDb(2), '+6.0 dB');
  assert.strictEqual(K.fmtDb(0), '−∞ dB');
});

test('闪避：只写动过的字段，关掉 = null，人声无文稿不生效', () => {
  let d = K.duckSet(null, {under: 'speech'});
  assert.deepStrictEqual(d, {under: 'speech'});
  assert.strictEqual(K.duckField(d, 'depth'), K.DUCK_SHOWN.depth, '缺席显示示意值');
  d = K.duckSet(d, {depth: 18});
  assert.deepStrictEqual(d, {under: 'speech', depth: 18});
  d = K.duckSet(d, {depth: null});
  assert.deepStrictEqual(d, {under: 'speech'}, '回到缺省 = 删字段');
  assert.strictEqual(K.duckSet(d, null), null);
  assert.ok(K.duckIdle({under: 'speech'}, false));
  assert.ok(!K.duckIdle({under: 'speech'}, true));
  assert.ok(!K.duckIdle({under: 'music'}, false));
  assert.ok(!K.duckOn({under: 'none'}));
});

test('背景三档：blur | black | #RRGGBB', () => {
  assert.deepStrictEqual(K.bgMode(undefined), {mode: 'blur', color: null});
  assert.deepStrictEqual(K.bgMode('black'), {mode: 'black', color: null});
  /* @ds-allow: 画布背景色（视频内容色）的回归断言 */
  assert.deepStrictEqual(K.bgMode('#1a2b3c'), {mode: 'color', color: '#1A2B3C'});
  assert.deepStrictEqual(K.bgMode('red'), {mode: 'blur', color: null}, '认不出的当缺省');
  /* @ds-allow: 画布背景色（视频内容色）的回归断言 */
  assert.strictEqual(K.bgValue('color', '#abcdef'), '#ABCDEF');
  assert.strictEqual(K.bgValue('color', null), '#FFFFFF');
  assert.strictEqual(K.bgValue('black'), 'black');
  /* @ds-allow: 画布背景色（视频内容色）的回归断言 */
  assert.strictEqual(K.bgValue('blur', '#123456'), 'blur');
  assert.strictEqual(K.bgFill('blur', 'gray'), 'gray');
  assert.strictEqual(K.bgFill('black'), '#000000');
  /* @ds-allow: 画布背景色（视频内容色）的回归断言 */
  assert.strictEqual(K.bgFill('#00FF00'), '#00FF00');
});
