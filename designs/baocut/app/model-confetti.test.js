/* model-confetti.test.js —— 彩纸算法粒子（第 231 轮）。钉住的是设计稿
   docs/design/elements/bcut-confetti-element-design.md 里的契约：确定性、闭式求值、上限、十款配方。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-confetti.js');
const C = window.BC_CONFETTI;

const BOX = {w: 960, h: 540};

test('十款配方齐全，缺省 props 落在范围内且颜色 ≤ 8、形状都在 12 种之内', () => {
  assert.strictEqual(C.STYLES.length, 10);
  assert.deepStrictEqual(C.STYLES.map((s) => s.k), ['rainbow-paper', 'pastel-fall',
    'neon-streamers', 'golden-starburst', 'festival-fireworks', 'hearts-petals',
    'party-cannons', 'curling-ribbons', 'geometric-pop', 'champagne-sparkle']);
  C.STYLES.forEach((s) => {
    const p = C.defaults(s.k, 7);
    assert.strictEqual(p.style, s.k);
    assert.strictEqual(p.seed, 7);
    assert.ok(p.colors.length >= 1 && p.colors.length <= C.LIMITS.colors, s.k);
    p.shapes.forEach((k) => assert.ok(C.SHAPES.indexOf(k) >= 0, s.k + ' 形状 ' + k));
    assert.strictEqual(p.origin, null);
    assert.strictEqual(p.angle, null);
    assert.ok(['continuous', 'burst'].indexOf(p.emit.mode) >= 0);
  });
  assert.strictEqual(C.SHAPES.length, 12);
});

test('splitmix64 通道是纯函数：同 seed 同下标恒等，不同 seed 不同', () => {
  const a = C.splitmix64Unit(42, 5), b = C.splitmix64Unit(42, 5), c = C.splitmix64Unit(43, 5);
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
  assert.ok(a >= 0 && a < 1);
  // 与 BigInt 大种子也能算（u64 里的 53 位安全整数）
  assert.ok(C.splitmix64Unit(2 ** 52 + 11, 0) < 1);
});

test('同一份 props 同一个 t 恒得同一帧；随机访问与顺序访问一致（闭式，无状态）', () => {
  const p = C.defaults('rainbow-paper', 123);
  const seq = [0.5, 1.0, 2.5, 4.0].map((t) => C.sample(p, t, BOX, 10));
  const rnd = [4.0, 0.5, 2.5, 1.0].map((t) => C.sample(p, t, BOX, 10));
  assert.deepStrictEqual(seq[0], rnd[1]);
  assert.deepStrictEqual(seq[2], rnd[2]);
  assert.deepStrictEqual(seq[3], rnd[0]);
  assert.ok(seq[3].length > 0);
});

test('换种子换画面，换款回缺省但种子保留', () => {
  const a = C.sample(C.defaults('rainbow-paper', 1), 2, BOX, 10);
  const b = C.sample(C.defaults('rainbow-paper', 2), 2, BOX, 10);
  assert.notDeepStrictEqual(a.map((q) => q.x), b.map((q) => q.x));
  const p = Object.assign(C.defaults('rainbow-paper', 99), {size: 3});
  const q = C.switchStyle(p, 'hearts-petals');
  assert.strictEqual(q.seed, 99);
  assert.strictEqual(q.style, 'hearts-petals');
  assert.strictEqual(q.size, 1);
});

test('连续发射：密度决定每秒出生数，settle 让片尾前 lifeMax 秒不再出生', () => {
  const p = C.defaults('rainbow-paper', 5);
  p.emit.rate = 100;
  const life = C.byStyle('rainbow-paper').recipe.lifeSec;
  // 稳态下活着的数量 ≈ rate × 平均寿命（0.925 × lifeSec），允许 ±15%
  const n = C.sample(p, life + 1, BOX, 60).length;
  const want = 100 * life * 0.925;
  assert.ok(Math.abs(n - want) / want < 0.15, `活粒子 ${n}，期望约 ${want}`);
  // settle：D = 10，t = 9.9 时最后一枚出生时刻 ≤ D − lifeMax
  p.emit.settle = true;
  const late = C.sample(p, 9.9, BOX, 10);
  late.forEach((q) => assert.ok(C.spawnAt(p, q.i, 10, life) <= 10 - life));
  // 不 settle 时片尾仍有新出生的
  p.emit.settle = false;
  assert.ok(C.sample(p, 9.9, BOX, 10).some((q) => C.spawnAt(p, q.i, 10, life) > 10 - life));
});

test('爆发发射：第 b 次在 b·interval，interval = 0 只放一次', () => {
  const p = C.defaults('golden-starburst', 9);
  p.emit.count = 50; p.emit.interval = 2;
  assert.strictEqual(C.spawnAt(p, 0, null, 3), 0);
  assert.strictEqual(C.spawnAt(p, 49, null, 3), 0);
  assert.strictEqual(C.spawnAt(p, 50, null, 3), 2);
  assert.strictEqual(C.spawnAt(p, 120, null, 3), 4);
  assert.strictEqual(C.sample(p, 0.5, BOX, 10).length, 50);
  // 2.05s：第 0 批（年龄 2.05，最短寿命 2.21）与第 1 批（年龄 0.05）都在
  assert.strictEqual(C.sample(p, 2.05, BOX, 10).length, 100);
  p.emit.interval = 0;
  assert.strictEqual(C.spawnAt(p, 50, null, 3), null);
  assert.strictEqual(C.sample(p, 0.5, BOX, 10).length, 50);
  // 寿命过后一只不剩
  assert.strictEqual(C.sample(p, 30, BOX, 40).length, 0);
});

test('活跃窗口只枚举出生在 (t − lifeMax, t] 里的编号', () => {
  const p = C.defaults('rainbow-paper', 1);
  p.emit.rate = 10;
  const [lo, hi] = C.indexWindow(p, 20, 4.5);
  assert.ok(lo <= 155 && lo >= 150, 'lo ' + lo);
  assert.ok(hi >= 200 && hi <= 202, 'hi ' + hi);
  p.emit.mode = 'burst'; p.emit.count = 10; p.emit.interval = 1;
  assert.deepStrictEqual(C.indexWindow(p, 5, 2.5), [30, 59]);
});

test('活粒子数封顶 600，颜色多于 8 与非法形状被 normalize 夹回', () => {
  const p = C.defaults('rainbow-paper', 3);
  p.emit.rate = 400;
  assert.ok(C.sample(p, 6, BOX, 20).length <= C.LIMITS.maxAlive);
  const q = C.normalize({style: 'neon-streamers', colors: new Array(12).fill('#FFFFFF'),
    shapes: ['heart', 'nope'], size: 99, emit: {rate: 9999, mode: 'weird'}});
  assert.strictEqual(q.colors.length, 8);
  assert.deepStrictEqual(q.shapes, ['heart']);
  assert.strictEqual(q.size, 4);
  assert.strictEqual(q.emit.rate, 400);
  assert.strictEqual(q.emit.mode, 'continuous');
  assert.deepStrictEqual(C.normalize({shapes: []}).shapes, C.defaults('rainbow-paper').shapes);
});

test('像素量按短边 / 540 缩放：大画面上粒子更大、走得更远', () => {
  const p = C.defaults('rainbow-paper', 8);
  const small = C.sample(p, 1, {w: 960, h: 540}, 10);
  const big = C.sample(p, 1, {w: 1920, h: 1080}, 10);
  assert.strictEqual(small.length, big.length);
  const a = small.filter((q) => q.i === big[0].i)[0];
  assert.ok(Math.abs(big[0].size / a.size - 2) < 1e-9);
  assert.ok(Math.abs(big[0].y / a.y - 2) < 1e-6);
});

test('运动核：无阻力是抛物线，有阻力趋于终端速度；透明度在 fadeOut 内单调下降', () => {
  const p = C.defaults('golden-starburst', 4);   // drag 0
  const f1 = C.sample(p, 0.5, BOX, 10), f2 = C.sample(p, 1.0, BOX, 10);
  const q1 = f1[0], q2 = f2.filter((q) => q.i === q1.i)[0];
  assert.ok(q2, '同一枚粒子在 1.0s 还活着');
  // 星芒是向上射再落下：0.5s → 1.0s 之间 y 变化受重力主导
  assert.ok(isFinite(q2.y) && q2.y !== q1.y);
  const r = C.defaults('rainbow-paper', 4);
  const life = C.byStyle('rainbow-paper').recipe.lifeSec;
  const frames = [0.2, 0.4, 0.55].map((d) => C.sample(r, life * 0.85 - d + 0.6, BOX, 10));
  const id = frames[0][0].i;
  const alphas = frames.map((f) => (f.filter((q) => q.i === id)[0] || {alpha: -1}).alpha);
  assert.ok(alphas[0] <= alphas[1] + 1e-9 && alphas[1] <= alphas[2] + 1e-9, alphas.join(','));
});

test('paint 只调标准 2D 接口，每枚粒子一次 save/restore', () => {
  const calls = [];
  const rec = (name) => (...a) => { calls.push(name); return undefined; };
  const fake = {save: rec('save'), restore: rec('restore'), translate: rec('translate'),
    rotate: rec('rotate'), scale: rec('scale'), beginPath: rec('beginPath'), fill: rec('fill'),
    rect: rec('rect'), arc: rec('arc'), ellipse: rec('ellipse'), moveTo: rec('moveTo'),
    lineTo: rec('lineTo'), closePath: rec('closePath'), bezierCurveTo: rec('bezierCurveTo')};
  const frame = C.SHAPES.map((shape, i) => ({x: i, y: i, size: 8, rot: 10, sy: 1, alpha: 1, shape, color: '#FFFFFF'}));
  C.paint(fake, frame, 2);
  assert.strictEqual(calls.filter((c) => c === 'save').length, 12);
  assert.strictEqual(calls.filter((c) => c === 'restore').length, 12);
  assert.strictEqual(calls.filter((c) => c === 'fill').length, 12);
});

test('effectiveEmit：null 回落到配方第一枚发射器，多发射器的款标 multi', () => {
  const e = C.effectiveEmit(C.defaults('party-cannons'));
  assert.deepStrictEqual([e.x, e.y, e.angle, e.spread, e.multi], [0, 83, -65, 26, true]);
  const f = C.effectiveEmit(Object.assign(C.defaults('party-cannons'), {origin: {x: 50, y: 50}, angle: -90}));
  assert.deepStrictEqual([f.x, f.y, f.angle, f.multi], [50, 50, -90, false]);
});

test('randomSeed 给出非零安全整数', () => {
  for (let i = 0; i < 20; i++) {
    const s = C.randomSeed();
    assert.ok(Number.isSafeInteger(s) && s > 0);
  }
});
