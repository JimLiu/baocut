const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-template.js');
const T = global.window.BC_TPL;

const chapters = () => [
  {id: 'c1', title: '开场', start: 0, end: 22},
  {id: 'c2', title: '现场访谈', start: 22, end: 95},
  {id: 'c3', title: '产品演示', start: 95, end: 158},
  {id: 'c4', title: '观点与总结', start: 158, end: 206},
];

test('十七款内置模板：id 唯一、层 id 在模板内唯一、盒子都在画幅里', () => {
  assert.equal(T.BUILTINS.length, 17);
  const ids = new Set(T.BUILTINS.map((t) => t.id));
  assert.equal(ids.size, 17);
  T.BUILTINS.forEach((t) => {
    const lids = new Set(t.layers.map((l) => l.id));
    assert.equal(lids.size, t.layers.length, t.id);
    t.layers.forEach((l) => {
      assert.ok(T.KINDS.includes(l.kind), l.kind);
      assert.deepEqual(T.clampBox(l.box), l.box, t.id + '/' + l.id);
      if (l.opacity != null) assert.equal(T.clampOpacity(l.opacity), l.opacity, t.id + '/' + l.id);
    });
  });
});

test('内置目录跟随界面语言：四个词表同一份版面，只换文字；未知语言退到英文', () => {
  assert.deepEqual(T.LANGS, ['zh', 'zh-Hant', 'en', 'ja']);
  const zh = T.builtins('zh');
  assert.strictEqual(zh, T.BUILTINS);
  assert.strictEqual(T.builtins('en'), T.builtins('en'));           // 同一语言同一个数组
  assert.strictEqual(T.builtins('ko'), T.builtins('en'));           // 没有词表 → 英文
  T.LANGS.forEach((lang) => {
    const list = T.builtins(lang);
    assert.deepEqual(list.map((t) => t.id), zh.map((t) => t.id), lang);
    list.forEach((t, i) => {
      assert.ok(t.name && t.desc, lang + '/' + t.id);
      assert.deepEqual(t.layers.map((l) => [l.id, l.kind, l.box]), zh[i].layers.map((l) => [l.id, l.kind, l.box]), lang + '/' + t.id);
    });
  });
  assert.equal(T.builtins('en')[0].name, 'Chapter bar · fill');
  assert.equal(T.layer(T.builtins('en')[0], 'l-lg').text, 'Kelang Talks');
  assert.equal(T.layer(T.builtins('ja')[0], 'l-lg').text, 'Kelang トーク');
  assert.notEqual(T.builtins('zh-Hant')[0].name, zh[0].name);
});

test('langOf：设置页的语言标签折成词表键；「跟随系统」按 navigator.language，没有 navigator 时是简体中文', () => {
  const sys = typeof navigator !== 'undefined' && navigator.language ? T.systemLang(navigator.language) : 'zh';
  assert.equal(T.langOf('简体中文'), 'zh');
  assert.equal(T.langOf('繁體中文'), 'zh-Hant');
  assert.equal(T.langOf('English'), 'en');
  assert.equal(T.langOf('日本語'), 'ja');
  assert.equal(T.langOf('Deutsch'), 'en');
  assert.equal(T.langOf('跟随系统'), sys);
  assert.equal(T.langOf(undefined), sys);
  assert.equal(T.systemLang('zh-TW'), 'zh-Hant');
  assert.equal(T.systemLang('zh-CN'), 'zh');
  assert.equal(T.systemLang('ja-JP'), 'ja');
  assert.equal(T.systemLang('fr-FR'), 'en');
});

test('byId：先按语言在内置里找，再找品牌库；换语言后实例的 from 仍找得到', () => {
  assert.equal(T.byId('tpl-vertical', 'en').name, 'Vertical clip');
  assert.equal(T.byId('tpl-vertical', 'zh').name, '竖屏切片');
  assert.equal(T.byId('tpl-brand-x', 'en', [{id: 'tpl-brand-x', name: 'X', layers: []}]).name, 'X');
  assert.equal(T.byId('nope', 'en'), null);
});

test('竖屏切片：9:16 锁画幅、视频标题为主章节名为次、台标字靠左，不画进度条与章节条', () => {
  const v = T.BUILTINS.find((t) => t.id === 'tpl-vertical');
  assert.equal(v.canvas, '9:16');
  assert.ok(T.ratioLocked(v));
  assert.ok(!v.layers.some((l) => l.kind === 'progress' || l.kind === 'chapters'));
  const title = T.layer(v, 'l-tt');
  const chapter = T.layer(v, 'l-ct');
  assert.equal(title.text, '{title}');
  assert.equal(chapter.text, '{chapter}');
  assert.ok(title.size > chapter.size && title.weight > chapter.weight, '标题比章节名大、粗');
  assert.equal(title.box.y + title.box.h, chapter.box.y, '两行上下相接成一张卡');
  assert.deepEqual([title.box.x, title.box.w, title.bg], [chapter.box.x, chapter.box.w, chapter.bg], '同宽同底');
  assert.match(title.bg, /^rgba\(0,\s*0,\s*0,/, '深色半透明底，不再是整块亮黄');
  assert.ok(chapter.box.y + chapter.box.h < 34, '标题卡在上三分之一');
  const logo = T.layer(v, 'l-lg');
  assert.equal(T.logoAlign(logo), 'left');
  assert.equal(logo.box.x, title.box.x, '台标与标题卡左缘对齐');
  const counter = T.layer(v, 'l-n');
  [title, chapter].forEach((l) => assert.deepEqual([l.box.x, l.pad], [logo.box.x, logo.pad], l.id + ' 与台标同一条起笔线'));
  assert.equal(counter.pad, logo.pad, '计数与台标字同一个内边距');
  assert.equal(100 - (counter.box.x + counter.box.w), logo.box.x, '计数右缘与台标左缘对称');
  assert.equal(T.subsBottom(v, 7), 7, '没有整宽带，字幕不用避让');
});

test('台标对齐：只认 left / right，缺省与其它值都居中；内置里只有竖屏切片写了 align', () => {
  assert.equal(T.logoAlign({kind: 'logo'}), 'center');
  assert.equal(T.logoAlign({kind: 'logo', align: 'left'}), 'left');
  assert.equal(T.logoAlign({kind: 'logo', align: 'right'}), 'right');
  assert.equal(T.logoAlign({kind: 'logo', align: 'justify'}), 'center');
  assert.equal(T.logoAlign(null), 'center');
  T.LANGS.forEach((lang) => {
    const aligned = T.builtins(lang).flatMap((t) => t.layers
      .filter((l) => l.kind === 'logo' && l.align != null).map((l) => t.id + '/' + l.id + '=' + l.align));
    assert.deepEqual(aligned, ['tpl-vertical/l-lg=left'], lang);
  });
});

test('内边距 pad：画面高的百分比折像素、没有 7px 下限；缺省与非法值交给 CSS；内置里只有竖屏切片四层写了', () => {
  assert.equal(T.layerPad({kind: 'text', pad: 1.2}, 1920), 23.04);
  assert.equal(T.layerPad({kind: 'logo', pad: 0}, 1920), 0);
  assert.equal(T.layerPad({kind: 'text', pad: 0.1}, 180), 0.18, '不像字号那样夹到 7px');
  assert.equal(T.layerPad({kind: 'text'}, 1920), null);
  assert.equal(T.layerPad({kind: 'text', pad: -1}, 1920), null);
  assert.equal(T.layerPad({kind: 'text', pad: NaN}, 1920), null);
  assert.equal(T.layerPad({kind: 'text', pad: '1.2'}, 1920), null);
  assert.equal(T.layerPad(null, 1920), null);
  T.LANGS.forEach((lang) => {
    const padded = T.builtins(lang).flatMap((t) => t.layers
      .filter((l) => l.pad != null).map((l) => t.id + '/' + l.id));
    assert.deepEqual(padded, ['tpl-vertical/l-lg', 'tpl-vertical/l-n', 'tpl-vertical/l-tt', 'tpl-vertical/l-ct'], lang);
  });
  const inst = T.instance(T.byId('tpl-vertical', 'zh'));
  assert.equal(T.layer(inst, 'l-tt').pad, 1.2, '实例深拷贝带着 pad');
});

test('水印是模板的一类：三款 tag=watermark、只有台标层、不影响字幕避让；角标与平铺各有不透明度', () => {
  const wms = T.BUILTINS.filter(T.isWatermark);
  assert.deepEqual(wms.map((t) => t.id), ['tpl-wm-corner', 'tpl-wm-tiled', 'tpl-wm-handle']);
  wms.forEach((t) => {
    assert.ok(t.layers.every((l) => l.kind === 'logo'), t.id);
    assert.equal(T.subsBottom(t, 7), 7, t.id);
  });
  const tiled = T.layer(T.byId('tpl-wm-tiled', 'zh'), 'l-wm');
  assert.ok(tiled.tile);
  assert.deepEqual(tiled.box, {x: 0, y: 0, w: 100, h: 100});
  assert.ok(tiled.opacity < 0.3);
  const corner = T.layer(T.byId('tpl-wm-corner', 'zh'), 'l-wm');
  assert.ok(!corner.tile && corner.box.x > 70 && corner.box.y > 80);
  assert.ok(!T.isWatermark(T.BUILTINS[0]));
});

test('layerOpacity / clampOpacity：缺省 1，夹到 [0.05, 1]，非数按 1', () => {
  assert.equal(T.layerOpacity({kind: 'logo'}), 1);
  assert.equal(T.layerOpacity({kind: 'logo', opacity: 0.5}), 0.5);
  assert.equal(T.clampOpacity(0), 0.05);
  assert.equal(T.clampOpacity(3), 1);
  assert.equal(T.clampOpacity('abc'), 1);
  assert.equal(T.clampOpacity(null), 1);
});

test('旧水印导入：平铺 → 铺满整幅低不透明度；钉角 → 小盒；图片按名字认品牌库图、认不出退成文字；重复导入同名覆盖', () => {
  const images = [{id: 'bm2', kind: 'image', name: 'logo-mark.png'}];
  const wms = [
    {id: 'w1', name: '@kelang.studio', mode: '平铺'},
    {id: 'w2', name: 'logo-mark.png', mode: '右下角'},
    {id: 'w3', name: 'missing.png', mode: '左上角'},
  ];
  const list = T.importWatermarks([{id: 'tpl-brand-1', name: '既有', brand: true, builtin: false, layers: []}], wms, {images});
  assert.deepEqual(list.map((t) => [t.id, t.name, t.imported, t.tag]), [
    ['tpl-brand-1', '既有', undefined, undefined],
    ['tpl-brand-2', '@kelang.studio', 'watermark', 'watermark'],
    ['tpl-brand-3', 'logo-mark.png', 'watermark', 'watermark'],
    ['tpl-brand-4', 'missing.png', 'watermark', 'watermark'],
  ]);
  const tiled = list[1].layers[0];
  assert.ok(tiled.tile && tiled.src === 'text' && tiled.text === '@kelang.studio');
  assert.deepEqual(tiled.box, {x: 0, y: 0, w: 100, h: 100});
  assert.ok(tiled.opacity < 0.3);
  const img = list[2].layers[0];
  assert.equal(img.src, 'bm2');
  assert.ok(!img.tile && img.box.x > 70 && img.box.y > 80);
  const miss = list[3].layers[0];
  assert.equal(miss.src, 'text');
  assert.equal(miss.text, 'missing.png');
  assert.ok(miss.box.x < 10 && miss.box.y < 10);
  list.slice(1).forEach((t) => { assert.ok(T.isWatermark(t)); assert.ok(t.brand && !t.builtin); assert.ok(t.desc.startsWith('由水印导入')); });
  // 幂等：再导一遍不产生第二份
  const again = T.importWatermarks(list, wms, {images});
  assert.equal(again.length, list.length);
  assert.deepEqual(again.map((t) => t.id), list.map((t) => t.id));
  // 导入的定义能照常实例化并套用
  const inst = T.instance(list[1]);
  assert.equal(inst.from, 'tpl-brand-2');
  assert.ok(!('imported' in inst) || inst.imported === 'watermark');
});

test('newLayer / addLayer 按语言取台标缺省文字', () => {
  const zh = T.newLayer('logo', T.blank(), 'zh');
  const en = T.newLayer('logo', T.blank(), 'en');
  assert.equal(zh.text, '科浪访谈');
  assert.equal(en.text, 'Kelang Talks');
  assert.equal(T.newLayer('logo', T.blank()).text, '科浪访谈');
  const t = T.addLayer(T.blank(), 'logo', 'ja');
  assert.equal(t.layers[t.layers.length - 1].text, 'Kelang トーク');
});

test('两款章节底栏：一款色条一款明暗，都是整宽贴底的带', () => {
  const bar = T.BUILTINS[0].layers.find((l) => l.kind === 'chapters');
  const dim = T.BUILTINS[1].layers.find((l) => l.kind === 'chapters');
  assert.equal(bar.fill, 'bar');
  assert.equal(dim.fill, 'dim');
  [bar, dim].forEach((l) => { assert.equal(l.box.x, 0); assert.equal(l.box.w, 100); assert.ok(l.box.y > 50); });
});

test('clampBox：尺寸先夹再夹位置，盒子不会探出画幅', () => {
  assert.deepEqual(T.clampBox({x: 95, y: 10, w: 20, h: 5}), {x: 80, y: 10, w: 20, h: 5});
  assert.deepEqual(T.clampBox({x: -3, y: -3, w: 2, h: 0.1}), {x: 0, y: 0, w: T.MIN_W, h: T.MIN_H});
  assert.deepEqual(T.clampBox({x: 0, y: 0, w: 140, h: 200}), {x: 0, y: 0, w: 100, h: 100});
});

test('增删层：新层 id 不撞、删掉就没了、层序可换', () => {
  let t = T.blank();
  t = T.addLayer(t, 'logo');
  t = T.addLayer(t, 'logo');
  assert.deepEqual(t.layers.map((l) => l.id), ['l-logo-1', 'l-logo-2']);
  t = T.addLayer(t, 'chapters');
  assert.equal(t.layers[2].kind, 'chapters');
  t = T.reorder(t, 'l-logo-1', 1);
  assert.deepEqual(t.layers.map((l) => l.id), ['l-logo-2', 'l-logo-1', 'l-chapters-1']);
  assert.equal(T.reorder(t, 'l-logo-2', -1), t);            // 已在最底，不动
  t = T.removeLayer(t, 'l-logo-1');
  assert.equal(t.layers.length, 2);
  assert.equal(T.layer(t, 'l-logo-1'), null);
});

test('拖动与拉伸按画面像素折成百分比并夹取', () => {
  const frame = {w: 800, h: 450};
  const b = {x: 10, y: 10, w: 20, h: 10};
  assert.deepEqual(T.dragBox(b, 80, 45, frame), {x: 20, y: 20, w: 20, h: 10});
  assert.deepEqual(T.dragBox(b, 8000, 0, frame), {x: 80, y: 10, w: 20, h: 10});
  assert.deepEqual(T.resizeBox(b, 80, 45, frame), {x: 10, y: 10, w: 30, h: 20});
  assert.deepEqual(T.resizeBox(b, -800, -450, frame), {x: 10, y: 10, w: T.MIN_W, h: T.MIN_H});
});

test('八把手拉伸：被拖的边跟手、对边不动（对拍 template.rs resize_from_each_handle）', () => {
  const frame = {w: 1000, h: 500};
  const b0 = {x: 20, y: 20, w: 40, h: 20};
  assert.deepEqual(T.resizeBoxFrom(b0, 'se', 100, 50, frame), T.resizeBox(b0, 100, 50, frame));
  assert.deepEqual(T.resizeBoxFrom(b0, 'w', -100, 999, frame), {x: 10, y: 20, w: 50, h: 20});
  assert.deepEqual(T.resizeBoxFrom(b0, 'n', 999, 50, frame), {x: 20, y: 30, w: 40, h: 10});
  assert.deepEqual(T.resizeBoxFrom(b0, 'nw', 5000, 5000, frame), {x: 56, y: 39.4, w: 4, h: 0.6});
  assert.deepEqual(T.resizeBoxFrom(b0, 'ne', 9000, -9000, frame), {x: 20, y: 0, w: 80, h: 40});
  assert.deepEqual(T.resizeBoxFrom(b0, 'sw', -9000, 9000, frame), {x: 0, y: 20, w: 60, h: 80});
  assert.deepEqual(T.resizeBoxFrom(b0, 'e', 100, 300, frame), {x: 20, y: 20, w: 50, h: 20});
  assert.deepEqual(T.resizeBoxFrom(b0, 's', 300, 50, frame), {x: 20, y: 20, w: 40, h: 30});
  assert.deepEqual(T.HANDLES.map((h) => h.k), ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  assert.equal(T.handleOf('x'), null);
});

test('clampBox 对拍 template.rs：先夹尺寸再夹位置、一位小数', () => {
  assert.deepEqual(T.clampBox({x: 98, y: 99.5, w: 10, h: 0.2}), {x: 90, y: 99.4, w: 10, h: 0.6});
  assert.deepEqual(T.clampBox({x: -3.33, y: 4.44, w: 200, h: 50}), {x: 0, y: 4.4, w: 100, h: 50});
  assert.deepEqual(T.clampBox({x: 10, y: 10, w: 1, h: 1}), {x: 10, y: 10, w: 4, h: 1});
});

test('快捷贴齐：居中两轴一起动，贴底只动 y，整宽整高各管一根轴', () => {
  const b = {x: 10, y: 10, w: 30, h: 8};
  assert.deepEqual(T.snap(b, 'center'), {x: 35, y: 46, w: 30, h: 8});
  assert.deepEqual(T.snap(b, 'bottom'), {x: 10, y: 92, w: 30, h: 8});
  assert.deepEqual(T.snap(b, 'top'), {x: 10, y: 0, w: 30, h: 8});
  assert.deepEqual(T.snap(b, 'fullWidth'), {x: 0, y: 10, w: 100, h: 8});
  assert.deepEqual(T.snap(b, 'fullHeight'), {x: 10, y: 0, w: 30, h: 100});
});

test('COLORS 导出八个模板插画色（版面编辑器色板引用它）', () => {
  assert.deepEqual(Object.keys(T.COLORS), ['WHITE', 'INK', 'ORANGE', 'RED', 'BLUE', 'YELLOW', 'PINK', 'TEAL']);
  assert.ok(Object.values(T.COLORS).every((c) => /^#[0-9A-F]{6}$/.test(c)));
});

test('命中从最上层往下找，关掉的层不吃点击', () => {
  const t = T.BUILTINS[0];                     // 章节条在底部、台标在其上方左侧
  assert.equal(T.hitTest(t, 50, 95), 'l-ch');
  assert.equal(T.hitTest(t, 5, 84), 'l-lg');
  assert.equal(T.hitTest(t, 50, 40), null);
  const off = T.updateLayer(t, 'l-lg', {on: false});
  assert.equal(T.hitTest(off, 5, 84), null);
});

test('章节段三态与已播比例', () => {
  const s = T.segments(chapters(), 40, 206);
  assert.deepEqual(s.map((x) => x.state), ['done', 'on', 'todo', 'todo']);
  assert.equal(s[0].done, 1);
  assert.ok(Math.abs(s[1].done - 18 / 73) < 1e-9);
  assert.equal(s[2].done, 0);
  // 没有章节表：整段一条
  const one = T.segments([], 103, 206);
  assert.equal(one.length, 1);
  assert.equal(one[0].done, 0.5);
});

test('变量表与占位符替换', () => {
  const v = T.vars(chapters(), 100, 206);
  assert.equal(v.chapter, '产品演示');
  assert.equal(v.n, '3');
  assert.equal(v.count, '4');
  assert.equal(v.time, '1:40');
  assert.equal(v.remain, '1:46');
  assert.equal(v.total, '3:26');
  assert.equal(T.fill('{n}/{count} {chapter} · {time}', v), '3/4 产品演示 · 1:40');
  assert.equal(T.fill('{nope}', v), '{nope}');          // 不认识的占位符原样留着
  assert.equal(T.timecode(3725), '1:02:05');
});

test('字幕避让只看贴底的整宽带', () => {
  assert.equal(T.subsBottom(null, 7), 7);
  assert.equal(T.subsBottom(T.BUILTINS[0], 7), 11);      // 章节条 y=91 → 100-91+2
  assert.equal(T.subsBottom(T.BUILTINS[2], 7), 7);       // 进度线在顶部
  const off = T.updateLayer(T.BUILTINS[0], 'l-ch', {on: false});
  assert.equal(T.subsBottom(off, 7), 7);
});

test('实例是深拷贝，改实例不动定义', () => {
  const def = T.BUILTINS[0];
  const inst = T.instance(def);
  assert.equal(inst.from, def.id);
  assert.equal(inst.builtin, false);
  const moved = T.moveBox(inst, 'l-lg', {x: 40});
  assert.equal(T.layer(moved, 'l-lg').box.x, 40);
  assert.equal(T.layer(def, 'l-lg').box.x, 2);
});

test('存进品牌库：新名字新增、同名覆盖', () => {
  const inst = T.instance(T.BUILTINS[1]);
  let r = T.saveToBrand([], inst, '科浪 · 节目包装');
  assert.equal(r.list.length, 1);
  assert.equal(r.updated, false);
  assert.equal(r.doc.id, 'tpl-brand-1');
  assert.equal(r.doc.from, undefined);
  const changed = T.updateLayer(inst, 'l-lg', {text: '科浪'});
  r = T.saveToBrand(r.list, changed, '科浪 · 节目包装');
  assert.equal(r.list.length, 1);
  assert.equal(r.updated, true);
  assert.equal(T.layer(r.list[0], 'l-lg').text, '科浪');
  r = T.saveToBrand(r.list, changed, '');
  assert.equal(r.list.length, 2);
  assert.equal(r.doc.name, changed.name);
});

test('summary 按层类去重', () => {
  assert.equal(T.summary(T.BUILTINS[0]), '章节条 · 台标');
  assert.equal(T.summary(T.BUILTINS[2]), '进度条 · 文字 · 台标');
});

test('分组（2026-09-14）：每款内置都有组、组序固定、品牌库一律归 brand、空组不出现、组名跟语言', () => {
  assert.deepStrictEqual(T.GROUPS, ['chapters', 'info', 'vertical', 'douyin', 'xhs', 'youtube', 'bili', 'watermark', 'brand']);
  T.BUILTINS.forEach((t) => assert.ok(T.GROUPS.includes(t.group) && t.group !== 'brand', t.id));
  assert.deepStrictEqual(T.groupTemplates(T.BUILTINS, 'zh').map((g) => [g.key, g.label, g.items.map((t) => t.id)]), [
    ['chapters', '章节与进度', ['tpl-chapter-bar', 'tpl-chapter-dim', 'tpl-progress-line']],
    ['info', '信息条', ['tpl-talk-top', 'tpl-lower-third', 'tpl-podcast']],
    ['vertical', '竖屏', ['tpl-vertical']],
    ['douyin', '抖音', ['tpl-dy-title', 'tpl-dy-list']],
    ['xhs', '小红书', ['tpl-xhs-note', 'tpl-xhs-list']],
    ['youtube', 'YouTube', ['tpl-yt-lower', 'tpl-yt-chapters']],
    ['bili', 'B 站', ['tpl-bili-part']],
    ['watermark', '水印', ['tpl-wm-corner', 'tpl-wm-tiled', 'tpl-wm-handle']],
  ]);
  // 品牌库的不管自带什么 group（从抖音款存进去的也一样）都归 brand，排最后；水印款存进去也不回水印组
  const saved = T.saveToBrand([], T.instance(T.byId('tpl-dy-title')), '我的抖音').list;
  const wm = T.saveToBrand([], T.instance(T.byId('tpl-wm-corner')), '我的水印').list;
  const gs = T.groupTemplates(T.BUILTINS.slice(0, 1).concat(saved, wm), 'en');
  assert.deepStrictEqual(gs.map((g) => [g.key, g.label, g.items.length]), [['chapters', 'Chapters & progress', 1], ['brand', 'Brand kit', 2]]);
  assert.strictEqual(T.groupKey({group: 'nope'}), 'info', '没登记的组键落到信息条，不丢模板');
  assert.strictEqual(T.groupLabel('xhs', 'ja'), 'Xiaohongshu');
  assert.strictEqual(T.groupLabel('bili', 'zh-Hant'), 'B 站');
  assert.strictEqual(T.groupLabel('watermark', 'xx'), 'Watermarks', '未知语言退到英文');
  assert.deepStrictEqual(T.groupTemplates([], 'zh'), []);
});

test('平台款（2026-09-14）：竖屏四款锁 9:16 且盒子避开平台 UI，横屏三款不锁；示例文字跟语言', () => {
  const vert = ['tpl-dy-title', 'tpl-dy-list', 'tpl-xhs-note', 'tpl-xhs-list'];
  vert.forEach((id) => {
    const t = T.byId(id);
    assert.equal(t.canvas, '9:16', id);
    assert.ok(T.ratioLocked(t), id);
    t.layers.forEach((l) => {
      const b = l.box;
      assert.ok(b.x >= 6 && b.x + b.w <= 82.5, id + '/' + l.id + ' 右侧 18% 留给点赞评论按钮');
      assert.ok(b.y >= 10 && b.y + b.h <= 72, id + '/' + l.id + ' 顶 8% 状态栏 / 底 28% 文案区');
    });
  });
  ['tpl-yt-lower', 'tpl-yt-chapters', 'tpl-bili-part'].forEach((id) => {
    const t = T.byId(id);
    assert.equal(t.canvas, '16:9', id);
    assert.ok(!T.ratioLocked(t), id);
  });
  // 竖屏四款都没有进度条（与竖屏切片同一个理由）
  vert.forEach((id) => assert.ok(!T.byId(id).layers.some((l) => l.kind === 'progress'), id));
  // 示例文字按词表：话题标签 / 订阅 / 收藏 / 分 P
  assert.equal(T.byId('tpl-dy-list', 'zh').layers[2].text, '#干货 #科普');
  assert.equal(T.byId('tpl-dy-list', 'en').layers[2].text, '#tips #explainer');
  assert.equal(T.byId('tpl-yt-lower', 'ja').layers[1].text, 'チャンネル登録');
  assert.equal(T.byId('tpl-xhs-list', 'zh-Hant').layers[2].text, '記得收藏');
  assert.equal(T.byId('tpl-bili-part', 'en').layers[0].text, 'Part {n}');
  assert.equal(T.byId('tpl-bili-part', 'zh').layers[0].text, 'P{n}');
  // 章节条款有字幕避让：抖音知识点条与小红书清单在上部，不贴底，所以不避让；YouTube / B 站贴底整宽的避让
  assert.equal(T.subsBottom(T.byId('tpl-dy-list'), 7), 7, '上部章节条不避让');
  assert.equal(T.subsBottom(T.byId('tpl-yt-chapters'), 7), 10, '贴底整宽章节条避让：100-92+2');
  assert.equal(T.subsBottom(T.byId('tpl-bili-part'), 7), 9);
});

test('套用时画幅是可选属性：只有讲座顶栏与竖屏切片声明了，实例与品牌库都原样带着', () => {
  const vertical = T.BUILTINS.find((t) => t.id === 'tpl-vertical');
  assert.equal(vertical.ratio, '9:16');
  assert.deepStrictEqual(Object.fromEntries(T.BUILTINS.map((t) => [t.id, T.ratioTarget(t)])), {
    'tpl-chapter-bar': null, 'tpl-chapter-dim': null, 'tpl-progress-line': null, 'tpl-talk-top': '16:9',
    'tpl-lower-third': null, 'tpl-podcast': null, 'tpl-vertical': '9:16',
    'tpl-dy-title': '9:16', 'tpl-dy-list': '9:16', 'tpl-xhs-note': '9:16', 'tpl-xhs-list': '9:16',
    'tpl-yt-lower': null, 'tpl-yt-chapters': null, 'tpl-bili-part': null,
    'tpl-wm-corner': null, 'tpl-wm-tiled': null, 'tpl-wm-handle': null,
  });
  assert.equal(T.ratioTarget(vertical), '9:16');
  assert.equal(T.ratioTarget({ratio: 'original'}), 'Original');
  assert.equal(T.ratioTarget({ratio: ' Original '}), 'Original');
  assert.equal(T.ratioTarget(null), null);
  assert.equal(T.ratioNote(vertical), '锁定画幅 9:16');
  assert.equal(T.ratioNote({ratio: 'original'}), '套用后画幅 原始');
  assert.equal(T.ratioNote(T.BUILTINS[0]), '');
  assert.equal(T.instance(vertical).ratio, '9:16');
  assert.equal(T.saveToBrand([], T.instance(vertical), '竖').doc.ratio, '9:16');
  assert.equal(T.blank('16:9').ratio, undefined);
});

test('画幅锁（第 218 轮）：声明画幅 + lockRatio 才算锁，注记与放行判据跟着变', () => {
  const vertical = T.BUILTINS.find((t) => t.id === 'tpl-vertical');
  const talk = T.BUILTINS.find((t) => t.id === 'tpl-talk-top');
  const bar = T.BUILTINS[0];
  assert.equal(T.ratioLocked(vertical), true);
  assert.equal(T.ratioLocked(talk), true);
  assert.equal(T.ratioLocked(bar), false);
  assert.equal(T.ratioLocked(null), false);
  // 只开锁不声明画幅 = 没锁；声明了不开锁 = 只在套用时改一次
  assert.equal(T.ratioLocked(Object.assign({}, bar, {lockRatio: true})), false);
  assert.equal(T.ratioLocked(Object.assign({}, bar, {ratio: '1:1'})), false);
  assert.equal(T.ratioNote(Object.assign({}, bar, {ratio: '1:1'})), '套用后画幅 1:1');
  assert.equal(T.ratioNote(vertical), '锁定画幅 9:16');
  assert.equal(T.ratioNote(Object.assign({}, bar, {ratio: 'original', lockRatio: true})), '锁定画幅 原始');
  assert.equal(T.ratioNote(bar), '');
  const lock = T.ratioLock(vertical);
  assert.deepEqual(lock, {ratio: '9:16', name: '竖屏切片', note: '画幅由模板「竖屏切片」锁定为 9:16'});
  assert.equal(T.ratioLock(bar), null);
  assert.equal(T.canSetRatio(bar, '1:1'), true);
  assert.equal(T.canSetRatio(vertical, '1:1'), false);
  assert.equal(T.canSetRatio(vertical, '9:16'), true);            // 设回锁定的那一档不算改
  // 实例继承锁；项目里解锁只动实例
  const inst = T.instance(vertical);
  assert.equal(T.ratioLocked(inst), true);
  const free = Object.assign({}, inst, {lockRatio: false});
  assert.equal(T.ratioLocked(free), false);
  assert.equal(T.ratioLocked(vertical), true);
});

test('applyRatio：套用时画幅怎么走', () => {
  const vertical = T.BUILTINS.find((t) => t.id === 'tpl-vertical');
  assert.deepEqual(T.applyRatio(vertical, '16:9'), {ratio: '9:16', changed: true, locked: true});
  assert.deepEqual(T.applyRatio(vertical, '9:16'), {ratio: '9:16', changed: false, locked: true});
  assert.deepEqual(T.applyRatio(T.BUILTINS[0], '16:9'), {ratio: '16:9', changed: false, locked: false});
  assert.deepEqual(T.applyRatio(Object.assign({}, T.BUILTINS[0], {ratio: 'original'}), '16:9'),
    {ratio: 'Original', changed: true, locked: false});
});
