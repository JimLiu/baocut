const test = require('node:test');
const assert = require('node:assert/strict');
const TP = require('./translate-pane.js');
const F = require('./find-replace.js');

// 两句：第一句逐行片（两片），第二句整句（无片）。
const doc = {
  cues: [
    {
      id: 'c1',
      text: 'As AI becomes part of work,',
      words: [
        { id: 'w1', text: 'As' }, { id: 'w2', text: 'AI' }, { id: 'w3', text: 'becomes' },
        { id: 'w4', text: 'part' }, { id: 'w5', text: 'of' }, { id: 'w6', text: 'work,' },
      ],
    },
    {
      id: 'c2',
      text: 'IT admins take a strategic role.',
      words: [
        { id: 'w7', text: 'IT' }, { id: 'w8', text: 'admins' }, { id: 'w9', text: 'take' },
        { id: 'w10', text: 'a' }, { id: 'w11', text: 'strategic' }, { id: 'w12', text: 'role.' },
      ],
    },
    { id: 'c3', text: 'The admins ship it.', words: [] },
  ],
  sentences: [
    { id: 's1', cueIds: ['c1', 'c2'], text: 'As AI becomes part of work, IT admins take a strategic role.', trans: '随着 AI 融入工作，IT 管理员承担战略角色。' },
    { id: 's2', cueIds: ['c3'], text: 'The admins ship it.', trans: 'IT 管理员把它交付。' },
  ],
  transCues: [
    { id: 's1#0', sid: 's1', kind: 'piece', text: '随着 AI 融入工作，' },
    { id: 's1#1', sid: 's1', kind: 'piece', text: 'IT 管理员承担战略角色。' },
  ],
};

test('scopeInfo / scopeIncludes 与 Mac TrReplaceScope 同语义', () => {
  assert.equal(TP.scopeInfo('both').short, '两者');
  assert.equal(TP.scopeInfo('transcript').label, '仅原文');
  assert.equal(TP.scopeInfo('translation').tip, '仅在译文中替换');
  assert.equal(TP.scopeInfo('nope').id, 'both');   // 未知值退回默认
  assert.equal(TP.scopeIncludes('both', 'transcript'), true);
  assert.equal(TP.scopeIncludes('both', 'translation'), true);
  assert.equal(TP.scopeIncludes('translation', 'transcript'), false);
  assert.equal(TP.scopeIncludes('transcript', 'translation'), false);
});

test('findItems 按卡自上而下、卡内先原文后译文', () => {
  const items = TP.findItems(doc, 'both');
  assert.deepEqual(items.map((i) => i.key),
    ['src:c1', 'src:c2', 's1#0', 's1#1', 'src:c3', 's2']);
  assert.deepEqual(items.map((i) => i.kind),
    ['cue', 'cue', 'piece', 'piece', 'cue', 'sentence']);
  assert.deepEqual(items.map((i) => i.card), ['s1', 's1', 's1', 's1', 's2', 's2']);
  assert.equal(items[0].cueId, 'c1');
  assert.equal(items[0].text, 'As AI becomes part of work,');
  assert.equal(items[5].text, 'IT 管理员把它交付。');
});

test('findItems 按范围裁剪条目', () => {
  assert.deepEqual(TP.findItems(doc, 'translation').map((i) => i.key), ['s1#0', 's1#1', 's2']);
  assert.deepEqual(TP.findItems(doc, 'transcript').map((i) => i.key), ['src:c1', 'src:c2', 'src:c3']);
  assert.deepEqual(TP.findItems({}, 'both'), []);
});

test('findItems 不重复收同一条 cue，源键与译键不撞命名空间', () => {
  const shared = Object.assign({}, doc, {
    sentences: [doc.sentences[0], Object.assign({}, doc.sentences[1], { cueIds: ['c2', 'c3'] })],
  });
  const keys = TP.findItems(shared, 'transcript').map((i) => i.key);
  assert.deepEqual(keys, ['src:c1', 'src:c2', 'src:c3']);
  const both = TP.findItems(doc, 'both').map((i) => i.key);
  assert.equal(new Set(both).size, both.length);
});

test('查找结果分别落在 editCue 与 editTrans 两条写路径上', () => {
  const items = TP.findItems(doc, 'both');
  const matches = F.collect(items, 'IT');
  assert.deepEqual(matches.map((m) => m.key), ['src:c2', 's1#1', 'src:c3', 's2']);
  const plan = F.replacePlan(matches, 'X');
  const routed = plan.map((entry) => [entry.item.kind, entry.item.cueId || entry.key, entry.text]);
  assert.deepEqual(routed, [
    ['cue', 'c2', 'X admins take a strategic role.'],
    ['piece', 's1#1', 'X 管理员承担战略角色。'],
    ['cue', 'c3', 'The admins ship X.'],
    ['sentence', 's2', 'X 管理员把它交付。'],
  ]);
});

test('deliveryLines / copyAllText 一行一个投递片并丢掉空行', () => {
  assert.deepEqual(TP.deliveryLines(doc),
    ['随着 AI 融入工作，', 'IT 管理员承担战略角色。', 'IT 管理员把它交付。']);
  assert.equal(TP.copyAllText(doc), '随着 AI 融入工作，\nIT 管理员承担战略角色。\nIT 管理员把它交付。');
  const blank = { sentences: [{ id: 's1', trans: '' }, { id: 's2', trans: '  ' }], transCues: [] };
  assert.deepEqual(TP.deliveryLines(blank), []);
  assert.equal(TP.copyAllText({}), '');
});

test('sentenceIsWhole：无译文 / 无片 / 单个 sentence 片都是整句上屏', () => {
  assert.equal(TP.sentenceIsWhole({ trans: '' }, [{ kind: 'piece' }]), true);
  assert.equal(TP.sentenceIsWhole({ trans: 'x' }, []), true);
  assert.equal(TP.sentenceIsWhole({ trans: 'x' }, [{ kind: 'sentence' }]), true);
  assert.equal(TP.sentenceIsWhole({ trans: 'x' }, [{ kind: 'piece' }, { kind: 'piece' }]), false);
  assert.deepEqual(TP.sentencePieces(doc.transCues, 's1').map((p) => p.id), ['s1#0', 's1#1']);
  assert.deepEqual(TP.sentencePieces(doc.transCues, 's2'), []);
});

test('scanOffsets / wordOffsets 顺序扫描，不依赖分隔符也不被重复词带歪', () => {
  assert.deepEqual(TP.wordOffsets(doc.cues[0]).map((o) => [o.id, o.start, o.end]), [
    ['w1', 0, 2], ['w2', 3, 5], ['w3', 6, 13],
    ['w4', 14, 18], ['w5', 19, 21], ['w6', 22, 27],
  ]);
  // CJK 无空格
  const cjk = { text: '管理员管理管理员', words: [{ id: 'a', text: '管理员' }, { id: 'b', text: '管理' }, { id: 'c', text: '管理员' }] };
  assert.deepEqual(TP.wordOffsets(cjk).map((o) => [o.start, o.end]), [[0, 3], [3, 5], [5, 8]]);
  assert.deepEqual(TP.wordOffsets({ text: 'abc' }), []);
  // 词表里有正文找不到的词：跳过它，后面的偏移不受影响
  const drift = [{ id: 'a', text: 'a' }, { id: 'b', text: 'zz' }, { id: 'c', text: 'c' }];
  assert.deepEqual(TP.scanOffsets('a c', drift).map((o) => [o.id, o.start]), [['a', 0], ['c', 2]]);
});

test('sourceIndex 同时给出 cue 表与词归属', () => {
  const idx = TP.sourceIndex(doc.cues);
  assert.equal(idx.cueById.get('c2').text, 'IT admins take a strategic role.');
  assert.equal(idx.wordCue.get('w8').id, 'c2');
  assert.equal(idx.wordCue.get('w1').id, 'c1');
  assert.equal(idx.wordCue.get('nope'), undefined);
});

const idx = TP.sourceIndex(doc.cues);
const marksOf = (cueId, query) => (idx.cueById.has(cueId)
  ? F.findTextRanges(idx.cueById.get(cueId).text, query) : []);

test('lineHighlight 把 cue 内偏移换算到子行局部偏移', () => {
  const marksFor = (cueId) => marksOf(cueId, 'part');   // c1 的 [14,18)
  const words = [{ id: 'w3', text: 'becomes' }, { id: 'w4', text: 'part' }, { id: 'w5', text: 'of' }];
  const hl = TP.lineHighlight('becomes part of', words, idx.wordCue, marksFor, () => 14);
  assert.deepEqual(hl.marks, [{ start: 8, end: 12 }]);
  assert.equal(hl.curStart, 8);
  // 当前匹配在别的子行：本子行只高亮不点亮
  assert.equal(TP.lineHighlight('becomes part of', words, idx.wordCue, marksFor, () => 0).curStart, null);
});

test('lineHighlight 支持跨 cue 的合并子行（mergeShortRuns 的产物）', () => {
  // 一条子行横跨 c1 末尾与 c2 开头，两条 cue 各自的匹配都要落在正确的位置。
  const text = 'of work, IT admins take';
  const words = [
    { id: 'w5', text: 'of' }, { id: 'w6', text: 'work,' },
    { id: 'w7', text: 'IT' }, { id: 'w8', text: 'admins' }, { id: 'w9', text: 'take' },
  ];
  const hl = TP.lineHighlight(text, words, idx.wordCue, (cueId) => marksOf(cueId, 'a'), () => null);
  const slices = hl.marks.map((m) => [m.start, text.slice(m.start, m.end)]);
  // c1 的 'a' 在 'part'（本子行外，丢掉）；本子行只剩 c2 的 'admins' / 'take'
  assert.deepEqual(slices, [[12, 'a'], [20, 'a']]);
});

test('lineHighlight 在换算不成立时丢掉那条匹配', () => {
  const marksFor = (cueId) => marksOf(cueId, 'part');
  // 跨词的匹配遇上不同的连接符 → 该匹配丢掉，整行退回纯文本
  assert.equal(TP.lineHighlight('part--of', [{ id: 'w4', text: 'part' }, { id: 'w5', text: 'of' }],
    idx.wordCue, (cueId) => marksOf(cueId, 'part of'), () => null), null);
  // 词内的匹配不受连接符影响：偏移是逐词算的，宽窄空格都不影响
  assert.deepEqual(TP.lineHighlight('becomes  part', [{ id: 'w3', text: 'becomes' }, { id: 'w4', text: 'part' }],
    idx.wordCue, marksFor, () => null).marks, [{ start: 9, end: 13 }]);
  // 匹配落在本子行之外
  assert.equal(TP.lineHighlight('As AI', [{ id: 'w1', text: 'As' }, { id: 'w2', text: 'AI' }],
    idx.wordCue, marksFor, () => null), null);
  // 没有词、没有匹配、词不属于任何 cue
  assert.equal(TP.lineHighlight('becomes', [], idx.wordCue, marksFor, () => null), null);
  assert.equal(TP.lineHighlight('becomes', [{ id: 'w3', text: 'becomes' }], idx.wordCue, () => [], () => null), null);
  assert.equal(TP.lineHighlight('x', [{ id: 'zz', text: 'x' }], idx.wordCue, marksFor, () => null), null);
});
