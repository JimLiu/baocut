/* node --test designs/baocut/app/model-subseg.test.js
   字幕轨的段（第 244 轮）：一层一枚 chip、段数、播放头落在哪一段、纪录片演示轨集。 */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-subseg.js');
const G = window.BC_SUBSEG;

const segs = [
  {id: 'b', start: 20, end: 30, source: '实拍 B'},
  {id: 'a', start: 0, end: 10, source: '实拍 A'},
  {id: 'c', start: 54.6, end: 60, source: '实拍 IzV8Vzekqg0'},
];
const layer = {id: 'en', lang: 'en', name: 'English', role: 'source', segments: segs};

test('没有 segments 的轨算一段，不出段落行', () => {
  const t = {id: 'zh', role: 'source', name: '中文'};
  assert.deepStrictEqual(G.segments(t), []);
  assert.equal(G.count(t), 1);
  assert.equal(G.hasRow(t), false);
  assert.equal(G.segmentAt(t, 5), null);
  assert.equal(G.count({segments: [segs[0]]}), 1);
  assert.equal(G.hasRow({segments: [segs[0]]}), false);
});

test('段按开始时刻排，段数就是 chip 上的数', () => {
  assert.deepStrictEqual(G.segments(layer).map((s) => s.id), ['a', 'b', 'c']);
  assert.equal(G.count(layer), 3);
  assert.equal(G.hasRow(layer), true);
  // 不改入参
  assert.equal(layer.segments[0].id, 'b');
});

test('chip 上的字：一层原文写「原文」，两层原文带语言，译文写语言名', () => {
  const zh = {id: 'zh', role: 'source', name: '中文'};
  const tr = {id: 'zh-tr', role: 'translation', name: '中文'};
  assert.equal(G.chipLabel(zh, [zh, tr]), '原文');
  assert.equal(G.chipLabel(tr, [zh, tr]), '中文');
  assert.equal(G.chipLabel(zh, [zh, layer, tr]), '原文 · 中文');
  assert.equal(G.chipLabel(layer, [zh, layer, tr]), '原文 · English');
  assert.equal(G.chipLabel({role: 'translation', lang: 'ja'}, []), 'ja');
  assert.equal(G.chipLabel(null, []), '');
});

test('播放头落在段内、段间、第一段之前、最后一段之后', () => {
  assert.equal(G.segmentAt(layer, 5).id, 'a');
  assert.equal(G.segmentAt(layer, 20).id, 'b');      // 起点算在段内
  assert.equal(G.segmentAt(layer, 30).id, 'b');      // 终点不算，落在段间 → 最近开始过的
  assert.equal(G.segmentAt(layer, 40).id, 'b');
  assert.equal(G.segmentAt(layer, 999).id, 'c');
  assert.equal(G.segmentAt({segments: [segs[0]]}, 3).id, 'b');  // 比第一段还早 → 第一段
});

test('covers：没有段恒在，有段只在段内', () => {
  assert.equal(G.covers({}, 999), true);
  assert.equal(G.covers(layer, 5), true);
  assert.equal(G.covers(layer, 15), false);
});

test('段的叫法：开始时刻 · 素材名', () => {
  assert.equal(G.segmentLabel(segs[2]), '0:54 · 实拍 IzV8Vzekqg0');
  assert.equal(G.segmentLabel({start: 125, end: 130}), '2:05');
  assert.equal(G.segmentLabel(null), '');
  assert.equal(G.mmss(-3), '0:00');
});

test('演示开关只认 subdemo=documentary', () => {
  assert.equal(G.demo('?subdemo=documentary'), true);
  assert.equal(G.demo('?perf=1&subdemo=documentary'), true);
  assert.equal(G.demo('?subdemo=documentaryx'), false);
  assert.equal(G.demo(''), false);
  assert.equal(G.demo(undefined), false);
});

test('纪录片轨集：三层、各 11 段，旁白与采访交替，译文与采访同起止', () => {
  const base = [
    {id: 'en', lang: 'en', name: 'English', role: 'translation', size: 32, y: 86, color: 'w'},
    {id: 'zh', lang: 'zh', name: '中文', role: 'source', size: 20, y: 93, wordAnim: 'x', color: 'w'},
  ];
  const out = G.documentaryTracks(base, 206);
  assert.deepStrictEqual(out.map((t) => [t.id, t.role, t.lang]),
    [['zh-tr', 'translation', 'zh'], ['zh', 'source', 'zh'], ['en', 'source', 'en']]);
  out.forEach((t) => assert.equal(G.count(t), 11));
  const [tr, narr, iv] = out;
  assert.equal(tr.of, 'en');
  assert.deepStrictEqual(tr.segments.map((s) => [s.start, s.end]), iv.segments.map((s) => [s.start, s.end]));
  // 交替：旁白一段结束处正是采访一段开始处，同一时刻不重叠
  narr.segments.forEach((s, i) => assert.equal(s.end, iv.segments[i].start));
  assert.equal(iv.segments[10].end, 206);
  assert.equal(G.covers(narr, 1) && !G.covers(iv, 1), true);
  // 两层原文时 chip 带语言
  assert.deepStrictEqual(out.map((t) => G.chipLabel(t, out)), ['中文', '原文 · 中文', '原文 · English']);
  // 不改默认那一对
  assert.equal(base[1].segments, undefined);
  // 凑不齐一对时原样返回
  assert.deepStrictEqual(G.documentaryTracks([base[1]], 206), [base[1]]);
});

test('倒转配对：采访的译文与采访原文换位，旁白不动', () => {
  require('./model-substyle.js');
  const S = window.BC_SUB;
  const base = [
    {id: 'en', lang: 'en', name: 'English', role: 'translation', size: 32, y: 86, valign: 'bottom'},
    {id: 'zh', lang: 'zh', name: '中文', role: 'source', size: 20, y: 93, valign: 'bottom'},
  ];
  // 默认一对（没有 `of`）照旧
  assert.equal(S.stackOrder({tracks: base}), 'transTop');
  assert.deepStrictEqual(S.flipStack({tracks: base}).map((t) => [t.id, t.y, t.size]), [['en', 93, 20], ['zh', 86, 32]]);
  const doc = {tracks: G.documentaryTracks(base, 206)};
  assert.equal(S.stackOrder(doc), 'transTop');
  const flipped = S.flipStack(doc);
  assert.deepStrictEqual(flipped.map((t) => [t.id, t.y, t.size]), [['zh-tr', 93, 20], ['zh', 90, 28], ['en', 86, 32]]);
  assert.equal(S.stackOrder({tracks: flipped}), 'srcTop');
  // 段跟着轨走
  assert.equal(G.count(flipped[0]), 11);
});

test('换语言：段与配对跟新轨走，不从被换掉的那层继承', () => {
  const S = window.BC_SUB;
  const base = [
    {id: 'en', lang: 'en', name: 'English', role: 'translation', size: 32, y: 86},
    {id: 'zh', lang: 'zh', name: '中文', role: 'source', size: 20, y: 93},
  ];
  const doc = {tracks: G.documentaryTracks(base, 206)};
  const out = S.replaceTrack(doc, 'zh-tr', {id: 'ja', lang: 'ja', name: '日本語', role: 'translation'});
  const ja = out.find((t) => t.id === 'ja');
  assert.equal(ja.segments, undefined);
  assert.equal(ja.of, undefined);
  assert.equal(G.count(ja), 1);
  assert.equal(ja.size, 32);   // 长相仍继承
});
