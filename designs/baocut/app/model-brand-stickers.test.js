/* model-brand-stickers.test.js —— 品牌库贴纸收件规则（第 238 轮）：白名单、
   字节优先的类型判定、20 MiB 上限、展示名与重名追加。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
// 分区判据借自 `BC_STSRC`（见 `isDynamic`），所以这里要一并装上。
require('./model-sticker-source.js');
require('./model-brand-stickers.js');
const B = window.BC_BRAND_STICKERS;

test('白名单是 8 个扩展名（第 242 轮加 .zip）', () => {
  assert.deepStrictEqual(Object.keys(B.ACCEPT),
    ['json', 'gif', 'svg', 'png', 'webp', 'jpg', 'jpeg', 'zip']);
  assert.strictEqual(B.MAX_BYTES, 20 * 1024 * 1024);
  ['a.json', 'a.GIF', 'b/c.svg', 'd.png', 'd.webp', 'd.jpg', 'd.jpeg', 'pet.zip'].forEach((n) => {
    assert.strictEqual(B.accepts(n), true, n);
  });
  ['a.mp4', 'a.txt', 'a', '.json'].forEach((n) => {
    assert.strictEqual(B.accepts(n), false, n);
  });
  assert.strictEqual(B.kindFromName('a.json.zip'), 'pet');
  assert.strictEqual(B.kindFromName('a.json'), 'lottie');
  assert.strictEqual(B.kindFromName('a.webp'), 'image');
  assert.strictEqual(B.kindFromName('a.mp4'), null);
});

test('字节头能判类型，且优先于扩展名', () => {
  const lottie = JSON.stringify({v: '5.7.4', fr: 60, ip: 0, op: 60, layers: [{ty: 4}]});
  assert.strictEqual(B.kindFromBytes(lottie), 'lottie');
  assert.strictEqual(B.kindFromBytes('GIF89a  '), 'gif');
  assert.strictEqual(B.kindFromBytes('PK\x03\x04\x14\x00'), 'pet');
  assert.strictEqual(B.kindFromBytes('<svg viewBox="0 0 24 24"></svg>'), 'svg');
  assert.strictEqual(B.kindFromBytes('<?xml version="1.0"?>\n<svg></svg>'), 'svg');
  assert.strictEqual(B.kindFromBytes('  \n<svg/>'), 'svg');
  // 是 JSON 但不是 Lottie（没有 layers）
  assert.strictEqual(B.kindFromBytes('{"hello":1}'), null);
  // 半截 JSON
  assert.strictEqual(B.kindFromBytes('{"layers":['), null);
  assert.strictEqual(B.kindFromBytes(''), null);
  assert.strictEqual(B.kindFromBytes(undefined), null);
  // 用户把 Lottie 存成了 .txt：字节说了算
  assert.strictEqual(B.kindOf('logo.txt', lottie), 'lottie');
  // 拿不到字节时退回扩展名
  assert.strictEqual(B.kindOf('logo.gif', null), 'gif');
});

test('展示名去扩展名、把下划线连字符换成空格、截到 40 字', () => {
  assert.strictEqual(B.displayName('brand_wave-01.json'), 'brand wave 01');
  assert.strictEqual(B.displayName('/a/b/Logo Loop.gif'), 'Logo Loop');
  assert.strictEqual(B.displayName('no-ext'), 'no ext');
  assert.strictEqual(B.displayName('___.svg'), '贴纸');
  assert.strictEqual(B.displayName(null), '贴纸');
  assert.strictEqual(B.displayName('x'.repeat(60) + '.json').length, 40);
});

test('重名追加 -2、-3，不覆盖也不拒收', () => {
  assert.strictEqual(B.uniqueName('logo', []), 'logo');
  assert.strictEqual(B.uniqueName('logo', ['logo']), 'logo-2');
  assert.strictEqual(B.uniqueName('logo', ['logo', 'logo-2']), 'logo-3');
  assert.strictEqual(B.uniqueName('logo', ['logo', 'logo-3']), 'logo-2');
  assert.deepStrictEqual(B.takenNames([{name: 'a'}, null, {name: 'b'}]), ['a', 'b']);
});

test('validate：扩展名、20 MiB 上限、空文件、坏 Lottie 四种拒收', () => {
  const lottie = JSON.stringify({layers: []});
  assert.deepStrictEqual(B.validate({name: 'a.json', size: 100}, lottie), {ok: true, kind: 'lottie'});
  assert.strictEqual(B.validate({name: 'a.mp4', size: 100}).ok, false);
  assert.strictEqual(B.validate({name: 'a.mp4', size: 100}).reason, B.REASONS.ext);
  assert.strictEqual(B.validate({name: 'a.gif', size: B.MAX_BYTES + 1}).reason, B.REASONS.size);
  assert.deepStrictEqual(B.validate({name: 'a.gif', size: B.MAX_BYTES}), {ok: true, kind: 'gif'});
  assert.strictEqual(B.validate({name: 'a.gif', size: 0}).reason, B.REASONS.empty);
  assert.strictEqual(B.validate({name: 'a.json', size: 10}, '{"nope":1}').reason, B.REASONS.broken);
});

test('intake 给出可以直接进 ctx.brandStickers 的一条记录', () => {
  const r = B.intake({name: 'Brand_Wave.gif', size: 2048}, null,
    {src: 'blob:x', taken: ['Brand Wave']});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.item.name, 'Brand Wave-2');
  assert.strictEqual(r.item.kind, 'gif');
  assert.strictEqual(r.item.src, 'blob:x');
  assert.strictEqual(r.item.size, 2048);
  assert.strictEqual(r.item.added, true);
  assert.strictEqual(typeof r.item.addedAt, 'number');
  assert.ok(r.item.addedAt > 0);
  assert.ok(r.item.id.startsWith('bs-'));
  assert.strictEqual(B.intake({name: 'a.mp4', size: 1}).ok, false);
});

test('recency：用过看 usedAt，没用过回落 addedAt', () => {
  assert.strictEqual(B.recency({addedAt: 5}), 5);
  assert.strictEqual(B.recency({addedAt: 5, usedAt: 9}), 9);
  assert.strictEqual(B.recency({addedAt: 5, usedAt: 0}), 5);
  assert.strictEqual(B.recency(null), 0);
});

test('mru 最近用过在前，同一刻保持库里的原序', () => {
  const list = [
    {id: 'a', addedAt: 1},
    {id: 'b', addedAt: 1},
    {id: 'c', addedAt: 1, usedAt: 30},
    {id: 'd', addedAt: 20},
  ];
  assert.deepStrictEqual(B.mru(list).map((m) => m.id), ['c', 'd', 'a', 'b']);
  assert.deepStrictEqual(list.map((m) => m.id), ['a', 'b', 'c', 'd']);  // 不就地改
  assert.deepStrictEqual(B.mru([]), []);
});

test('touch 只盖被点的那一条，认不出的 id 原样返回', () => {
  const list = [{id: 'a', addedAt: 1}, {id: 'b', addedAt: 2}];
  const next = B.touch(list, 'b', 77);
  assert.deepStrictEqual(next.map((m) => m.usedAt), [undefined, 77]);
  assert.deepStrictEqual(B.touch(list, 'zzz', 77).map((m) => m.usedAt), [undefined, undefined]);
});

test('sizeText 三档', () => {
  assert.strictEqual(B.sizeText(0), '');
  assert.strictEqual(B.sizeText(900), '900 B');
  assert.strictEqual(B.sizeText(2048), '2 KB');
  assert.strictEqual(B.sizeText(3 * 1024 * 1024), '3.0 MB');
});

test('两节的 accept 串把白名单不重不漏地切成两半（第 241 轮）', () => {
  assert.strictEqual(B.acceptAttr(false), '.svg,.png,.webp,.jpg,.jpeg');
  assert.strictEqual(B.acceptAttr(true), '.json,.gif,.zip');
  // 不重不漏：两串合起来正好是整张白名单，一个不多一个不少。
  const halves = (B.acceptAttr(false) + ',' + B.acceptAttr(true)).split(',').sort();
  const all = Object.keys(B.ACCEPT).map((e) => '.' + e).sort();
  assert.deepStrictEqual(halves, all);
});

test('split 按落点切库，各自保持原序', () => {
  const lib = [
    {id: 'a', kind: 'svg'}, {id: 'b', kind: 'lottie'}, {id: 'c', kind: 'image'},
    {id: 'd', kind: 'gif'}, {id: 'e', kind: 'svg'}, {id: 'f', kind: 'pet'},
  ];
  const out = B.split(lib);
  assert.deepStrictEqual(out.still.map((m) => m.id), ['a', 'c', 'e']);
  assert.deepStrictEqual(out.dynamic.map((m) => m.id), ['b', 'd', 'f']);
  assert.deepStrictEqual(B.split(null), {still: [], dynamic: []});
});

test('落点认收件记录的 kind，不认它的文件名', () => {
  // 传的是 .txt 但字节判出 Lottie —— 它该去动态那一节，而不是因为名字留在静态。
  const lottie = JSON.stringify({v: '5.7.4', fr: 60, ip: 0, op: 60, layers: [{ty: 4}]});
  const r = B.intake({name: 'hello.txt', size: lottie.length}, lottie, {src: 'blob:x'});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(B.isDynamic(r.item), true);
});
