/* model-elpanel.js —— Elements 浏览结构钉住：顶层 chip、目录页分节与贴纸 chip、
   可视化 chip、进度网格次序。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-substyle.js');
require('./model-pose.js');
require('./model-shape-paths.js');
require('./model-elements.js');
require('./model-stickers.js');
require('./model-confetti.js');
require('./model-pet.js');
require('./model-elpanel.js');
const P = window.BC_ELPANEL;
const E = window.BC_EL;
const SK = window.BC_SK;

test('彩纸元素默认铺满画布且连续添加不错位，新建即写入随机种子；其他贴纸保留普通落位（第 231 轮）', () => {
  const C = window.BC_CONFETTI;
  const seeds = [];
  for (const seq of [1,2,3]) {
    const added = P.newElement('confetti', C.STYLES[0], {seq, total:10, playT:0});
    assert.deepStrictEqual(added.place, {x:50,y:50,w:100,h:100});
    assert.equal(added.anim.loop.k, 'none');
    assert.equal(added.id, 'e-cft-' + seq);
    assert.equal(added.kind, 'confetti');
    assert.equal(added.name, '彩纸 · ' + C.STYLES[0].name);   // 演示装置里没有彩纸行，基名走 KIND_HEAD
    const cf = added.style.confetti;
    assert.equal(cf.style, 'rainbow-paper');
    assert.ok(Number.isSafeInteger(cf.seed) && cf.seed > 0, '种子应随机非零');
    seeds.push(cf.seed);
  }
  assert.ok(new Set(seeds).size === 3, '三次新建三个种子');
  assert.equal(P.newElement('confetti', C.byStyle('party-cannons'), {total:10}).style.confetti.style, 'party-cannons');
  assert.ok(P.newElement('sticker', SK.list(SK.find('dyn-emoji'))[0], {total:10}).place.w < 100);
  // 目录里的 Confetti 包退场：动态贴纸分类 chip 里改由「彩纸」一格接位，位次就是 confetti 分类键的位次
  assert.ok(!SK.find('dyn-confetti'));
  const cats = P.animCats(SK.ANIM).map((c) => c.k);
  assert.ok(cats.indexOf('confetti') === cats.indexOf('dyn-collage') + 1, cats.join(','));
  assert.ok(cats.indexOf('dyn-emoji') === cats.indexOf('confetti') + 1, cats.join(','));
});

/* ---------- 顶层 chip 与分节 ---------- */

test('顶层 chip 恰好四格：全部 / 贴纸 / 形状 / 可视化', () => {
  assert.deepStrictEqual(P.TABS.map((t) => t.k), ['all', 'st', 'sh', 'viz']);
});

test('目录页只保留有实现或有第三方来源的分节', () => {
  assert.deepStrictEqual(P.SECTIONS.map((s) => s.k),
    ['st', 'gif', 'sh', 'viz', 'cta', 'fr']);
  assert.deepStrictEqual(P.SECTIONS.filter((s) => s.bao).map((s) => s.k), ['fr']);
  // 2026-09-14：这一段只剩模板，组用二级 chip 切
  assert.strictEqual(P.sectionOf('fr').title, '模板');
  assert.strictEqual(P.sectionOf('fr').subs, 'tpl');
});

test('模板的二级 chip = 全部 ＋ 有模板的组（2026-09-14）', () => {
  const groups = [{key: 'chapters', label: '章节与进度', items: [1, 2]}, {key: 'brand', label: '品牌库', items: [1]}];
  assert.deepStrictEqual(P.tplChips(groups).map((c) => c.k), ['all', 'chapters', 'brand']);
  assert.deepStrictEqual(P.tplChips(groups).map((c) => c.label), ['全部', '章节与进度', '品牌库']);
  assert.deepStrictEqual(P.tplChips([]).map((c) => c.k), ['all']);
});

/* 批注 / 绘制两段第 217 轮随「批注 · 绘制 · 占位框」整类退场；`an` / `draw` 不再是
   分节键，`sectionOf` 对它们回 null。 */
test('BaoCut 特有的段不占顶层 chip，但钻得进去', () => {
  const tabs = P.TABS.map((t) => t.k);
  P.SECTIONS.filter((s) => s.bao).forEach((s) => {
    assert.ok(tabs.indexOf(s.k) < 0, s.k + ' 不该占一格顶层 chip');
    assert.ok(s.tab, s.k + ' 该钻得进去');
  });
  ['an', 'draw'].forEach((k) => assert.strictEqual(P.sectionOf(k), null, k));
});

test('顶层 chip 每一格（除全部）都指得到一段', () => {
  P.TABS.filter((t) => t.k !== 'all').forEach((t) => {
    assert.ok(P.sectionOf(t.k), t.k + ' 没有对应的分节');
  });
});

test('sections(tab)：全部摆整表，钻进去只摆那一段', () => {
  assert.strictEqual(P.sections('all').length, P.SECTIONS.length);
  assert.deepStrictEqual(P.sections('viz').map((s) => s.k), ['viz']);
  assert.deepStrictEqual(P.sections('gif').map((s) => s.k), ['gif']);
});

test('目录页每段只摆一屏四格', () => {
  assert.strictEqual(P.TILES, 4);
});

/* ---------- 贴纸的二级 chip ---------- */

test('贴纸 chip 只保留有素材的全部 / 精选 / 表情，「我的贴纸」紧跟「全部」', () => {
  const chips = P.stickerChips(SK.PACKS);
  // 品牌库那一格是 BaoCut 特有的（bao: true）。第 238 轮摆在第三方包那几格之后，
  // 第 239 轮提到「全部」之后第一格——chip 次序要和分节次序一致，用户自己的东西在最前。
  assert.deepStrictEqual(chips.map((c) => c.k), ['all', 'brand', 'featured', 'emoji']);
  assert.strictEqual(chips[1].bao, true);
  assert.strictEqual(chips.filter((c) => !c.bao).length, 3);
});

test('Icons 不是 chip（它只往网格供图）', () => {
  assert.ok(P.stickerChips(SK.PACKS).every((c) => c.k !== 'icon'));
});

test('包不存在就不摆空 chip（「我的贴纸」除外，它空着也摆，点进去是指路）', () => {
  assert.deepStrictEqual(P.stickerChips([{k: 'emoji'}]).map((c) => c.k), ['all', 'brand', 'emoji']);
  assert.deepStrictEqual(P.stickerChips([]).map((c) => c.k), ['all', 'brand']);
});

test('「⋯」里是两格 chip 之外的第三方包，一个不落一个不重', () => {
  const rest = P.stickerRest(SK.PACKS);
  assert.strictEqual(rest.length, SK.PACKS.length - 2);
  const chipped = P.stickerChips(SK.PACKS).map((c) => c.k);
  rest.forEach((p) => assert.ok(chipped.indexOf(p.k) < 0, p.k + ' 既在 chip 又在 ⋯'));
  const seen = {};
  P.stickerChips(SK.PACKS).slice(1).filter((c) => !c.bao).concat(rest).forEach((p) => {
    assert.ok(!seen[p.k], p.k + ' 出现了两次');
    seen[p.k] = true;
  });
  assert.strictEqual(Object.keys(seen).length, SK.PACKS.length);
});

/* ---------- 动态贴纸 ---------- */

test('动图分类按分类键字母序摆', () => {
  const got = P.animOrder(SK.ANIM).map((c) => P.ANIM_KEY[c.k]);
  const want = P.ANIM_ORDER.filter((k) => got.indexOf(k) >= 0);
  assert.deepStrictEqual(got, want);
});

test('动态贴纸分类的第一格是「我的贴纸」（第 239 轮从末尾提到最前）', () => {
  const cats = P.animCats(SK.ANIM);
  assert.strictEqual(cats[0].k, 'brand');
  assert.strictEqual(cats[0].label, '我的贴纸');
  assert.strictEqual(cats[0].bao, true);
  // 空表也摆得出这一格：目录里没有第三方动图分类时它仍在
  // Pet（第 242 轮）紧随其后，在随包目录之前
  assert.strictEqual(cats[1].k, 'pet');
  assert.strictEqual(cats[1].label, 'Pet');
  assert.deepStrictEqual(P.animCats([]).map((c) => c.k), ['brand', 'pet', 'confetti']);
});

test('confettiAt 报的是不含「我的贴纸」那一格的位次（视图拿它插彩纸）', () => {
  const at = P.confettiAt(SK.ANIM);
  const bare = P.animOrder(SK.ANIM).map((c) => P.ANIM_KEY[c.k]);
  // 彩纸插进去之后应当正好落在 confetti 分类键的字母序位次上
  const withCf = bare.slice(0, at).concat(['confetti'], bare.slice(at));
  assert.deepStrictEqual(withCf, P.ANIM_ORDER.filter((k) => withCf.indexOf(k) >= 0));
  // 分类全表里那一格与 animCats 的实际落点一致（animCats 多顶了「我的贴纸」「Pet」两格）
  assert.strictEqual(P.animCats(SK.ANIM).findIndex((c) => c.k === 'confetti'), at + 2);
  assert.strictEqual(P.confettiAt([]), 0);
});

test('整类不收的两格（logos / social_media）不造空分类', () => {
  const keys = SK.ANIM.map((c) => P.ANIM_KEY[c.k]);
  assert.ok(keys.indexOf('logos') < 0);
  assert.ok(keys.indexOf('social_media') < 0);
  // 保留的第三方分类每一格都认得出对应的分类键
  SK.ANIM.forEach((c) => assert.ok(P.ANIM_KEY[c.k], c.k + ' 没有对应的分类键'));
});

/* ---------- 可视化 ---------- */

test('可视化二级 chip 恰好三格，计时不再自己占一格', () => {
  assert.deepStrictEqual(P.VIZ_CATS.map((c) => c.k), ['all', 'pr', 'sw']);
});

test('进度网格：计时两格夹在 snake 与 snake_spin 之间，共 16 格', () => {
  const grid = P.progOrder(E.PROG_TILES, E.COUNTERS);
  assert.strictEqual(grid.length, 16);
  assert.deepStrictEqual(grid.map((x) => x.k), ['rounded', 'normal', 'border', 'reverse_border',
    'donut', 'rainbow_border', 'reverse_rainbow_border', 'circle', 'strobe_border',
    'reverse_strobe_border', 'snake', 'countdown', 'countup', 'snake_spin', 'snake_rainbow',
    'snake_spin_rainbow']);
  assert.strictEqual(grid[11].fam, 'count');
  assert.strictEqual(grid[13].fam, 'prog');
});

test('目录页可视化那四格是手挑的两进度 ＋ 一声波 ＋ 一计时', () => {
  const four = P.vizPicks(E.PROG_TILES, E.WAVES, E.COUNTERS);
  assert.deepStrictEqual(four.map((x) => x.k), ['rainbow_border', 'rounded', 'ribbons', 'countdown']);
  assert.deepStrictEqual(four.map((x) => x.fam), ['prog', 'prog', 'wave', 'count']);
  assert.strictEqual(four.length, P.TILES);
});

/* ---------- 点一格 = 新建 ---------- */

const BASE = {sticker: {name: '贴纸 · ON AIR', icon: 'star', hue: 'purple', place: {x: 17, y: 62, w: 13}},
  counter: {name: '计时 · 倒计时', icon: 'text', hue: 'orange', place: {x: 22, y: 12, w: 30}},
  vframe: {name: '取景框 · 摄像机', icon: 'film', hue: 'indigo', place: {x: 50, y: 50, w: 100}}};

test('新建的起点是播放头、时长是 NEW_SPAN', () => {
  const el = P.newElement('sticker', {src: 'a.svg', alt: '甲'}, {playT: 12.4, total: 206, seq: 1, base: BASE.sticker});
  assert.strictEqual(el.start, 12.4);
  assert.strictEqual(el.end, 12.4 + E.NEW_SPAN);
  assert.strictEqual(el.kind, 'sticker');
  assert.strictEqual(el.added, true);
  assert.strictEqual(el.icon, 'star');
  assert.strictEqual(el.hue, 'purple');
});

test('计时是唯一的例外：时长走 COUNT_SPAN', () => {
  const el = P.newElement('counter', E.COUNTERS[0], {playT: 3, total: 206, seq: 1, base: BASE.counter});
  assert.strictEqual(el.end - el.start, E.COUNT_SPAN);
  assert.strictEqual(el.style.cntMode, 'countdown');
});

test('撞到片尾裁到片尾，起点不倒着走', () => {
  const el = P.newElement('sticker', {src: 'a.svg'}, {playT: 204, total: 206, seq: 1, base: BASE.sticker});
  assert.strictEqual(el.start, 204);
  assert.strictEqual(el.end, 206);
});

test('每一格的样式真落到这条元素自己的样式文档上（画布词表的键名）', () => {
  const st = P.newElement('sticker', {builtin: {id: 'bulb', name: '灯泡'}}, {seq: 1, total: 206, base: BASE.sticker});
  assert.deepStrictEqual(st.style, {asset: null, builtin: 'bulb'});
  assert.strictEqual(st.name, '贴纸 · 灯泡');
  /* 素材那一支带上 `assetKind`（第 238 轮）：品牌库上传的源是 `blob:…`，扩展名没了，
     收件时按字节判出的类型得跟着样式袋走，否则画布判不出该不该起 lottie-web。 */
  const as = P.newElement('sticker', {src: 'a.svg'}, {seq: 1, total: 206, base: BASE.sticker});
  assert.deepStrictEqual(as.style, {asset: 'a.svg', assetKind: null, builtin: null});
  const bs = P.newElement('sticker', {src: 'blob:x', kind: 'lottie'},
    {seq: 1, total: 206, base: BASE.sticker});
  assert.strictEqual(bs.style.assetKind, 'lottie');
  const wv = P.newElement('wave', E.WAVES[2], {seq: 1, total: 206, base: {name: '声波 · Trio', place: {x: 50, y: 60, w: 55}}});
  assert.strictEqual(wv.style.waveStyle, E.WAVES[2].k);
  assert.strictEqual(wv.style.waveColor, E.WAVES[2].main);
  const sh = P.newElement('shape', {shape: E.SHAPES[0], i: E.SHAPES[0].i},
    {seq: 1, total: 206, base: {name: '形状 · 圆角矩形', place: {x: 80, y: 36, w: 18}}});
  assert.strictEqual(sh.style.shapeI, E.SHAPES[0].i);
});

test('连点四下落位错开，铺满画面的那几类不错开', () => {
  const xs = [1, 2, 3, 4].map((n) => P.newElement('sticker', {src: 'a.svg'},
    {playT: 0, total: 206, seq: n, base: BASE.sticker}));
  const seen = xs.map((e) => e.place.x + '/' + e.place.y);
  assert.strictEqual(new Set(seen).size, 4);
  const ids = new Set(xs.map((e) => e.id));
  assert.strictEqual(ids.size, 4);
  const full = [1, 2].map((n) => P.newElement('vframe', {name: '宝丽来'},
    {playT: 0, total: 206, seq: n, base: BASE.vframe}));
  assert.deepStrictEqual(full[0].place, full[1].place);
});

test('第一条新建的不会严丝合缝扣在同类演示元素上', () => {
  const e = P.newElement('sticker', {src: 'a.svg'}, {playT: 0, total: 206, seq: 1, base: BASE.sticker});
  assert.notDeepStrictEqual(e.place, BASE.sticker.place);
  assert.ok(e.place.x !== BASE.sticker.place.x || e.place.y !== BASE.sticker.place.y);
  /* 铺满画面的那几类仍然按原位盖满：它们本来就该压在一起。 */
  const full = P.newElement('vframe', {name: '宝丽来'}, {playT: 0, total: 206, seq: 1, base: BASE.vframe});
  assert.deepStrictEqual(full.place, BASE.vframe.place);
});

test('错开不会把元素推出画面', () => {
  const e = P.newElement('sticker', {src: 'a.svg'},
    {playT: 0, total: 206, seq: 4, base: {name: '贴纸', place: {x: 97, y: 97, w: 10}}});
  assert.ok(e.place.x <= 94 && e.place.y <= 94);
});

test('没有样式的类型不硬造一份空样式', () => {
  const el = P.newElement('vframe', {name: '宝丽来'},
    {playT: 0, total: 206, seq: 1, base: {name: '取景框 · 摄像机', place: {x: 50, y: 50, w: 100}}});
  assert.strictEqual(el.style, null);
  assert.strictEqual(el.name, '取景框 · 宝丽来');
});

test('Codex Pet 格子的样式袋带 assetKind:pet 与 pet 元数据（第 242 轮）', () => {
  const st = P.tileStyle('sticker', {src: 'assets/pets/official/codex/spritesheet.webp', kind: 'pet',
    version: 2, name: 'Codex', author: 'OpenAI', license: 'x'});
  assert.strictEqual(st.assetKind, 'pet');
  assert.strictEqual(st.asset, 'assets/pets/official/codex/spritesheet.webp');
  assert.deepStrictEqual(st.pet, {version: 2, state: 'idle', name: 'Codex', author: 'OpenAI', license: 'x'});
  // 普通贴纸不长出 pet 袋
  assert.strictEqual(P.tileStyle('sticker', {src: 'a.json', kind: 'lottie'}).pet, undefined);
  // 元素样式袋的共用键里有 pet，toStage 才不会把它丢掉
  assert.strictEqual(window.BC_EL.toStage('sticker', {pet: st.pet}).pet, st.pet);
});
