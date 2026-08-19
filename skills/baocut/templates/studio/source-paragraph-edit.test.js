const test = require('node:test');
const assert = require('node:assert/strict');
const ParagraphEdit = require('./source-paragraph-edit.js');

test('paragraph split carries live text and a Unicode character caret', () => {
  assert.deepEqual(ParagraphEdit.operation(
    'split', { id: 'p-w1', text: 'old text' }, '你好 world', 2,
  ), {
    kind: 'sourceParagraph',
    operation: {
      kind: 'split', id: 'p-w1', baseText: 'old text', value: '你好 world', charOffset: 2,
    },
  });
  assert.equal(ParagraphEdit.operation(
    'split', { id: 'p-w1', text: 'abc' }, 'abc', 0,
  ), null);
});

test('paragraph edit and merge use the durable paraId', () => {
  const paragraph = { id: 'temporary', paraId: 'p-w1', text: 'Current paragraph' };
  assert.equal(ParagraphEdit.operation('edit', paragraph, 'Edited paragraph').operation.id, 'p-w1');
  assert.equal(ParagraphEdit.operation('mergeDown', paragraph, 'Current paragraph').operation.kind, 'mergeDown');
  assert.equal(ParagraphEdit.operation('mergeUp', { id: 'q-w1', text: 'bad' }, 'bad'), null);
});
