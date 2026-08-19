const test = require('node:test');
const assert = require('node:assert/strict');
const SpeakerNameEdit = require('./speaker-name-edit.js');

test('speaker rename is a sparse table patch that preserves hue', () => {
  assert.deepEqual(SpeakerNameEdit.operation(' s1 ', { name: 'Host', hue: 42.5 }, '  Jim  '), {
    kind: 'patchTranscript',
    set: { speakers: { s1: { name: 'Jim', hue: 43 } } },
  });
  assert.equal(SpeakerNameEdit.operation('', { hue: 42 }, 'Jim'), null);
  assert.equal(SpeakerNameEdit.operation('s1', { hue: 42 }, '  '), null);
  assert.equal(SpeakerNameEdit.operation('s1', {}, 'Jim'), null);
  assert.equal(SpeakerNameEdit.operation('s1', null, 'Jim'), null);
});
