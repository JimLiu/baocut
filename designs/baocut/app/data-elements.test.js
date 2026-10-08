const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

global.window = {};
require('./model-substyle.js');
require('./model-pose.js');
require('./model-shape-paths.js');
require('./model-elements.js');
require('./model-textpresets.js');
require('./model-wordanim.js');
require('./model-subanim.js');
require('./model-subpresets.js');
require('./model-motioncaption.js');
require('./model-template.js');
require('./model-cut.js');   // data.js 的剪口建议派生自它（第 192 轮）
require('./model-defaultsub.js'); // data.js 的画廊第一区（默认样式那张卡）
require('./data.js');

test('默认双语上行 32、下行 20，倒转后保持位置字号而不绑定语言', () => {
  const S = window.BC_SUB;
  const st = window.BC_DATA.subtitle.defaults;
  const upper = S.translations(st)[0];
  const lower = S.source(st);
  assert.ok(upper.y < lower.y);
  assert.strictEqual(upper.size, 32);
  assert.strictEqual(lower.size, 20);
  const flipped = S.flipStack(st);
  const next = Object.assign({}, st, {tracks: flipped});
  assert.strictEqual(S.source(next).size, 32);
  assert.strictEqual(S.translations(next)[0].size, 20);
});

test('Sintel 远程样例使用真实时长、单片段与媒体目录，不混入访谈字幕', () => {
  const D = window.BC_DATA;
  const p = D.projects.find(p => p.id === 'p11');
  const s = D.projectSetup(p);
  assert.equal(p.duration, 52.208333);
  assert.equal(s.duration, p.duration);
  assert.deepEqual(s.clips, [{id: 'k1', start: 0, end: p.duration, src: 0}]);
  assert.equal(s.tab, 'video');
  assert.equal(s.transcript, false);
  assert.equal(s.music, false);
  assert.deepEqual(s.chapters, []);
  assert.equal(s.sources.video[0].url, p.preview.url);
  assert.equal(s.sources.video.length, 1);
});

test('五类样例的轨道与素材边界互不混用', () => {
  const D = window.BC_DATA;
  const setup = id => D.projectSetup(D.projects.find(p => p.id === id));
  for (const id of ['p1', 'p7']) {
    const p = D.projects.find(p => p.id === id);
    const s = setup(id);
    assert.ok(p.bare);
    assert.equal(s.entry.canvas, 'bi');
    assert.equal(s.tab, 'subtitle');
    assert.equal(s.music, false);
    assert.equal(s.sources.video[0].name, p.src.name);
    assert.deepEqual([s.sources.video.length, s.sources.image.length, s.sources.audio.length], [1, 0, 0]);
    assert.equal(p.content.overlay, undefined);
  }
  assert.equal(setup('p8').entry.canvas, 'mono');
  assert.equal(setup('p8').tab, 'transcript');
  assert.equal(setup('p8').chapters.length, 3);
  assert.equal(setup('p9').tab, 'elements');
  assert.equal(setup('p9').transcript, false);
  assert.equal(setup('p10').entry.canvas, 'bi');
  assert.equal(setup('p10').music, true);
  assert.ok(setup('p10').sources.image.length > 0);
});

test('同语言切换口播与访谈时重装说话人与译文，不串包', () => {
  const D = window.BC_DATA;
  D.activateProject('p1');
  const original = JSON.stringify(D.cues);
  D.activateProject('p8');
  assert.deepEqual([...new Set(D.cues.map(c => c.sp))], ['s1']);
  assert.ok(D.cues.every(c => !c.trans));
  assert.equal(D.cutSuggestions.length, 9);
  D.activateProject('p1');
  assert.equal(JSON.stringify(D.cues), original);
  D.activateProject('p7');
  assert.equal(D.srcLang.code, 'en');
  assert.equal(D.dstLang.code, 'zh');
  D.activateProject('p1');
});

test('新建项目按当前项目语言加载演示包，不再只查静态样例项目表', () => {
  const D = window.BC_DATA;
  D.activateProject('new-project', {id: 'new-project', lang: '英语'});
  assert.strictEqual(D.srcLang.code, 'en');
  assert.match(D.cues[0].text, /Welcome/);
  D.activateProject('p1');
  assert.strictEqual(D.srcLang.code, 'zh');
});

test('Elements 的模板行 = 十七款内置模板（含七款平台款、三款水印），都是真入口（第 112 轮；2026-09-14）', () => {
  assert.deepStrictEqual(
    window.BC_DATA.templateItems.map((item) => [item.name, item.real, item.add]),
    [['章节底栏 · 色条', true, 'tpl'], ['章节底栏 · 明暗', true, 'tpl'], ['极简进度线', true, 'tpl'],
      ['讲座顶栏', true, 'tpl'], ['下三分名条', true, 'tpl'], ['播客集数', true, 'tpl'], ['竖屏切片', true, 'tpl'],
      ['抖音 · 大字标题', true, 'tpl'], ['抖音 · 知识点条', true, 'tpl'],
      ['小红书 · 笔记封面', true, 'tpl'], ['小红书 · 要点清单', true, 'tpl'],
      ['YouTube · 频道名条', true, 'tpl'], ['YouTube · 章节进度', true, 'tpl'], ['B 站 · 分 P 标题', true, 'tpl'],
      ['水印 · 角标', true, 'tpl'], ['水印 · 平铺', true, 'tpl'], ['水印 · 社交名', true, 'tpl']],
  );
  assert.strictEqual(window.BC_DATA.templates, window.BC_TPL.BUILTINS);
  // 品牌库：一套自己存的 + 两条旧水印导进来的（没有 brand.watermarks 了）
  assert.strictEqual(window.BC_DATA.brand.watermarks, undefined);
  assert.deepStrictEqual(window.BC_DATA.brand.templates.map((t) => [t.id, t.brand, t.builtin, t.imported || null]),
    [['tpl-brand-1', true, false, null], ['tpl-brand-2', true, false, 'watermark'], ['tpl-brand-3', true, false, 'watermark']]);
  assert.strictEqual(window.BC_DATA.brand.templates[2].layers[0].src, 'bm2', '图片水印认出品牌库里的 logo-mark.png');
  assert.ok(window.BC_DATA.brand.templates[1].layers[0].tile, '平铺水印导成铺满整幅的台标层');
  // 品牌库那份是拷贝：内置定义没被改
  assert.strictEqual(window.BC_TPL.layer(window.BC_TPL.BUILTINS[0], 'l-lg').src, 'text');
});

/* 2026-09-14：挂在模板一节后面的四格取景框 / 覆盖层退出元素目录。文档里已有的
   `vframe` / `overlay` 元素仍渲染仍有属性页，只是目录里不再有新建它们的格子。 */
test('取景框 / 覆盖层格子退出元素目录（2026-09-14）', () => {
  const D = window.BC_DATA;
  assert.strictEqual(D.frameItems, undefined, '框架件数据整表删掉');
  assert.ok(D.elementSpecs.vframe && D.elementSpecs.overlay, '已有元素的属性页规格保留');
  const src = ['panel-elements.jsx', 'panel-elements-tile.jsx', 'panel-elements-sections.jsx']
    .map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
  assert.doesNotMatch(src, /frameItems|IconTile|tgrid--gapped/);
});

test('Settings 左栏搬出演示数据：2026-09-30 起按能力类型分，表在 model-settings-nav.js', () => {
  assert.strictEqual(window.BC_DATA.settingsSections, undefined);
});

/* 第 217 轮：批注 / 绘制 / 占位框（Camera · 媒体 · 屏幕）整类退出 Elements 面板，
   与 `apps/baocut`、`apps/web` 同步。文档格式层的 `draw` / `placeholder` 仍解析仍
   渲染，只是原型的元素目录、画布画法与属性页都不再有它们的位置。 */
test('批注 / 绘制 / 占位框整类退出元素面板', () => {
  const D = window.BC_DATA;
  ['annot', 'draw', 'holder'].forEach((k) => {
    assert.ok(!D.elements.some((e) => e.kind === k), k + ' 不该留在演示装置里');
    assert.ok(!D.elementSpecs[k], k + ' 不该留着属性页规格');
  });
  const src = ['stage.jsx', 'stage-elements.jsx', 'panel-elements.jsx', 'panel-elements-tile.jsx']
    .map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
  assert.doesNotMatch(src, /AnnotTile|DrawPanel|drawlayer|从本地或项目媒体替换/);
});
