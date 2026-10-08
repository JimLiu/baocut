const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-video-transition.js');
const T = window.BC_VIDEO_TRANSITION;
test('short videos clamp each boundary to half the clip without overlapping', () => {
  assert.deepEqual(T.normalize({k: 'wipe', dur: 3}, 0.3), {k: 'wipe', dur: 0.15});
  assert.deepEqual(T.normalize({k: 'unknown', dur: NaN}, 0), {k: 'none', dur: 0});
});
test('entry and exit are independent and sampled against the same visibility window', () => {
  const t = {in: {k: 'dissolve', dur: 1}, out: {k: 'wipe', dur: 0.5}};
  assert.deepEqual(T.at(t, 0, 4), {opacity: 0});
  assert.deepEqual(T.at(t, 0.5, 4), {opacity: 0.5});
  assert.deepEqual(T.at(t, 1, 4), {});
  assert.deepEqual(T.at(t, 3.75, 4), {clipPath: 'inset(0 50% 0 0)'});
  assert.deepEqual(T.at(t, 4, 4), {opacity: 0});
  assert.deepEqual(T.at(t, -0.1, 4), {opacity: 0});
});
test('every transition resolves to an unchanged full frame at the end of entry', () => {
  for (const p of T.PRESETS) assert.deepEqual(T.style(p.k, 1), {});
  assert.deepEqual(T.at(null, 0, 3), {});
  assert.deepEqual(T.style('none', 0), {});
});
