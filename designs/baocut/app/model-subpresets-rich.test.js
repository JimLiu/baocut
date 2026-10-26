/* node --test designs/baocut/app/model-subpresets-rich.test.js
   钉 caption-editor-redesign §10：新增 60 份、合计 103 份，四个新分区，每份显式带当前词，
   每份都看得清（没底板就得有描边、阴影或发光），涂装栈镜像回 v1 键，目录三形态齐全。 */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-subanim.js');
require('./model-subpresets.js');
require('./model-defaultsub.js');
require('./model-subtitle-designs.js');
require('./model-captionsurface.js');
require('./model-subpresets-rich.js');
require('./model-captionstyle.js');
const CS = window.BC_CS;
const RP = window.BC_RP;
const SURF = window.BC_SURF;

test('新增 60 份，合计 103 份，键不撞', () => {
  assert.equal(RP.ROWS.length, 60);
  const all = CS.presets();
  assert.equal(all.length, 103);
  assert.equal(new Set(all.map((p) => p.id)).size, 103);
  assert.equal(all.filter((p) => p.schema === CS.SCHEMA2).length, 60, '新增的写 /2');
  assert.equal(all.filter((p) => p.schema === CS.SCHEMA).length, 43, '原有的仍是 /1');
});

test('分区计数照 §10 那张表', () => {
  const n = {};
  CS.presets().forEach((p) => { n[p.category] = (n[p.category] || 0) + 1; });
  assert.deepEqual(n, {basic: 5, social: 30, neon: 8, cinema: 8, cute: 8, art: 8, business: 10, retro: 10, motion: 15, kinetic: 1});
  assert.deepEqual(RP.CATEGORIES.map((c) => c.k), ['neon', 'cinema', 'cute', 'art']);
  RP.CATEGORIES.forEach((c) => assert.ok(CS.CATEGORIES.some((x) => x.k === c.k && x.name === c.name), c.k));
});

test('每份显式带当前词，模式都在目录里，当前词色是 6 位大写', () => {
  RP.ROWS.forEach((r) => {
    const b = CS.byKey(r.k);
    assert.ok(b && b.activeWord, r.k);
    assert.ok(CS.ACTIVE_MODES.some((m) => m.k === b.activeWord.mode), r.k);
    if (['color', 'lift', 'sweep', 'underline', 'pop', 'stretch', 'glow', 'scale'].includes(b.activeWord.mode)) {
      assert.match(b.activeWord.color, /^#[0-9A-F]{6}$/, r.k);
    }
    if (b.activeWord.mode === 'box') assert.match(b.activeWord.box.color, /^#[0-9A-F]{6}$/, r.k);
    if (b.motion) ['in', 'out', 'loop'].forEach((s) => { if (b.motion[s]) assert.ok(CS.motionPreset(s, b.motion[s].preset), r.k + '.' + s); });
  });
});

test('每份都看得清：没有底板就必须有描边、阴影或发光', () => {
  Object.keys(RP.LOOKS).forEach((k) => {
    const L = RP.LOOKS[k];
    const s = L.layers;
    const plate = L.opacity > 0 || L.wordBackground;
    assert.ok(plate || s.strokes.length || s.shadows.some((x) => !x.inner) || s.glow, k);
  });
});

test('涂装栈镜像回 v1 键，套用后轨上带着栈', () => {
  const L = RP.LOOKS['double-pop'];
  assert.equal(L.layers.strokes.length, 2);
  assert.deepEqual([L.outline, L.outlineColor, L.outlineW], [true, '#111111', 16]);
  const t = CS.toTrack(CS.byKey('double-pop'), {role: 'source'});
  assert.deepEqual(t.layers, L.layers);
  assert.equal(t.activeWord.mode, 'pop');
  assert.equal(t.wordAnim, 'none', '目录没有这一格，走通用路径');
  assert.equal(CS.toTrack(CS.byKey('classic'), {role: 'source'}).layers, null, '旧预设没有栈');
});

test('效果标签覆盖 §8 除表情装饰以外的十五种', () => {
  const seen = new Set();
  CS.presets().forEach((p) => SURF.tags(Object.assign({}, p, {surface: Object.assign({}, p.surface.layers, {plate: p.surface.plate, wordBox: p.surface.wordBox})}))
    .forEach((t) => seen.add(t)));
  const want = SURF.TAGS.map((t) => t.k).filter((k) => k !== 'decoration');
  assert.deepEqual(want.filter((k) => !seen.has(k)), []);
});

test('分页只落在有词级时间的源语言轨上；强调词进 highlight', () => {
  const b = CS.byKey('page-stack');
  assert.deepEqual(CS.toTrack(b, {role: 'source'}).pagination, {wordsPerPage: 3, rows: [2, 1]});
  assert.equal(CS.toTrack(b, {role: 'translation'}).pagination, null);
  assert.equal(CS.toTrack(b, {role: 'source', hasWordTiming: false}).pagination, null);
  const back = CS.fromTrack(CS.toTrack(b, {role: 'source'}));
  assert.deepEqual(back.layout.pagination, {wordsPerPage: 3, rows: [2, 1]});
  assert.equal(back.schema, CS.SCHEMA2);
  const kw = CS.toTrack(CS.byKey('keyword-zoom'), {role: 'source'});
  assert.deepEqual([kw.highlight.color, kw.highlight.scale, kw.highlight.bold], ['#FFE14D', 135, true]);
});

test('目录卡三种形态，画廊按 presets() 的顺序陈列 103 张', () => {
  ['orig', 'bi', 'trans'].forEach((f) => assert.equal(RP.cards(f).length, 60));
  assert.equal(RP.cards('bi')[0].look2, RP.cards('bi')[0].look);
  const catalog = window.BC_DS.cards('orig').concat(window.BC_VS.cards('orig'), window.BC_SD.cards('orig'),
    [{id: 'daoyazi', name: '倒鸭子', cat: 'kinetic', form: 'orig', look: 'casper', anim: 'none', kinetic: true}], RP.cards('orig'));
  const cards = CS.galleryCards(catalog);
  assert.equal(cards.length, 103);
  assert.equal(cards[cards.length - 1].id, 'v-char-cascade');
  assert.equal(cards.find((c) => c.id === 'v-neon-pink').cat, 'neon');
});
