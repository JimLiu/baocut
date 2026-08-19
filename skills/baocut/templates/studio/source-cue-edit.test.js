const test = require('node:test');
const assert = require('node:assert/strict');
const SourceCueEdit = require('./source-cue-edit.js');

test('delete op carries the selected cue identity and visible text CAS', () => {
  assert.deepEqual(SourceCueEdit.operation({ id: 'q-w1', text: 'Current cue.' }), {
    kind: 'deleteOriginalCue', cueId: 'q-w1', base: 'Current cue.',
  });
  assert.deepEqual(SourceCueEdit.operation({
    id: 'tl-a', sourceItemId: 'q-w1', text: 'Projected cue.',
  }), {
    kind: 'deleteOriginalCue', cueId: 'q-w1', base: 'Projected cue.',
  });
  assert.equal(SourceCueEdit.operation({ id: 'w1', text: 'bad id' }), null);
});

test('timeline selection resolves only main-source cues', () => {
  const doc = {
    timelineCues: [
      { id: 'tl-a', sourceId: 'main', sourceItemId: 'q-w1', text: 'Main' },
      { id: 'tl-b', sourceId: 'guest', sourceItemId: 'q-g1', text: 'Guest' },
    ],
  };
  assert.equal(SourceCueEdit.selectedCue(doc, { cueId: 'q-w1' }).text, 'Main');
  assert.equal(SourceCueEdit.selectedCue(doc, { cueId: 'q-g1' }), null);
  assert.equal(SourceCueEdit.selectedCue(doc, null), null);
});

test('delete shortcut yields to every text input surface', () => {
  assert.equal(SourceCueEdit.isTextInput({ tagName: 'INPUT' }), true);
  assert.equal(SourceCueEdit.isTextInput({ tagName: 'TEXTAREA' }), true);
  assert.equal(SourceCueEdit.isTextInput({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(SourceCueEdit.isTextInput({ tagName: 'DIV', isContentEditable: false }), false);
});
