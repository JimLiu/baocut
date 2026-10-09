/* node --test designs/baocut/app/model-substyle.test.js
   段门控几条与 apps/baocut `adapters/stylepane.rs` 的同名测试互为镜像；
   轨与组那几条（接缝、词级时间戳、轨的增删、画廊归属）是第 45 轮新增的判据。 */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-substyle.js');
require('./model-pose.js');
require('./model-shape-paths.js');   // model-elements.js 的形状几何（生成物）
require('./model-elements.js');        // data.js 建演示元素时要用
require('./model-textpresets.js');     // data.js 的文字目录转口自它
require('./model-wordanim.js');
require('./model-subanim.js');       // data.js 的动效目录派生自它
require('./model-subpresets.js');       // data.js 的字幕样式目录转口自它
require('./model-motioncaption.js');   // data.js 的动效字幕那一区派生自它
require('./model-template.js');
require('./model-cut.js');   // data.js 的剪口建议派生自它（第 192 轮）
require('./model-defaultsub.js'); // data.js 的画廊第一区（默认样式那张卡）
require('./model-captionstyle.js'); // data.js 的分区与两轴（当前词 / 动效）
require('./data.js');
const S = window.BC_SUB;
const P = window.BC_POSE;

const has = (list, k) => list.indexOf(k) >= 0;

const T = (id, role, extra) => Object.assign({
  id, role, lang: id, name: id, size: role === 'source' ? 32 : 44,
  valign: 'bottom', y: role === 'source' ? 93 : 86,
  font: id + '-font', color: id + '-color', bold: role === 'source', align: 'center',
  bg: 'k', corners: 8, opacity: 55, outline: false, outlineColor: 'x', outlineW: 8,
  shadow: true, lines: 2, rotate: false,
}, extra);

const doc = (...ts) => ({tracks: ts});
const mono = () => doc(T('zh', 'source'));
/* 默认叠法（第 46 轮）：**译文在上、原文在下**——数组顺序就是画面上从上到下。 */
const bi = () => doc(T('en', 'translation'), T('zh', 'source'));
const tri = () => doc(T('en', 'translation'), T('ja', 'translation'), T('zh', 'source'));

/* ---------- 轨 ---------- */

test('没有组这个对象——位置属于每一条轨自己，键与核心同名', () => {
  const st = bi();
  assert.equal(st.group, undefined);
  S.tracks(st).forEach((t) => {
    assert.equal(typeof t.y, 'number', t.id + ' 没有自己的锚线 y');
    assert.ok(P.VALIGNS.indexOf(t.valign) >= 0, t.id + ' 的 valign 不在核心的白名单里');
  });
});

test('画面上谁在上谁在下由各自的锚线决定，不是数组顺序', () => {
  const st = bi();
  const y = (id) => S.byId(st, id).y;
  assert.ok(y('en') < y('zh'), '默认译文在上');
  // 只改一条轨的锚线，另一条不动——这正是「各自选中编辑」的判据
  st.tracks = S.tracks(st).map((t) => (t.id === 'en' ? Object.assign({}, t, {y: 97}) : t));
  assert.ok(y('en') > y('zh'), '把译文的锚线往下挪之后它就到了下面');
  assert.equal(S.byId(st, 'zh').y, 93, '另一条一点没动');
});

test('加一门语言 = 加一条轨；同 id 不重复加', () => {
  const st = bi();
  st.tracks = S.addTrack(st, T('ja', 'translation'));
  assert.deepEqual(S.tracks(st).map((t) => t.id), ['en', 'ja', 'zh'], '新的译文插在原文上面');
  st.tracks = S.addTrack(st, T('ja', 'translation'));
  assert.equal(S.tracks(st).length, 3, '同一门语言不会落两条轨');
});

test('默认叠法：译文在上、原文在下，原文恒在最下一格', () => {
  // 原文被「仅译文」拿下来过，再放回来时落到最下面，不是回到第一格
  const only = doc(T('en', 'translation'), T('ja', 'translation'));
  assert.deepEqual(S.place(S.tracks(only), T('zh', 'source')).map((t) => t.id), ['en', 'ja', 'zh']);
  // 一条轨都没有时无所谓上下
  assert.deepEqual(S.place([], T('zh', 'source')).map((t) => t.id), ['zh']);
  assert.deepEqual(S.place([], T('en', 'translation')).map((t) => t.id), ['en']);
});

test('加轨不重排已有顺序', () => {
  const st = doc(T('zh', 'source'), T('en', 'translation'));   // 数组里原文在前
  st.tracks = S.addTrack(st, T('ja', 'translation'));
  assert.deepEqual(S.tracks(st).map((t) => t.id), ['ja', 'zh', 'en'],
    '新的译文插在原文那一格前面，但 en 不会被拽回去重排');
});

test('拿一条轨下来不是删数据，但不能拿掉最后一条', () => {
  const st = bi();
  assert.deepEqual(S.removeTrack(st, 'en').map((t) => t.id), ['zh']);
  // 源语言也能拿下来——「仅译文」样式就是这么落的；数据仍在文稿里
  assert.deepEqual(S.removeTrack(st, 'zh').map((t) => t.id), ['en']);
  assert.deepEqual(S.removeTrack(mono(), 'zh').map((t) => t.id), ['zh'], '最后一条拿不掉');
});

test('词级时间戳只在源语言轨上', () => {
  assert.equal(S.hasWordTiming(S.source(bi())), true);
  assert.equal(S.hasWordTiming(S.byId(bi(), 'en')), false);
  assert.deepEqual(S.translations(tri()).map((t) => t.id), ['en', 'ja']);
});

/* ---------- 属性页门控 ---------- */

test('属性页只有一种页：这一条轨的样子 ＋ 它自己的位置', () => {
  ['zh', 'en'].forEach((id) => {
    const list = S.sections(bi(), id);
    ['group', 'seam', 'sharedNote', 'memberNote'].forEach((k) => {
      assert.ok(!has(list, k), k + ' 是组那一档的东西，组已经去掉了');
    });
    // 第 48/50 轮的删减：行内对齐折进「文字」，随机微倾 / 行数 / 自动表情整段去掉
    ['lineAlign', 'rotate', 'lines', 'emoji'].forEach((k) => {
      assert.ok(!has(list, k), k + ' 已经不是一段了');
    });
    assert.ok(has(list, 'text'));
    assert.ok(has(list, 'position'), '锚点/偏移在每一条轨自己的页上');
  });
  // 一条轨与多轨是同一种页，只是没有 chip 可切
  assert.deepEqual(S.sections(mono(), 'zh'), S.sections(mono()));
  assert.equal(S.scopes(mono()).length, 0, '一条轨没有可选作用域');
  assert.deepEqual(S.scopes(tri()), ['en', 'ja', 'zh'], 'chip 就是几条轨，没有「整组」');
});

test('「双语」段（上下次序）只在原文与译文都在画面上时出现，两条轨的页上都有（第 152 轮）', () => {
  assert.ok(has(S.sections(bi(), 'en'), 'bilingual'));
  assert.ok(has(S.sections(bi(), 'zh'), 'bilingual'));
  assert.ok(!has(S.sections(mono(), 'zh'), 'bilingual'), '一条轨没有上下可言');
  assert.equal(S.sections(bi(), 'zh').indexOf('bilingual'), S.sections(bi(), 'zh').indexOf('display') - 1, '排在位置之后、显示选项之前');
});

test('比例链 hint 只长在并排的译文轨上', () => {
  assert.ok(has(S.sections(bi(), 'en'), 'ratioNote'));
  assert.ok(!has(S.sections(bi(), 'zh'), 'ratioNote'), '原文行不跟自己比');
  assert.ok(!has(S.sections(doc(T('en', 'translation')), 'en'), 'ratioNote'),
    '画面上只有译文一条时没有可比的原文行');
});

test('当前词与强调词只跟着源语言轨走——译文轨就是少这两段；动效两条轨都有', () => {
  ['activeWord', 'highlight'].forEach((k) => {
    assert.ok(has(S.sections(mono(), 'zh'), k));
    assert.ok(has(S.sections(bi(), 'zh'), k));
    assert.ok(!has(S.sections(bi(), 'en'), k), k + ' 不该长在译文轨上');
  });
  assert.ok(!has(S.sections(mono(), 'zh'), 'wordAnim'), '「字幕动画」段已拆成当前词与动效');
  ['zh', 'en'].forEach((id) => assert.ok(has(S.sections(bi(), id), 'motion'), id + ' 轨应有动效段'));
});

test('可写轨永远是一条轨——没有「谁也不写」这一档', () => {
  assert.equal(S.writable(mono(), 'zh'), 'zh');
  assert.equal(S.writable(bi(), 'en'), 'en');
  assert.equal(S.writable(bi()), 'en', '没给作用域就落在第一条上');
  assert.equal(S.writable(bi(), 'nope'), 'en', '轨被拿下来之后回落，不停在不存在的 id 上');
  assert.equal(S.writable(doc()), null, '一条轨都没有时才是 null');
});

/* ---------- 样式画廊 ---------- */

const CATS = [{k: 'dynamic', name: '动态'}, {k: 'social', name: '社交'}, {k: 'retro', name: '复古'}];
const CATALOG = [
  {id: 'o1', form: 'orig', cat: 'social'},
  {id: 'o2', form: 'orig', cat: 'dynamic'},
  {id: 'b1', form: 'bi', cat: 'social'},
  {id: 'b2', form: 'bi', cat: 'dynamic'},
  {id: 't1', form: 'trans', cat: 'dynamic'},
];

test('画廊按分类切区、保持分类顺序，空区不出现', () => {
  const g = S.gallery(CATALOG, CATS, ['orig']);
  assert.deepEqual(g.map((x) => x.cat.k), ['dynamic', 'social'], '复古区是空的，不出现');
  const ids = g.flatMap((x) => x.items.map((i) => i.id));
  assert.deepEqual(ids, ['o2', 'o1']);
  assert.ok(ids.indexOf('b1') < 0 && ids.indexOf('t1') < 0, '形态过滤是硬的');
});

/* ---------- 第 151 轮：一份画廊、一份涂装一张卡、缩略图画的是画面上的轨 ---------- */

test('三胞胎收成一张卡：去前缀是同一份涂装，形态一律 screen，译文行涂装回落到原文行', () => {
  assert.equal(S.family('v-slay'), 'slay');
  assert.equal(S.family('vb-slay'), 'slay');
  assert.equal(S.family('vt-slay'), 'slay');
  assert.equal(S.family('b1'), 'b1', '品牌库的卡没有前缀，原样');
  const cat = S.screenCatalog([
    {id: 'v-slay', form: 'orig', cat: 'social', look: 'slay', anim: 'karaoke'},
    {id: 'vb-slay', form: 'bi', cat: 'social', look: 'slay', look2: 'slay'},
    {id: 'vt-slay', form: 'trans', cat: 'social', look: 'slay', anim: 'none'},
    {id: 'v-ali', form: 'orig', cat: 'retro', look: 'ali', anim: 'none'},
  ]);
  assert.deepEqual(cat.map((p) => p.id), ['v-slay', 'v-ali'], '一份涂装只留第一张');
  assert.ok(cat.every((p) => p.form === 'screen'));
  assert.equal(cat[0].anim, 'karaoke', '逐词动效跟第一张（原文行那份）走');
  assert.equal(cat[0].look2, 'slay');
  assert.equal(cat[1].look2, 'ali', '没有 look2 的与原文行同款');
});

test('内置目录收成 34 张（默认 + Shorts + 31 份预设 + 倒鸭子），分区仍照分类序（第 151 轮）', () => {
  const D = window.BC_DATA;
  const cat = S.screenCatalog(D.subtitle.catalog);
  assert.equal(cat.length, 34);   // 2026-09-17 起多一张「倒鸭子」（cat: kinetic），2026-09-27 起多一张「Shorts」（cat: shorts）
  assert.equal(cat[0].id, 'v-classic', '默认那张排第一区第一位');
  const g = S.gallery(cat, D.subtitle.cats, ['screen']);
  assert.deepEqual(g.map((x) => x.cat.k), D.subtitle.cats.map((c) => c.k).filter((k) => cat.some((p) => p.cat === k)));
  assert.equal(g.reduce((n, x) => n + x.items.length, 0), 34, '每一张都在某个分区里');
  // 默认态那张卡（vb- 前缀）在收拢后的画廊里仍找得到——首屏画的东西画廊里得有勾
  assert.ok(S.currentCard(D.subtitle.defaults, cat), '默认 preset 在收拢后的画廊里找不到');
});

test('screen 形态落在画面上的每一条轨，停用的也上妆——它仍在 timeline 上', () => {
  const st = {tracks: [T('en', 'translation'), T('zh', 'source'), T('ja', 'translation', {hidden: true})]};
  assert.deepEqual(S.applyTargets(st, 'screen', 'zh'), ['en', 'zh', 'ja']);
  assert.deepEqual(S.applyTargets({tracks: []}, 'screen', 'zh'), []);
});

test('缩略图照画面上的轨画：按锚线从上到下、停用的不画、语言取轨自己的、译文行取 look2', () => {
  const p = {look: 'slay', look2: 'ali'};
  const st = {tracks: [T('en', 'translation'), T('zh', 'source')]};
  assert.deepEqual(S.screenRows(st, p), [['trans', 'ali', 'en', 'en'], ['orig', 'slay', 'zh', 'zh']], '默认译文在上');
  const flipped = {tracks: S.flipStack(st)};
  assert.deepEqual(S.screenRows(flipped, p).map((r) => r[0]), ['orig', 'trans'], '倒转后原文在上');
  const one = {tracks: [T('en', 'translation', {hidden: true}), T('zh', 'source')]};
  assert.deepEqual(S.screenRows(one, p), [['orig', 'slay', 'zh', 'zh']], '停用的译文不在画面上');
  assert.deepEqual(S.screenRows({tracks: []}, p, 'en'), [['orig', 'slay', 'en', null]], '没有轨时退回单行样张');
  assert.deepEqual(S.screenRows(st, {look: 'slay'}).map((r) => r[1]), ['slay', 'slay'], '没有 look2 与原文同款');
});

test('当下套的是哪张卡：按涂装找，三胞胎任一 id 都算；没套过或找不到返回 null', () => {
  const cat = [{id: 'v-slay', look: 'slay'}, {id: 'b1', look: 'shadeplay'}];
  assert.equal(S.currentCard({preset: 'vb-slay'}, cat).id, 'v-slay');
  assert.equal(S.currentCard({preset: 'vt-slay'}, cat).id, 'v-slay');
  assert.equal(S.currentCard({preset: 'b1'}, cat).id, 'b1');
  assert.equal(S.currentCard({preset: 'v-gone'}, cat), null);
  assert.equal(S.currentCard({}, cat), null);
});

/* ---------- 套一份样式 = 只换涂装（第 108 轮） ---------- */

/* 第 108 轮裁决：**文档只和 timeline 相关，timeline 上有什么字幕轨就显示什么**。
   于是「套一份样式」不再是对轨集的一次声明——它只挑在场的轨上妆。第 44 轮那张
   形态转移表（双语补一条译文、仅译文把源语言拿下来、只显示原文把译文拿下来）连同
   `stageTracks` 一起退役；第 151 轮画廊改成一份、按画面上的轨画缩略图，`TAB_FORMS` /
   `forms` / `tabOf` 也退役，`FORMS` 只剩品牌库里存过的卡还在用。
   下面这一组是**反向断言**：套卡之后轨集逐位不变。 */

const AVAIL = [{id: 'en', role: 'translation', lang: 'en', name: 'English'}];

/** 轨集的指纹：id、角色、顺序。三样里任何一样变了都算样式卡越界。 */
const setOf = (st) => S.tracks(st).map((t) => t.id + ':' + t.role).join('|');

test('模型层不再有把形态投影成轨集的那个出口', () => {
  assert.equal(typeof S.stageTracks, 'undefined',
    'stageTracks 已退役——留个空壳会让调用方以为还能这么用');
  assert.deepEqual(S.FORMS, ['orig', 'bi', 'trans']);
  // 第 151 轮：按 Tab 分陈列的那两个出口也退役了——两个 Tab 看的是同一份画廊
  assert.equal(typeof S.forms, 'undefined');
  assert.equal(typeof S.tabOf, 'undefined');
});

test('套任何形态的卡都不动轨集：id、角色、顺序逐位不变', () => {
  [mono(), bi(), tri(), doc(T('en', 'translation'))].forEach((st) => {
    const before = setOf(st);
    ['orig', 'bi', 'trans'].forEach((form) => {
      [null, 'zh', 'en', 'ja'].forEach((editId) => {
        S.applyTargets(st, form, editId);
        assert.equal(setOf(st), before, form + '/' + editId + ' 之后轨集变了');
      });
    });
  });
});

test('落笔的目标只会是画面上已有的轨——不点名不在场的语言', () => {
  const av = [T('ja', 'translation')];   // 翻好了但没放上去：套卡也请不上来
  [mono(), bi(), tri(), doc(T('en', 'translation'))].forEach((st) => {
    const on = S.tracks(st).map((t) => t.id);
    ['orig', 'bi', 'trans'].forEach((form) => {
      [null, 'zh', 'en', 'ja', 'ko'].forEach((editId) => {
        S.applyTargets(st, form, editId).forEach((id) => {
          assert.ok(on.indexOf(id) >= 0, form + '/' + editId + ' 落到了不在场的 ' + id);
        });
      });
    });
  });
  assert.equal(av.length, 1, '候选表一条都没被吃进去');
});

test('画面上一条字幕都没有时，套卡什么也不落（不凭空造轨）', () => {
  const empty = doc();
  ['orig', 'bi', 'trans'].forEach((form) => {
    assert.deepEqual(S.applyTargets(empty, form, null), [], form + ' 凭空造了轨');
  });
});

test('双语卡落在只有一条字幕的画面上：只给在场的那条上妆，由调用方去说「短了一半」', () => {
  assert.deepEqual(S.applyTargets(mono(), 'bi', null), ['zh']);
  assert.deepEqual(S.applyTargets(doc(T('en', 'translation')), 'bi', null), ['en']);
});

/* 角色自然回退：画面上只剩译文时「只显示原文」这张卡落在那条译文上，不是空转。
   缺省顺序是 `[译文, 原文]`（第 46 轮），所以这里不能退回 `tracks[0]`——那会让
   「原文」卡在双语画面上涂到译文头上。 */
test('画面上缺哪一半，那一半的卡就落在在场的另一半上', () => {
  const only = doc(T('en', 'translation'));
  assert.deepEqual(S.applyTargets(only, 'orig', null), ['en'], '没有源语言轨时不空转');
  assert.deepEqual(S.applyTargets(bi(), 'orig', null), ['zh'], '有源语言轨就必须是它');
  assert.deepEqual(S.applyTargets(mono(), 'trans', null), ['zh'], '没有译轨时落在源语言上');
});

/* 第 106 轮裁决：**样式卡语言中立**。换语言、换译文轨是语言入口一个人的活儿；
   样式卡只对语言入口当下选中的那条译文轨生效，点卡永远不换语言。所以语言入口停在
   一门还没翻的语言上时（画面上没有那条轨、也就没有 cue 可落），样式落在**画面上
   已有的那条译文**上——判为有意语义，不是 bug。反过来那条方案（点卡时语言不一致
   就直接替换语言）被否掉：那会让一次涂装顺手改掉画面上说的是哪门语言。
   第 108 轮把这条从「先声明轨集再落笔」改写成「只在在场的轨里挑」，结论不变。 */
test('语言入口指着轨集上没有的语言时，样式落在画面上第一条译文上（不替换语言）', () => {
  assert.deepEqual(S.applyTargets(bi(), 'trans', 'ja'), ['en']);
  assert.deepEqual(S.applyTargets(bi(), 'bi', 'ja'), ['zh', 'en']);
  // 多条译文时也是「第一条」，不是候选里的那条
  assert.deepEqual(S.applyTargets(tri(), 'trans', 'ko'), ['en']);
  assert.equal(setOf(bi()), 'en:translation|zh:source', '这一路上轨集一动没动');
});

test('源语言轨没有就是没有，第一条译文不冒充它', () => {
  assert.equal(S.source(doc(T('en', 'translation'))), null);
  assert.equal(S.source(bi()).id, 'zh');
});

test('落笔目标不重复——双语两条时不会同一条落两遍', () => {
  [mono(), bi(), tri(), doc(T('en', 'translation'))].forEach((st) => {
    ['orig', 'bi', 'trans'].forEach((form) => {
      [null, 'zh', 'en', 'ja'].forEach((editId) => {
        const ids = S.applyTargets(st, form, editId);
        assert.equal(new Set(ids).size, ids.length, form + '/' + editId + ' → ' + ids.join(','));
      });
    });
  });
  assert.equal(AVAIL.length, 1);
});

/* ---------- 拿下 / 放回：轨集的改写入口（第 108 轮） ---------- */

/* 画面上是哪几条字幕，改它的入口只有时间轴行头（拿下 / 放回）、语言入口那一组
   「有译文，还没放上去」、属性页页头那颗垃圾桶，以及项目层自动落轨。下面这几条
   钉的是这些入口共用的两条规矩：**拿下时最后一条拒绝**、**放回时第三条起问一次**。 */

test('拿下一条：那门语言只是离开画面，候选表能把它原样放回来', () => {
  const st = bi();
  const shelved = S.byId(st, 'en');
  const afterDrop = doc(...S.removeTrack(st, 'en'));
  assert.deepEqual(S.tracks(afterDrop).map((t) => t.id), ['zh']);
  // 放回：只剩一条时不问，直接加
  assert.deepEqual(S.putBackMode(afterDrop, shelved, null), {mode: 'add', swapId: null});
  const back = doc(...S.addTrack(afterDrop, shelved));
  assert.equal(setOf(back), setOf(bi()), '拿下再放回，轨集回到原样');
});

test('拿下最后一条被拒——画面上一条字幕都没有不是这个入口的活儿', () => {
  const st = mono();
  assert.equal(S.removeTrack(st, 'zh'), S.tracks(st), '同一个引用回来 = 调用方据此报拒绝');
  const two = bi();
  assert.equal(S.removeTrack(two, 'nope'), S.tracks(two), '拿一条不在画面上的也是空操作');
});

test('放回第三条时先问一次，默认换掉手上那条译文', () => {
  assert.deepEqual(S.putBackMode(bi(), T('ja', 'translation'), 'en'), {mode: 'ask', swapId: 'en'});
  // 手上是源语言轨：换不掉源语言，退回第一条译文
  assert.deepEqual(S.putBackMode(bi(), T('ja', 'translation'), 'zh'), {mode: 'ask', swapId: 'en'});
});

test('套用落到哪几条轨：原文一条、译文一条、双语两条', () => {
  const st = tri();
  assert.deepEqual(S.applyTargets(st, 'orig', 'ja'), ['zh']);
  assert.deepEqual(S.applyTargets(st, 'trans', 'ja'), ['ja'], '译文落在当前正在编辑的那条译轨上');
  assert.deepEqual(S.applyTargets(st, 'bi', 'ja'), ['zh', 'ja']);
  // 手上是源语言轨时，「译文」那一半退回第一条译轨，而不是写到源语言轨上
  assert.deepEqual(S.applyTargets(st, 'bi', 'zh'), ['zh', 'en']);
  assert.deepEqual(S.applyTargets(mono(), 'bi', 'zh'), ['zh'], '没有译轨就只落源语言轨');
});

/* ---------- 轨样式的取值 ---------- */

test('每条轨就是它自己那一份——没有「跟随源语言」这条隐性连线', () => {
  const st = bi();
  const t = S.line(st, 'en');
  assert.equal(t.font, 'en-font', '译文轨不照抄原文轨的字体');
  assert.equal(t.color, 'en-color');
  assert.equal(t.size, 44);
  // 在原文轨上改一笔，另一条一点不动：这正是去掉跟随要保证的事
  st.tracks = S.tracks(st).map((x) => (x.id === 'zh' ? Object.assign({}, x, {color: 'new'}) : x));
  assert.equal(S.line(st, 'en').color, 'en-color', '改原文轨不会顺手改到译文轨');
});

test('属性页上没有「跟随源语言」这一段', () => {
  assert.ok(S.sections(bi(), 'en').indexOf('followSource') < 0);
});

test('轨的称呼是角色在前、语言在后', () => {
  assert.equal(S.label({role: 'source', name: '中文'}), '原文（中文）');
  assert.equal(S.label({role: 'translation', name: 'English'}), '译文（English）');
  // 多条译文时靠语言区分，所以语言不能省
  assert.notEqual(S.label({role: 'translation', name: 'English'}),
    S.label({role: 'translation', name: '日本語'}));
  assert.equal(S.label(null), '');
});

test('line 返回副本，改它不会写回文档', () => {
  const st = bi();
  const t = S.line(st, 'en');
  t.color = 'green';
  assert.equal(st.tracks[0].color, 'en-color');
  assert.equal(S.line(st, 'nope'), null);
});

test('比例链：原文行的字号就是原文行的字号，根字号是反推出来的', () => {
  const r = S.ratio(bi(), 'en');
  assert.equal(r.orig, 32, '印出来的原文行字号必须与画面上一致');
  assert.equal(r.root, 54);          // 32 ÷ (20/34) ≈ 54，再乘回去四舍五入正好是 32
  assert.equal(Math.round(r.root * S.BI_SCALE), r.orig);
  assert.equal(r.trans, 44);
  assert.ok(r.k > 1, '默认双语里译文行比原文行大');
});

/* ---------- 软上限：放回一条搁置的轨（方案 C） ---------- */

test('不足两条时直接放回去——这是「仅译文 / 只显示原文」的回头路，不该有摩擦', () => {
  assert.deepEqual(S.putBackMode(mono(), T('en', 'translation'), null), {mode: 'add', swapId: null});
  assert.deepEqual(S.putBackMode(doc(T('en', 'translation')), T('zh', 'source'), null),
    {mode: 'add', swapId: null});
});

test('已经两条时放第三条要问一次，换的是**手上那条译文**', () => {
  assert.deepEqual(S.putBackMode(bi(), T('ja', 'translation'), 'en'), {mode: 'ask', swapId: 'en'});
  assert.deepEqual(S.putBackMode(tri(), T('ko', 'translation'), 'ja'), {mode: 'ask', swapId: 'ja'});
  // 手上是源语言轨时退回第一条译文——总不能拿源语言去换一门译文
  assert.deepEqual(S.putBackMode(tri(), T('ko', 'translation'), 'zh'), {mode: 'ask', swapId: 'en'});
});

test('把源语言放回一堆译文上没有可换的，只剩「再叠一条」，但仍然确认一次', () => {
  const two = doc(T('en', 'translation'), T('ja', 'translation'));
  assert.deepEqual(S.putBackMode(two, T('zh', 'source'), 'en'), {mode: 'stack', swapId: null});
});

test('换一门语言：身份来自新轨，长相来自被换掉的那条', () => {
  const st = bi();
  st.tracks[0] = Object.assign(st.tracks[0], {color: 'my-color', size: 28});
  const next = S.replaceTrack(st, 'en', {id: 'ja', lang: 'ja', name: '日本語', role: 'translation'});
  const ja = next.find((t) => t.id === 'ja');
  assert.equal(next.length, 2);
  assert.equal(next[0].id, 'ja', '位次不动——换的是这一格里装谁');
  assert.equal(next[1].id, 'zh', '原文仍在最下');
  assert.equal(ja.name, '日本語');
  assert.equal(ja.color, 'my-color', '调好的样子不该因为换了语言就丢');
  assert.equal(ja.size, 28);
  assert.ok(!S.byId({tracks: next}, 'en'), '被换掉的那条不再在组里');
});

test('换成译文轨时源语言独有的几项跟着角色走', () => {
  const st = bi();
  const next = S.replaceTrack(st, 'zh', {id: 'ja', lang: 'ja', name: '日本語', role: 'translation'});
  const ja = next.find((t) => t.id === 'ja');
  assert.equal(ja.wordAnim, undefined, '词级动画只对源语言成立');
  assert.equal(ja.activeColor, undefined);
  assert.equal(ja.highlight, undefined);
});

test('换掉一条不存在的轨是空操作', () => {
  const st = bi();
  assert.equal(S.replaceTrack(st, 'nope', T('ja', 'translation')), st.tracks);
});

/* ---------- 逐词动效与动效字幕是两个字段（第 54 轮） ---------- */

test('动效字幕不写进 wordAnim——它是另一个字段，且接管整条', () => {
  // 与核心一致：`word_animation` 读 name，`designed_caption` 读 caption；后者有值就报 Designed
  const src = window.BC_DATA.subtitle.defaults.tracks.find((t) => t.role === 'source');
  assert.ok('wordAnim' in src && 'caption' in src, '两件事要有两个字段');
  assert.equal(src.caption, null, '默认没有配方，逐词动效说了算');
});

test('动效字幕第 74 轮下架：目录与分区里都没有它，注册表与配方原样保留', () => {
  const caps = window.BC_DATA.subtitle.catalog.filter((p) => p.caption);
  assert.equal(caps.length, 0, '下架是从目录摘下来，画廊里不该还有带配方的卡');
  assert.ok(!window.BC_DATA.subtitle.cats.some((c) => c.k === 'designed'), '那一区的区头也一起摘');
  // 隐藏不是删除：25 份配方注册表还在，重启时放回 cats + catalog 即可
  assert.equal(window.BC_DATA.subtitle.designed.length, 25);
  window.BC_DATA.subtitle.designed.forEach((g) =>
    assert.ok(window.BC_VC.byKey(g.id), g.id + ' 的配方不在 BC_VC 里，注册表烂了'));
});

test('画廊里其余的样式一律不带配方——套它们会把 caption 清掉', () => {
  window.BC_DATA.subtitle.catalog.filter((p) => p.cat !== 'designed')
    .forEach((p) => assert.equal(p.caption, undefined, p.id + ' 不该带配方'));
});

test('目录里的两段没有共用的键——一个 id 只可能是其中一种', () => {
  const words = new Set(window.BC_DATA.subtitle.anims.map((a) => a.k));
  window.BC_DATA.subtitle.designed.forEach((g) => {
    assert.ok(!words.has(g.id), g.id + ' 同时是逐词动效与动效字幕，那就分不清写哪个字段了');
    /* 第 70 轮起卡片 id **就是**配方的 preset id（`emphasisFifteen` / `template-027-sub`…），
       中间不设翻译层——一有翻译表，就有「按名字对错了」的余地。核心那 16 份
       `caption-*` 还没跟上，登记在 README 分歧台账。 */
    assert.ok(window.BC_VC.byKey(g.id), g.id + ' 不在 BC_VC.PRESETS 里，那它指不到任何一份配方');
    assert.equal(g.caption, g.id, g.id + ' 的 caption 字段要与卡片 id 是同一个');
  });
});

/* ---------- cue 级样式覆盖（第 102 轮，「脱离主样式」的语义） ---------- */

const CUE = 'c7';

test('没脱离的 cue 返回 null——「跟随」与「脱离但还没改」是两个状态', () => {
  const st = bi();
  assert.equal(S.cueOverride(st, CUE, 'zh'), null);
  assert.equal(S.isDetached(st, CUE, 'zh'), false);
  const st2 = Object.assign({}, st, {cueStyles: S.detachCue(st, CUE, 'zh')});
  assert.deepEqual(S.cueOverride(st2, CUE, 'zh'), {});
  assert.equal(S.isDetached(st2, CUE, 'zh'), true);
  assert.deepEqual(S.overriddenKeys(st2, CUE, 'zh'), []);
});

test('没改过的字段仍然读轨上那一份（其余跟随主样式）', () => {
  const st = bi();
  const st2 = Object.assign({}, st, {cueStyles: S.setCueStyle(st, CUE, 'zh', {size: 64})});
  const ln = S.line(st2, 'zh', CUE);
  assert.equal(ln.size, 64, '改过的读覆盖');
  assert.equal(ln.color, 'zh-color', '没改过的读轨');
  assert.equal(S.line(st2, 'zh').size, 32, '不给 cueId 时读的还是轨本身');
  assert.equal(S.line(st2, 'en', CUE).size, 44, '覆盖只落在写它的那条轨上');
});

test('白名单外的键写不进覆盖表', () => {
  const st = bi();
  const map = S.setCueStyle(st, CUE, 'zh', {size: 64, name: '改不了的身份', role: 'source'});
  assert.deepEqual(Object.keys(map[CUE].zh), ['size'], '身份字段不是样式，落不进覆盖表');
});

/* 第 102.1 轮（用户裁决）：**能改的都能逐条改**。首版把逐词动效与强调词排除在外，
   于是同一张属性页切一下作用域少掉两张卡——那读起来是「坏了」，不是「这一档不支持」。 */
test('词级那三件与强调词也能逐条覆盖', () => {
  const st = bi();
  const map = S.setCueStyle(st, CUE, 'zh',
    {wordAnim: 'karaoke', caption: null, activeColor: 'x-active', highlight: {on: true}});
  assert.deepEqual(Object.keys(map[CUE].zh).sort(),
    ['activeColor', 'caption', 'highlight', 'wordAnim']);
  const st2 = Object.assign({}, st, {cueStyles: map});
  assert.equal(S.line(st2, 'zh', CUE).wordAnim, 'karaoke');
  assert.equal(S.line(st2, 'zh').wordAnim, undefined, '轨上那份没被动过');
});

test('每一个可覆盖的键都恰好属于一段——否则改得了退不回去', () => {
  const flat = Object.keys(S.SECTION_KEYS)
    .reduce((a, k) => a.concat(S.SECTION_KEYS[k]), []);
  assert.deepEqual(flat.slice().sort(), S.CUE_KEYS.slice().sort());
  assert.equal(flat.length, new Set(flat).size, '一个键只能归一段');
});

test('两个作用域是同一页——段的门控只看轨，不看作用域', () => {
  const st = bi();
  assert.deepEqual(S.sections(st, 'zh'), S.sections(st, 'zh', CUE));
  assert.ok(has(S.sections(st, 'zh'), 'activeWord') && has(S.sections(st, 'zh'), 'highlight'));
  assert.ok(has(S.sections(st, 'en'), 'ratioNote'));
});

test('比例链按这一条 cue 的有效字号算', () => {
  const st0 = bi();
  const st = Object.assign({}, st0, {cueStyles: S.setCueStyle(st0, CUE, 'en', {size: 88})});
  assert.equal(S.ratio(st, 'en').trans, 44, '不给 cueId 时还是轨上那份');
  assert.equal(S.ratio(st, 'en', CUE).trans, 88);
  assert.equal(S.ratio(st, 'en', CUE).k, +(88 / 32).toFixed(2));
});

test('逐段退回跟随只抹这一段的键；空段是空操作，不生成新表', () => {
  const st0 = bi();
  const st = Object.assign({}, st0,
    {cueStyles: S.setCueStyle(st0, CUE, 'zh', {size: 64, outlineW: 20, y: 40})});
  assert.deepEqual(S.sectionOverrides(st, CUE, 'zh', 'text'), ['size']);
  assert.deepEqual(S.sectionOverrides(st, CUE, 'zh', 'outline'), ['outlineW']);
  const cleared = S.clearSection(st, CUE, 'zh', 'text');
  assert.deepEqual(Object.keys(cleared[CUE].zh).sort(), ['outlineW', 'y']);
  assert.equal(S.clearSection(st, CUE, 'zh', 'shadow'), S.cueStyles(st), '空段返回原表');
});

test('回到跟随把这一条整条抹掉，抹到没有 cue 就不留空壳', () => {
  const st0 = bi();
  const st = Object.assign({}, st0, {cueStyles: S.setCueStyle(st0, CUE, 'zh', {size: 64})});
  assert.deepEqual(S.detachedCueIds(st), [CUE]);
  const map = S.clearCue(st, CUE, 'zh');
  assert.deepEqual(map, {});
  assert.deepEqual(S.detachedCueIds(Object.assign({}, st, {cueStyles: map})), []);
});

test('两条轨在同一条 cue 上各写各的，互不牵连', () => {
  const st0 = bi();
  let map = S.setCueStyle(st0, CUE, 'zh', {size: 64});
  let st = Object.assign({}, st0, {cueStyles: map});
  map = S.setCueStyle(st, CUE, 'en', {color: 'red'});
  st = Object.assign({}, st0, {cueStyles: map});
  assert.equal(S.line(st, 'zh', CUE).size, 64);
  assert.equal(S.line(st, 'en', CUE).color, 'red');
  const after = S.clearCue(st, CUE, 'zh');
  assert.deepEqual(Object.keys(after[CUE]), ['en'], '抹掉一条轨不该把同一条 cue 的另一条也带走');
});

test('画面上这一刻是哪一条 cue：三处读同一个函数', () => {
  const cues = [{id: 'a', start: 0, end: 2}, {id: 'b', start: 2, end: 4}];
  assert.equal(S.cueAt(cues, 0).id, 'a');
  assert.equal(S.cueAt(cues, 2).id, 'b', '区间左闭右开');
  assert.equal(S.cueAt(cues, 99).id, 'a', '落在缝里回落到第一条，与画布同一条口径');
  assert.equal(S.cueAt([], 1), null);
});

test('「套到」一条轨：只给它上妆，缩略图只重画那一行，其余行画轨上现在的涂装（第 152 轮）', () => {
  const p = {look: 'slay', look2: 'ali'};
  const st = {tracks: [T('en', 'translation'), T('zh', 'source')]};
  assert.deepEqual(S.applyTargets(st, 'screen', 'zh', 'en'), ['en'], '作用域指到译文轨就只落它');
  assert.deepEqual(S.applyTargets(st, 'screen', 'zh', 'nope'), ['en', 'zh'], '作用域指到不存在的轨等于全部');
  const rows = S.screenRows(st, p, 'en', 'en');
  assert.equal(rows[0][1], 'slay', '作用域那一行落的是卡的主涂装，不是 look2');
  assert.equal(rows[1][1].color, 'zh-color', '作用域外那一行画的是轨上现在的涂装对象');
});

test('样式按轨记：全部同族才算「套的是它」，混搭印两个名字（第 152 轮）', () => {
  const cat = [{id: 'v-slay', name: 'Slay', look: 'slay'}, {id: 'v-ali', name: 'Ali', look: 'ali'}];
  const same = {preset: 'v-slay', tracks: [T('en', 'translation', {preset: 'v-slay'}), T('zh', 'source', {preset: 'vb-slay'})]};
  assert.equal(S.currentCard(same, cat).id, 'v-slay', '三胞胎 id 算同一族');
  assert.deepEqual(S.styleNames(same, [cat]), ['Slay']);
  const mixed = {preset: 'v-slay', tracks: [T('en', 'translation', {preset: 'v-ali'}), T('zh', 'source')]};
  assert.equal(S.currentCard(mixed, cat), null, '各轨勾在不同的卡上就不是「套的是它」');
  assert.deepEqual(S.styleNames(mixed, [cat]), ['Ali', 'Slay'], '按画面上从上到下的次序印名字');
  assert.equal(S.presetOf(mixed, mixed.tracks[1]), 'v-slay', '没记过的轨读文档级 preset');
  const hiddenMix = {preset: 'v-slay', tracks: [T('en', 'translation', {preset: 'v-ali', hidden: true}), T('zh', 'source')]};
  assert.equal(S.currentCard(hiddenMix, cat).id, 'v-slay', '停用的轨不在画面上，不参与判定');
  assert.deepEqual(S.styleNames({preset: 'v-gone', tracks: []}, [cat]), ['自定义']);
});

test('覆盖表是纯函数产物，不改入参文档', () => {
  const st = bi();
  const before = JSON.stringify(st);
  S.setCueStyle(st, CUE, 'zh', {size: 64});
  S.detachCue(st, CUE, 'zh');
  S.clearCue(st, CUE, 'zh');
  assert.equal(JSON.stringify(st), before);
});

test('倒鸭子（kinetic）：源语言轨的段换成 kinetic / highlight，没有位置；换语言时随角色清掉', () => {
  const st = {tracks: [T('zh', 'source', {kinetic: {seed: 1}}), T('en', 'translation')]};
  const list = S.sections(st, 'zh');
  assert.deepEqual(list.filter((k) => k !== 'saveFoot' && k !== 'bilingual' && k !== 'display'), ['kinetic', 'highlight']);
  assert.ok(!has(list, 'activeWord') && !has(list, 'motion'), '动态排版的面板取代当前词与动效');
  assert.ok(!has(list, 'position'), '字幕区域由 kinetic 自己的三档决定');
  assert.ok(!has(S.sections(st, 'en'), 'kinetic'), '译文轨没有这一段');
  assert.ok(S.CUE_KEYS.indexOf('kinetic') < 0, 'kinetic 是整条轨的，不进 cue 覆盖表');
  const next = S.replaceTrack(st, 'zh', {id: 'ja', lang: 'ja', name: '日本語', role: 'translation'});
  assert.equal(next.find((t) => t.id === 'ja').kinetic, undefined);
  const card = window.BC_DATA.subtitle.catalog.find((p) => p.kinetic);
  assert.ok(card && card.cat === 'kinetic' && window.BC_DATA.subtitle.cats.some((c) => c.k === 'kinetic'), '画廊有倒鸭子那张卡与它的分区');
});
