const test = require('node:test');
const assert = require('node:assert/strict');
const AB = require('./align-blocks.js');

// 五词句、三块 [0,1]|[2,2]|[3,4]，两片 [0,2]|[3,4]（第一片跨两块）。
// 拼接串 "我没去，因为我病了。"（10 字）：块 tgt (0,4) (4,6) (6,10)。
const sentence = {
  id: 's-1', mode: 'manyToOne', correspondence: 'block', textBasis: 'trans',
  blocks: [
    { src: [0, 1], tgt: [0, 4], confidence: 0.9, flags: [] },
    { src: [2, 2], tgt: [4, 6], confidence: 0.4, flags: ['weak'] },
    { src: [3, 4], tgt: [6, 10], flags: ['local-reorder'] },
  ],
};
const transCues = [
  { id: 's-1#1', sid: 's-1', kind: 'piece', wordFrom: 3, wordTo: 4, text: '我病了。', start: 2, end: 3 },
  { id: 's-1#0', sid: 's-1', kind: 'piece', wordFrom: 0, wordTo: 2, text: '我没去，因为', start: 0, end: 2 },
  { id: 's-9', sid: 's-9', kind: 'sentence', text: '别的句', start: 5, end: 6 },
];

test('sentencePieces sorts a sentence\'s pieces by source span', () => {
  const pieces = AB.sentencePieces(transCues, 's-1');
  assert.deepEqual(pieces.map((p) => p.id), ['s-1#0', 's-1#1']);
  assert.deepEqual(AB.pieceOffsets(pieces), { 's-1#0': 0, 's-1#1': 6 });
});

test('pieceSegments projects blocks onto each piece with flags and boundaries', () => {
  const pieces = AB.sentencePieces(transCues, 's-1');
  const first = AB.pieceSegments(sentence, pieces, pieces[0]);
  assert.deepEqual(first.map((s) => [s.chars, s.flags, s.boundary]), [
    [4, [], false],
    [2, ['weak'], true],
  ]);
  const second = AB.pieceSegments(sentence, pieces, pieces[1]);
  assert.deepEqual(second.map((s) => [s.chars, s.flags, s.boundary]), [[4, ['local-reorder'], false]]);
  // 无块层：不画刻度。
  assert.deepEqual(AB.pieceSegments({ blocks: [] }, pieces, pieces[0]), []);
});

test('snapSplit snaps to the nearest inner block boundary and refuses single-block pieces', () => {
  const pieces = AB.sentencePieces(transCues, 's-1');
  // 光标在第 2 字后：最近块边界在第 4 字后（词 1|2）。
  assert.deepEqual(AB.snapSplit(sentence, pieces, pieces[0], 2), { ok: true, afterWord: 1, cut: 4 });
  assert.deepEqual(AB.snapSplit(sentence, pieces, pieces[0], 5), { ok: true, afterWord: 1, cut: 4 });
  // 单块片没有合法拆分点。
  assert.equal(AB.snapSplit(sentence, pieces, pieces[1], 2).ok, false);
  // 无块层：交给旧路径。
  assert.equal(AB.snapSplit({ blocks: [] }, pieces, pieces[0], 2), null);
  assert.equal(AB.snapSplit({}, pieces, pieces[0], 2), null);
});

test('isBlockBoundary only accepts cuts on block starts when blocks exist', () => {
  assert.equal(AB.isBlockBoundary(sentence, 1), true);
  assert.equal(AB.isBlockBoundary(sentence, 2), true);
  assert.equal(AB.isBlockBoundary(sentence, 0), false);
  assert.equal(AB.isBlockBoundary({ blocks: [] }, 0), true);
});

test('cardChips derives the sentence-level and rewritten chips', () => {
  assert.deepEqual(AB.cardChips(sentence), { sentenceLevel: false, rewritten: false });
  assert.deepEqual(AB.cardChips({ correspondence: 'sentence' }), { sentenceLevel: true, rewritten: false });
  // 旧 data.json 只有 crossing：仍按整句对应解释。
  assert.deepEqual(AB.cardChips({ crossing: true }), { sentenceLevel: true, rewritten: false });
  assert.deepEqual(
    AB.cardChips({ correspondence: 'block', textBasis: 'display', displayText: '改写', trans: '自然' }),
    { sentenceLevel: false, rewritten: true },
  );
});
