/* node --test designs/baocut/app/model-stylepack.test.js
   钉 caption-editor-redesign §7 / §8 在原型里的一层：清单 → 模板卡（来源、分区、效果标签、
   逐词时间、文字系统、设备不支持的原因）、冻结的来源、包卸载与新版本、语言 → 文字系统。 */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-captionsurface.js');
require('./model-subpresets-rich.js');
require('./model-captionstyle.js');
require('./font-library-data.js');
require('./model-sceneadjust.js');
require('./model-stylepack.js');
require('./model-stylepack-demo.js');
require('./model-sublibrary.js');
const P = window.BC_PACK;
const L = window.BC_LIB;

const scene = {fonts: [{key: 'f0', family: 'Bangers'}], paints: [{kind: 'stroke', color: '#000000', width: 0.05}, {kind: 'fill', color: '#FFFFFF'}],
  states: {active: {mode: 'color', color: '#FFE14D'}}, layout: {x: 0.5, y: 0.8, width: 0.9}};
const pack = (styles, more) => Object.assign({schema: P.SCHEMA, id: 'tp', version: '2.0.0', name: {en: 'Test pack', 'zh-Hans': '测试包'},
  categories: [{id: 'a', name: {en: 'A'}}], styles}, more);
const style = (id, more) => Object.assign({id, revision: 2, name: id, categories: ['a'], fonts: [], resources: [], scene}, more);

test('LocalizedText 取界面语言，取不到落回英文再落回第一项', () => {
  assert.strictEqual(P.text({en: 'Hi', 'zh-Hans': '你好'}), '你好');
  assert.strictEqual(P.text({en: 'Hi', fr: 'Salut'}), 'Hi');
  assert.strictEqual(P.text({fr: 'Salut'}), 'Salut');
  assert.strictEqual(P.text('plain'), 'plain');
});

test('清单 → 模板卡：id、来源包、分区、效果标签取包作者给的，没给用摘要', () => {
  const list = [pack([style('one'), style('two', {tags: ['loop']})])];
  const cards = P.cards(list);
  assert.deepStrictEqual(cards.map((c) => c.id), ['pk:tp:one', 'pk:tp:two']);
  assert.strictEqual(cards[0].pack.name, '测试包');
  assert.strictEqual(cards[0].form, 'screen');
  assert.deepStrictEqual(cards[0].categories, ['a']);
  assert.deepStrictEqual(cards[0].tags, ['active-color', 'stroke']);
  assert.deepStrictEqual(cards[1].tags, ['loop']);
  assert.strictEqual(cards[0].needsWordTiming, true);
  assert.deepStrictEqual(cards[0].scripts, ['Latn']);
  assert.strictEqual(L.sourceOf(cards[0]), 'pack:tp');
});

test('要这台设备没有的能力：卡照样列出，标不支持与原因，样式库不可套用', () => {
  const cards = P.cards([pack([style('x', {requires: ['caption-particle-burst/1', 'caption-gradient-glyph/1']}), style('y', {requires: ['caption-future/9']})])]);
  assert.strictEqual(cards.length, 2);
  assert.deepStrictEqual(cards[0].unsupported.missing, ['caption-particle-burst/1']);
  assert.match(cards[0].unsupported.reason, /粒子迸发/);
  assert.match(cards[1].unsupported.reason, /未知能力/);
  assert.ok(L.fitOf(cards[0], {wordTiming: true}).blocked);
});

test('字体不含这门语言的字：中文轨上的拉丁字体卡标提示，认不出的语言不判', () => {
  const [card] = P.cards([pack([style('one')])]);
  assert.strictEqual(L.fitOf(card, {wordTiming: true, script: P.scriptOf('zh')}).notes[0].k, 'font');
  assert.strictEqual(L.fitOf(card, {wordTiming: true, script: P.scriptOf('en')}).notes.length, 0);
  assert.strictEqual(L.fitOf(card, {wordTiming: true, script: P.scriptOf('xx')}).notes.length, 0);
});

test('语言 → 文字系统；字体库里的覆盖 → ISO 15924，查不到按拉丁算', () => {
  assert.deepStrictEqual(['zh', 'zh-Hant', 'ja', 'ko', 'ru', 'ar', 'pt-BR', 'en', 'xx', null].map(P.scriptOf),
    ['Hans', 'Hant', 'Jpan', 'Kore', 'Cyrl', 'Arab', 'Latn', 'Latn', null, null]);
  assert.deepStrictEqual(P.fontScripts('Noto Sans SC'), ['Hans', 'Latn']);
  assert.deepStrictEqual(P.fontScripts('Inter'), ['Latn', 'Cyrl', 'Grek']);
  assert.deepStrictEqual(P.fontScripts('No Such Font'), ['Latn']);
});

test('冻结的来源：包与模板的版本、调整前场景的摘要（同一份场景摘要稳定）', () => {
  const list = [pack([style('one')])];
  const pk = P.packById('tp', list);
  const o = P.origin(pk, pk.manifest.styles[0]);
  assert.deepStrictEqual(o.pack, {id: 'tp', version: '2.0.0'});
  assert.deepStrictEqual(o.template, {id: 'one', revision: 2});
  assert.strictEqual(o.sceneSha256, P.origin(pk, JSON.parse(JSON.stringify(pk.manifest.styles[0]))).sceneSha256);
});

test('包卸载后显示「样式包已移除」；包里的模板升了版本提示有新版本', () => {
  const org = {pack: {id: 'tp', version: '1.0.0'}, template: {id: 'one', revision: 1}, sceneSha256: 'x'};
  assert.deepStrictEqual(P.originState(org, [pack([style('one')])]).newer, true);
  assert.deepStrictEqual(P.originState(org, []).removed, true);
  assert.strictEqual(P.originState(null, []).removed, false);
  assert.deepStrictEqual(P.byCard('pk:tp:one', [pack([style('one')])]).style.id, 'one');
  assert.strictEqual(P.byCard('pk:tp:gone', [pack([style('one')])]), null);
  assert.strictEqual(P.byCard('v-classic'), null);
});

test('演示包：两份通用包、分区与样式都对得上，有一张不可套用、有一张不要逐词时间', () => {
  const packs = P.installed();
  assert.deepStrictEqual(packs.map((p) => p.id), ['demo-headline', 'demo-night']);
  const cards = P.cards();
  packs.forEach((p) => cards.filter((c) => c.pack.id === p.id).forEach((c) => {
    assert.ok(p.categories.some((x) => x.id === c.categories[0]), c.id + ' 的分区在包里');
  }));
  assert.deepStrictEqual(cards.filter((c) => c.unsupported).map((c) => c.id), ['pk:demo-night:spark-burst']);
  assert.ok(cards.some((c) => c.needsWordTiming === false));
  assert.ok(cards.some((c) => c.emphasis));
  /* 样式库按包的分区陈列 */
  const secs = L.sections(cards, {source: 'pack:demo-headline', cat: 'all', q: '', tags: []}, {cats: [], packs});
  assert.deepStrictEqual(secs.map((s) => s.name), ['标题', '综艺', '手账']);
});

test('套用模板 = 冻结：场景、来源落到轨上，调整层从空开始，记下套用前的锚点', () => {
  const list = [pack([style('one'), style('two')])];
  const t0 = {id: 's1', role: 'source', size: 24, y: 70, x: 50, preset: 'v-classic'};
  const t1 = P.applyToTrack(t0, P.byCard('pk:tp:one', list), {role: 'source', preset: 'pk:tp:one'});
  assert.strictEqual(t1.preset, 'pk:tp:one');
  assert.strictEqual(t1.scene, scene);
  assert.deepStrictEqual(t1.origin.template, {id: 'one', revision: 2});
  assert.strictEqual(t1.adjust, null);
  assert.deepStrictEqual(t1.home, {y: 70, x: 50, width: undefined});
  assert.strictEqual(t1.font, 'Bangers');
  assert.strictEqual(t1.y, 70, '落位以轨的锚点为准，不搬家');
  /* 调过之后再点同一张：调整留着 */
  const adj = window.BC_ADJ.withScale(null, 1.5);
  const t2 = Object.assign({}, t1, {adjust: adj, size: 36, y: 40});
  const t3 = P.applyToTrack(t2, P.byCard('pk:tp:one', list), {role: 'source', preset: 'pk:tp:one'});
  assert.strictEqual(t3.adjust, adj);
  assert.strictEqual(t3.size, 36);
  assert.strictEqual(t3.origin, t2.origin);
  /* 换一份模板：调整丢掉，字号与落位回到套用模板之前 */
  const t4 = P.applyToTrack(t2, P.byCard('pk:tp:two', list), {role: 'source', preset: 'pk:tp:two'});
  assert.strictEqual(t4.adjust, null);
  assert.strictEqual(t4.size, 24);
  assert.strictEqual(t4.y, 70);
  assert.ok(!('width' in t4));
  assert.deepStrictEqual(t4.origin.template.id, 'two');
});

test('关键词是实例数据：组合样式里点过的强调词带成 keyword 词标签；离开模板时外观关掉、标签留着', () => {
  const list = [pack([style('one')])];
  const marks = {c1: [{text: '苏黎', index: 1}]};
  const t0 = {id: 's1', size: 20, highlight: {on: true, marks}};
  const t1 = P.applyToTrack(t0, P.byCard('pk:tp:one', list), {role: 'source'});
  assert.deepStrictEqual(t1.presentation, {wordTags: {keyword: marks}});
  const kept = P.applyToTrack(Object.assign({}, t0, {presentation: {seed: 3}}), P.byCard('pk:tp:one', list), {});
  assert.deepStrictEqual(kept.presentation, {seed: 3}, '轨上已有实例数据就不改');
  const scaled = Object.assign({}, t1, {adjust: {fontScale: 2}, size: 40});
  const off = P.leaveTemplate(scaled, {highlight: {on: true, color: '#FF0000'}});
  assert.deepStrictEqual([off.scene, off.origin, off.adjust, off.home], [null, null, null, null]);
  assert.strictEqual(off.size, 20);
  assert.strictEqual(off.highlight.on, false);
  assert.ok(!('highlight' in P.leaveTemplate(t1, {highlight: null})));
});
