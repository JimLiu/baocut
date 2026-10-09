/* model-toolbar.js —— 把浮动工具条配置表的结构与逐类型词表钉住。
   这张表是定死的，改它要有依据。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-sticker-source.js');   // barKind 的「能不能分色」问它
require('./model-toolbar.js');
const B = window.BC_BAR;

test('ordinary video exposes transitions and keeps long menus clear of their trigger', () => {
  assert.deepEqual(B.visible('video'), [['animation', 'transitions'], ['volume', 'speed']]);
  assert.deepEqual(B.videoMenuLayout({top: 360, bottom: 392}, 768), {dir: 'up', maxHeight: 334});
  assert.deepEqual(B.videoMenuLayout({top: 50, bottom: 82}, 768), {dir: 'down', maxHeight: 660});
});

test('video toolbar stays outside the frame, flips at the stage edge, and fits narrow stages', () => {
  const area = {left: 100, right: 600, top: 50, bottom: 450, width: 500};
  assert.deepEqual(B.videoPlacement({left: 150, width: 400, top: 90, bottom: 350}, area,
    {width: 220, height: 40}), {left: 140, top: 312, maxWidth: 484});
  assert.deepEqual(B.videoPlacement({left: 150, width: 400, top: 90, bottom: 430}, area,
    {width: 220, height: 40}), {left: 140, top: 8, maxWidth: 484});
  const narrow = {left: 100, right: 260, top: 50, bottom: 350, width: 160};
  assert.deepEqual(B.videoPlacement({left: 220, width: 100, top: 90, bottom: 250}, narrow,
    {width: 220, height: 40}), {left: 8, top: 212, maxWidth: 144});
});

test('main clip and ordinary video share every menu item without legacy actions', () => {
  assert.deepEqual(B.visible('clip'), B.visible('video'));
  assert.deepEqual(B.more('clip'), B.more('video'));
  assert.equal(B.ITEM['clip-frame'], undefined);
  assert.equal(B.ITEM['clip-reset'], undefined);
});

test('配置的形状是「分组的数组」，不是一条平的 chip 流', () => {
  Object.keys(B.BAR).forEach((k) => {
    const c = B.BAR[k];
    assert.ok(Array.isArray(c.visible), k + ' 缺 visible');
    c.visible.forEach((g) => assert.ok(Array.isArray(g), k + ' 的 visible 每一项都得是一组'));
    if (c.more) c.more.forEach((g) => assert.ok(Array.isArray(g), k + ' 的 more 每一项都得是一组'));
  });
});

test('每个词条都有显示名，没有漏配的 id', () => {
  Object.keys(B.BAR).forEach((k) => {
    const c = B.BAR[k];
    const ids = [];
    const walk = (g) => g.forEach((x) => (Array.isArray(x) ? walk(x) : ids.push(x)));
    c.visible.forEach(walk);
    (c.more || []).forEach(walk);
    ids.forEach((id) => assert.ok(B.ITEM[id], `${k} 用了没配显示名的 ${id}`));
  });
});

test('贴纸走 SVG 那一条：填充色列表 + 动画，不是单色着色', () => {
  assert.deepStrictEqual(B.visible('sticker'), [['fill-list'], ['animation']]);
});

/* 第 213 轮：1–2 枚色点画在样式下拉**前面**
   ——「大部分类型都能直接在浮动条上改色」是浮动条的基线。出几枚按款查表，配置表只
   负责摆位次。 */
test('声波 / 进度的色点排在样式下拉之前', () => {
  assert.deepStrictEqual(B.visible('wave'), [['wave-colors'], ['wave-picker'], ['animation']]);
  assert.deepStrictEqual(B.visible('progress'),
    [['progress-colors'], ['progress-picker'], ['animation']]);
});

test('文本组只有解组与删除两件，且**没有溢出菜单**', () => {
  assert.deepStrictEqual(B.visible('textgroup'), [['ungroup'], ['delete']]);
  assert.strictEqual(B.more('textgroup'), null, '组本身没有可调属性，能调的都在成员身上');
  assert.strictEqual(B.more('tpl'), null);
});

/* 第 82 轮：文字这一条重排，不做 Text Behind Person。
   这条把整张表钉死——改它要有依据。 */
test('文字的条子与菜单逐项钉死（不做 Text Behind Person）', () => {
  assert.deepStrictEqual(B.visible('text'), [['color', 'font', 'size'], ['text-styles', 'animation']],
    '条子是「颜色 字体 字号 │ 两枚图标钮」，样式不单拎到最前');
  assert.deepStrictEqual(B.more('text'), [
    [['bold', 'italic'], ['align-left', 'align-center', 'align-right']],
    ['line-height', 'letter-spacing'],
    ['opacity'],
    ['copy', 'arrange', 'save-to-brand-kit'],
    ['properties'],
    ['adjust-timing', 'disable', 'delete'],
  ]);
  const flat = B.more('text').filter((g) => !B.isRow(g)).reduce((a, g) => a.concat(g), []);
  assert.strictEqual(flat.indexOf('hide-text-behind'), -1, 'Text Behind Person 两处都不画');
});

/* 第 79 轮立、第 82 与 84.1 两轮收窄、第 102 轮再补一类：**条子上**一处都不放
   （存是「调完之后」的动作，浮动条是「正在调」的地方），只进菜单。
   这条穷举整张表，免得下一次补词表时把它撒回条子上。 */
test('十五类的条子上都没有「存到品牌库」，菜单里只有文字 / 图片 / 视频 / 字幕四类', () => {
  const flat = (groups) => {
    const ids = [];
    const walk = (g) => g.forEach((x) => (Array.isArray(x) ? walk(x) : ids.push(x)));
    (groups || []).forEach(walk);
    return ids;
  };
  // 菜单里有它的四类：text / image / video / subtitle。
  // 动图贴纸与矢量贴纸两条都不放。
  const INMENU = {text: true, image: true, video: true, subtitle: true};
  Object.keys(B.BAR).forEach((k) => {
    assert.strictEqual(flat(B.BAR[k].visible).indexOf('save-to-brand-kit'), -1,
      k + ' 的条子上不该有存到品牌库');
    const inMenu = flat(B.BAR[k].more).indexOf('save-to-brand-kit') >= 0;
    assert.strictEqual(inMenu, !!INMENU[k], k + ' 的菜单里' + (inMenu ? '多' : '少') + '了存到品牌库');
  });
  // 第 145 轮普通视频：分离音频在存到品牌库之前；2026-09-16 智能裁剪挨着替换视频。
  assert.deepStrictEqual(B.more('video').slice(-1)[0],
    ['adjust-timing', 'crop-video', 'replace-video', 'detach-audio', 'save-to-brand-kit', 'delete']);
  assert.deepStrictEqual(B.more('image').slice(-1)[0],
    ['adjust-timing', 'replace-image', 'save-to-brand-kit', 'disable', 'delete']);
});

/* 对照 BaoCut v2 已上线的条子（2026-10-09）：v2 除视频外每一类的溢出菜单都有不透明度与「隐藏」。
   这里的「隐藏」叫停用片段，与时间线菜单同一个词，摆在删除前一格；视频那一条 v2 没有。 */
test('除视频与彩纸 / 白板外，每一类的菜单里都有不透明度与停用片段', () => {
  const flat = (groups) => {
    const ids = [];
    const walk = (g) => g.forEach((x) => (Array.isArray(x) ? walk(x) : ids.push(x)));
    (groups || []).forEach(walk);
    return ids;
  };
  ['text', 'image', 'shape', 'sticker', 'stickerimg', 'progress', 'wave', 'counter'].forEach((k) => {
    const menu = flat(B.more(k));
    assert.ok(menu.indexOf('opacity') >= 0, k + ' 的菜单里少了不透明度');
    assert.strictEqual(menu.indexOf('disable'), menu.indexOf('delete') - 1, k + ' 的停用片段该在删除前一格');
  });
  assert.strictEqual(flat(B.more('video')).indexOf('disable'), -1, '视频那一条 v2 没有隐藏');
});

test('翻转与适应画布在溢出菜单的第一段：一行两簇、四枚图标钮', () => {
  ['image', 'video', 'shape', 'sticker', 'stickerimg'].forEach((k) => {
    const first = B.more(k)[0];
    assert.ok(B.isRow(first), k + ' 的第一段该是嵌套的按钮行');
    /* 第 43 轮收成**一行**（此前是两行、后两枚是宽文字钮），
       第 85 轮再分回**两簇**：翻转两枚与画布两枚之间空一档。 */
    assert.deepStrictEqual(first, [['flip-vertical', 'flip-horizontal'],
                                   ['fit-canvas', 'fill-canvas']], k + ' 的第一段');
  });
});

test('调整时间与删除永远是溢出菜单的最后一段', () => {
  Object.keys(B.BAR).forEach((k) => {
    const m = B.more(k);
    if (!m) return;
    const last = m[m.length - 1];
    assert.ok(last.indexOf('delete') >= 0 || last.indexOf('hide-subs') >= 0,
      k + ' 的最后一段该收在删除上');
  });
});

test('属性只给文字 / 形状 / 贴纸 / 计时——图片与视频没有属性页那一条', () => {
  const has = (k) => (B.more(k) || []).some((g) => g.indexOf('properties') >= 0);
  assert.ok(has('text') && has('shape') && has('sticker'));
  // 计时是一条文字元素（第 88 轮），跟着文字那一条走
  assert.ok(has('counter'));
  assert.ok(!has('image') && !has('video'));
});

/* 第 88 轮：计时的条子照文字那一条摆「颜色 字体 字号」——它就是一条文字元素，
   只把最前面换成这一类独有的模式下拉。`text-styles` 不摆：文字样式预设是一整套排版，
   套在一格逐秒换字的读数上没有对应物。 */
test('计时的条子 = 模式下拉 ＋ 文字那三件 ＋ 动画', () => {
  assert.deepStrictEqual(B.visible('counter'),
    [['counter-mode'], ['color', 'font', 'size'], ['animation']]);
  const flat = (B.visible('counter') || []).reduce((a, g) => a.concat(g), []);
  assert.strictEqual(flat.indexOf('text-styles'), -1);
});

/* 第 89.1 轮：对齐进了菜单，`more` 的第一段与文字元素同形。 */
test('计时菜单的第一段 = B / I ＋ 三对齐，与文字元素同一张形状', () => {
  const first = (B.more('counter') || [])[0];
  assert.deepStrictEqual(first, [['bold', 'italic'], ['align-left', 'align-center', 'align-right']]);
  assert.deepStrictEqual(first, (B.more('text') || [])[0]);
});

test('位图 / 动图贴纸走 stickers 一条，矢量贴纸走 SVG 一条', () => {
  // 素材决定条子：`.svg` 有填充色可换，位图与动图只有 Adjust
  assert.strictEqual(B.barKind('sticker', 'assets/stickers/emoji-fire.svg'), 'sticker');
  assert.strictEqual(B.barKind('sticker', 'assets/stickers/anim/dyn-tap-01.gif'), 'stickerimg');
  /* 第 238 轮：Lottie 也能分色，走 `SVG` 那一条；品牌库上传的 `blob:` 源没有扩展名，
     判类型靠收件时写进样式袋的 `assetKind`。 */
  assert.strictEqual(B.barKind('sticker', 'assets/stickers/anim/dyn-emoji-01.json'), 'sticker');
  assert.strictEqual(B.barKind('sticker', {src: 'blob:abc', kind: 'lottie'}), 'sticker');
  assert.strictEqual(B.barKind('sticker', {src: 'blob:abc', kind: 'image'}), 'stickerimg');
  assert.strictEqual(B.barKind('sticker', 'assets/stickers/pride-02.png'), 'stickerimg');
  // 素材还没读到时按矢量算——猜错的代价是少两行菜单，不是一个读不出色的空段
  assert.strictEqual(B.barKind('sticker', null), 'sticker');
  // 其余类型原样返回
  ['video', 'image', 'shape', 'text'].forEach((k) => {
    assert.strictEqual(B.barKind(k, 'x.gif'), k);
  });
});

test('动图贴纸的条子：动画 ＋ 调整，没有填充色列表', () => {
  const flat = (groups) => {
    const ids = [];
    const walk = (g) => g.forEach((x) => (Array.isArray(x) ? walk(x) : ids.push(x)));
    (groups || []).forEach(walk);
    return ids;
  };
  const vis = flat(B.visible('stickerimg'));
  assert.deepStrictEqual(vis, ['animation', 'adjust']);
  const menu = flat(B.more('stickerimg'));
  // 与矢量贴纸相比：多出不透明度 / 圆角，少掉属性
  assert.ok(menu.indexOf('opacity') >= 0 && menu.indexOf('round-corners') >= 0);
  assert.strictEqual(menu.indexOf('properties'), -1);
  assert.strictEqual(menu.indexOf('fill-list'), -1);
  assert.ok(menu.indexOf('replace-sticker') >= 0);
});

test('视频菜单有滤镜 · 效果 · 调整那一段（第三段）', () => {
  const seg = B.more('video').filter((g) => g.indexOf('filters') >= 0)[0];
  assert.deepStrictEqual(seg, ['filters', 'effects', 'adjust']);
  // 位次：紧跟在「不透明度 / 圆角」那一段之后
  const at = (id) => B.more('video').findIndex((g) => g.indexOf(id) >= 0);
  assert.strictEqual(at('filters'), at('round-corners') + 1);
  assert.strictEqual(at('filters'), at('copy') - 1);
});

test('没配的类型退回一颗「属性」，不是空条子', () => {
  assert.deepStrictEqual(B.visible('nope'), [['properties']]);
  assert.strictEqual(B.more('nope'), null);
});

/* ---------- 字幕（第 102 轮重排） ---------- */

test('字幕条子的第一段是作用域段：目标轨 ＋ 作用域', () => {
  assert.deepStrictEqual(B.visible('subtitle')[0], ['sub-scope', 'sub-cue-scope']);
  // 不放 `hide-text-behind`（人像分割），BaoCut 没有那条链路
  const flat = B.visible('subtitle').reduce((a, g) => a.concat(g), []);
  assert.strictEqual(flat.indexOf('hide-text-behind'), -1);
});

test('字幕菜单第一段是两簇：B / I 一簇，三档对齐 ＋ 大小写一簇', () => {
  const first = B.more('subtitle')[0];
  assert.ok(B.isRow(first));
  assert.deepStrictEqual(first, [['bold', 'italic'],
    ['align-left', 'align-center', 'align-right', 'case']]);
  // 大小写不再单开一段（此前它自己占一段，把「这一行怎么排」拆成了两件事）
  assert.strictEqual(B.more('subtitle').filter((g) => !B.isRow(g))
    .filter((g) => g.length === 1 && g[0] === 'case').length, 0);
});

test('字幕菜单里没有 Delete——真相在 transcript，画布侧只提供隐藏（§16.3）', () => {
  const flat = B.more('subtitle').reduce((a, g) => a.concat(B.isRow(g)
    ? g.reduce((b, x) => b.concat(x), []) : g), []);
  assert.strictEqual(flat.indexOf('delete'), -1);
  assert.ok(flat.indexOf('hide-subs') >= 0);
  assert.deepStrictEqual(B.more('subtitle').slice(-1)[0],
    ['apply-style-to-global', 'save-to-brand-kit', 'hide-subs']);
});

test('字幕动画入口只导航属性面板，不提供逐词下拉', () => {
  assert.deepStrictEqual(B.visible('subtitle')[2], ['sub-edit', 'sub-style', 'sub-animation']);
});
