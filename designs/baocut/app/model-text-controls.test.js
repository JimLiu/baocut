const test = require('node:test');
const assert = require('node:assert/strict');
const TC = require('./model-text-controls.js');
global.window = {};
require('./model-textpresets.js');
require('./model-shape-paths.js');
require('./model-elements.js');
const TP = window.BC_TP;
const E = window.BC_EL;

test('外观预设清掉旧效果，但保留字体、排版、文字与动画', () => {
  const original = {font: 'serif', size: 72, align: 'left', bold: false, text: 'Hello',
    anim: {in: {k: 'slide'}}, sh: {dist: 1}, ol: {w: 9}};
  const preset = {style: {color: 'white', bg: {color: 'blue', pad: 8}}};
  const applied = {...original, ...TC.effectPatch(preset)};
  for (const key of ['font', 'size', 'align', 'bold', 'text', 'anim']) assert.equal(applied[key], original[key]);
  assert.equal(applied.sh, null);
  assert.equal(applied.ol, null);
  assert.equal(original.ol.w, 9);
});

test('背景、描边、阴影通过逐元素样式映射往返，关闭后参数仍可恢复', () => {
  const bg = {color: 'blue', pad: 17, r: 9, mode: 'wrap'};
  const off = TC.toggleEffect(bg, {}, false);
  assert.equal(TC.enabled(off), false);
  assert.equal(TC.toggleEffect(off, {pad: 8}, true).pad, 17);
  const patch = {bg: off, ol: {color: 'white', w: 3}, sh: null, alpha: 1};
  assert.deepEqual(E.fromStage('text', E.toStage('text', patch)), patch);
  assert.equal(bg.enabled, undefined);
});

test('预设选中态由实际效果推导，微调后变为自定义', () => {
  const preset = {id: 'test', style: {color: 'white'}};
  const applied = TC.effectPatch(preset);
  assert.equal(TC.presetOf(applied, [preset]), preset);
  assert.equal(TC.presetOf({...applied, color: 'blue'}, [preset]), undefined);
  const withBg = {style: {color: 'white', bg: {color: 'blue', pad: 8}}};
  const onAgain = {...TC.effectPatch(withBg), bg: {pad: 8, enabled: true, color: 'blue'}};
  assert.equal(TC.presetOf(onAgain, [withBg]), withBg);
});

test('关闭的外观不进入舞台绘制，重新开启可复现原值', () => {
  const effect = {color: 'blue', pad: 8, r: 9, enabled: false};
  const style = {size: 40, color: 'white', bg: effect,
    ol: {color: 'red', w: 4, enabled: false}, sh: {color: 'black', enabled: false}};
  const css = TP.textCss(TP.fromStyle(style), 1);
  assert.equal(css.background, undefined);
  assert.equal(css.WebkitTextStroke, undefined);
  assert.equal(css.textShadow, undefined);
  assert.equal(TP.textCss(TP.fromStyle({...style, bg: {...effect, enabled: true}}), 1).borderRadius, 9);
});

test('背景透明度不连带淡化文字，描边先画以保护字形', () => {
  const css = TP.textCss({size: 40, color: 'white', bg: {color: '#000000', alpha: 0.5}, ol: {color: 'blue', w: 2}}, 1);
  assert.equal(css.opacity, null);
  assert.equal(css.background, 'rgba(0,0,0,0.5)');
  assert.equal(css.paintOrder, 'stroke fill');
});

test('阴影取色的八位 Hex 保留 RGB 与 alpha', () => {
  const css = TP.textCss({size: 40, sh: {color: '#FF000080', a: 1, dist: 0, blur: 0, rot: 0}}, 1);
  assert.match(css.textShadow, /rgba\(255,0,0,0\.5019/);
});

test('切动画保留调好的时长及合法方向，点无仅清当前阶段', () => {
  const cur = {k: 'slide', dur: 1.2, dir: 'up'};
  assert.deepEqual(TC.chooseAnimation('in', TP.find('in', 'slide'), cur), cur);
  assert.deepEqual(TC.chooseAnimation('in', TP.find('in', 'fade'), cur), {k: 'fade', dur: 1.2, dir: null});
  assert.deepEqual(TC.chooseAnimation('in', TP.find('in', 'none'), cur), {k: 'none'});
  assert.deepEqual(cur, {k: 'slide', dur: 1.2, dir: 'up'});
  assert.equal(TC.duration('loop', {k: 'none'}), 2);
});
