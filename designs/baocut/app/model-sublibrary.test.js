/* node --test designs/baocut/app/model-sublibrary.test.js
   钉 caption-editor-redesign §8 / §9.1：来源与分区、效果标签取交集、搜索、适配判定只标不藏、
   「只看合适的」收起、收藏与最近用过。 */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-sublibrary.js');
const L = window.BC_LIB;

const CATS = [{k: 'basic', name: '基础'}, {k: 'neon', name: '霓虹'}];
const PACK = {id: 'demo', name: '演示包', categories: [{id: 'title', name: '标题'}, {id: 'fun', name: '活泼'}]};
const cards = [
  {id: 'a', name: '白字黑边', cat: 'basic', tags: ['stroke'], activeWord: {mode: 'none', spoken: 'keep', unspoken: 'keep'}},
  {id: 'b', name: '霓虹粉', cat: 'neon', tags: ['glow', 'active-color'], activeWord: {mode: 'color'}},
  {id: 'c', name: '霓虹描边', cat: 'neon', tags: ['glow', 'stroke'], activeWord: {mode: 'none'}, pagination: {wordsPerPage: 3}},
  {id: 'm1', name: '我的一份', brand: true, anim: 'none', tags: []},
  {id: 'p1', name: '大标题', pack: PACK, categories: ['title'], tags: ['word-pop'], needsWordTiming: true, scripts: ['Latn']},
  {id: 'p2', name: '不能画', pack: PACK, categories: ['fun'], tags: [], unsupported: {reason: '未知能力 particle'}},
];
const names = {cat: {basic: '基础', neon: '霓虹'}, tag: (k) => ({stroke: '描边', glow: '发光'})[k] || k};
const ctx = (extra) => Object.assign({cats: CATS, packs: [PACK], names, fav: [], recent: []}, extra);
const ids = (secs) => secs.map((s) => [s.k, s.items.map((x) => x.id)]);

test('来源：全部 / 内置 / 我的 / 每个样式包', () => {
  assert.deepEqual(L.sources([PACK]).map((s) => s.k), ['all', 'builtin', 'mine', 'pack:demo']);
  assert.deepEqual(cards.map(L.sourceOf), ['builtin', 'builtin', 'builtin', 'mine', 'pack:demo', 'pack:demo']);
  assert.deepEqual(L.categoriesOf('builtin', CATS, [PACK]).map((c) => c.k), ['basic', 'neon']);
  assert.deepEqual(L.categoriesOf('mine', CATS, [PACK]).map((c) => c.k), ['fav', 'recent', 'brand']);
  assert.deepEqual(L.categoriesOf('pack:demo', CATS, [PACK]).map((c) => c.id), ['title', 'fun']);
  assert.deepEqual(L.categoriesOf('all', CATS, [PACK]), []);
});

test('全部：品牌库在前，内置按分区，样式包各一节', () => {
  const f = {source: 'all', cat: 'all', q: '', tags: []};
  assert.deepEqual(ids(L.sections(cards, f, ctx())), [
    ['brand', ['m1']], ['basic', ['a']], ['neon', ['b', 'c']], ['pack:demo', ['p1', 'p2']]]);
});

test('选一个来源之后按它自己的分区陈列，分区可单选', () => {
  assert.deepEqual(ids(L.sections(cards, {source: 'builtin', cat: 'neon'}, ctx())), [['neon', ['b', 'c']]]);
  assert.deepEqual(ids(L.sections(cards, {source: 'pack:demo', cat: 'all'}, ctx())),
    [['pack:demo:title', ['p1']], ['pack:demo:fun', ['p2']]]);
  const mine = L.sections(cards, {source: 'mine', cat: 'all'}, ctx({fav: ['b'], recent: ['c', 'a']}));
  assert.deepEqual(ids(mine), [['fav', ['b']], ['recent', ['c', 'a']], ['brand', ['m1']]]);
});

test('效果标签之间取交集，再与搜索取交集；有筛选时计数', () => {
  const f = {source: 'all', cat: 'all', q: '', tags: ['glow', 'stroke']};
  const secs = L.sections(cards, f, ctx());
  assert.deepEqual(ids(secs), [['neon', ['c']]], '品牌库那一节在有筛选时空了就不留');
  assert.equal(L.count(secs), 1);
  assert.ok(L.hasFilter(f));
  assert.deepEqual(L.filter(cards, {q: '霓虹 描边'}, ctx()).map((c) => c.id), ['c'], '名字与标签名都算');
  assert.deepEqual(L.filter(cards, {q: '基础'}, ctx()).map((c) => c.id), ['a'], '分区名也算');
  assert.deepEqual(L.filter(cards, {q: '演示包'}, ctx()).map((c) => c.id), ['p1', 'p2'], '包名也算');
});

test('没筛选时品牌库空着也留一节（视图写引导），有筛选时不留', () => {
  const none = cards.filter((c) => !c.brand);
  assert.deepEqual(ids(L.sections(none, {source: 'all'}, ctx()))[0], ['brand', []]);
  assert.ok(!L.sections(none, {source: 'all', q: '霓虹'}, ctx()).some((s) => s.k === 'brand'));
});

test('适配判定：要逐词时间而轨没有 → 标；模板字体不含文字系统 → 标；设备不支持 → 不可套用', () => {
  const noTiming = {wordTiming: false, script: 'Hans'};
  assert.deepEqual(L.fitOf(cards[0], noTiming).notes, [], '什么都不动的卡不要逐词时间');
  assert.deepEqual(L.fitOf(cards[1], noTiming).notes.map((n) => n.k), ['timing']);
  assert.deepEqual(L.fitOf(cards[2], noTiming).notes.map((n) => n.k), ['timing'], '分页也要逐词时间');
  assert.deepEqual(L.fitOf(cards[4], noTiming).notes.map((n) => n.k), ['timing', 'font']);
  assert.deepEqual(L.fitOf(cards[4], {wordTiming: true, script: 'Latn'}).notes, []);
  assert.equal(L.fitOf(cards[5], null).blocked.text, '这台设备不支持 · 未知能力 particle');
  assert.ok(L.needsTiming({motion: {in: {trigger: 'spoken'}}}));
  assert.ok(L.needsTiming({anim: 'karaoke'}), '品牌库旧卡');
  assert.ok(!L.needsTiming({motion: {in: {trigger: 'cue'}}}));
});

test('只看合适的：收起两类提示与不可套用；它不算筛选，清除筛选也不动它', () => {
  const f = {source: 'all', fitOnly: true};
  const left = L.filter(cards, f, ctx({target: {wordTiming: false, script: 'Hans'}})).map((c) => c.id);
  assert.deepEqual(left, ['a', 'm1']);
  assert.ok(!L.hasFilter(f));
  assert.deepEqual(L.cleared({source: 'mine', cat: 'fav', q: 'x', tags: ['glow'], fitOnly: true}),
    {source: 'mine', cat: 'all', q: '', tags: [], fitOnly: true});
});

test('收藏切换、最近用过去重限 12 个、换来源分区回到全部、标签切换', () => {
  assert.deepEqual(L.toggleFav(['a'], 'b'), ['b', 'a']);
  assert.deepEqual(L.toggleFav(['b', 'a'], 'b'), ['a']);
  let r = [];
  for (let i = 0; i < 15; i++) r = L.pushRecent(r, 'x' + i);
  assert.equal(r.length, L.RECENT_MAX);
  assert.deepEqual(L.pushRecent(['a', 'b', 'c'], 'c'), ['c', 'a', 'b']);
  assert.deepEqual(L.withSource({source: 'builtin', cat: 'neon', tags: ['glow']}, 'mine'), {source: 'mine', cat: 'all', tags: ['glow']});
  assert.deepEqual(L.toggleTag({tags: ['glow']}, 'stroke').tags, ['glow', 'stroke']);
  assert.deepEqual(L.toggleTag({tags: ['glow', 'stroke']}, 'glow').tags, ['stroke']);
});
