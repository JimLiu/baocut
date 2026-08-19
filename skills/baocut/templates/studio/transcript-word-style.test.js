const test = require('node:test');
const assert = require('node:assert/strict');
const { wordIsCut, cueRuns } = require('./transcript-word-style.js');

test('cueRuns preserves exact spacing and marks only cut word atoms', () => {
  const cue = {
    text: 'hello,  world!',
    words: [
      { id: 'w1', text: 'hello,', t0: 0, t1: 0.4 },
      { id: 'w2', text: 'world!', t0: 0.5, t1: 0.9 },
    ],
  };
  const runs = cueRuns(cue, [{ id: 'cut-1', t0: 0.45, t1: 1 }]);
  assert.equal(runs.map((run) => run.text).join(''), cue.text);
  assert.deepEqual(runs.map((run) => [run.text, run.cut]), [
    ['hello,', false], ['  ', false], ['world!', true],
  ]);
});

test('cueRuns supports compact CJK and safely drops stale atom styling', () => {
  const compact = cueRuns({
    text: '你好',
    words: [
      { id: 'w1', text: '你', t0: 0, t1: 0.2 },
      { id: 'w2', text: '好', t0: 0.2, t1: 0.4 },
    ],
  }, []);
  assert.equal(compact.map((run) => run.text).join(''), '你好');
  assert.equal(compact.length, 2);

  assert.deepEqual(cueRuns({ text: 'edited', words: [{ id: 'old', text: 'stale', t0: 0, t1: 1 }] }, []),
    [{ text: 'edited', wordId: null, cut: false }]);
});

test('wordIsCut uses the word midpoint like the native clients', () => {
  const word = { start: 1, end: 2 };
  assert.equal(wordIsCut(word, [{ t0: 1.49, t1: 1.51 }]), true);
  assert.equal(wordIsCut(word, [{ t0: 1.6, t1: 2.2 }]), false);
});
