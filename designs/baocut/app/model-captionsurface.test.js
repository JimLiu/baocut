/* node --test designs/baocut/app/model-captionsurface.test.js
   钉 caption-editor-redesign §4 的分层涂装：v1 键机械升级、镜像回 v1 键、层数上限、
   CSS 画法（纯色字身第一层走 text-stroke，渐变字身全走 drop-shadow）、效果标签判据。 */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-captionsurface.js');
const S = window.BC_SURF;

test('v1 涂装键升级成栈：描边进 strokes[0]，距离为 0 的阴影是发光', () => {
  const a = S.fromPaint({outline: true, outlineColor: '#000000', outlineW: 8, shadow: true, shDist: 12, shAngle: 90, shBlur: 24, shColor: '#000000D9'});
  assert.deepEqual(a.strokes, [{color: '#000000', width: 0.025}]);
  assert.equal(a.shadows.length, 1);
  assert.deepEqual(a.shadows[0].offset, [0, 0.12]);
  assert.equal(a.glow, null);
  const g = S.fromPaint({shadow: true, shDist: 0, shBlur: 40, shColor: '#FF2BD6'});
  assert.equal(g.shadows.length, 0);
  assert.equal(g.glow.color, '#FF2BD6');
  assert.deepEqual(S.fromPaint({}), {fill: null, strokes: [], shadows: [], glow: null});
});

test('栈镜像回 v1 键：旧读者读得到第一层描边与第一层外阴影', () => {
  const stack = {strokes: [{color: '#FFFFFF', width: 0.04}, {color: '#111111', width: 0.1}],
    shadows: [{color: '#00000080', offset: [0, 0.08], blur: 0.1, inner: true}, {color: '#000000', offset: [0.06, 0.06], blur: 0}]};
  const p = S.toPaint(stack, {color: '#FFD84D'});
  assert.equal(p.color, '#FFD84D');
  assert.deepEqual([p.outline, p.outlineColor, p.outlineW], [true, '#FFFFFF', 12.8]);
  assert.equal(p.shadow, true);
  assert.equal(p.shAngle, 45, '内阴影不当外阴影镜像');
  assert.ok(Math.abs(p.shDist - 8.4853) < 0.001);
  assert.equal(p.layers.strokes.length, 2);
  // 往返：只有一层的栈升级、镜像后回到同一组键
  const v1 = {outline: true, outlineColor: '#123456', outlineW: 12, shadow: true, shDist: 10, shAngle: 90, shBlur: 20, shColor: '#00000099'};
  const back = S.toPaint(S.fromPaint(v1), {color: '#FFFFFF'});
  ['outline', 'outlineColor', 'outlineW', 'shadow', 'shDist', 'shAngle', 'shBlur', 'shColor'].forEach((k) => assert.equal(back[k], v1[k], k));
});

test('描边、阴影各最多三层；加满后再加不变', () => {
  let s = S.normalize({});
  for (let i = 0; i < 5; i++) s = S.addLayer(s, 'stroke');
  assert.equal(s.strokes.length, 3);
  assert.equal(s.strokes[2].width, s.strokes[0].width, '每层宽度是这一圈自己的厚度，新加一层照抄上一层');
  for (let i = 0; i < 4; i++) s = S.addLayer(s, 'shadow');
  assert.equal(s.shadows.length, 3);
  assert.equal(S.normalize({strokes: [1, 2, 3, 4].map(() => ({color: '#000000', width: 0.1}))}).strokes.length, 3);
  const moved = S.moveLayer(S.setLayer(s, 'stroke', 0, {color: '#FF0000'}), 'stroke', 0, 1);
  assert.equal(moved.strokes[1].color, '#FF0000');
  assert.deepEqual(S.moveLayer(moved, 'stroke', 0, -1).strokes, moved.strokes, '挪不动时原样');
  assert.equal(S.removeLayer(moved, 'stroke', 1).strokes.length, 2);
});

test('CSS：纯色字身第一层描边走 text-stroke，其余走 drop-shadow 链', () => {
  const css = S.cssOf({strokes: [{color: '#000000', width: 0.05}, {color: '#FFFFFF', width: 0.1}]}, '#FFFFFF', 20);
  assert.equal(css.WebkitTextStroke, '2px #000000');
  assert.equal(css.paintOrder, 'stroke fill');
  assert.match(css['--tx-filter'], /^drop-shadow\(2px 0 0 #FFFFFF\) drop-shadow\(-2px 0 0 #FFFFFF\)/);
  assert.ok(!('--tx-fill' in css), '纯色不挂填充');
});

test('CSS：渐变字身的描边全走 drop-shadow，填充挂成 --tx-fill', () => {
  const css = S.cssOf({fill: {kind: 'linear', angle: 180, stops: [[0, '#FFFFFF'], [1, '#FFD84D']]}, strokes: [{color: '#000000', width: 0.05}]}, '#FFFFFF', 20);
  assert.ok(!css.WebkitTextStroke);
  assert.equal(css['--tx-fill'], 'linear-gradient(180deg, #FFFFFF 0%, #FFD84D 100%)');
  assert.equal(css['--tx-tfc'], 'transparent');
  assert.equal(css['--tx-clip'], 'text');
  assert.match(css['--tx-filter'], /^drop-shadow\(1px 0 0 #000000\)/);
  const tex = S.cssOf({fill: {kind: 'texture', texture: 'gold', tint: '#FF000033'}}, '#FFFFFF', 20);
  assert.match(tex['--tx-fill'], /^linear-gradient\(#FF000033, #FF000033\), linear-gradient\(180deg, #FFF6C8/);
  assert.equal(tex['--tx-size'], 'auto');
  const inner = S.cssOf({shadows: [{color: '#00000080', offset: [0, 0.1], blur: 0.1, inner: true}]}, '#FFFFFF', 20);
  assert.match(inner['--tx-fill'], /^linear-gradient\(180deg, #00000080 0%, transparent 20%\), linear-gradient\(#FFFFFF, #FFFFFF\)/);
  assert.equal(S.cssOf({glow: {color: '#FF2BD6', radius: 0.4, strength: 0.9}}, '#FFFFFF', 20)['--tx-filter'],
    'drop-shadow(0 0 4px #FF2BD6) drop-shadow(0 0 8px #FF2BD6)');
});

test('当前词换色撤掉填充', () => {
  assert.deepEqual(S.inkVars('#FF0000'), {'--tx-fill': 'none', '--tx-clip': 'border-box', '--tx-tfc': '#FF0000'});
  assert.equal(S.inkVars(null), null);
});

test('效果标签按 §8 的判据', () => {
  assert.deepEqual(S.tags({activeWord: {mode: 'sweep'}, motion: {loop: {preset: 'wave'}}}), ['sweep', 'loop']);
  assert.deepEqual(S.tags({activeWord: {mode: 'pop'}, motion: {in: {preset: 'line-slide', unit: 'line'}}}),
    ['active-color', 'word-pop', 'line-motion']);
  assert.deepEqual(S.tags({activeWord: {mode: 'none', unspoken: 'hidden'}}), ['reveal']);
  assert.deepEqual(S.tags({activeWord: {mode: 'glow'}, surface: {fill: {kind: 'texture', texture: 'neon-tube'}, glow: {color: '#FF2BD6'}}}),
    ['active-color', 'glow', 'texture']);
  // v1 正文的单数 surface 照样认
  assert.deepEqual(S.tags({activeWord: {mode: 'box'}, surface: {stroke: {color: '#000000', width: 0.05}, plate: {color: '#000000'}}}),
    ['active-box', 'stroke', 'plate']);
  assert.deepEqual(S.tags({activeWord: {mode: 'color'}, emphasis: {color: '#FFD84D'}, layout: {pagination: {wordsPerPage: 3, rows: [2, 1]}}}),
    ['active-color', 'keyword', 'multiline']);
  assert.equal(S.TAGS.length, 16);
  assert.equal(S.tagName('glow'), '发光');
});

test('填充切换与调色板', () => {
  let s = S.setFill({}, 'linear', '#FFFFFF');
  assert.equal(S.fillKind(s), 'linear');
  assert.equal(s.fill.stops[0][1], '#FFFFFF');
  s = S.setFill(s, 'texture');
  assert.deepEqual(s.fill, {kind: 'texture', texture: 'metal'});
  assert.equal(S.fillKind(S.setFill(s, 'solid')), 'solid');
  assert.deepEqual(S.colorsOf({strokes: [{color: '#000000', width: 0.1}], glow: {color: '#FF2BD6'}}, '#FFFFFF'), ['#FFFFFF', '#000000', '#FF2BD6']);
  assert.ok(S.TEXTURES.every((t) => t.image && t.name));
});
