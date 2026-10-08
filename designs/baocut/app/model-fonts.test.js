/* model-fonts.js —— 字体选择框的三段与排序。§18 / 第 80 轮。
   连着 data.js 一起跑：`popular` 指向的名字必须在目录里真有，品牌字体也一样——
   选中一个目录里不存在的族，画面上什么都不会变，而菜单里看不出这件事。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-fonts.js');
require('./model-substyle.js');
require('./model-pose.js');
require('./model-shape-paths.js');     // model-elements.js 的形状几何（生成物）
require('./model-elements.js');        // data.js 建演示元素时要用
require('./model-textpresets.js');     // data.js 的文字目录转口自它
require('./model-wordanim.js');
require('./model-subanim.js');         // data.js 的动效目录派生自它
require('./model-subpresets.js');         // data.js 的字幕样式目录转口自它
require('./model-motioncaption.js');     // data.js 的动效字幕那一区派生自它
require('./model-template.js');
require('./model-cut.js');   // data.js 的剪口建议派生自它（第 192 轮）
require('./model-defaultsub.js'); // data.js 的画廊第一区（默认样式那张卡）
require('./data.js');
const F = window.BC_FONT;
const D = window.BC_DATA;

test('品牌字体按「上一次用过」倒序，没用过的垫底且不打乱登记顺序', () => {
  const sorted = F.brandFonts([
    {name: 'A', used: 180}, {name: 'B', used: 12}, {name: 'C'}, {name: 'D'}, {name: 'E', used: 12},
  ]).map((f) => f.name);
  assert.deepStrictEqual(sorted, ['B', 'E', 'A', 'C', 'D']);
});

test('演示品牌库里字幕那款排在标题款前面——本页按用途排，菜单按最近用过排', () => {
  assert.deepStrictEqual(F.brandFonts(D.brand.fonts).map((f) => f.name),
    ['思源黑体 Source Han Sans', 'Source Sans 3']);
  assert.deepStrictEqual(D.brand.fonts.map((f) => f.name),
    ['Source Sans 3', '思源黑体 Source Han Sans'], '品牌页仍按用途排，两处不是同一个顺序');
});

test('目录按名字自然序：拉丁名在前、中文名在后', () => {
  const names = F.catalog([{n: '站酷快乐体'}, {n: 'Poppins'}, {n: 'Anton'}, {n: '思源宋体'}]).map((f) => f.n);
  assert.deepStrictEqual(names, ['Anton', 'Poppins', '思源宋体', '站酷快乐体']);
});

test('三段：Brand kits / Popular / All，且不去重（同一族可以三段各出现一次）', () => {
  const gs = F.groups({all: D.fonts.all, popular: D.fonts.popular, brand: D.brand.fonts, query: ''});
  assert.deepStrictEqual(gs.map((g) => g.key), ['brand', 'popular', 'all']);
  assert.deepStrictEqual(gs.map((g) => g.title), ['Brand kits', 'Popular', 'All']);
  const brandNames = gs[0].rows.map((r) => r.n);
  assert.ok(gs[1].rows.some((r) => brandNames.indexOf(r.n) >= 0),
    '品牌那两款也是常用款——三段各回答一个问题，不互相扣减');
  assert.strictEqual(gs[2].rows.length, D.fonts.all.length, 'All 就是目录全量');
});

test('检索时 Brand kits 让位，三段合成一条平列表，且这时候去重', () => {
  const gs = F.groups({all: D.fonts.all, popular: D.fonts.popular, brand: D.brand.fonts, query: 'source'});
  assert.deepStrictEqual(gs.map((g) => g.key), ['search']);
  const names = gs[0].rows.map((r) => r.n);
  assert.strictEqual(new Set(names).size, names.length, '平列表里同一个名字只出现一次');
  assert.strictEqual(names[0], '思源黑体 Source Han Sans', '品牌命中排在最前（按最近用过）');
  names.forEach((n) => assert.ok(n.toLowerCase().includes('source'), n + ' 不该被检索命中'));
});

test('检索没有命中时三段都空——视图据此画「没有匹配的字体」', () => {
  const gs = F.groups({all: D.fonts.all, popular: D.fonts.popular, brand: D.brand.fonts, query: 'zzz'});
  assert.strictEqual(gs[0].rows.length, 0);
});

test('popular 与品牌字体指向的名字，目录里都真有', () => {
  const names = new Set(D.fonts.all.map((f) => f.n));
  D.fonts.popular.forEach((n) => assert.ok(names.has(n), 'popular 里的 ' + n + ' 不在目录里'));
  D.brand.fonts.forEach((f) => assert.ok(names.has(f.name), '品牌字体 ' + f.name + ' 不在目录里'));
});

test('动效字幕用到的族全都在目录里——否则那份样式落下去会掉回默认字体', () => {
  const names = new Set(D.fonts.all.map((f) => f.n));
  window.BC_VC.fontFamilies().forEach((f) => assert.ok(names.has(f), f + ' 不在 fonts.all 里'));
});

test('样张写法摊成行内 style：族名本身就在 `st` 里', () => {
  assert.deepStrictEqual(F.face("font-family:'Poppins',sans-serif;font-weight:600"),
    {fontFamily: "'Poppins',sans-serif", fontWeight: '600'});
  assert.deepStrictEqual(F.face(''), {});
  assert.deepStrictEqual(F.face('font-weight:800'), {fontWeight: '800'});
});
