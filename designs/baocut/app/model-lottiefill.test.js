/* model-lottiefill.test.js —— Lottie 分色（第 238 轮）。最硬的一条判据是与生成器
   对拍：81 份内置 Lottie 逐份取色，必须与 manifest 里记的 `colors` 逐字相等。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
global.window = {};
require('./model-lottiefill.js');
const L = window.BC_LOTTIEFILL;

const DIR = path.join(__dirname, '../assets/stickers/anim');
const MANIFEST = path.join(DIR, 'provenance.json');

const fill = (hex) => ({ty: 'fl', c: {a: 0, k: L.hexRgb(hex)}});

test('hex 与 Lottie 的 0–1 RGB 互转', () => {
  assert.strictEqual(L.rgbHex([1, 0, 0]), '#FF0000');
  assert.strictEqual(L.rgbHex([0, 0.5, 1]), '#0080FF');
  // 少数导出用 0–255
  assert.strictEqual(L.rgbHex([255, 128, 0]), '#FF8000');
  assert.strictEqual(L.rgbHex([1, 0]), null);
  assert.strictEqual(L.rgbHex('x'), null);
  assert.deepStrictEqual(L.hexRgb('#FF0000'), [1, 0, 0]);
  assert.deepStrictEqual(L.hexRgb('#000'), [0, 0, 0]);
  assert.strictEqual(L.hexRgb('nope'), null);
  assert.strictEqual(L.norm('#abc'), '#AABBCC');
  assert.strictEqual(L.norm('#ff8000'), '#FF8000');
  assert.strictEqual(L.norm('rgb(1,2,3)'), null);
});

test('取色：填充 / 描边 / 分组里的形状 / 纯色图层都算，动画色跳过', () => {
  const doc = {layers: [
    {ty: 4, shapes: [fill('#FF0000'), {ty: 'st', c: {a: 0, k: L.hexRgb('#00FF00')}},
      {ty: 'gr', it: [fill('#0000FF')]},
      // c.a 为真 = 这条颜色自己在动，不是一个换得掉的色区
      {ty: 'fl', c: {a: 1, k: [{t: 0, s: [1, 1, 1]}]}}]},
    {ty: 1, sc: '#abc'},
  ]};
  assert.deepStrictEqual(L.colorsOf(doc), ['#FF0000', '#00FF00', '#0000FF', '#AABBCC']);
  assert.deepStrictEqual(L.fillsOf(doc).map((c) => c.i), [0, 1, 2, 3]);
});

test('取色按出现次数排序，次数相同按第一次出现的先后，最多 8 组', () => {
  const doc = {layers: [{ty: 4, shapes: [fill('#111111'), fill('#222222'), fill('#222222')]}]};
  assert.deepStrictEqual(L.colorsOf(doc), ['#222222', '#111111']);
  const many = {layers: [{ty: 4, shapes: Array.from({length: 12},
    (unused, i) => fill('#' + String(i).padStart(2, '0').repeat(3)))}]};
  assert.strictEqual(L.colorsOf(many).length, 8);
  assert.strictEqual(L.colorsOf(many, 3).length, 3);
});

test('assets 里的图层也算（Noto 用预合成放主体）', () => {
  const doc = {layers: [], assets: [{id: 'comp_0', layers: [{ty: 4, shapes: [fill('#ABCDEF')]}]}]};
  assert.deepStrictEqual(L.colorsOf(doc), ['#ABCDEF']);
});

test('applyFills 换第 i 组，返回深拷贝且原件不动', () => {
  const doc = {layers: [{ty: 4, shapes: [fill('#FF0000'), fill('#FF0000'), fill('#00FF00')]},
    {ty: 1, sc: '#FF0000'}]};
  const out = L.applyFills(doc, ['#0000FF']);
  assert.notStrictEqual(out, doc);
  assert.deepStrictEqual(L.colorsOf(doc), ['#FF0000', '#00FF00'], '原件不动');
  assert.deepStrictEqual(L.colorsOf(out), ['#0000FF', '#00FF00']);
  // 同一组的每一处都换了，纯色图层也在内
  assert.deepStrictEqual(out.layers[0].shapes[1].c.k, [0, 0, 1]);
  assert.strictEqual(out.layers[1].sc, '#0000FF');
  // 空位保留原色
  assert.deepStrictEqual(L.colorsOf(L.applyFills(doc, [null, '#123456'])), ['#FF0000', '#123456']);
});

test('原样的覆盖表不重建 animationData（同一个对象引用回去）', () => {
  const doc = {layers: [{ty: 4, shapes: [fill('#FF0000')]}]};
  assert.strictEqual(L.isDefault(doc, null), true);
  assert.strictEqual(L.isDefault(doc, []), true);
  assert.strictEqual(L.isDefault(doc, ['#ff0000']), true, '大小写不算改过');
  assert.strictEqual(L.isDefault(doc, ['#00FF00']), false);
  assert.strictEqual(L.applyFills(doc, ['#ff0000']), doc);
  assert.notStrictEqual(L.applyFills(doc, ['#00FF00']), doc);
});

test('81 份内置 Lottie 的取色与 manifest 记的 colors 逐字相等', () => {
  const items = Object.values(JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))).filter((i) => i.animated);
  assert.strictEqual(items.length, 81);
  for (const item of items) {
    const doc = JSON.parse(fs.readFileSync(path.join(DIR, item.name), 'utf8'));
    assert.deepStrictEqual(L.colorsOf(doc), item.colors, item.name);
    assert.ok(item.colors.length <= L.LIMIT, item.name);
  }
});

test('拿一份真素材换色：第 1 组换掉之后其余组不动', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(DIR, 'dyn-collage-01.json'), 'utf8'));
  const before = L.colorsOf(doc);
  assert.ok(before.length >= 2);
  const out = L.applyFills(doc, ['#10FE72']);
  assert.deepStrictEqual(L.colorsOf(out), ['#10FE72'].concat(before.slice(1)));
  assert.strictEqual(out.op, doc.op, '换色不碰时间信息');
  assert.strictEqual(out.markers.length, doc.markers.length);
});
