const {test} = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-subanim.js');
require('./model-subcanvas.js');
const {frame, ease} = window.BC_SC;

test('analytic curves match the reference float samples', () => {
  const fixture = require('./easing.fixture.json');
  for (const [name, values] of Object.entries(fixture.curves)) fixture.times.forEach((t, i) => {
    assert.ok(Math.abs(ease(name, t) - values[i]) < 2e-6, `${name} at ${t}`);
  });
});

test('seeded offsets match the reference samples and flip before applying the offset', () => {
  for (const [seed, expected] of require('./easing.fixture.json').random) assert.equal(window.BC_SC.seededUnit(seed), expected);
  const pose = frame('rotateFlipClock', 2.6).block;
  assert.ok(pose.rx > 0, 'the next sentence flips in from the opposite X direction');
  assert.equal(frame('rotateFlipClock', 3.175).block.rz, -10 + (window.BC_SC.seededUnit(1) * 2 - 1) * 5);
});

test('continuous flip samples use the capped timing and analytic expo easing', () => {
  assert.equal(frame('flipClock', 0.1).block.opacity, 0.5);
  assert.equal(frame('flipClock', 0.1).block.rx, -45);
  assert.equal(frame('flipClock', 1.2).block.rx, 0);
  assert.ok(frame('rotateFlipClock', 0.1).block.opacity > 0.5);
});
test('colourHighlight respects mixSecondary overriding useCustom outside the active word', () => {
  assert.deepEqual(frame('colourHighlight', 0.675).words.map((w) => w.tint), [false,true,false,false]);
});
test('rotation alternates between sentences and keeps a stable offset while seeking', () => {
  const first = frame('rotateFlipClock', 0.675).block.rz;
  const second = frame('rotateFlipClock', 3.175).block.rz;
  assert.ok(first >= 5 && first <= 15);
  assert.ok(second >= -15 && second <= -5);
  assert.equal(frame('rotateFlipClock', 0.875).block.rz, first);
});
test('impact centers the only visible word and reading leaves no stale chip', () => {
  const impact = frame('impact', 0.675);
  assert.ok(impact.words.every((w) => w.centered));
  assert.deepEqual(impact.words.map((w) => w.opacity), [0,1,0,0]);
  assert.ok(frame('boxHighlight', 2.2).words.every((w) => w.chip === null));
  assert.equal(ease('sinInOut', 0.5), 0.49999999999999994);
});
