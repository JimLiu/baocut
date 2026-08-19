const test = require('node:test');
const assert = require('node:assert/strict');
const ChapterTitleEdit = require('./chapter-title-edit.js');

test('chapter rename replaces one title and preserves the complete chapter table', () => {
  const chapters = [
    { id: 'ch-1', title: 'Old', start: 0, end: 12.5 },
    { id: 'ch-2', title: 'Keep', start: 12.5, end: 30 },
  ];
  assert.deepEqual(ChapterTitleEdit.operation(chapters, 'ch-1', '  Opening  '), {
    kind: 'patchTranscript',
    set: {
      chapters: [
        { id: 'ch-1', title: 'Opening', start: 0, end: 12.5 },
        { id: 'ch-2', title: 'Keep', start: 12.5, end: 30 },
      ],
    },
  });
  assert.equal(ChapterTitleEdit.operation(chapters, 'missing', 'Nope'), null);
  assert.equal(ChapterTitleEdit.operation(chapters, 'ch-1', '  '), null);
  assert.equal(ChapterTitleEdit.operation(null, 'ch-1', 'Opening'), null);
});
