/* node --test designs/baocut/app/model-defaultsub.test.js
   这一份钉的是**画廊第一区那张卡**（新建项目种下的那份涂装）。三层判据：

     1. 默认样式不在这份预设目录里——核心的预设目录就是拿 `BC_VS.LOOKS` /
        `BC_VS.cards(form)` 生成的，混进去会让核心目录里凭空多一份样式，还会与核心
        手写的同名卡撞号。
     2. 涂装的键集与目录里那 31 份**一模一样**——画布、缩略图、属性页预览条走同一个涂装
        函数，少一个键那三处就各画各的。
     3. 卡的形态规矩与目录卡同一条：三形态三个前缀、双语两行同款、仅译文没有词通道；
        并且真的排在画廊第一区的第一张。 */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-subanim.js');
require('./model-subpresets.js');
require('./model-defaultsub.js');
require('./model-shape-paths.js');
require('./model-elements.js');
require('./model-textpresets.js');
require('./model-substyle.js');
require('./model-wordanim.js');
require('./model-motioncaption.js');
require('./model-template.js');
require('./model-cut.js');
require('./data.js');
const V = window.BC_VS;
const DS = window.BC_DS;
const S = window.BC_SUB;
const D = window.BC_DATA;

/* ---------- 1. 不许混进预设目录 ---------- */

test('预设目录里没有 classic——核心目录正是拿它生成的', () => {
  assert.equal(V.LOOKS.classic, undefined);
  assert.equal(V.PRESETS.filter((p) => p.k === 'classic').length, 0);
  ['orig', 'bi', 'trans'].forEach((form) => {
    assert.equal(V.cards(form).length, 31, form + ' 仍是目录那 31 张');
    assert.equal(V.cards(form).filter((c) => c.look === 'classic').length, 0);
  });
});

/* ---------- 2. 涂装 ---------- */

test('键集与目录涂装逐字段一致——三处共用同一个涂装函数', () => {
  const mine = Object.keys(DS.LOOK).sort();
  const theirs = Object.keys(V.LOOKS.prettymarketer).sort();
  assert.deepEqual(mine, theirs);
});

test('逐字段对着种子（core 的 default_style）', () => {
  const L = DS.LOOK;
  assert.equal(L.color, '#FFFFFF');
  assert.equal(L.bold, true);
  assert.equal(L.italic, false);
  assert.equal(L.align, 'center');
  assert.equal(L.lh, 120, 'lineHeight 1.2 ×100');
  assert.equal(L.spacing, 0);
  assert.equal(L.upper, '');
  // 底板关着 = 不透明度 0（同目录里那几张没有底板的卡），底色留着当滑杆的起点
  assert.equal(L.opacity, 0);
  assert.equal(L.bg, '#000000');
  assert.equal(L.plate, 'line', 'backgroundStyle: "wrap"');
  assert.equal(L.outline, true);
  assert.equal(L.outlineW, 11, 'textOutline.width 14 ÷1.25');
  assert.equal(L.shadow, true);
  assert.equal(L.shDist, 8);
  assert.equal(L.shBlur, 12);
  assert.equal(L.shAngle, 45);
  assert.equal(L.shColor, '#000000E6', 'dropShadow.opacity 0.9');
  assert.equal(L.activeColor, '#18E1D6');
});

test('字体框里查得到这个族名——那一栏栽过「指着自己列表里没有的名字」', () => {
  assert.ok(D.fonts.all.some((f) => f.n === DS.LOOK.font), DS.LOOK.font + ' 不在字体目录里');
});

/* ---------- 3. 卡 ---------- */

test('三形态三个前缀，双语两行同款，仅译文没有词通道', () => {
  assert.deepEqual(['orig', 'bi', 'trans'].map((f) => DS.cards(f)[0].id),
    ['v-classic', 'vb-classic', 'vt-classic']);
  // 每种形态两张：经典 ＋ Shorts（2026-09-27）
  ['orig', 'bi', 'trans'].forEach((f) => assert.deepEqual(DS.cards(f).map((c) => c.look), ['classic', 'shorts']));
  assert.equal(DS.cards('bi')[0].look2, 'classic');
  assert.equal(DS.cards('orig')[0].anim, 'colourHighlight');
  assert.equal(DS.cards('trans')[0].anim, 'none');
});

test('它是画廊第一区的第一张，且涂装真的查得到', () => {
  assert.equal(D.subtitle.cats[0].k, 'default');
  const groups = S.gallery(D.subtitle.catalog, D.subtitle.cats, ['orig']);
  assert.equal(groups[0].cat.k, 'default');
  assert.deepEqual(groups[0].items.map((c) => c.id), ['v-classic']);
  D.subtitle.catalog.forEach((c) => {
    assert.ok(D.subtitle.looks[c.look], c.id + ' 的涂装没登记');
    if (c.look2) assert.ok(D.subtitle.looks[c.look2], c.id + ' 的译文行涂装没登记');
  });
});

test('翻译 Tab 的两区也各多这一张，且家族同名', () => {
  const ids = D.subtitle.catalog.map((c) => c.id);
  assert.equal(ids.filter((id) => S.family(id) === 'classic').length, 3);
  assert.equal(ids[0], 'v-classic');
});

/* ---------- 4. Shorts 内置预设（设计稿 bcut-shorts-design §5.2，契约 6） ---------- */

test('Shorts 涂装：键集同目录涂装，粗体、描边 ＋ 投影、无底板、念到的词有强调色', () => {
  const L = DS.SHORTS_LOOK;
  assert.deepEqual(Object.keys(L).sort(), Object.keys(V.LOOKS.prettymarketer).sort());
  assert.equal(V.LOOKS.shorts, undefined, '不混进预设目录');
  assert.equal(L.bold, true);
  assert.ok(L.weight >= 700);
  assert.equal(L.outline, true);
  assert.equal(L.shadow, true);
  assert.equal(L.opacity, 0, '没有底板');
  assert.match(L.activeColor, /^#[0-9A-F]{6}$/);
  assert.notEqual(L.activeColor, L.color);
  assert.ok(D.fonts.all.some((f) => f.n === L.font));
});

test('Shorts 卡：三形态三个前缀、逐词弹跳（仅译文没有词通道）、带落位记号，自成一区排在默认之后', () => {
  assert.deepEqual(['orig', 'bi', 'trans'].map((f) => DS.cards(f)[1].id), ['v-shorts', 'vb-shorts', 'vt-shorts']);
  assert.equal(DS.cards('orig')[1].anim, 'bounce');
  assert.equal(DS.cards('trans')[1].anim, 'none');
  assert.equal(DS.cards('bi')[1].look2, 'shorts');
  ['orig', 'bi', 'trans'].forEach((f) => assert.equal(DS.cards(f)[1].layout, 'shorts'));
  assert.deepEqual(D.subtitle.cats.slice(0, 2).map((c) => c.k), ['default', 'shorts']);
  const groups = S.gallery(S.screenCatalog(D.subtitle.catalog), D.subtitle.cats, ['screen']);
  assert.deepEqual(groups[1].items.map((c) => c.id), ['v-shorts']);
  assert.equal(groups[1].items[0].layout, 'shorts');
  const ids = D.subtitle.catalog.map((c) => c.id);
  assert.equal(ids.filter((id) => S.family(id) === 'shorts').length, 3);
});
