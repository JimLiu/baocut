/* node --test designs/baocut/app/model-sceneadjust.test.js
   钉 caption-editor-redesign §5 / §6 在原型里的替身：颜色规范化与保留透明度、按值换色覆盖
   状态与动画、落位只改常量（参数驱动的报 CAPTION_ADJUST_UNSUPPORTED）、还原就是删掉 adjust、
   摘要的字段与排序、seed 换一版、`toPaint` 折成轨键。 */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-captionsurface.js');
require('./model-subpresets-rich.js');
require('./model-captionstyle.js');
require('./model-sceneadjust.js');
const A = window.BC_ADJ;

const scene = () => ({
  fonts: [{key: 'f0', family: 'Bangers', weight: 400, tunedSpacing: true}, {key: 'f1', family: 'Inter', weight: 700}],
  text: {upper: true, spacing: 4, lh: 105},
  paints: [
    {kind: 'glow', color: '#FF2BD6', radius: 0.4, strength: 0.9},
    {kind: 'shadow', color: '#00000080', offset: [0, 0.06], blur: 0.1},
    {kind: 'stroke', color: '#000000', width: 0.07},
    {kind: 'stroke', color: '#FFFFFF', width: 0.04},
    {kind: 'fill', color: '#FFD23F'},
  ],
  states: {active: {mode: 'color', color: '#FF4D8D'}, keyword: {color: '#FFE600', font: 'f1', scale: 1.4}},
  animation: {in: 'pop', colors: ['#FF4D8D', '#00FFAA']},
  wordTags: ['keyword'],
  layout: {x: 0.5, y: {param: 'baseline'}, width: 0.86},
});

test('颜色比较前规范成 #RRGGBBAA；to 没写透明度时保留原色的透明度', () => {
  assert.strictEqual(A.normColor('#abc'), '#AABBCCFF');
  assert.strictEqual(A.normColor('#00000080'), '#00000080');
  assert.strictEqual(A.normColor('red'), null);
  assert.strictEqual(A.swap('#00000080', '#FF0000'), '#FF000080');
  assert.strictEqual(A.swap('#00000080', '#FF0000CC'), '#FF0000CC');
});

test('按值换色：同一个值在涂装、状态、动画关键帧里一起换', () => {
  const adj = A.withColor(null, '#ff4d8d', '#00FF00');
  assert.deepStrictEqual(adj.colors, [{from: '#FF4D8D', to: '#00FF00'}]);
  const s = A.apply(scene(), adj);
  assert.strictEqual(s.states.active.color, '#00FF00');
  assert.deepStrictEqual(s.animation.colors, ['#00FF00', '#00FFAA']);
  assert.strictEqual(s.paints[4].color, '#FFD23F');
  /* 带透明度的阴影色换成不带透明度的值，透明度留着 */
  const t = A.apply(scene(), A.withColor(null, '#00000080', '#3344FF'));
  assert.strictEqual(t.paints[1].color, '#3344FF80');
});

test('同一个 from 只留一条；换回原色等于没调；全部还原后 adjust 为 null', () => {
  let adj = A.withColor(null, '#FFD23F', '#111111');
  adj = A.withColor(adj, '#FFD23F', '#222222');
  assert.strictEqual(adj.colors.length, 1);
  assert.strictEqual(adj.colors[0].to, '#222222');
  assert.strictEqual(A.withColor(adj, '#FFD23F', '#FFD23F'), null);
  assert.strictEqual(A.clean({fontScale: 1, colors: [], placement: {}}), null);
  assert.strictEqual(A.isAdjusted(null), false);
});

test('换字体按字体键；字号倍率夹在 50%–200%', () => {
  const adj = A.withFont(null, 'f0', {family: 'Anton', weight: 400});
  const s = A.apply(scene(), adj);
  assert.strictEqual(s.fonts[0].family, 'Anton');
  assert.strictEqual(s.fonts[1].family, 'Inter');
  assert.strictEqual(A.withScale(null, 3).fontScale, 2);
  assert.strictEqual(A.withScale(null, 0.1).fontScale, 0.5);
  assert.strictEqual(A.withScale(null, 1), null);
  assert.strictEqual(A.withFont(adj, 'f0', null), null);
});

test('落位只覆盖常量；参数驱动的那一项报 CAPTION_ADJUST_UNSUPPORTED，其余照常生效', () => {
  const adj = A.withPlacement(null, {x: 0.3, y: 0.2});
  const s = A.apply(scene(), adj);
  assert.strictEqual(s.layout.x, 0.3);
  assert.deepStrictEqual(s.layout.y, {param: 'baseline'});
  const d = A.diagnostics(scene(), adj);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].code, 'CAPTION_ADJUST_UNSUPPORTED');
  assert.strictEqual(d[0].field, 'placement.y');
  assert.deepStrictEqual(A.placeable(scene()), ['x', 'width']);
});

test('apply 不改模板本身；没有 adjust 时原样返回', () => {
  const s0 = scene();
  const before = JSON.stringify(s0);
  A.apply(s0, A.withColor(A.withFont(null, 'f0', {family: 'Anton'}), '#FFD23F', '#000000'));
  assert.strictEqual(JSON.stringify(s0), before);
  assert.strictEqual(A.apply(s0, null), s0);
});

test('摘要（§6）：颜色按值聚合、带用途与动画标记，按用途组排序；字体带字距提示与文字系统', () => {
  const s = A.describe(scene(), null, {fontScripts: (f) => (f === 'Inter' ? ['Latn', 'Cyrl'] : ['Latn'])});
  assert.deepStrictEqual(s.colors.map((c) => c.value), ['#FFD23F', '#000000', '#FFFFFF', '#00000080', '#FF2BD6', '#FF4D8D', '#00FFAA', '#FFE600']);
  const pink = s.colors.find((c) => c.value === '#FF4D8D');
  assert.deepStrictEqual(pink.uses, ['active']);
  assert.strictEqual(pink.animated, true);
  assert.strictEqual(s.colors[0].animated, false);
  assert.deepStrictEqual(s.fonts.map((f) => [f.key, f.tunedSpacing, f.scripts]), [['f0', true, ['Latn']], ['f1', false, ['Latn', 'Cyrl']]]);
  assert.deepStrictEqual(s.wordTags, ['keyword']);
  assert.ok(s.behaviors.indexOf('keyword') >= 0 && s.behaviors.indexOf('glow') >= 0 && s.behaviors.indexOf('stroke') >= 0);
  assert.strictEqual(s.needsWordTiming, true);
  assert.strictEqual(s.seeded, false);
  assert.deepStrictEqual(s.pagination, {mode: 'auto'});
  assert.deepStrictEqual(s.layers.map((l) => l.kind), ['glow', 'shadow', 'stroke', 'stroke', 'fill']);
  assert.deepStrictEqual(s.adjustable, {colors: true, fonts: true, placement: true, fontScale: true});
});

test('摘要带着调整：每种颜色与字体给出调过之后的值，诊断一并给', () => {
  const adj = A.withPlacement(A.withFont(A.withColor(null, '#FFD23F', '#123456'), 'f1', {family: 'Anton'}), {y: 0.4});
  const s = A.describe(scene(), adj);
  assert.strictEqual(s.colors.find((c) => c.value === '#FFD23F').to, '#123456');
  assert.strictEqual(s.colors.find((c) => c.value === '#000000').to, '#000000');
  assert.strictEqual(s.fonts[1].to.family, 'Anton');
  assert.strictEqual(s.fonts[0].to, null);
  assert.strictEqual(s.diagnostics[0].field, 'placement.y');
});

test('固定词数分页与随 seed 变的模板', () => {
  const sc = Object.assign(scene(), {pagination: {mode: 'fixed', wordsPerPage: 3, rows: [1, 2]}, seeded: true,
    seedPalette: ['#111111', '#222222', '#333333']});
  const s = A.describe(sc);
  assert.deepStrictEqual(s.pagination, {mode: 'fixed', wordsPerPage: 3});
  assert.strictEqual(s.seeded, true);
  assert.ok(s.behaviors.indexOf('multiline') >= 0);
  const colors = [0, 1, 2, 3].map((seed) => A.toPaint(sc, null, {presentation: {seed}}).activeColor);
  assert.deepStrictEqual(colors, ['#111111', '#222222', '#333333', '#111111']);
});

test('不要逐词时间的模板：没有词级状态、入场按整条出现', () => {
  const sc = {fonts: [{key: 'f0', family: 'Inter'}], paints: [{kind: 'fill', color: '#FFFFFF'}], states: {}, animation: {in: 'fade-up'}};
  assert.strictEqual(A.describe(sc).needsWordTiming, false);
  assert.strictEqual(A.needsWordTiming(Object.assign({}, sc, {animation: {in: 'elastic-pop'}})), true);
});

test('toPaint：涂装栈由内向外、关键词读字幕实例的词标签、译文轨没有当前词', () => {
  const marks = {c1: [{text: 'hello', index: 0}]};
  const p = A.toPaint(scene(), null, {role: 'source', presentation: {wordTags: {keyword: marks}}});
  assert.strictEqual(p.font, 'Bangers');
  assert.strictEqual(p.color, '#FFD23F');
  assert.deepStrictEqual(p.layers.strokes.map((s) => s.color), ['#FFFFFF', '#000000']);
  assert.strictEqual(p.layers.glow.color, '#FF2BD6');
  assert.strictEqual(p.activeWord.mode, 'color');
  assert.strictEqual(p.activeColor, '#FF4D8D');
  assert.strictEqual(p.highlight.on, true);
  assert.strictEqual(p.highlight.font, 'Inter');
  assert.strictEqual(p.highlight.scale, 140);
  assert.strictEqual(p.highlight.marks, marks);
  assert.strictEqual(p.upper, 'upper');
  const t = A.toPaint(scene(), null, {role: 'translation'});
  assert.strictEqual(t.activeWord.mode, 'none');
  assert.strictEqual(t.highlight, null);
  assert.strictEqual(t.activeColor, undefined);
  /* 调整进画法：换色与换字体落到轨键上 */
  const q = A.toPaint(scene(), A.withFont(A.withColor(null, '#FFD23F', '#00FF00'), 'f0', {family: 'Anton'}));
  assert.strictEqual(q.color, '#00FF00');
  assert.strictEqual(q.font, 'Anton');
});

test('digest 与键序无关、随内容变', () => {
  const a = A.digest({b: 1, a: [1, 2]});
  assert.strictEqual(a, A.digest({a: [1, 2], b: 1}));
  assert.notStrictEqual(a, A.digest({a: [2, 1], b: 1}));
  assert.match(a, /^[0-9a-f]{8}$/);
});
