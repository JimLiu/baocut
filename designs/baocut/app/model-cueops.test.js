const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-cueops.js');
const O = window.BC_CUEOPS;

test('并句后阅读速度使用合并后的整段时间，保留两句之间的间隔', () => {
  const cards = [
    {id: 'a', kind: 'plain', sp: 's1', time: '00:10.0', duration: 2, orig: '甲', trans: 'A'},
    {id: 'b', kind: 'plain', sp: 's1', time: '00:13.0', duration: 3, orig: '乙', trans: 'B'},
  ];
  assert.equal(O.mergeCards(cards, 'b', -1).cards[0].duration, 6);
  assert.equal(O.mergeCards(cards, 'a', 1).cards[0].duration, 6);
  assert.equal(cards[0].duration, 2);
});

const cues = [
  {id: 'g1', start: 0, end: 4, sp: 's1', text: '词是真相，句子和 cue 都是投影。', trans: 'Words are the truth.'},
  {id: 'g2', start: 4, end: 6, sp: 's1', text: '这样翻译改了原文也不会把时间轴打乱。', trans: 'Editing never scrambles.'},
  {id: 'g3', start: 6, end: 9, sp: 's2', text: 'So the timeline cannot drift.', trans: '时间轴不能漂。'},
];
const paras = [
  {id: 'p1', sp: 's1', start: 0, end: 6, cueIds: ['g1', 'g2']},
  {id: 'p2', sp: 's2', start: 6, end: 9, cueIds: ['g3']},
];

test('joiner：中日文直接相接，拉丁文补空格，已带空白不重复补', () => {
  assert.equal(O.joiner('词是真相，', '句子'), '');
  assert.equal(O.joiner('Hold on', 'let’s see'), ' ');
  assert.equal(O.joiner('Hold on ', 'let’s see'), '');
  assert.equal(O.joiner('', 'x'), '');
});

test('cutText：两端切不出东西就是 null，切出来的两侧去掉首尾空白', () => {
  assert.equal(O.cutText('abc', 0), null);
  assert.equal(O.cutText('abc', 3), null);
  assert.equal(O.cutText('ab  ', 3), null);
  assert.deepEqual(O.cutText('Hold on let’s see', 7), {left: 'Hold on', right: 'let’s see'});
});

test('splitTime：按字数比例分，两边各留 MIN_DUR，太短的条对半', () => {
  assert.equal(O.splitTime(0, 4, 1, 3), 1);
  assert.equal(O.splitTime(0, 4, 39, 1), 3.7);
  assert.equal(O.splitTime(0, 0.5, 1, 9), 0.25);
});

test('splitCue：光标处拆两条，新条带 root、译文留在前一条；两端不拆', () => {
  const r = O.splitCue(cues, 'g1', cues[0].text, 5);
  assert.equal(r.cues.length, 4);
  assert.equal(r.cues[0].text, '词是真相，');
  assert.equal(r.cues[1].text, '句子和 cue 都是投影。');
  assert.equal(r.cues[1].id, 'g1-1');
  assert.equal(r.id, 'g1-1');
  assert.equal(r.cues[1].root, 'g1');
  assert.equal(r.cues[0].end, r.cues[1].start);
  assert.equal(r.cues[1].trans, '');
  assert.equal(r.cues[0].trans, 'Words are the truth.');
  // 再拆一次拆出来的那条：id 不撞、root 仍是最初那条
  const r2 = O.splitCue(r.cues, 'g1-1', r.cues[1].text, 3);
  assert.equal(r2.cues[2].id, 'g1-2');
  assert.equal(r2.cues[2].root, 'g1');
  assert.equal(O.splitCue(cues, 'g1', cues[0].text, 0), null);
  assert.equal(O.splitCue(cues, 'g1', cues[0].text, 99), null);
  assert.equal(O.splitCue(cues, 'nope', 'x y', 1), null);
  // 拆用的是这一刻的文本（还没提交的改写也算）
  assert.equal(O.splitCue(cues, 'g1', 'ab cd', 2).cues[0].text, 'ab');
});

test('mergeCues：同说话人上下都能并，接缝位置回来；不同说话人与边界报 err', () => {
  const up = O.mergeCues(cues, 'g2', null, -1);
  assert.equal(up.cues.length, 2);
  assert.equal(up.id, 'g1');
  assert.equal(up.cues[0].text, cues[0].text + cues[1].text);
  assert.equal(up.cues[0].trans, 'Words are the truth. Editing never scrambles.');
  assert.equal(up.cues[0].end, 6);
  assert.equal(up.caret, cues[0].text.length);
  const down = O.mergeCues(cues, 'g1', '改过的', 1);
  assert.equal(down.cues[0].text, '改过的' + cues[1].text);
  assert.equal(down.caret, 3);
  assert.deepEqual(O.mergeCues(cues, 'g2', null, 1), {err: 'speaker'});
  assert.deepEqual(O.mergeCues(cues, 'g1', null, -1), {err: 'edge'});
  assert.equal(O.canMergeCues(cues, 'g2', -1), true);
  assert.equal(O.canMergeCues(cues, 'g3', -1), false);
});

test('parasOf：拆出来的新条按 root 归回原段，并掉的条消失，空段不出现', () => {
  const r = O.splitCue(cues, 'g2', cues[1].text, 4);
  const ps = O.parasOf(r.cues, paras);
  assert.deepEqual(ps[0].cueIds, ['g1', 'g2', 'g2-1']);
  assert.equal(ps[0].end, 6);
  const m = O.mergeCues(cues, 'g2', null, -1);
  assert.deepEqual(O.parasOf(m.cues, paras)[0].cueIds, ['g1']);
  // g3 并到 g2 上去（假设同说话人）之后 p2 一条都不剩
  const same = cues.map((c) => Object.assign({}, c, {sp: 's1'}));
  const m2 = O.mergeCues(same, 'g3', null, -1);
  const ps2 = O.parasOf(m2.cues, paras);
  assert.equal(ps2.length, 1);
  assert.equal(ps2[0].end, 9);
});

const cards = [
  {id: 'x1', kind: 'block', sp: 's1', time: '00:12.1', cps: 9,
   blocks: [{o: '对齐之后，', t: 'Once aligned,'}, {o: '字幕、', t: 'subtitles,'}, {o: '翻译和动画', t: 'translations and animations'}]},
  {id: 'x2', kind: 'plain', sp: 's1', time: '00:18.6', cps: 12, orig: '因为素材是别人的。', trans: 'Because the footage isn’t ours.'},
  {id: 'x3', kind: 'plain', sp: 's3', time: '00:21.4', cps: 7, stale: true, orig: '而且模型跑得动了。', trans: 'And the models run fine now.'},
  {id: 'x5', kind: 'many', sp: 's3', time: '00:24.0', subs: ['等一下，', '先看看导出。'], trans: 'Hold on'},
];

test('rowsOf / withRows：块卡与普通卡都有行，其余没有；一行收成普通卡、多行是块卡', () => {
  assert.equal(O.rowsOf(cards[0]).length, 3);
  assert.deepEqual(O.rowsOf(cards[1]), [{o: '因为素材是别人的。', t: 'Because the footage isn’t ours.'}]);
  assert.equal(O.rowsOf(cards[3]), null);
  const one = O.withRows(cards[0], [{o: 'a', t: 'b'}]);
  assert.equal(one.kind, 'plain');
  assert.equal(one.orig, 'a');
  assert.equal(one.blocks, undefined);
  assert.equal(one.time, '00:12.1');
  const two = O.withRows(cards[1], [{o: 'a', t: 'b'}, {o: 'c', t: 'd'}]);
  assert.equal(two.kind, 'block');
  assert.equal(two.orig, undefined);
  assert.deepEqual(two.blocks.map((b) => b.ow), [1, 1]);
});

test('splitRow：两侧在已有对齐边界同时拆开，不产生空侧', () => {
  const c = {id: 'pair', kind: 'plain', orig: '翻译和动画', trans: 'translations and animations',
    units: [{o: '翻译', t: 'translations'}, {o: '和动画', t: 'and animations'}]};
  for (const [side, text, at] of [['trans', c.trans, 11], ['orig', c.orig, 3]]) {
    const p = O.splitRow(c, 0, side, text, at);
    assert.equal(p.kind, 'block');
    assert.deepEqual(p.blocks.map(b => [b.o, b.t]), [['翻译', 'translations'], ['和动画', 'and animations']]);
    const merged = O.mergeRows(p, 1, side, null, -1).card;
    assert.equal(merged.orig, c.orig); assert.equal(merged.trans, c.trans);
    assert.deepEqual(O.splitRow(merged, 0, side, text, at).blocks, p.blocks);
  }
  const dirty = O.splitRow(c, 0, 'trans', 'translations and motion', 12);
  assert.equal(dirty.blocks[1].t, 'and motion');
  assert.equal(dirty.blocks[1].o, '和动画');
  assert.equal(c.trans, 'translations and animations');
  assert.equal(O.splitRow(cards[0], 2, 'trans', 'translations and animations', 12), null, '没有内部块边界时不猜切点');
  assert.equal(O.splitRow(cards[1], 0, 'orig', 'abc', 3), null);
  assert.equal(O.splitRow(cards[3], 0, 'orig', 'a b', 1), null);
});

test('合并保留已知接缝；旧文本覆盖不能继续使用过期内部边界', () => {
  const merged = O.mergeRows(cards[0], 1, 'orig', null, -1).card;
  const split = O.splitRow(merged, 0, 'orig', merged.blocks[0].o, 5);
  assert.deepEqual(split.blocks.map(b => [b.o, b.t]), cards[0].blocks.map(b => [b.o, b.t]));
  merged.blocks[0].o = '已重写过且无法对齐';
  assert.equal(O.splitRow(merged, 0, 'orig', merged.blocks[0].o, 3), null);
});

test('普通卡原文拆 cue 变多对一，子行拆并都不切整句译文', () => {
  const card = cards[1];
  const split = O.splitSourceRow(card, 0, card.orig, 2);
  assert.equal(split.kind, 'many');
  assert.deepEqual(split.subs, ['因为', '素材是别人的。']);
  assert.equal(split.trans, card.trans);
  const more = O.splitSourceRow(split, 1, split.subs[1], 2);
  assert.equal(more.subs.length, 3); assert.equal(more.trans, card.trans);
  const merged = O.mergeSourceRows(split, 1, '新原文', -1);
  assert.equal(merged.card.kind, 'plain'); assert.equal(merged.card.orig, '因为新原文');
  assert.equal(merged.card.trans, card.trans);
  assert.equal(O.splitSourceRow({kind: 'sentence', words: ['整句参考']}, 0, '整句参考', 2), null);
  assert.equal(O.mergeSourceRows(split, 0, '因为', -1), null);
});

test('mergeRows：相邻两行两侧各自相接，接缝位置回来；并到只剩一行就是普通卡', () => {
  const r = O.mergeRows(cards[0], 1, 'orig', null, -1);
  assert.equal(r.row, 0);
  assert.equal(r.card.blocks.length, 2);
  assert.equal(r.card.blocks[0].o, '对齐之后，字幕、');
  assert.equal(r.card.blocks[0].t, 'Once aligned, subtitles,');
  assert.deepEqual(r.caret, {o: 5, t: 14});
  const d = O.mergeRows(cards[0], 1, 'trans', 'subs', 1);
  assert.equal(d.row, 1);
  assert.equal(d.card.blocks[1].t, 'subs translations and animations');
  assert.equal(d.caret.t, 5);
  const two = O.withRows(cards[1], [{o: 'a', t: 'b'}, {o: 'c', t: 'd'}]);
  assert.equal(O.mergeRows(two, 1, 'orig', null, -1).card.kind, 'plain');
  assert.deepEqual(O.mergeRows(cards[0], 0, 'orig', null, -1), {err: 'edge'});
  assert.deepEqual(O.mergeRows(cards[3], 0, 'orig', null, -1), {err: 'kind'});
});

test('mergeCards：同说话人的两句首尾相接成一张块卡；不同说话人、没有行的卡、边界报 err', () => {
  const r = O.mergeCards(cards, 'x2', -1);
  assert.equal(r.cards.length, 3);
  assert.equal(r.id, 'x1');
  assert.equal(r.row, 3);
  assert.equal(r.cards[0].blocks.length, 4);
  assert.equal(r.cards[0].blocks[3].o, '因为素材是别人的。');
  assert.equal(r.cards[1].id, 'x3');
  assert.deepEqual(O.mergeCards(cards, 'x3', -1), {err: 'speaker'});
  assert.deepEqual(O.mergeCards(cards, 'x5', -1), {err: 'kind'});
  assert.deepEqual(O.mergeCards(cards, 'x1', -1), {err: 'edge'});
  assert.equal(O.canMergeCards(cards, 'x1', 1), true);
  assert.equal(O.canMergeCards(cards, 'x3', 1), false);
  // 过期标记跟着并进来
  const s = O.mergeCards(cards.map((c) => Object.assign({}, c, {sp: 's1'})), 'x3', -1);
  assert.equal(s.cards[1].stale, true);
});

test('caretTime：按字符位置在 [start, end] 里插值，两端与非法输入收到 start、不越过 end', () => {
  assert.equal(O.caretTime(10, 14, 5, 10), 12);
  assert.equal(O.caretTime(10, 14, 0, 10), 10);
  assert.equal(O.caretTime(10, 14, 10, 10), 14);
  assert.equal(O.caretTime(10, 14, 99, 10), 14);
  assert.equal(O.caretTime(10, 14, 3, 0), 10);
  assert.equal(O.caretTime(10, 8, 3, 10), 10);
  assert.equal(O.caretTime(1.2, 1.5, 1, 3), 1.3);
});
