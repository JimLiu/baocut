const test = require('node:test');
const assert = require('node:assert/strict');
const TP = require('./translation-paragraph.js');

function fixture() {
  return {
    meta: { targetLang: { code: 'zh-Hans' } },
    chapters: [{ id: 'ch-1', start: 0, end: 10 }],
    cues: [
      { id: 'c1', sp: 's1', words: [
        { id: 'w1', text: 'one', t0: 0, t1: 0.4 },
        { id: 'w2', text: 'thought', t0: 0.4, t1: 0.8 },
      ] },
      { id: 'c2', sp: 's1', words: [
        { id: 'w3', text: 'continues', t0: 1, t1: 1.4 },
        { id: 'w4', text: 'here.', t0: 1.4, t1: 1.8 },
      ] },
    ],
    sentences: [
      { id: 's-w1', sourceWordIds: ['w1', 'w2'], trans: '上半句' },
      { id: 's-w3', sourceWordIds: ['w3', 'w4'], trans: '下半句', paraStart: true },
    ],
    transCues: [],
  };
}

test('paragraph merge emits CAS bases and edited values', () => {
  const doc = fixture(), [upper, lower] = doc.sentences;
  assert.equal(TP.canMerge(doc, upper, lower), true);
  assert.deepEqual(TP.operation(doc, upper, lower, '上半句已编辑', '下半句'), {
    kind: 'translationParagraphMerge', lang: 'zh-Hans',
    upperSid: 's-w1', lowerSid: 's-w3',
    upperBase: '上半句', lowerBase: '下半句',
    upperValue: '上半句已编辑', lowerValue: '下半句',
  });
});

test('paragraph merge rejects every deterministic sentence boundary', () => {
  const mutations = [
    (doc) => { doc.sentences[1].paraStart = false; },
    (doc) => { doc.cues[1].sp = 's2'; },
    (doc) => { doc.cues[0].words[1].text = 'thought.'; },
    (doc) => { doc.cues[1].words[0].t0 = 2.6; },
    (doc) => { doc.chapters = [
      { id: 'a', start: 0, end: 0.9 }, { id: 'b', start: 0.9, end: 10 },
    ]; },
    (doc) => { doc.sentences[0].sourceWordIds = ['w1', ...Array(77).fill('w1'), 'w2']; },
  ];
  mutations.forEach((mutate) => {
    const doc = fixture(); mutate(doc);
    assert.equal(TP.canMerge(doc, doc.sentences[0], doc.sentences[1]), false);
  });
  const doc = fixture();
  assert.equal(TP.canMerge(doc, doc.sentences[1], doc.sentences[0]), false);
  assert.equal(TP.sentenceEnd('Dr.'), false);
  assert.equal(TP.sentenceEnd('agents.md'), false);
  assert.equal(TP.sentenceEnd('done.”'), true);
});

test('edited piece is folded into the whole compact-script card value', () => {
  const doc = fixture();
  doc.transCues = [
    { id: 's-w1#0', sid: 's-w1', kind: 'piece', wordFrom: 0, text: '前片' },
    { id: 's-w1#1', sid: 's-w1', kind: 'piece', wordFrom: 1, text: '后片' },
  ];
  assert.equal(TP.sentenceTextReplacing(doc, doc.sentences[0], 's-w1#0', '新前片'), '新前片后片');
  doc.meta.targetLang.code = 'en';
  assert.equal(TP.sentenceText(doc, doc.sentences[0]), '前片 后片');
});
