/* node --test designs/baocut/app/model-subpresets.test.js
   这一份钉的是**数据与换算有没有走样**，不是好不好看。判据分三层：

     1. 表本身：份数、顺序、键唯一——顺序是有意排的，别按字母重排。
     2. 换算：拿手算得出的几份做定点校验（`casper` 逐字段等于默认样式），
        以及三条不变量（底色一定拆成「不透明色 ＋ 不透明度」、字重与 B 钮是两个键、
        圆角与内边距是百分比不是 px）。
     3. 接口：换算出来的每一个枚举值都必须落在目录里（分类 / 大小写 / 逐词动效）——
        落不进去的那张卡会**在画廊里静悄悄消失**，那是最难发现的一种坏法。 */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-subanim.js');       // data.js 的动效目录派生自它
require('./model-subpresets.js');
require('./model-shape-paths.js');   // model-elements.js 的形状几何（生成物）
require('./model-elements.js');      // data.js 建演示元素时要用
require('./model-textpresets.js');   // data.js 的文字目录转口自它
require('./model-substyle.js');
require('./model-wordanim.js');
require('./model-motioncaption.js');   // data.js 的动效字幕那一区派生自它
require('./model-template.js');
require('./model-cut.js');   // data.js 的剪口建议派生自它（第 192 轮）
require('./model-defaultsub.js'); // data.js 的画廊第一区（默认样式那张卡）
require('./model-captionstyle.js'); // data.js 的分区与两轴（当前词 / 动效）
require('./data.js');
const V = window.BC_VS;
const D = window.BC_DATA;

/* ---------- 表本身 ---------- */

test('31 份，顺序是定的——头尾两张是判据', () => {
  assert.equal(V.PRESETS.length, 31);
  assert.equal(V.PRESETS[0].k, 'prettymarketer', '画廊第一屏的第一张是 prettymarketer');
  assert.equal(V.PRESETS[V.PRESETS.length - 1].k, 'yeet');
});

test('key 不重复，且每一份都进了涂装表', () => {
  const keys = V.PRESETS.map((p) => p.k);
  assert.equal(new Set(keys).size, keys.length);
  keys.forEach((k) => assert.ok(V.LOOKS[k], k + ' 没有涂装'));
  assert.equal(Object.keys(V.LOOKS).length, keys.length);
});

/* ---------- 换算 ---------- */

test('casper 逐字段等于默认样式', () => {
  // 默认样式 = {Poppins, bold, lh 1.25, ls 0, outline .04/#000000, shadow .17 @(.0834,.0863)/#000000cc}
  const L = V.LOOKS.casper;
  assert.equal(L.font, 'Poppins');
  assert.equal(L.weight, 400, '族的基准字重，B 钮的加成不焊进这个数');
  assert.equal(L.bold, true);
  assert.equal(L.lh, 125);
  assert.equal(L.spacing, 0);
  assert.equal(L.outlineW, 6, '.04 × 160');
  assert.equal(L.outlineColor, '#000000');
  assert.equal(L.shBlur, 17, '.17 × 100');
  assert.equal(L.shDist, 12, 'hypot(.0834, .0863) × 100');
  assert.equal(L.shAngle, 46, 'atan2 → 度');
  assert.equal(L.shColor, '#000000cc');
});

test('没有底板的涂装一律带描边——白底上看得清（一处有意的补丁）', () => {
  // 与 Classic 同款：黑色、outlineW 11
  const bare = V.PRESETS.filter((p) => !p.bg && !p.outline).map((p) => p.k);
  assert.deepEqual(bare, ['karl', 'sprout', 'phantom', 'simple', 'corpo'], '预设表里这五份既没底板也没描边');
  bare.forEach((k) => {
    const L = V.LOOKS[k];
    assert.equal(L.outline, true, k + ' 没有补上描边');
    assert.equal(L.outlineColor, '#000000');
    assert.equal(L.outlineW, V.READABLE_OUTLINE.w);
  });
  assert.equal(V.READABLE_OUTLINE.w, window.BC_DS.LOOK.outlineW, '补的描边与 Classic 同一个粗细');
  Object.keys(V.LOOKS).forEach((k) => {
    const L = V.LOOKS[k];
    assert.ok(L.opacity > 0 || L.outline, k + ' 既没底板也没描边');
  });
  // 有底板的不加（半透明底板已经把字和画面隔开）；预设自带的描边粗细不动
  ['snugle', 'boo', 'shadeplay', 'lowkey', 'ali'].forEach((k) => assert.equal(V.LOOKS[k].outline, false, k));
  assert.equal(V.LOOKS.bulb.outlineW, 2);
  // 预设表本身没改
  assert.equal(V.PRESETS.find((p) => p.k === 'phantom').outline, null);
});

test('阴影偏移是极坐标的逆运算——正下方那一档角度是 90°', () => {
  // simple: offset ≈ (0, .05)，也就是 distance 5、direction 90°
  assert.equal(V.LOOKS.simple.shDist, 5);
  assert.equal(V.LOOKS.simple.shAngle, 90);
  // 角度一律落在 [0, 360)，负角不许漏出来——CSS 里 cos/sin 虽认，滑杆的 min 是 0
  V.PRESETS.forEach((p) => {
    const a = V.LOOKS[p.k].shAngle;
    assert.ok(a >= 0 && a < 360, p.k + ' 的阴影角度 ' + a + ' 不在 [0, 360)');
  });
});

test('底色拆成「不透明色 ＋ 不透明度」，bg 上不留 8 位串', () => {
  // 属性页那颗不透明度滑杆要有东西可写；混在一个 8 位串里它就是个摆设
  V.PRESETS.forEach((p) => {
    const L = V.LOOKS[p.k];
    assert.match(L.bg, /^#[0-9A-F]{6}$/, p.k + ' 的底色不是 6 位不透明色：' + L.bg);
    assert.ok(L.opacity >= 0 && L.opacity <= 100, p.k + ' 的不透明度越界');
  });
  // snugle 的底是 #00000066 → 黑 + 40%
  assert.equal(V.LOOKS.snugle.bg, '#000000');
  assert.equal(V.LOOKS.snugle.opacity, 40);
  // 没有底板的一律 0，不是「有一块全透明的板」
  assert.equal(V.LOOKS.casper.opacity, 0);
});

test('字重与 B 钮是两个键——Poppins Extrabold 关掉 B 仍然是 800', () => {
  assert.equal(V.LOOKS.rizz.weight, 800);
  assert.equal(V.LOOKS.rizz.bold, false, '预设的 emphasis 是 normal，字重来自族名');
  // 合成成一个数的话，属性页上关掉 B 画面不会有任何反应
  assert.equal(V.LOOKS.prettymarketer.weight, 400);
  assert.equal(V.LOOKS.prettymarketer.bold, true);
});

test('圆角与内边距是占字号的百分比，不是 px', () => {
  // 预设的 cornerRadius .3 / innerPadding .2 都是归一化的；px 圆角不跟字号缩放，
  // 同一份样式在 13px 的缩略图与画布的大字上会是两个形状
  assert.equal(V.LOOKS.ali.corners, 30);
  assert.equal(V.LOOKS.ali.pad, 20);
  assert.equal(V.LOOKS.snugle.corners, 30);
  assert.equal(V.LOOKS.shadeplay.corners, 0, 'ER({}) 不圆角');
});

test('字距按 1/100 em 存，最紧那一档是预设的 -3.12', () => {
  assert.equal(V.LOOKS.bulb.spacing, -6);   // -3.12 × 2，向 0 取整
  assert.equal(V.LOOKS.ali.spacing, 1);     // .3 × 2
});

/* ---------- 接口：换算出来的枚举必须落得进目录 ---------- */

test('每一份的分类都在 cats 里——落不进去那张卡会在画廊里静悄悄消失', () => {
  const cats = new Set(D.subtitle.cats.map((c) => c.k));
  V.PRESETS.forEach((p) => {
    const k = V.CATS[p.cat];
    assert.ok(k, p.k + ' 的分类 ' + p.cat + ' 不在换算表里');
    assert.ok(cats.has(k), p.k + ' 落到了 cats 没有的分区 ' + k);
  });
});

test('每一档大小写与逐词动效都在目录里', () => {
  const cases = new Set(D.subtitle.cases.map((c) => c.k));
  const anims = new Set(D.subtitle.anims.map((a) => a.k));
  V.PRESETS.forEach((p) => {
    assert.ok(cases.has(V.LOOKS[p.k].upper), p.k + ' 的大小写档不在 cases 里');
    assert.ok(anims.has(V.animOf(p.anim)), p.k + ' 的逐词动效 ' + p.anim + ' 落不进 anims');
  });
});

/* 动效那几条判据第 66 轮搬去了 model-subanim.test.js：那边有 17 条关键帧，
   这里只留「样式表里写的那个动效名，目录认不认」这一条。 */

test('31 份样式写的动效名，目录逐个都认', () => {
  V.PRESETS.forEach((p) => {
    assert.ok(window.BC_SA.byKey(p.anim), p.k + ' 的动效 ' + p.anim + ' 不在目录里');
    assert.equal(V.animOf(p.anim), p.anim, p.k + ' 的动效名被翻译过了');
  });
});

test('每一款字体都有栈，且栈末尾挂得住中文', () => {
  // 画廊双语样张下面那行是中文，拉丁字体一个 CJK 字形都没有
  V.PRESETS.forEach((p) => {
    const s = V.LOOKS[p.k].stack;
    assert.ok(s.indexOf("'" + p.font.split(' ')[0]) === 0 || s.indexOf("'" + p.font + "'") === 0,
      p.k + ' 的栈没有以它自己的族打头：' + s);
    assert.ok(/PingFang SC/.test(s), p.k + ' 的栈里没有中文字体');
  });
});

/* ---------- 目录卡 ---------- */

test('三种形态各 31 张，id 不撞', () => {
  const all = ['orig', 'bi', 'trans'].flatMap((f) => V.cards(f));
  assert.equal(all.length, 93);
  assert.equal(new Set(all.map((c) => c.id)).size, 93);
});

test('双语两行同款——给译文行另配一款是替样式做决定', () => {
  V.cards('bi').forEach((c) => assert.equal(c.look2, c.look, c.id));
});

test('仅译文一律没有逐词动效——画面上没有原文，词级时间戳的宿主不在场', () => {
  V.cards('trans').forEach((c) => assert.equal(c.anim, 'none', c.id));
  V.cards('orig').forEach((c) => assert.ok(!('look2' in c), c.id + ' 只有一行，不该有 look2'));
});

test('内置目录就是这三份加倒鸭子那一张，没有别的——动效字幕第 74 轮下架（注册表在，卡不上目录）', () => {
  const cat = D.subtitle.catalog;
  // 三形态 ×（默认 + Shorts 两张 + 目录的 31 份）＋ 倒鸭子一张（2026-09-17，`kinetic: true`，只有 orig 形态）
  assert.equal(cat.length, 3 * 33 + 1);
  assert.equal(cat.filter((p) => p.kinetic).length, 1);
  cat.forEach((p) => {
    /* 动效字幕**自带涂装**（emphasis 预设的 `effectiveDefaults`，见 model-motioncaption.js），
       所以它们没有 look：借一份 look 会让画面上出现两个说了算的人。 */
    if (p.caption) {
      assert.equal(p.look, null, p.id + ' 是配方，不该再借一份 look');
      assert.ok(window.BC_VC.byKey(p.caption).paint, p.id + ' 的配方没有自带涂装');
      return;
    }
    // 其余每一张卡指的 look 都得在涂装表里——指空了那张卡会画成回落的那一份
    assert.ok(D.subtitle.looks[p.look], p.id + ' 的 look「' + p.look + '」不在涂装表里');
    if (p.look2) assert.ok(D.subtitle.looks[p.look2], p.id + ' 的 look2 不在涂装表里');
  });
});

test('默认样式是目录里真有的那一张，画布首屏画的东西在画廊里找得到', () => {
  const d = D.subtitle.defaults;
  const card = D.subtitle.catalog.find((p) => p.id === d.preset);
  assert.ok(card, '默认 preset ' + d.preset + ' 不在目录里');
  const L = D.subtitle.looks[card.look];
  d.tracks.forEach((t) => {
    assert.equal(t.font, L.font, t.id + ' 的字体与那张卡对不上');
    assert.equal(t.color, L.color, t.id + ' 的字色与那张卡对不上');
    assert.equal(t.outlineW, L.outlineW, t.id + ' 的描边与那张卡对不上');
  });
  // 词级时间戳只有源语言轨有，所以译文轨不带当前词高亮色
  const trans = d.tracks.find((t) => t.role !== 'source');
  assert.ok(!('activeColor' in trans), '译文轨不该带 activeColor');
});
