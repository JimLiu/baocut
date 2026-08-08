const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('./stage-click-policy.js');

const base = {
  fullscreen: false,
  playing: false,
  hasSelection: false,
  hasTarget: false,
  targetSelected: false,
  now: 1000,
  deadline: null,
};

test('Studio canvas click policy table', () => {
  const cases = [
    ['playing without selection pauses and arms', { playing: true }, 'pauseAndArm', 3000],
    ['playing with selection only pauses', { playing: true, hasSelection: true }, 'pause', null],
    ['armed subtitle click selects at two seconds', { hasTarget: true, now: 3000, deadline: 3000 }, 'select', null],
    ['expired subtitle click resumes playback', { hasTarget: true, now: 3000.01, deadline: 3000 }, 'play', null],
    ['armed background click resumes playback', { now: 2000, deadline: 3000 }, 'play', null],
    ['selected subtitle passes through', { hasSelection: true, hasTarget: true, targetSelected: true }, 'passThrough', null],
    ['different current hit selects without drag', { hasSelection: true, hasTarget: true }, 'select', null],
    ['selected background clears', { hasSelection: true }, 'clearSelection', null],
  ];
  for (const [name, patch, action, deadline] of cases) {
    const result = policy.resolve({ ...base, ...patch });
    assert.equal(result.action, action, name);
    assert.equal(result.deadline, deadline, name);
  }
});

test('Studio only passes body gestures through for an already-selected paused subtitle', () => {
  assert.equal(policy.resolve({ ...base, hasTarget: true, deadline: 3000 }).action, 'select');
  assert.equal(policy.resolve({ ...base, playing: true, hasSelection: true, hasTarget: true, targetSelected: true }).action, 'pause');
  assert.equal(policy.resolve({ ...base, hasSelection: true, hasTarget: true, targetSelected: true }).action, 'passThrough');
});
