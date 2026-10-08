/* model-project-search.js 的判据：两层字段、大小写、snippet 边界、排序、分页。 */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-find.js');
require('./model-project-search.js');
const PS = global.window.BC_PSEARCH;

const P = (over) => Object.assign({
  id: 'px', title: '样例项目', mtime: 100,
  src: {name: 'x.mp4', path: '~/Movies/x.mp4'},
  content: {},
}, over);

test('元信息层覆盖十个字段', () => {
  const p = P({
    id: 'p9', title: '语音', desc: '语音', notes: '语音', url: 'https://e.test/语音',
    src: {name: '语音.mp4', path: '~/Movies/语音.mp4'},
    source: {title: '语音', desc: '语音', uploader: '语音'},
  });
  const rows = PS.metadataRows(p, '语音');
  const keys = rows.map((r) => r.field);
  ['title', 'file', 'path', 'desc', 'notes', 'url', 'srcTitle', 'srcDesc', 'uploader']
    .forEach((k) => assert.ok(keys.includes(k), k));
  assert.ok(rows.every((r) => r.tier === 1));
});

test('内容层带时间码与语言 chip', () => {
  const p = P({content: {
    chapters: [{t: 12, title: '语音识别'}],
    speakers: ['语音助手'],
    paras: [{t: 30, text: '这里讲语音'}],
    trans: [{t: 30, lang: '简体中文', text: '语音 here'}],
    overlay: [{t: 44, text: '语音 overlay'}],
  }});
  const rows = PS.contentRows(p, '语音');
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.tier === 2));
  const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
  assert.equal(byField.transcript.t, 30);
  assert.equal(byField.speaker.t, null);
  assert.equal(byField.trans.chip, '译文 · 简体中文');
  assert.ok(byField.chapter.timed);
});

test('大小写不敏感，且一条文本里的多次命中都算', () => {
  assert.equal(PS.highlightRanges('Voice voice VOICE', 'voice').length, 3);
  const r = PS.highlightRanges('Local-first', 'LOCAL');
  assert.deepEqual(r, [{start: 0, end: 5}]);
});

test('空 query 不出结果', () => {
  assert.deepEqual(PS.highlightRanges('语音', '  '), []);
  assert.deepEqual(PS.metadataResults([P({title: '语音'})], ''), []);
  assert.deepEqual(PS.search([P({title: '语音'})], '   '), []);
  assert.equal(PS.statusLabel([], '', false), '');
});

test('短文本不取窗，长文本按 lead 留头并两端补省略号', () => {
  const short = '一段很短的文稿';
  assert.deepEqual(PS.snippet(short, [{start: 3, end: 5}]),
    {text: short, ranges: [{start: 3, end: 5}], head: false, tail: false});

  const long = 'a'.repeat(200) + '语音' + 'b'.repeat(200);
  const cut = PS.snippet(long, PS.highlightRanges(long, '语音'));
  assert.equal(cut.text.length, PS.WIN);
  assert.equal(cut.head, true);
  assert.equal(cut.tail, true);
  assert.equal(cut.ranges[0].start, PS.LEAD);
  assert.equal(cut.text.slice(cut.ranges[0].start, cut.ranges[0].end), '语音');
});

test('命中靠前时不往前顶，命中靠尾时窗口整体退回来', () => {
  const head = '语音' + 'b'.repeat(200);
  const a = PS.snippet(head, PS.highlightRanges(head, '语音'));
  assert.equal(a.head, false);
  assert.equal(a.ranges[0].start, 0);

  const tail = 'a'.repeat(200) + '语音';
  const b = PS.snippet(tail, PS.highlightRanges(tail, '语音'));
  assert.equal(b.tail, false);
  assert.equal(b.text.length, PS.WIN);
  assert.equal(b.text.slice(b.ranges[0].start, b.ranges[0].end), '语音');
});

test('窗口边界不切开代理对，且区间基准跟着窗口走', () => {
  const emoji = '\u{1F600}';                       // 一个 emoji = 两个 UTF-16 码元
  const long = emoji.repeat(60) + '语音' + 'b'.repeat(200);
  const cut = PS.snippet(long, PS.highlightRanges(long, '语音'));
  assert.equal(cut.text.slice(cut.ranges[0].start, cut.ranges[0].end), '语音');
  assert.ok(!/[\uD800-\uDBFF]$/.test(cut.text));   // 尾巴不留半个代理对
  assert.ok(!/^[\uDC00-\uDFFF]/.test(cut.text));   // 开头不留半个代理对
});

test('排序：ID 整串相等 > 字段权重 > 命中条数 > 修改时间新者', () => {
  const projects = [
    P({id: 'a1', title: '语音笔记', mtime: 500}),                       // title, w=90
    P({id: '语音', title: '无关', mtime: 900}),                          // id 整串相等
    P({id: 'a3', title: '无关', mtime: 10, src: {name: '语音.mp4', path: '~/x'}}),   // file, w=80
    P({id: 'a4', title: '无关', mtime: 5, src: {name: '语音.mp4', path: '~/语音/x'}}), // file + path
  ];
  const got = PS.search(projects, '语音').map((g) => g.id);
  assert.deepEqual(got, ['语音', 'a1', 'a4', 'a3']);
});

test('修改时间是同分组内最后一条判据', () => {
  const projects = [P({id: 'old', title: '语音', mtime: 900}), P({id: 'new', title: '语音', mtime: 3})];
  assert.deepEqual(PS.search(projects, '语音').map((g) => g.id), ['new', 'old']);
});

test('两层合并后同一个项目只出现一组', () => {
  const p = P({id: 'p1', title: '语音', content: {paras: [{t: 1, text: '语音'}]}});
  const got = PS.search([p], '语音');
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].rows.map((r) => r.field), ['title', 'transcript']);
  assert.equal(PS.total(got), 2);
});

test('只出第一层时不含内容行', () => {
  const p = P({id: 'p1', title: '语音', content: {paras: [{t: 1, text: '语音'}]}});
  const got = PS.search([p], '语音', {content: false});
  assert.deepEqual(got[0].rows.map((r) => r.field), ['title']);
  assert.equal(PS.statusLabel(got, '语音', true), '正在搜索文稿…');
  assert.equal(PS.statusLabel(got, '语音', false), '1 条结果 ·「语音」');
});

test('分页：默认十条，一次再放十条', () => {
  const rows = Array.from({length: 23}, (_, i) => ({i}));
  const a = PS.planRows(rows);
  assert.equal(a.rows.length, 10);
  assert.equal(a.rest, 13);
  assert.equal(a.more, 10);
  assert.equal(a.next, 20);

  const b = PS.planRows(rows, a.next);
  assert.equal(b.rows.length, 20);
  assert.equal(b.rest, 3);
  assert.equal(b.more, 3);

  const c = PS.planRows(rows, b.next);
  assert.equal(c.rows.length, 23);
  assert.equal(c.rest, 0);
  assert.equal(c.more, 0);

  assert.equal(PS.planRows([], 10).rows.length, 0);
  assert.equal(PS.planRows(rows, 0, 5).rows.length, 0);
  assert.equal(PS.planRows(rows, null, 5).rows.length, 5);
});
