/* node --test designs/baocut/app/model-captionstyle.test.js
   钉的是设计稿 caption-style-model-design.md 的几条硬规则：每份预设自带当前词、
   19 格往返、换当前词不改涂装（反之亦然）、译文当前词恒 none、分类计数。 */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-subanim.js');
require('./model-subpresets.js');
require('./model-defaultsub.js');
require('./model-subtitle-designs.js');
require('./model-captionstyle.js');
const CS = window.BC_CS;

test('分类按 §7 的顺序：基础 / 社交 / 商务 / 复古 / 动效 / 动态排版', () => {
  assert.deepEqual(CS.CATEGORIES.map((c) => c.k), ['basic', 'social', 'business', 'retro', 'motion', 'kinetic']);
  assert.deepEqual(CS.CATEGORIES.map((c) => c.name), ['基础', '社交', '商务', '复古', '动效', '动态排版']);
});

test('当前词七种模式与两根小轴', () => {
  assert.deepEqual(CS.ACTIVE_MODES.map((m) => m.k), ['none', 'color', 'box', 'scale', 'lift', 'underline', 'sweep']);
  assert.deepEqual(CS.ACTIVE_MODES.map((m) => m.name), ['无', '变色', '底块', '放大', '上抬', '下划线', '扫色']);
  assert.deepEqual(CS.SPOKEN.map((m) => m.k), ['keep', 'tint', 'dim']);
  assert.deepEqual(CS.UNSPOKEN.map((m) => m.k), ['keep', 'dim', 'hidden']);
});

test('动效预设三栏都带默认触发与单位', () => {
  ['in', 'out', 'loop'].forEach((s) => {
    assert.ok(CS.MOTION_PRESETS[s].length > 0);
    CS.MOTION_PRESETS[s].forEach((p) => {
      assert.ok(['enter', 'spoken'].includes(p.trigger), p.k);
      assert.ok(['cue', 'line', 'word', 'grapheme'].includes(p.unit), p.k);
      assert.ok(p.durationSeconds > 0, p.k);
    });
  });
  // §3.5 列出的名字一个不少
  const want = {in: 'typewriter fade-up rise cascade pop blur-in slide-mask wave-in drop-in float-in-top float-in-bottom scale-in impact flip stomp stack',
    out: 'fade-down sink pop-out blur-out typewriter-erase', loop: 'pulse wave shimmer swing'};
  Object.keys(want).forEach((s) => assert.deepEqual(CS.MOTION_PRESETS[s].map((p) => p.k), want[s].split(' ')));
});

test('19 格目录往返：fromAnim → toAnim 回到同一格', () => {
  const cells = window.BC_SA.ANIMS.map((a) => a.k);
  assert.equal(cells.length, 19);
  assert.deepEqual(cells.slice().sort(), CS.CELL_KEYS.slice().sort(), '查表覆盖目录全部 19 格');
  cells.forEach((k) => {
    const r = CS.fromAnim(k, '#6147FF');
    assert.equal(CS.toAnim(r.activeWord, r.motion), k, k);
  });
  assert.equal(CS.fromAnim('bgHighlight').motion.in.preset, 'stack', '实现名 bgHighlight 认作 stack');
});

test('§4 表的几行逐条核对', () => {
  assert.deepEqual(pick(CS.fromAnim('reveal').activeWord), {mode: 'none', spoken: 'keep', unspoken: 'hidden'});
  assert.deepEqual(pick(CS.fromAnim('karaoke').activeWord), {mode: 'none', spoken: 'keep', unspoken: 'dim'});
  assert.deepEqual(pick(CS.fromAnim('highlight').activeWord), {mode: 'none', spoken: 'dim', unspoken: 'dim'});
  assert.equal(CS.fromAnim('paint').activeWord.spoken, 'tint');
  assert.equal(CS.fromAnim('bounce').activeWord.lift, 0.22);
  const drop = CS.fromAnim('dropIn', '#FF0000');
  assert.equal(drop.activeWord.mode, 'color');
  assert.deepEqual([drop.motion.in.preset, drop.motion.in.trigger, drop.motion.in.unit], ['drop-in', 'spoken', 'word']);
  assert.equal(CS.fromAnim('impactPop').motion.in.intensity, 1.3);
});

function pick(a) { return {mode: a.mode, spoken: a.spoken, unspoken: a.unspoken}; }

test('目录没有的组合返回 null（渲染走通用路径）', () => {
  assert.equal(CS.toAnim({mode: 'sweep', color: '#FF6A1A'}), null);
  assert.equal(CS.toAnim({mode: 'underline'}), null);
  assert.equal(CS.toAnim({mode: 'scale', scale: 1.2}), null);
  assert.equal(CS.toAnim({mode: 'box', box: {color: '#FFD84D'}}, {in: CS.effect('in', 'drop-in')}), null, '落入 + 底块 目录里没有');
  assert.equal(CS.toAnim({mode: 'color', scale: 1.1}), 'colourHighlight', '放大叠在变色上仍是变色那一格');
  assert.equal(CS.toAnim({mode: 'color'}, {in: CS.effect('in', 'cascade')}), 'colourHighlight', '出现时的入场不选格，走 textMotion');
});

test('每一份内置预设都显式带 activeWord', () => {
  const list = CS.presets();
  assert.equal(list.length, 43, '31 + 经典 + Shorts + 9 份 Studio + 倒鸭子');
  assert.equal(new Set(list.map((p) => p.id)).size, list.length, 'id 不撞');
  list.forEach((p) => {
    assert.equal(p.schema, 'baocut.caption-style/1');
    assert.ok(p.activeWord && CS.ACTIVE_MODES.some((m) => m.k === p.activeWord.mode), p.key);
    assert.ok(p.activeWord.spoken && p.activeWord.unspoken, p.key);
    assert.ok(/^v-/.test(p.id), p.key + ' 的 id 保持 v- 前缀');
    if (['color', 'lift', 'sweep', 'underline'].includes(p.activeWord.mode)) {
      assert.match(p.activeWord.color, /^#[0-9A-F]{6}$/, p.key + ' 的当前词色');
      assert.notEqual(p.activeWord.color, '#000000', p.key + ' 当前词不该是占位黑');
    }
  });
});

test('分类计数（§7 按现有数据机械换算）', () => {
  const n = {};
  CS.presets().forEach((p) => { n[p.category] = (n[p.category] || 0) + 1; });
  assert.deepEqual(n, {basic: 3, social: 20, business: 6, retro: 6, motion: 7, kinetic: 1});
  const basic = CS.presets().filter((p) => p.category === 'basic');
  assert.deepEqual(basic.map((p) => p.name), ['经典', 'Shorts', '简洁']);
  assert.deepEqual(CS.presets().filter((p) => p.category === 'motion').map((p) => p.name),
    ['逐词入场', '逐字显现', '逐行滑入', '柔焦显现', '升起落定', '字符波浪', 'KTV 歌词']);
});

test('基础区与动效区的取值照 §7 那张表', () => {
  const k = (key) => CS.byKey(key);
  assert.deepEqual([k('classic').activeWord.mode, k('classic').activeWord.color], ['color', '#18E1D6']);
  assert.deepEqual([k('shorts').activeWord.mode, k('shorts').activeWord.lift, k('shorts').activeWord.color], ['lift', 0.22, '#FFE14D']);
  assert.equal(k('shorts').layout.y, 0.72);
  assert.deepEqual([k('simple').activeWord.color, k('simple').activeWord.scale], ['#FFFFFF', 1.06]);
  assert.deepEqual([k('studio-focus').activeWord.scale, k('studio-focus').activeWord.durationSeconds], [1.18, 0.2]);
  assert.equal(k('studio-word-tiles').activeWord.box.color, '#FFD84D');
  assert.ok(k('studio-word-tiles').surface.wordBox, '逐词底块常驻深底');
  const ktv = k('studio-ktv').activeWord;
  assert.deepEqual([ktv.mode, ktv.color, ktv.sweep.guide, ktv.sweep.nextLine], ['sweep', '#FF6A1A', true, true]);
  assert.deepEqual(pick(k('studio-paper-typewriter').activeWord), {mode: 'none', spoken: 'keep', unspoken: 'hidden'});
  assert.equal(k('studio-paper-typewriter').motion.in.preset, 'typewriter');
  assert.equal(k('studio-rise-settle').motion.out.preset, 'fade-down');
  assert.equal(k('studio-kinetic-wave').motion.loop.preset, 'wave');
  assert.equal(k('daoyazi').layout.mode, 'sequence');
});

test('31 份按 fromAnim 换算，Studio 键保持稳定', () => {
  window.BC_VS.PRESETS.filter((p) => p.k !== 'simple').forEach((p) => {
    const b = CS.byKey(p.k);
    assert.equal(CS.toAnim(b.activeWord, b.motion), p.anim, p.k + ' 往返回到原来那一格');
    assert.equal(b.category, window.BC_VS.CATS[p.cat]);
  });
});

test('换当前词不改涂装，换涂装不改当前词', () => {
  const b = CS.byKey('prettymarketer');
  const a = CS.toTrack(b, {role: 'source'});
  const b2 = Object.assign({}, b, {activeWord: CS.normActive({mode: 'sweep', color: '#FF6A1A'})});
  const c = CS.toTrack(b2, {role: 'source'});
  CS.PAINT_KEYS.forEach((k) => assert.deepEqual(c[k], a[k], k));
  assert.notEqual(c.wordAnim, a.wordAnim);
  // 反过来：只改涂装，词级那几件一个不动
  const b3 = Object.assign({}, b, {surface: Object.assign({}, b.surface, {color: '#00FF00'})});
  const d = CS.toTrack(b3, {role: 'source'});
  CS.WORD_KEYS.forEach((k) => assert.deepEqual(d[k], a[k], k));
  assert.notEqual(d.color, a.color);
  // patchWord 只返回词级那几件
  const patch = CS.patchWord(Object.assign({role: 'source'}, a), {activeWord: {mode: 'box', box: {color: '#FFD84D'}}});
  assert.deepEqual(Object.keys(patch).sort(), CS.WORD_KEYS.slice().sort());
  assert.equal(patch.activeWord.mode, 'box');
  assert.equal(patch.wordAnim, 'boxHighlight');
});

test('涂装键往返不走样', () => {
  ['prettymarketer', 'ali', 'shadeplay', 'studio-word-tiles', 'studio-focus'].forEach((key) => {
    const p = CS.byKey(key);
    const look = Object.assign({}, window.BC_VS.LOOKS[key] || window.BC_SD.LOOKS[key]);
    const t = CS.toTrack(p, {role: 'source'});
    ['font', 'stack', 'weight', 'bold', 'italic', 'color', 'opacity', 'outline', 'outlineColor', 'shadow', 'shColor', 'plate']
      .forEach((k) => assert.deepEqual(t[k], look[k], key + '.' + k));
    assert.equal(t.upper, look.upper || '', key + '.upper');
    ['lh', 'spacing', 'outlineW', 'shDist', 'shAngle', 'shBlur', 'corners', 'pad'].forEach((k) => {
      assert.ok(Math.abs(t[k] - look[k]) < 0.01, key + '.' + k + ' ' + t[k] + ' vs ' + look[k]);
    });
  });
});

test('译文轨当前词恒 none，念到时的入场改成出现时', () => {
  const b = CS.byKey('boba');                // dropIn：念到时落入
  const t = CS.toTrack(b, {role: 'translation'});
  assert.equal(t.activeWord.mode, 'none');
  assert.equal(t.wordAnim, 'none');
  assert.ok(!('activeColor' in t), '译文轨不带当前词色');
  assert.equal(t.motion.in.trigger, 'enter');
  const noTiming = CS.toTrack(CS.byKey('studio-ktv'), {role: 'source', hasWordTiming: false});
  assert.equal(noTiming.activeWord.mode, 'none', '没有词级时间不扫色');
  assert.equal(noTiming.textMotion, null);
  // 目录卡的仅译文形态同样落 none
  const card = CS.annotate({id: 'vt-studio-ktv', form: 'trans', look: 'studio-ktv'});
  assert.equal(card.activeWord.mode, 'none');
});

test('编译出的 textMotion：扫色 → karaoke，放大叠加 → emphasis，出现时的入场原样', () => {
  const ktv = CS.toTrack(CS.byKey('studio-ktv'), {role: 'source'});
  assert.deepEqual(ktv.textMotion.karaoke, {color: '#FF6A1A', guide: true, nextLine: true});
  const focus = CS.toTrack(CS.byKey('studio-focus'), {role: 'source'});
  assert.deepEqual(focus.textMotion.emphasis, {color: '#FC75E9', scale: 1.18, durationSeconds: 0.2});
  const drop = CS.toTrack(CS.byKey('studio-word-drop'), {role: 'source'});
  assert.equal(drop.textMotion.in.preset, 'cascade');
  const tiles = CS.toTrack(CS.byKey('studio-word-tiles'), {role: 'source'});
  assert.equal(tiles.wordBackground.activeColor, '#FFD84D');
});

test('fromTrack 认旧轨：只有 wordAnim 的文档也解析得出当前词', () => {
  const b = CS.fromTrack({wordAnim: 'boxHighlight', activeColor: '#6147FF', color: '#FFFFFF', role: 'source'});
  assert.equal(b.activeWord.mode, 'box');
  assert.equal(b.activeWord.box.color, '#6147FF');
  const k = CS.fromTrack({wordAnim: 'none', textMotion: {version: 1, karaoke: {color: '#FF6A1A', guide: true}}});
  assert.equal(k.activeWord.mode, 'sweep');
});

test('画廊陈列：一份预设一张卡、按分类、带当前词，不折叠家族', () => {
  const catalog = window.BC_DS.cards('orig').concat(window.BC_VS.cards('orig'), window.BC_SD.cards('orig'),
    [{id: 'daoyazi', name: '倒鸭子', cat: 'kinetic', form: 'orig', look: 'casper', anim: 'none', kinetic: true}],
    window.BC_VS.cards('bi'));
  const cards = CS.galleryCards(catalog);
  assert.equal(cards.length, 43);
  assert.ok(cards.every((c) => c.form === 'screen' && c.activeWord && c.cat));
  assert.ok(cards.some((c) => c.id === 'v-hustle'), '别名家族也陈列');
  assert.equal(cards.find((c) => c.id === 'v-daoyazi').kinetic, true);
  assert.equal(CS.badge({mode: 'sweep'}), '扫色');
  assert.equal(CS.badge({mode: 'none', unspoken: 'hidden'}), '逐词显现');
});

test('扫色进度：词内按时间线性推进，按词时整词瞬间换色', () => {
  assert.equal(CS.wordProgress(0.5, 4, 4, 0), 0.5);
  assert.equal(CS.wordProgress(2.5, 4, 4, 1), 1);
  assert.equal(CS.wordProgress(0.5, 4, 4, 2), 0);
  assert.equal(CS.sweptGraphemes(0.5, 4, 'grapheme'), 2);
  assert.equal(CS.sweptGraphemes(0.01, 4, 'word'), 4);
  assert.equal(CS.sweptGraphemes(0, 4, 'word'), 0);
});
