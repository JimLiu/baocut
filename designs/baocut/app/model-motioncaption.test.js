/* node --test designs/baocut/app/model-motioncaption.test.js
   这一份钉的是**数据与语义有没有走样**。判据分三层：

     1. 数据：25 份、顺序固定、每份涂装键完整、`presetIR` 的每条通道都已规范化
        （与 BC_SA 同款「每帧属性集一致」自检也在这一层）。这里写死了几组原始数值——
        它们就是判据本身，改数据时这几条必须跟着一起看。
     2. 语义：`resolveTime` 的十种 anchor 逐条、progress 不 clamp、NaN / 倒序段丢弃、常量塌缩、
        spacing 的 off-by-one、`evalPredicate` 的谓词与具名算法、inject 替换、groupConsecutive 合并。
        这一层是本轮最高纪律的落点——每一条都对着实现的行为判，不对着名字。
     3. 渲染（第 71 轮换代）：缓动是精确的 Penner 函数、`layoutOf` 的排版与量宽、
        `plan(t)` 的时间门控（没到窗口没指令 / 过窗停末帧 / 静息拍不重播），以及六份
        预设各自的可判定特征（Memo 的扫入、Slab 的撑幅 ＋ 反色、Terminal 的错峰打字、
        Whisper 的聚焦、Cascade 的堆叠、Wiggle 的贝塞尔轨迹）。判据里的数值都按预期画面
        定死，不是拍脑袋给的。 */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-motioncaption.js');
const V = window.BC_VC;

const WORDS = ['the', 'quick', 'brown', 'foxes'];
const W = (a, b) => [a, b];
/** 假量尺：等宽 0.55em、上伸 0.92em、下伸 0.28em。视图那边是 canvas `measureText`，
 *  这一层要的只是「宽度是字号的确定倍数」——判据因此是算式，不是某台机器上的字体。 */
const ruler = (text, face) => ({
  w: text.length * 0.55 * face.sizePx, ascent: 0.92 * face.sizePx, descent: 0.28 * face.sizePx,
});
/** 四个词、每词一秒的 cue（与 `layoutOf` 缺省的均分口径一致，但写死免得跟着缺省漂）。 */
const WINS = [[0, 1], [1, 2], [2, 3], [3, 4]];
const lay4 = (k, cur, opts) => V.layoutOf(V.byKey(k), WORDS, ruler,
  Object.assign({fz: 20, boxW: 400, cur: cur, cueDur: 4, wins: WINS}, opts || {}));
const opsAt = (k, lay, t) => V.plan(V.byKey(k), lay, t, {}).ops;
const textsAt = (k, lay, t) => opsAt(k, lay, t).filter((o) => o.kind === 'text');
const boxesAt = (k, lay, t) => opsAt(k, lay, t).filter((o) => o.kind === 'box');
/** 秒是浮点，`10 + (-0.64) - 5` 落在 4.359999999999999——判据是那个数，不是它的二进制表示。 */
const near = (got, want, msg) => assert.ok(Math.abs(got - want) < 1e-9,
  (msg || '') + ' 实际 ' + got + '，应为 ' + want);

/* ================= 一、数据 ================= */

const ORDER25 = [
  'emphasisFifteen', 'emphasisSixteen', 'emphasisSeventeen', 'template-027-sub',
  'template-020-sub', 'template-018-sub', 'template-015-sub', 'template-011-sub',
  'template-022-sub', 'template-013-sub', 'template-014-sub', 'template-017-sub',
  'template-029-sub', 'emphasisThirteen', 'emphasisTwelve', 'emphasisEight', 'emphasisNine',
  'emphasisTen', 'emphasisSeven', 'emphasisSix', 'emphasisFive', 'emphasisThree',
  'emphasisOne', 'emphasisTwo', 'emphasisFour'];
/** 第 72 轮进来的那 8 份，以及它们在 25 份陈列里的**插位**（从 1 数起）。 */
const NEW8 = {emphasisSixteen: 2, emphasisSeventeen: 3, 'template-020-sub': 5,
  'template-015-sub': 7, 'template-013-sub': 10, 'template-029-sub': 13,
  emphasisTen: 18, emphasisSeven: 19};

test('25 份，顺序是定的', () => {
  assert.equal(V.PRESETS.length, 25);
  assert.deepEqual(V.PRESETS.map((p) => p.k), ORDER25);
  // 第 72 轮那 8 份是**插在中段**的，不是追加在尾巴上——插位逐条钉住
  Object.keys(NEW8).forEach((k) => assert.equal(ORDER25.indexOf(k) + 1, NEW8[k],
    k + ' 的插位错了：实际第 ' + (ORDER25.indexOf(k) + 1) + ' 位'));
  // 第 70/71 轮那 17 份的**相对次序**一条都没动
  const kept = ORDER25.filter((k) => NEW8[k] === undefined);
  assert.deepEqual(kept, [
    'emphasisFifteen', 'template-027-sub', 'template-018-sub', 'template-011-sub',
    'template-022-sub', 'template-014-sub', 'template-017-sub', 'emphasisThirteen',
    'emphasisTwelve', 'emphasisEight', 'emphasisNine', 'emphasisSix', 'emphasisFive',
    'emphasisThree', 'emphasisOne', 'emphasisTwo', 'emphasisFour']);
  // 三个占位名就是 label
  assert.equal(V.byKey('emphasisSixteen').label, 'Template 004');
  assert.equal(V.byKey('emphasisSixteen').name, 'Ember');
  assert.equal(V.byKey('emphasisSixteen').tpl, 'template-004-sub');
  assert.equal(V.byKey('emphasisSeventeen').label, 'Template 005');
  assert.equal(V.byKey('emphasisSeventeen').name, 'Vesper');
  assert.equal(V.byKey('emphasisSeventeen').tpl, 'template-005-sub');
  assert.equal(V.byKey('emphasisTen').label, 'Backdrop+');
  assert.equal(V.byKey('emphasisSeven').label, 'Backdrop');
});

test('显示名就是 label，包括 emphasisFifteen 的占位名「Template 003」', () => {
  const p = V.byKey('emphasisFifteen');
  assert.equal(p.label, 'Template 003');
  assert.equal(p.name, 'Slab', '引擎名叫 Slab，但卡上显示的不是它');
  assert.equal(p.tpl, 'template-003-sub');
  // 卡片 id = preset id，中间没有翻译层（裁决 3）
  assert.equal(V.byKey('template-027-sub').tpl, 'template-027-sub');
  assert.equal(V.byKey('emphasisThirteen').tpl, 'emphasisZen', '别名表的四条之一');
});

test('每份的涂装键完整，且都是**画进画面**的量', () => {
  const KEYS = ['font', 'weight', 'bold', 'italic', 'color', 'align', 'lh', 'spacing', 'upper',
    'mono', 'bg', 'opacity', 'corners', 'pad', 'plate', 'outline', 'outlineColor', 'outlineW',
    'shadow', 'activeColor', 'shDist', 'shAngle', 'shBlur', 'shColor'];
  V.PRESETS.forEach((p) => {
    KEYS.forEach((k) => assert.ok(p.paint[k] !== undefined, p.k + ' 缺涂装键 ' + k));
    assert.ok(V.FONTS[p.paint.font], p.k + ' 的字体 ' + p.paint.font + ' 不在字体表里');
    // 这一族没有底板：17 份的 effectiveDefaults 里一个 background 都没有
    assert.equal(p.paint.opacity, 0, p.k + ' 不该有底板');
  });
});

test('数据里出现的每一个字体族都在 FONTS 表里——涂装 / highlightStyle / 规则 / IR 四处都算', () => {
  const used = new Set();
  const walk = (o, key) => {
    if (Array.isArray(o)) return o.forEach((x) => walk(x, key));
    if (o && typeof o === 'object') {
      Object.keys(o).forEach((k) => {
        if (k === 'font' && typeof o[k] === 'string') used.add(o[k]);
        walk(o[k], k);
      });
    }
  };
  V.PRESETS.forEach((p) => walk(p));
  assert.equal(used.size, 22, '族数变了：' + [...used].sort().join(', '));
  // 第 72 轮那 8 份带进来的 7 个新族（逐一核过 Google Fonts 有这个 family）
  ['Instrument Serif', 'Gloock', 'Unna', 'Gloria Hallelujah', 'Just Me Again Down Here',
    'Rubik Spray Paint', 'BBH Bartle'].forEach((f) => assert.ok(used.has(f), f + ' 没被用到'));
  used.forEach((f) => assert.ok(V.FONTS[f], f + ' 不在 FONTS 表里——那一份会掉回默认字体'));
  // 视图要往 Google Fonts link 与 fonts.popular 里加的就是这一张表
  assert.deepEqual(V.fontFamilies().slice().sort(), [...used].sort());
});

test('换算定点校验：Slab 与 Terminal 逐字段对得上 effectiveDefaults', () => {
  // template-003-sub: font Anton / lineHeight 1.1 / letterSpacingEm -.04 / uppercase / #fff
  const slab = V.byKey('emphasisFifteen').paint;
  assert.equal(slab.font, 'Anton');
  assert.equal(slab.lh, 110);
  assert.equal(slab.spacing, -4, 'letterSpacingEm ×100（不是 classic 那边的 ×2）');
  assert.equal(slab.upper, 'upper');
  assert.equal(slab.color, '#FFFFFF');
  assert.equal(slab.outline, false);
  // emphasisNine: outline {size:.02,color:#000000} → outlineW = .02×160 = 3.2 → 3
  const term = V.byKey('emphasisNine').paint;
  assert.equal(term.font, 'IBM Plex Mono');
  assert.equal(term.mono, true);
  assert.equal(term.outline, true);
  assert.equal(term.outlineW, 3);
  assert.equal(term.color, '#00FF41');
  assert.equal(term.activeColor, '#00FF41', 'highlightStyle.color');
  // emphasisThirteen 的 shadow {size:.4, offset:{0,0}} → shBlur 40、距离 0
  const zen = V.byKey('emphasisThirteen').paint;
  assert.equal(zen.shadow, true);
  assert.equal(zen.shBlur, 40);
  assert.equal(zen.shDist, 0);
});

test('defaultsPatch 是 fallback 不是 override（裁决 4）', () => {
  /* emphasisTwelve 的 patch 写着 {align:center, y:.75, size:.06, highlightStyle:{color:#FFFFFF}}，
     其中 size 在 landscape 块里被引擎默认 .026 盖住——因为合并顺序是 {...patch, ...defaults}。 */
  const p = V.byKey('emphasisTwelve');
  assert.equal(p.layout.size, 0.026, 'landscape.size 是引擎默认，patch 的 .06 没赢');
  assert.equal(p.paint.align, 'center', '顶层 align 引擎没定义，patch 才生效');
});

test('capabilities 的 11 位原样保留，6 位没有消费端', () => {
  const BITS = ['styleType', 'usesDepthLayout', 'hasCharacterAnimations', 'usesDynamicColor',
    'usesOwnHighlighting', 'ignoreEmphasisEnabled', 'requiresMeasurements', 'usesBlendModes',
    'usesHideBehindForeground', 'usesMaskFill', 'supportsLineReflow'];
  V.PRESETS.forEach((p) => {
    assert.equal(Object.keys(p.caps).length, 11, p.k);
    BITS.forEach((b) => assert.ok(p.caps[b] !== undefined, p.k + ' 缺 ' + b));
  });
  /* 带 `hideBehindForeground` 哨兵的**正好 7 份**（第 72 轮进来的那 8 份里除了 Blaze）。
     Quill 的 `description` 说自己藏在前景后面，但它的位是 false、IR 里也没有哨兵
     ——那个串只出现在一条 characterAnimations 的描述里，不是 property。 */
  const sentinel = V.PRESETS.filter((p) => JSON.stringify(p.ir).includes('"hideBehindForeground"'));
  assert.deepEqual(sentinel.map((p) => p.k).sort(), ['emphasisSeven', 'emphasisSixteen',
    'emphasisSeventeen', 'emphasisTen', 'template-013-sub', 'template-015-sub',
    'template-020-sub'].sort());
  sentinel.forEach((p) => assert.equal(p.caps.usesHideBehindForeground, true, p.k));
  assert.equal(V.byKey('template-014-sub').caps.usesHideBehindForeground, false,
    'Quill 的描述在骗人，位是 false');
  assert.equal(V.byKey('template-029-sub').caps.usesHideBehindForeground, false, 'Blaze 没有哨兵');
});

test('presetIR 的每条通道都已规范化：{value} 或 {keyframes:[…]}，每帧属性集一致', () => {
  let channels = 0, frames = 0;
  const checkChannel = (c, where) => {
    channels++;
    if ('value' in c) return;
    if (!('keyframes' in c)) { assert.deepEqual(c, {}, where + ' 通道既不是 value 也不是 keyframes'); return; }
    c.keyframes.forEach((f) => {
      frames++;
      assert.ok(f.t0 && f.t1, where + ' 帧缺 t0/t1');
      assert.equal(typeof f.easing, 'string', where + ' 帧缺 easing（应补默认 linear）');
      const hasV = ('v0' in f) && ('v1' in f);
      assert.ok(hasV !== ('bezier' in f), where + ' 帧要么 v0/v1 要么 bezier，不能都有或都没有');
    });
    // segments / interpolate 两个别名都不该留在数据里
    assert.ok(!('segments' in c) && !('interpolate' in c), where + ' 别名没合一');
  };
  const walkProp = (p, where) => {
    if (p.ch) checkChannel(p.ch, where);
    ['size', 'color', 'offset', 'angle', 'axisPos', 'axisDir'].forEach((k) => {
      if (p[k]) checkChannel(p[k], where + '.' + k);
    });
    (p.payload || []).forEach((x) => walkProp(x, where + '.box'));
    (p.stops || []).forEach((s) => { checkChannel(s.color, where); checkChannel(s.position, where); });
    assert.ok(!p.unknown, where + ' 出现了认不出的属性类型：' + p.type);
  };
  V.PRESETS.forEach((p) => {
    ['word', 'line', 'char', 'global'].forEach((s) =>
      (p.ir[s] || []).forEach((e) => e.p.forEach((x) => walkProp(x, p.k + '.' + s))));
    Object.keys(p.ir.tags).forEach((t) => ['word', 'line', 'char'].forEach((s) =>
      (p.ir.tags[t][s] || []).forEach((e) => e.p.forEach((x) => walkProp(x, p.k + '#' + t + '.' + s)))));
  });
  assert.ok(channels > 60, '通道数应该在几十条量级，实际 ' + channels);
  assert.ok(frames > 60, '关键帧数应该在几十条量级，实际 ' + frames);
});

test('绘制指令表全是数：17 份、每一份在四个时刻上都不许出现 CSS 串或 NaN', () => {
  const NUMS = ['x', 'y', 'w', 'h', 'r', 'alpha', 'blur', 'tracking'];
  let planned = 0, boxes = 0, texts = 0;
  V.PRESETS.forEach((p) => {
    const lay = V.layoutOf(p, WORDS, ruler, {fz: 20, boxW: 400, cur: 2, cueDur: 4, wins: WINS});
    [0, 1.2, 2.4, 3.9].forEach((t) => {
      const pl = V.plan(p, lay, t, {});
      planned++;
      assert.ok(Array.isArray(pl.ops), p.k);
      pl.ops.forEach((o) => {
        assert.ok(o.kind === 'box' || o.kind === 'text', p.k + ' 出现了第三种指令 ' + o.kind);
        NUMS.forEach((n) => {
          if (o[n] === undefined) return;
          assert.equal(typeof o[n], 'number', p.k + '.' + o.kind + '.' + n + ' 不是数');
          assert.ok(!isNaN(o[n]), p.k + '.' + o.kind + '.' + n + ' 是 NaN');
        });
        if (o.kind === 'box') { boxes++; assert.ok(o.w >= 0 && o.h >= 0, p.k + ' 块的宽高为负'); }
        else {
          texts++;
          assert.equal(typeof o.text, 'string');
          assert.equal(typeof o.face.sizePx, 'number');
          ['tx', 'ty', 'sx', 'sy', 'rot', 'ox', 'oy'].forEach((n) =>
            assert.ok(typeof o.tf[n] === 'number' && !isNaN(o.tf[n]), p.k + '.tf.' + n));
        }
      });
    });
  });
  assert.equal(planned, 25 * 4);
  assert.ok(texts > 100, '文字指令太少：' + texts);
  assert.ok(boxes > 10, '块指令太少：' + boxes);
});

/* ================= 二、语义 ================= */

/* `resolveTime` 的参数：窗口 [t,n]、cue [r,i]、上一窗口 [s,c]、段内引用 {t0,prevT0,prevT1}。
   结果一律是**秒，以 cue 起点为 0**。 */
const WIN = W(10, 11), PREV = W(8, 9), CUE = W(5, 20);

test('resolveTime：十种 anchor 逐条', () => {
  const r = (d, seg) => V.resolveTime(d, WIN, PREV, CUE, seg);
  assert.equal(r({time: ['start', 0]}), 5);            // 10 + 0 − 5
  near(r({time: ['start', -0.64]}), 4.36);             // 负 offset 是常态
  assert.equal(r({time: ['end', 0]}), 6);              // 11 − 5
  near(r({time: ['end', 0.5]}), 6.5);
  assert.equal(r({time: ['prevStart', 0]}), 3);        // 8 − 5
  assert.equal(r({time: ['prevEnd', 0]}), 4);          // 9 − 5
  assert.equal(r({time: ['absoluteStart', 2]}), 2);    // 已经是 cue 相对，不再减
  assert.equal(r({time: ['absoluteEnd', 0]}), 15);     // 20 − 5
  near(r({time: ['t0', 0.25]}, {t0: 1}), 1.25);
  near(r({time: ['prevT0', 0.1]}, {prevT0: 2}), 2.1);
  near(r({time: ['prevT1', 0.1]}, {prevT1: 3}), 3.1);
  // t0 拿来定义 t0 是 NaN，prevT0/T1 没有上一段直接抛
  assert.ok(isNaN(r({time: ['t0', 0]})));
  assert.throws(() => r({time: ['prevT0', 0]}), /prevT0/);
  assert.throws(() => r({time: ['nope', 0]}), /锚点/);
});

test('resolveTime：progress 按**动画自己的窗口**归一，且不 clamp', () => {
  const r = (d) => V.resolveTime(d, WIN, PREV, CUE);
  assert.equal(r({progress: 0}), 5);
  assert.equal(r({progress: 1}), 6);
  assert.equal(r({progress: 0.5}), 5.5);
  // 数据里 progress:-0.12（词前起跳）与 progress:2（两倍词长之后）都在用
  near(r({progress: -0.12}), 4.88);
  assert.equal(r({progress: 2}), 7);
});

test('resolveTime：min / max 逐元素取，NaN 过滤掉', () => {
  const r = (d) => V.resolveTime(d, WIN, PREV, CUE);
  near(r({min: [{time: ['start', 0.09]}, {time: ['end', -0.001]}]}), 5.09);
  near(r({max: [{time: ['end', -0.07]}, {time: ['start', 0.02]}]}), 5.93);
  // t0 在这里解不开 → NaN → 被过滤，只剩另一条
  assert.equal(r({max: [{time: ['t0', 0]}, {time: ['start', 0]}]}), 5);
  assert.throws(() => r({min: []}), /非空/);
});

const CTX = {win: W(0, 1), prev: W(-1, 0), cue: W(0, 1), cueColor: '#123456'};

test('resolveChannel：NaN 段与倒序段丢弃', () => {
  const ch = {keyframes: [
    {t0: {time: ['t0', 0]}, v0: 0, t1: {time: ['start', 1]}, v1: 1, easing: 'linear'},   // t0 是 NaN
    {t0: {time: ['start', 0.8]}, v0: 0, t1: {time: ['start', 0.2]}, v1: 1, easing: 'linear'}, // 倒序
    {t0: {time: ['start', 0]}, v0: 0, t1: {time: ['start', 0.5]}, v1: 1, easing: 'linear'},
  ]};
  const rc = V.resolveChannel(ch, CTX);
  assert.equal(rc.keyframes.length, 1);
  assert.deepEqual([rc.keyframes[0].t0, rc.keyframes[0].t1], [0, 0.5]);
  // t0 === t1 的零长段也丢（`c >= f`）
  const zero = V.resolveChannel({keyframes: [
    {t0: {time: ['start', 0.3]}, v0: 0, t1: {time: ['start', 0.3]}, v1: 1, easing: 'linear'}]}, CTX);
  assert.deepEqual(zero, {keyframes: []});
});

test('resolveChannel：全常量塌缩成 {value}，一条变的就不塌', () => {
  const flat = V.resolveChannel({keyframes: [
    {t0: {progress: 0}, v0: 3, t1: {progress: 0.5}, v1: 3, easing: 'linear'},
    {t0: {progress: 0.5}, v0: 3, t1: {progress: 1}, v1: 3, easing: 'linear'}]}, CTX);
  assert.deepEqual(flat, {value: 3});
  const tuple = V.resolveChannel({keyframes: [
    {t0: {progress: 0}, v0: [1, 1], t1: {progress: 1}, v1: [1, 1], easing: 'linear'}]}, CTX);
  assert.deepEqual(tuple, {value: [1, 1]});
  const moving = V.resolveChannel({keyframes: [
    {t0: {progress: 0}, v0: 3, t1: {progress: 1}, v1: 4, easing: 'linear'}]}, CTX);
  assert.ok(moving.keyframes);
  // bezier 段永远不算常量（塌缩规则的第一条）
  const bez = V.resolveChannel({keyframes: [
    {t0: {progress: 0}, t1: {progress: 1}, bezier: [[0, 0], [0, 0], [0, 0], [0, 0]], easing: 'linear'}]}, CTX);
  assert.ok(bez.keyframes, 'bezier 段被误当成常量塌掉了');
});

test('resolveChannel：useTextColor 换成 cue 的字色', () => {
  assert.deepEqual(V.resolveChannel({value: 'useTextColor'}, CTX), {value: '#123456'});
  const rc = V.resolveChannel({keyframes: [
    {t0: {progress: 0}, v0: 'useTextColor', t1: {progress: 1}, v1: '#000000', easing: 'linear'}]}, CTX);
  assert.equal(rc.keyframes[0].v0, '#123456');
});

test('sampleChannel：段外取端点，段内按缓动插值，bezier 段走曲线上的点', () => {
  const rc = V.resolveChannel({keyframes: [
    {t0: {progress: 0}, v0: 0, t1: {progress: 1}, v1: 10, easing: 'linear'}]}, CTX);
  assert.equal(V.sampleChannel(rc, -1), 0);
  assert.equal(V.sampleChannel(rc, 2), 10);
  assert.equal(V.sampleChannel(rc, 0.5), 5);
  // emphasisFour 的 creepy-0 用的就是这种二维三次贝塞尔
  const b = V.bezierPoint([[0, 0], [0.06, -0.04], [-0.04, 0.06], [-0.06, 0.02]], 1);
  assert.deepEqual(b, [-0.06, 0.02]);
  assert.deepEqual(V.bezierPoint([[0, 0], [0.06, -0.04], [-0.04, 0.06], [-0.06, 0.02]], 0), [0, 0]);
});

test('spacing 的 off-by-one：范围是 [from, to-1]，单字符整条跳过', () => {
  assert.deepEqual(V.rangeOf('spacing', 3, 8), [3, 7]);
  assert.deepEqual(V.rangeOf('alpha', 3, 8), [3, 8]);
  assert.equal(V.spacingApplies(1), false);
  assert.equal(V.spacingApplies(2), true);
});

test('applyCasing：capitalize 没有实现——只认 uppercase / lowercase', () => {
  assert.equal(V.applyCasing('abc', 'uppercase'), 'ABC');
  assert.equal(V.applyCasing('ABC', 'lowercase'), 'abc');
  assert.equal(V.applyCasing('abc', 'capitalize'), 'abc');
});

test('谓词：rank 的三个名字比的是**档**，cue-max / cue-median 比的是数', () => {
  const all = [{text: 'a', length: 1, rank: 1}, {text: 'bb', length: 2, rank: 6}];
  const w = {rank: 6, allWords: all, wordIndex: 1, totalWords: 2, lineIndex: 0, totalLines: 1,
    wordIndexInLine: 1, wordsInLine: 2, wordLength: 2, itemIndex: 0};
  assert.equal(V.evalPredicate({type: 'rank', operator: 'gte', value: 'highlighted'}, w), true);
  assert.equal(V.evalPredicate({type: 'rank', operator: 'lt', value: 'highlighted'}, w), false);
  assert.equal(V.evalPredicate({type: 'rank', operator: 'eq', value: 'cue-max'}, w), true);
  assert.equal(V.evalPredicate({type: 'rank', operator: 'eq', value: 'cue-max'},
    Object.assign({}, w, {rank: 1})), false);
  // rank 为 null 时只有 neq 判真
  const nul = Object.assign({}, w, {rank: null});
  assert.equal(V.evalPredicate({type: 'rank', operator: 'neq', value: 'cue-max'}, nul), true);
  assert.equal(V.evalPredicate({type: 'rank', operator: 'eq', value: 'cue-max'}, nul), false);
});

test('谓词：position 的 modulo 与 relativeTo、text / linePosition / constant / featureFlag', () => {
  const w = {rank: 1, allWords: [], wordIndex: 7, totalWords: 9, lineIndex: 1, totalLines: 3,
    wordIndexInLine: 2, wordsInLine: 4, wordLength: 5, itemIndex: 7};
  assert.equal(V.evalPredicate({type: 'position', field: 'itemIndex', operator: 'eq',
    value: 1, modulo: 6}, w), true, '7 % 6 = 1');
  assert.equal(V.evalPredicate({type: 'position', field: 'wordIndex', operator: 'eq',
    value: -2, relativeTo: 'totalWords'}, w), true, '9 + (−2) = 7');
  assert.equal(V.evalPredicate({type: 'text', field: 'wordLength', operator: 'gte', value: 5}, w), true);
  assert.equal(V.evalPredicate({type: 'linePosition', position: 'middle'}, w), true);
  assert.equal(V.evalPredicate({type: 'linePosition', position: 'first'}, w), false);
  assert.equal(V.evalPredicate({type: 'constant', value: true}, w), true);
  // featureFlag 缺省表是 {dynamicHighlights: true}
  assert.equal(V.evalPredicate({type: 'featureFlag', name: 'dynamicHighlights'}, w), true);
  assert.equal(V.evalPredicate({type: 'featureFlag', name: 'nope'}, w), false);
  assert.equal(V.evalPredicate({type: 'featureFlag', name: 'dynamicHighlights'}, w,
    {featureFlags: {dynamicHighlights: false}}), false);
  // and / or / not
  const T = {type: 'constant', value: true}, F = {type: 'constant', value: false};
  assert.equal(V.evalPredicate({type: 'and', rules: [T, F]}, w), false);
  assert.equal(V.evalPredicate({type: 'or', rules: [T, F]}, w), true);
  assert.equal(V.evalPredicate({type: 'not', rule: F}, w), true);
  assert.equal(V.evalPredicate({type: 'nope'}, w), false, '认不出的谓词判假，不抛');
});

test('谓词：range / wordAtIndex / allWordsMatch', () => {
  const all = [{text: 'aa', length: 2, rank: 1}, {text: 'bbbb', length: 4, rank: 6}];
  const w = {rank: 6, allWords: all, wordIndex: 1, totalWords: 2, lineIndex: 0, totalLines: 1,
    wordIndexInLine: 1, wordsInLine: 2, wordLength: 4, itemIndex: 0};
  assert.equal(V.evalPredicate({type: 'range', field: 'rank', min: 6, max: 10}, w), true);
  assert.equal(V.evalPredicate({type: 'range', field: 'wordIndex', min: 2, max: 5}, w), false);
  assert.equal(V.evalPredicate({type: 'wordAtIndex', index: 0, field: 'length',
    operator: 'eq', value: 2}, w), true);
  assert.equal(V.evalPredicate({type: 'wordAtIndex', index: 9, field: 'length',
    operator: 'eq', value: 2}, w), false);
  assert.equal(V.evalPredicate({type: 'allWordsMatch', quantifier: 'every', field: 'length',
    operator: 'gte', value: 2}, w), true);
  assert.equal(V.evalPredicate({type: 'allWordsMatch', quantifier: 'some', field: 'length',
    operator: 'gt', value: 3}, w), true);
});

test('具名算法：ALGORITHMS 的五条，逐条对实现（不对名字）', () => {
  const mk = (o) => Object.assign({rank: 1, allWords: [], wordIndex: 0, totalWords: 1,
    lineIndex: 0, totalLines: 1, wordIndexInLine: 0, wordsInLine: 1, wordLength: 1, itemIndex: 0}, o);
  // alternating：**每 N 个词一次**，默认 step 2，看的是 wordIndex % step === 0
  assert.equal(V.ALGORITHMS.alternating(mk({wordIndex: 4}), undefined), true);
  assert.equal(V.ALGORITHMS.alternating(mk({wordIndex: 3}), undefined), false);
  assert.equal(V.ALGORITHMS.alternating(mk({wordIndex: 3}), {step: 3}), true);
  // isShortSentenceHighlighted：**≤1 个词**且有非 accessible 的词（不是「短句被高亮」）
  const hi = [{text: 'a', length: 1, rank: 6}];
  assert.equal(V.ALGORITHMS.isShortSentenceHighlighted(mk({totalWords: 1, allWords: hi})), true);
  assert.equal(V.ALGORITHMS.isShortSentenceHighlighted(mk({totalWords: 2, allWords: hi})), false);
  assert.equal(V.ALGORITHMS.checkShortSentenceMode(mk({totalWords: 1})), true);
  // highlightedWordCount：默认 gte 1
  assert.equal(V.ALGORITHMS.highlightedWordCount(mk({allWords: hi}), undefined), true);
  assert.equal(V.ALGORITHMS.highlightedWordCount(mk({allWords: hi}), {operator: 'gte', value: 2}), false);
  // firstHalfLines：lineIndex < ceil(totalLines/2)，奇数行数偏向前半
  assert.equal(V.ALGORITHMS.firstHalfLines(mk({lineIndex: 1, totalLines: 3})), true);
  assert.equal(V.ALGORITHMS.firstHalfLines(mk({lineIndex: 2, totalLines: 3})), false);
});

test('applyRules：base 累加 tags、其余覆盖；continueMatching 才接着往下匹配', () => {
  // emphasisTwo 的八条规则互斥（都不带 continueMatching），一个词只命中一条
  const two = V.applyRules(V.byKey('emphasisTwo'), WORDS);
  two.forEach((w) => assert.ok(w.tags.length <= 2, '命中了不止一条规则：' + w.tags));
  // emphasisFour 的两条都带 continueMatching，base 的 creepy-0 与规则的 left/right 并存
  const four = V.applyRules(V.byKey('emphasisFour'), WORDS);
  assert.ok(four.some((w) => w.tags.indexOf('creepy-0') >= 0 && w.tags.length > 1));
  four.forEach((w) => assert.equal(w.tags[0], 'creepy-0', 'base 的标签在前'));
  // tags 去重（按 Set）：template-027-sub 的 base 与规则都写了 wordFadeIn
  const memo = V.applyRules(V.byKey('template-027-sub'), WORDS);
  memo.forEach((w) => assert.equal(new Set(w.tags).size, w.tags.length, '标签重复了'));
});

test('addDynamicColorTag 拼的是**这个词带进来的色**，不是 rank 名', () => {
  const p = V.byKey('template-027-sub');       // 规则里写着 addDynamicColorTag: true
  // 原型没有 AI 强调那一路，词不带色 → 这个标签根本不出现
  V.applyRules(p, WORDS).forEach((w) =>
    w.tags.forEach((t) => assert.ok(!t.startsWith('color-'), '凭空多了一个 ' + t)));
  // 给了色才出现，且拼的就是那个色串
  const withColor = V.applyRules(p, WORDS, {colors: [null, '#FF0000', null, null]});
  assert.ok(withColor[1].tags.indexOf('color-#FF0000') >= 0, JSON.stringify(withColor[1].tags));
  // 数据里也没有任何 color-* 的 customAnimation 与它对应——它在这一族里本来就是空转
  V.PRESETS.forEach((q) => Object.keys(q.ir.tags).forEach((t) =>
    assert.ok(!t.startsWith('color-'), q.k + ' 出现了 color-* 的 customAnimation')));
});

test('highlightStyle 垫在词属性下面：规则赢，它只补空位', () => {
  // emphasisThree 的 highlightStyle 是 {font: Pinyon Script, spacing: 1e-5, bold: false, color: #fff}
  const p = V.byKey('emphasisThree');
  const w = V.applyRules(p, WORDS);
  const hi = w.find((x) => x.rankName === 'highlighted');
  assert.equal(hi.font, 'Pinyon Script', '高亮词没吃到 highlightStyle 的字体');
  assert.equal(hi.spacing, 0.00001, 'highlightStyle 的字距盖过规则给的（p?.spacing ?? l.spacing）');
  assert.deepEqual(hi.scale, [2, 2], '规则给的 scale 赢，highlightStyle 只在没有时才补 size');
  w.filter((x) => x.rankName === 'accessible').forEach((x) =>
    assert.equal(x.font, undefined, '非高亮词不该吃到 highlightStyle'));
  // ignoreEmphasisEnabled 的 preset 一律不合（emphasisSix：全员 accessible，也就没有高亮档）
  const q = V.byKey('emphasisSix');
  V.applyRules(q, WORDS).forEach((x) => assert.equal(x.rankName, 'accessible'));
  // dynamicHighlights 关掉也不合
  const off = V.applyRules(p, WORDS, {featureFlags: {dynamicHighlights: false}});
  assert.equal(off.find((x) => x.rankName === 'highlighted').font, undefined);
});

test('highlight 存的是**原样**的 highlightStyle，涂装换算走 highlightPaint()', () => {
  const raw = V.byKey('emphasisEight').highlight;
  assert.deepEqual(raw, {font: 'Indie Flower', spacing: -0.055, bold: false},
    'spacing 是 em，没有先换成 1/100 em');
  const paint = V.highlightPaint('emphasisEight');
  assert.equal(paint.spacing, -5, '涂装那一路才 ×100');
  assert.ok(paint.stack.startsWith("'Indie Flower'"));
  assert.equal(V.highlightPaint('emphasisTwo'), null, '没有 highlightStyle 就是 null');
});

test('overwriteWithComputedScale：量出来的 computedScale 直接顶掉规则给的 scale', () => {
  // emphasisThirteen 的高亮规则写着 scale: 2 + overwriteWithComputedScale: true
  const p = V.byKey('emphasisThirteen');
  const plain = V.applyRules(p, WORDS).find((x) => x.rankName === 'highlighted');
  assert.deepEqual(plain.scale, [2, 2], '没量宽之前用规则给的');
  const measured = V.applyRules(p, WORDS, {computedScale: 0.7}).find((x) => x.rankName === 'highlighted');
  assert.deepEqual(measured.scale, [0.7, 0.7]);
});

test('applyRules：base.rank 盖在进来的 rank 上', () => {
  // template-003-sub 的 base 写着 rank: highlighted，且 ignoreEmphasisEnabled 让进来的全是 accessible
  const slab = V.applyRules(V.byKey('emphasisFifteen'), WORDS);
  slab.forEach((w) => assert.equal(w.rank, 6, 'base 的 highlighted 没盖上'));
  slab.forEach((w) => assert.deepEqual(w.tags, ['stretch', 'exclusionBlend']));
});

test('inject：三种色源 ＋ computedScale 的 fallback / multiplyBy', () => {
  const p = V.byKey('template-027-sub');
  const ictx = V.injectContext(p, {});
  assert.equal(ictx.accessibleColor, p.paint.color, '演示口径：底是深色画面，默认字色即可及色');
  assert.equal(ictx.highlightColor, p.paint.activeColor);
  assert.equal(V.resolveInject({inject: 'color', source: 'accessibleColor'}, ictx), p.paint.color);
  // 取不到就走 sourceFallback，再取不到才走 fallback
  assert.equal(V.resolveInject({inject: 'color', source: 'nope', fallback: '#ABCDEF'}, ictx), '#ABCDEF');
  assert.equal(V.resolveInject({inject: 'color', source: 'nope', sourceFallback: 'highlightColor',
    fallback: '#ABCDEF'}, ictx), p.paint.activeColor);
  // computedScale 是视图量出来的；这一层只留 fallback
  assert.equal(V.resolveInject({inject: 'scale', source: 'computedScale', fallback: 2}, ictx), 2);
  const withScale = V.injectContext(p, {computedScale: 3});
  assert.equal(V.resolveInject({inject: 'scale', source: 'computedScale', fallback: 1}, withScale), 3);
  assert.equal(V.resolveInject({inject: 'scale', source: 'computedScale', fallback: 1,
    transform: 'multiplyBy', transformParam: 2}, withScale), 6);
  // 深走一遍把标记全换掉
  const tree = V.resolveInjects({a: [{inject: 'color', source: 'highlightColor'}], b: 1}, ictx);
  assert.deepEqual(tree, {a: [p.paint.activeColor], b: 1});
});

test('inject：scaleOpacity 在线性光空间里同时缩 RGB 与 alpha', () => {
  assert.equal(V.scaleOpacity('#FFFFFF', 1), '#FFFFFF');
  const half = V.scaleOpacity('#FFFFFFFF', 0.5);
  assert.match(half, /^#[0-9A-F]{8}$/);
  assert.equal(half.slice(7), '80', 'alpha 也要乘');
  assert.notEqual(half.slice(1, 3), '80', 'RGB 走线性光，不是直接对半砍');
});

test('computedScale 要视图量宽：Slab ＋ Backdrop 一族六份 ＋ 逐行那两份', () => {
  const need = V.PRESETS.filter((p) => V.needsMeasure(p.k)).map((p) => p.k);
  assert.deepEqual(need, ['emphasisFifteen', 'emphasisSixteen', 'emphasisSeventeen',
    'template-020-sub', 'template-015-sub', 'template-013-sub', 'template-029-sub',
    'emphasisThirteen', 'emphasisTen', 'emphasisSeven']);
  assert.equal(V.byKey('emphasisFifteen').layout.sizeAlgorithm, 'calculateHighlightedTextScale');
  assert.deepEqual(V.byKey('emphasisFifteen').layout.sizeParams,
    {minScale: 0.05, maxScale: 1, targetFillRatio: 3});
  assert.equal(V.byKey('emphasisThirteen').layout.perWordSizeAlgorithm, 'calculatePerLineHighlightScales');
  /* 没量之前 stretch 落 fallback 1（＝不缩放），量完由 `layoutOf` 灌回来。
     `stretch` 写着 `impactLayout: true`，所以它**折进字号**（撑幅就是排版），
     不是绘制变形——绘制变形不会把行宽撑开。 */
  const p = V.byKey('emphasisFifteen');
  const one = V.layersOf(p, 'word', ['stretch'], {});
  assert.deepEqual(V.layoutScaleOf(one), [1, 1], '没量宽时落 fallback 1');
  assert.deepEqual(V.layoutScaleOf(V.layersOf(p, 'word', ['stretch'], {computedScale: 2.5})),
    [2.5, 2.5]);
  assert.equal(V.stateAt(one, 0, {skipLayoutScale: true}).sx, 1, '参与排版的那一格不许再画一遍');
});

test('groupConsecutive：连着的一串合成一条 range，run 里每个词都吃', () => {
  const fake = {
    k: 'fake', paint: {color: '#FFFFFF', activeColor: '#FFFFFF'},
    caps: {ignoreEmphasisEnabled: false},
    rules: {base: {tags: ['bar']}, rules: []},
    layout: {}, ir: {word: [], line: [], char: [], global: [], tags: {
      bar: {groupConsecutive: true, word: [{d: '', p: [{type: 'alpha', ch: {value: 1}}]}]}}},
  };
  const words = [{tags: ['bar']}, {tags: ['bar']}, {tags: []}, {tags: ['bar']}];
  const runs = V.consecutiveRuns(fake, words);
  assert.deepEqual(runs.bar.map((r) => r.words), [[0, 1], [3]]);
  assert.deepEqual(V.wordTracks(fake, 0, {words: words}).run, {tag: 'bar', from: 0, to: 1});
  /* 第 72 轮改正：run 里的**非首词也吃**这一条——groupConsecutive 发的是覆盖整段的一条 rangeProperty。
     预期效果：Ember 的 `Ten years` 两个词都是大号红色喷漆体，
     而那个倍率与那个颜色只有 `hidden`（唯一一个 groupConsecutive 标签）给得出。 */
  const w1 = V.wordTracks(fake, 1, {words: words});
  assert.equal(w1.entries.length, 1, 'run 里的非首词也要发');
  assert.deepEqual(w1.gtags, ['bar'], '它走的是 run 那一堆，不是自己的词窗那一堆');
  assert.deepEqual(w1.tags, [], '带 groupConsecutive 的标签不留在词窗那一堆里');
  assert.deepEqual(w1.run, {tag: 'bar', from: 0, to: 1});
  assert.deepEqual(V.wordTracks(fake, 3, {words: words}).run, {tag: 'bar', from: 3, to: 3});
  // 跨行就断（lineIndex 变了）
  const runs2 = V.consecutiveRuns(fake, [{tags: ['bar']}, {tags: ['bar']}], [[0], [1]]);
  assert.deepEqual(runs2.bar.map((r) => r.words), [[0], [1]]);
});

test('groupConsecutive 真数据：Ember 的 hidden 是 run，run 里两个词同色同倍率、共用 run 窗口', () => {
  const p = V.byKey('emphasisSixteen');
  assert.equal(V.groupsConsecutive(p, 'hidden'), true);
  /* Ember 的规则：4 个词、首词长度 ≤ 4 ⇒ 前两个词 highlighted（画面上 `Ten years`
     两个词一起变大变红，`teaching ballet` 留在下面那条轴上）。 */
  const words = ['Ten', 'years', 'teaching', 'ballet'];
  const wp = V.applyRules(p, words);
  assert.deepEqual(wp.map((w) => w.rankName),
    ['highlighted', 'highlighted', 'accessible', 'accessible']);
  assert.deepEqual(wp.slice(0, 2).map((w) => w.tags), [['hidden'], ['hidden']]);
  const runs = V.consecutiveRuns(p, wp);
  assert.deepEqual(runs.hidden.map((r) => r.words), [[0, 1]]);
  const lay = V.layoutOf(p, words, ruler, {fz: 20, boxW: 400, cur: 3, cueDur: 4, wins: WINS});
  const a = lay.words[0], b = lay.words[1];
  assert.deepEqual(a.gtags, ['hidden']);
  assert.deepEqual(b.gtags, ['hidden']);
  // run 里两个词共用 run 的窗口（首词起 0、末词止 2），不是各自的 [0,1] / [1,2]
  assert.deepEqual(a.gwin, [0, 2]);
  assert.deepEqual(b.gwin, [0, 2]);
  // 两个词都吃到了 hidden 的字体 / 颜色 / 倍率——非首词被吞掉的话这三条都会落回正文那一档
  const at = (i) => V.plan(p, lay, 3.5, {}).ops.filter((o) => o.kind === 'text')[i];
  const hot = V.plan(p, lay, 3.5, {}).ops.filter((o) => o.kind === 'text');
  const red = hot.filter((o) => o.fill === '#FF0503');
  assert.equal(red.length, 2, '两个高亮词都该是 highlightColor，实际 ' + hot.map((o) => o.text + ':' + o.fill));
  red.forEach((o) => assert.ok(/Rubik Spray Paint/.test(o.face.family), 'hidden 的 font 没落上'));
  assert.ok(a.face.sizePx > lay.fontPx * 1.5 && b.face.sizePx > lay.fontPx * 1.5,
    '两个词都该吃到 computedScale');
  assert.ok(at(0) !== undefined);
});

test('wordTracks：base 的那一档 ＋ 该词每个 tag 的那一档，按 tag 顺序', () => {
  const p = V.byKey('template-011-sub');       // base 有 word 动画、没有 tag
  assert.equal(V.wordTracks(p, 0, {tags: []}).entries.length, 1);
  const q = V.byKey('emphasisThree');          // base 一条 ＋ fadeIn / scaleIn 各一条
  assert.equal(V.wordTracks(q, 0, {tags: []}).entries.length, 1);
  assert.equal(V.wordTracks(q, 0, {tags: ['fadeIn', 'scaleIn']}).entries.length, 3);
  // 数据里挂着 customAnimations 里根本没有的标签（emphasisThree 的 fadeOut），取不到就是没有
  assert.equal(V.wordTracks(q, 0, {tags: ['fadeOut']}).entries.length, 1);
});

test('认得出但不做视觉的属性：hideBehindForeground 一律丢掉（裁决 5）', () => {
  const fake = {
    k: 'fake', paint: {color: '#FFFFFF', activeColor: '#FFFFFF'}, caps: {}, layout: {},
    rules: {rules: []},
    ir: {line: [], char: [], global: [], tags: {}, word: [{d: '', p: [
      {type: 'hideBehindForeground', value: 'injectedHiddenUuid'},
      {type: 'alpha', ch: {value: 0.5}}]}]},
  };
  const st = V.stateAt(V.layersOf(fake, 'word', []), 0);
  assert.equal(st.alpha, 0.5);
  assert.equal(st.box, null, 'hideBehindForeground 不该留下任何绘制状态');
  assert.deepEqual([st.sx, st.sy, st.tx, st.ty, st.rot, st.blur], [1, 1, 0, 0, 0, 0]);
});

/* ================= 三、缓动是精确的 Penner 函数 ================= */

test('ease01：闭式解，不是 cubic-bezier 近似（端点、中点、越界都钉住）', () => {
  const near3 = (g, w, m) => assert.ok(Math.abs(g - w) < 1e-9, m + ' 实际 ' + g + '，应为 ' + w);
  ['linear', 'quadOut', 'cubicIn', 'expoOut', 'backOut', 'elasticOut', 'bounceOut']
    .forEach((n) => { near3(V.ease01(n, 0), 0, n + '(0)'); near3(V.ease01(n, 1), 1, n + '(1)'); });
  near3(V.ease01('linear', 0.37), 0.37, 'linear');
  near3(V.ease01('quadIn', 0.5), 0.25, 'quadIn(.5)');
  near3(V.ease01('quadOut', 0.5), 0.75, 'quadOut(.5)');
  near3(V.ease01('cubicOut', 0.5), 0.875, 'cubicOut(.5)');
  near3(V.ease01('quartOut', 0.5), 0.9375, 'quartOut(.5)');
  near3(V.ease01('expoOut', 0.5), 1 - Math.pow(2, -5), 'expoOut(.5)');
  near3(V.ease01('sineOut', 0.5), Math.sin(Math.PI / 4), 'sineOut(.5)');
  // backOut 冲过 1 再回落——三次贝塞尔近似里这一格是压扁的
  assert.ok(V.ease01('backOut', 0.6) > 1, 'backOut 应该过冲');
  // elastic / bounce 一条三次贝塞尔装不下，上一轮它们落的是 quintOut 的曲线
  assert.notEqual(V.ease01('elasticOut', 0.4), V.ease01('quintOut', 0.4));
  assert.notEqual(V.ease01('bounceOut', 0.4), V.ease01('quintOut', 0.4));
  // 大小写不敏感（数据里有一处写成 `Linear`），别名 sinOut = sineOut
  near3(V.ease01('Linear', 0.4), 0.4, 'Linear');
  near3(V.ease01('sinOut', 0.3), V.ease01('sineOut', 0.3), 'sinOut 别名');
  // 阶跃：squareIn 整段停起点、squareOut 一开始就跳终点
  assert.equal(V.ease01('squareIn', 0.99), 0);
  assert.equal(V.ease01('squareOut', 0.01), 1);
  // 认不出的名字按 linear（认不出的东西一律丢而不抛）
  near3(V.ease01('nope', 0.42), 0.42, 'unknown');
});

/* ================= 四、排版 layoutOf ================= */

test('layoutOf：字号按 layout.size 折算，`lineTransform` 四种逐条', () => {
  // Slab 的 size .15 是基准 .04 的 3.75 倍 → 20px 基准落 75px
  assert.equal(lay4('emphasisFifteen', 0).fontPx, 75);
  assert.equal(V.captionFontPx('emphasisNine', 20), 12.5);
  // splitToWords：一词一行（Cascade / Quill / Wiggle）
  const casc = lay4('template-022-sub', 3, {boxW: 1200});
  assert.ok(casc.lines.every((L) => L.words.length === 1), '一词一行');
  /* `splitToWords` 那一路不吃 `maxLines`（Cascade 写着 2，画面上要叠到五六行），
     所以四个词四行都在；堆叠上限是原型自己的 5。 */
  assert.equal(casc.lines.length, 4);
  assert.deepEqual(casc.lines.map((L) => L.words[0]), [0, 1, 2, 3]);
  // 反过来 Memo 的 maxLines: 1 是实打实的一行（片里也是）
  assert.equal(lay4('template-027-sub', 3, {boxW: 200}).lines.length, 1);
  /* 一次一词是排版算出来的：Slab 的 `wrapWidth: 0.15` ＋ `maxLines: 1` ⇒ 一行一个词、
     堆叠窗口只留一行。没有任何地方按 `wordVisibility` 特判。 */
  assert.deepEqual(lay4('emphasisFifteen', 2).lines.map((L) => L.words), [[2]]);
  // 同样写着 transient 的 Terminal（wrapWidth .64、maxLines 无）就该逐词累积
  assert.ok(lay4('emphasisNine', 3, {boxW: 900}).lines[0].words.length > 1,
    'Terminal 该是一行放得下好几个词');
  // eachHighlightInOwnLine：强调词自己占一行
  const zen = lay4('emphasisThirteen', 1, {boxW: 2000});
  assert.ok(zen.lines.length >= 1);
  // greedyLineBreak：宽度不够就折（wrapWidth × 容器宽）。挑一份没有 maxLines 的
  // （Memo 的 maxLines 是 1，折出来几行都只显示一行——那是堆叠窗口，不是折行）
  const wide = lay4('emphasisEight', 3, {boxW: 3000});
  const narrow = lay4('emphasisEight', 3, {boxW: 200});
  assert.ok(narrow.lines.length > wide.lines.length, '容器变窄要多折几行');
  assert.equal(wide.lines.length, 1, '够宽就一行');
});

test('layoutOf：casing 与 highlightStyle 落到每个词的字面上', () => {
  // Slab 的 base 是 uppercase（涂装里的 upper）
  assert.deepEqual(lay4('emphasisFifteen', 0).words.map((w) => w.text)[0], 'THE');
  // Memo 的 base 是 lowercase
  assert.deepEqual(lay4('template-027-sub', 0).words.map((w) => w.text),
    ['the', 'quick', 'brown', 'foxes']);
  // Memo 的高亮词（最长的 quick / brown / foxes 里最先命中的那个）吃 variant{500, italic}
  const memo = lay4('template-027-sub', 0);
  const hi = memo.words.find((w) => w.tags.indexOf('highlightBox') >= 0);
  assert.ok(hi, '没有词命中 highlightBox');
  assert.equal(hi.face.italic, true, '高亮词要斜体');
  assert.equal(hi.face.weight, 500, '高亮词比正文（bold 700）细一档');
  memo.words.filter((w) => w !== hi).forEach((w) =>
    assert.equal(w.face.weight, 700, '正文是 paint.bold 的 700'));
});

test('layoutOf：computedScale 走真量宽，Slab 全条一个值、Zen One 逐词一个值', () => {
  /* Slab: 撑到 `wrapWidth(.15) × targetFillRatio(3) × 容器宽`，**没有上限**
     （数据写着 maxScale 1，可 `IS` 要比 `FIVE-MINUTE` 高一倍多，那不是「不许放大」）。
     全条一个值，按最宽的那个词算——IR 的原话是 “uniformly across all words in the cue”。 */
  const wide = lay4('emphasisFifteen', 0, {boxW: 4000});
  assert.ok(wide.computedScale > 1, '容器一宽就该撑上去，实际 ' + wide.computedScale);
  const widest = Math.max.apply(null, WORDS.map((w) => w.length));
  // 最宽的那个词撑到目标宽（0.45 × 容器宽），误差在四舍五入的三位小数内
  assert.ok(Math.abs(Math.max.apply(null, wide.words.map((x) => x.natW)) - 4000 * 0.45) < 4,
    '最宽的词该正好撑满目标宽：' + wide.words.map((x) => Math.round(x.natW)));
  assert.equal(wide.words.filter((x) => x.text.length === widest).length >= 1, true);
  assert.ok(lay4('emphasisFifteen', 0, {boxW: 100}).computedScale < 1, '窄容器要缩');
  // 一份不需要量宽的（Memo）不该产出 computedScale
  assert.equal(lay4('template-027-sub', 0).computedScale, undefined);
  // Zen One: minScale 1 / maxScale 2，`overwriteWithComputedScale` 顶掉规则给的 2
  const zen = lay4('emphasisThirteen', 1, {boxW: 600});
  const big = zen.words.find((w) => w.wp.overwriteWithComputedScale);
  if (big) assert.ok(big.face.sizePx >= zen.fontPx, '强调词不该比基准还小');
});

/* ================= 五、时间门控（plan 的核心语义） ================= */

test('门控：没到自己的窗口就没有指令，过了窗口停在末帧，静息拍不重播', () => {
  const k = 'template-027-sub';                 // persistent + 逐词淡入
  const WIDE = {boxW: 2000};                    // 一行放得下四个词（Memo 的 maxLines 是 1）
  const lay = lay4(k, 2, WIDE);
  // t 落在第 3 个词的窗口里（[2,3)）：第 4 个词一条指令都没有
  const at25 = textsAt(k, lay, 2.5).map((o) => o.text);
  assert.deepEqual(at25, ['the', 'quick', 'brown'], '第 4 个词提前出现了：' + at25);
  // 第 4 个词自己的窗口刚开时还在淡入（alpha < 1），窗口内才补满
  const lay3 = lay4(k, 3, WIDE);
  const fadeIn = textsAt(k, lay3, 3.02).find((o) => o.text === 'foxes');
  assert.ok(fadeIn && fadeIn.alpha < 0.9, '第 4 个词该在淡入，实际 ' + (fadeIn && fadeIn.alpha));
  assert.equal(textsAt(k, lay3, 3.9).find((o) => o.text === 'foxes').alpha, 1);
  // 静息拍（t 超过末窗）：全体停在末帧，不重播——CSS 那一路正是在这里栽的
  const rest = textsAt(k, lay4(k, 4, WIDE), 4.5);
  assert.equal(rest.length, 4);
  rest.forEach((o) => assert.equal(o.alpha, 1, o.text + ' 在静息拍上重播了入场'));
  // cue 还没开始（t < 0）：整行隐形
  assert.equal(textsAt(k, lay4(k, -1, WIDE), -0.4).length, 0, 'cue 未开始时整行该是隐形的');
});

test('门控：每帧都是纯函数——同一个 t 问两遍必须一模一样', () => {
  const lay = lay4('emphasisThirteen', 1);
  assert.deepEqual(opsAt('emphasisThirteen', lay, 1.4), opsAt('emphasisThirteen', lay, 1.4));
});

/* ================= 六、六份预设的可判定特征 ================= */

test('Memo：绿条从收没了扫到整词宽，扫完停驻；高度恒定（视频口径的块高下限）', () => {
  const k = 'template-027-sub';
  const lay = lay4(k, 3, {boxW: 2000});
  const hi = lay.words.find((w) => w.tags.indexOf('highlightBox') >= 0);
  const barAt = (t) => boxesAt(k, lay, t)[0];
  /* `highlightBox` 的 padding.x 从 −4em 扫到 0：起点宽度被收成 0，终点等于整个词宽。
     窗口是 progress −0.12 → 0.84，所以是**这个高亮词自己的**词窗上的那一段。 */
  const s0 = hi.win[0], span = hi.win[1] - hi.win[0];
  /* 扫入其实从词窗前 0.12 就起跳了，但**词还没淡入**，那一段一条指令都不发
     （文字 alpha 为 0 ⇒ 连它的块一起不画）——所以判据取词窗里的三个时刻。 */
  assert.equal(barAt(s0 - 0.05 * span), undefined, '词还没亮，块也不该画');
  const t0 = barAt(s0 + 0.2 * span), mid = barAt(s0 + 0.5 * span), t1 = barAt(s0 + 0.9 * span);
  assert.ok(t0.w < hi.natW * 0.3, '扫入起点该几乎收没了，实际 ' + t0.w + ' / ' + hi.natW);
  assert.ok(mid.w > t0.w && mid.w < t1.w, '中点该在两端之间：' + [t0.w, mid.w, t1.w]);
  assert.ok(Math.abs(t1.w - hi.natW) < 1, '扫完等于整个词宽：' + t1.w + ' vs ' + hi.natW);
  assert.deepEqual(barAt(hi.win[1] + 2).w, t1.w, '过了窗口要停驻，不能收回去');
  /* 块高：`padding.y` 恒在 −1.5em，按字面算是负的；预期那条绿条整个扫入过程
     恒定 2px @ fs≈14.5px = 0.14em。所以下限是一个定死的常量，且不随 padding 变。 */
  assert.equal(t0.h, t1.h, '扫入过程中高度不许变');
  assert.ok(Math.abs(t1.h - V.BOX_MIN_H_EM * hi.face.sizePx) < 1e-6,
    '块高该落在定死的下限上：' + t1.h);
  // 绿条在字底下：先块后字
  const ops = opsAt(k, lay, s0 + 0.9 * span);
  assert.ok(ops.findIndex((o) => o.kind === 'box') < ops.findIndex((o) => o.text === hi.text));
});

test('Template 003（Slab）：一次一词、全大写、撑幅折进字号、整条交给 exclusion', () => {
  const k = 'emphasisFifteen';
  const lay = lay4(k, 1, {boxW: 300});
  assert.equal(lay.lines.length, 1);
  const pl = V.plan(V.byKey(k), lay, 1.4, {});
  assert.equal(pl.ops.length, 1, '一次只画一个词');
  assert.equal(pl.ops[0].text, 'QUICK');
  assert.equal(pl.blend, 'exclusion', '反色是整条交给合成器的');
  // 撑幅是排版：容器变窄，字号跟着 computedScale 缩，绘制变形保持恒等
  const narrow = lay4(k, 1, {boxW: 100});
  assert.ok(narrow.words[1].face.sizePx < lay.words[1].face.sizePx, '窄容器该把字缩回去');
  assert.equal(V.plan(V.byKey(k), narrow, 1.4, {}).ops[0].tf.sx, 1, '撑幅不许再画一遍');
});

test('Terminal：逐字形簇错峰打字，光标块跟着最后一个字走', () => {
  const k = 'emphasisNine';
  const lay = lay4(k, 1);
  const w = lay.words[1];
  assert.ok(w.chars && w.chars.length === 5, 'quick 该拆成 5 个字形簇');
  // 每个簇的窗口是词窗的均分片，所以起点严格递增（＝错峰）
  w.chars.forEach((g, j) => {
    if (!j) return;
    assert.ok(g.win[0] > w.chars[j - 1].win[0], '第 ' + j + ' 个簇没有错峰');
  });
  /* 打到第三个字时，后面两个还没出现。Terminal 是逐词累积的（`wrapWidth: 0.64`
     放得下整行），所以前一个词整个留在画面上——判据取这个词自己那一段。 */
  const typed = textsAt(k, lay, w.chars[2].win[0] + 0.01)
    .map((o) => o.text).join('').slice(-3);
  assert.equal(typed, 'qui', '打字机进度不对：' + typed);
  // 光标块：每个已打出的簇各带一块，块的中心在这个簇右边一个 em（`position: [1, 0]`）
  const box = boxesAt(k, lay, w.chars[2].win[0] + 0.01).pop();
  const g = w.chars[2];
  assert.ok(box.x + box.w / 2 > g.x + g.w, '光标块该在字的右边，实际 ' + box.x);
});

test('Whisper：字符级 blur 从 1.2em 聚到 0，词级 scale 从 0 弹到 1', () => {
  const k = 'emphasisSix';
  const lay = lay4(k, 1);
  const w = lay.words[1];
  const fz = w.face.sizePx;
  const blurOf = (t) => {
    const o = textsAt(k, lay, t).find((x) => x.text === w.chars[0].g);
    return o ? o.blur : null;
  };
  // 词窗是 [1,2]，通道从 start−0.6 到 start+0.12 ⇒ 0.4 → 1.12 秒
  assert.ok(Math.abs(blurOf(0.45) - 1.2 * fz) < 0.35 * fz, '起手该是糊的，实际 ' + blurOf(0.45));
  assert.ok(blurOf(0.8) < blurOf(0.45), '要越来越清楚');
  assert.equal(blurOf(1.5), 0, '聚焦完必须是 0——漏一帧就等于一直糊着');
  // scale 0 → 1（词级），过窗停 1
  const sc = (t) => textsAt(k, lay, t).find((x) => x.text === w.chars[0].g).tf.sx;
  assert.ok(sc(0.5) < 1 && sc(0.5) > 0);
  assert.equal(sc(1.6), 1);
});

test('Cascade：一词一行堆叠 reveal，行内 spacing 随词龄展开', () => {
  const k = 'template-022-sub';
  const lay = lay4(k, 3, {boxW: 1200});
  /* 第 4 个词的窗口是 [3,4)，`wordFadeIn` 在 start−0.001 → start 之间跳满——
     所以 2.9 秒时前三行露着、第 4 行还没到（堆叠上限 5 行，四行全在窗口里）。 */
  assert.deepEqual(textsAt(k, lay, 2.9).map((o) => o.text), ['the', 'quick', 'brown'],
    '第 4 个词提前出现了');
  const on = textsAt(k, lay, 3.5);
  assert.deepEqual(on.map((o) => o.text), ['the', 'quick', 'brown', 'foxes']);
  // 行与行的基线不同（堆叠），后一行更靠下
  assert.ok(lay.lines[1].baseline > lay.lines[0].baseline);
  assert.ok(lay.lines[3].baseline > lay.lines[2].baseline);
  // 词级 spacing 通道 −0.06 → −0.09 em：越到词末尾字距越负
  const tr = (t) => textsAt(k, lay, t).find((o) => o.text === 'foxes').tracking;
  assert.ok(tr(3.9) < tr(3.1), '字距该随词龄收紧：' + [tr(3.1), tr(3.9)]);
});

test('Wiggle：位移走二维三次贝塞尔，八段首尾相接，末段回到原点', () => {
  const k = 'emphasisFour';
  /* 挑第 0 个词：中间的词还会吃 `left` / `right` 那两条固定偏移（±0.5em），
     首尾词只有 base 的 `creepy-0`，轨迹就是纯贝塞尔。 */
  const lay = lay4(k, 1, {boxW: 1200});
  const w = lay.words[0];
  const off = (t) => {
    const o = textsAt(k, lay, t).find((x) => x.text === w.text);
    return o ? [o.tf.tx / w.face.sizePx, o.tf.ty / w.face.sizePx] : null;
  };
  // 词窗 [0,1]，第一段 start+0 → start+0.0625：贝塞尔起点 [0,0]、终点 [−0.06, 0.02]
  const a = off(0), b = off(0.0625);
  assert.ok(Math.abs(a[0]) < 1e-6 && Math.abs(a[1]) < 1e-6, '起点该在原点：' + a);
  assert.ok(Math.abs(b[0] + 0.06) < 1e-3 && Math.abs(b[1] - 0.02) < 1e-3, '第一段终点：' + b);
  // 中途确实在动（不是一条直线）
  assert.notDeepEqual(off(0.03), off(0.05));
  // 第八段末尾回到 [0,0]，之后停驻
  const end = off(0.5), later = off(0.9);
  assert.ok(Math.abs(end[0]) < 1e-6 && Math.abs(end[1]) < 1e-6, '末段该回到原点：' + end);
  assert.deepEqual(later, end, '过了窗口要停驻');
  // Wiggle 没有 alpha 通道：整条 cue 一开始就全员在场
  assert.equal(textsAt(k, lay, 0.1).length, lay.lines.length);
});

/* ================= 七、静帧与视图接口 ================= */

test('stillT：reduced-motion 画的是当前词窗 35% 那一帧，认得出且不是首帧', () => {
  const k = 'emphasisSix';
  const lay = lay4(k, 1);
  assert.equal(V.stillT(lay, 1), 1 + V.SAMPLE_ON);
  assert.equal(V.stillT(lay), lay.cur + V.SAMPLE_ON);
  const still = textsAt(k, lay, V.stillT(lay, 1));
  assert.ok(still.length, '签名帧上得有东西');
  assert.notDeepEqual(still, textsAt(k, lay, 0), '签名帧要看得出在动');
});

test('plan：混合模式是**整条**交给合成器的一格，只有真声明了才出', () => {
  assert.equal(V.plan(V.byKey('emphasisFifteen'), lay4('emphasisFifteen', 0), 0.5, {}).blend,
    'exclusion');
  assert.equal(V.plan(V.byKey('emphasisFive'), lay4('emphasisFive', 1), 1.5, {}).blend,
    'difference', 'Fusion 的强调词是 difference');
  assert.equal(V.plan(V.byKey('template-027-sub'), lay4('template-027-sub', 1), 1.5, {}).blend,
    null, '没声明就是 null，不许凭空混合');
});

test('演示 rank 口径确定：最长的那个词 highlighted，并列取先；ignoreEmphasisEnabled 全员 accessible', () => {
  const p = V.byKey('emphasisThree');          // ignoreEmphasisEnabled = false
  assert.deepEqual(V.demoRanks(p, ['aa', 'bbbb', 'ccc']), [1, 6, 1]);
  assert.deepEqual(V.demoRanks(p, ['aaa', 'bbb']), [6, 1], '并列取先');
  assert.deepEqual(V.demoRanks(p, ['aa', 'bbbb', 'ccc']), V.demoRanks(p, ['aa', 'bbbb', 'ccc']));
  const q = V.byKey('emphasisSix');            // ignoreEmphasisEnabled = true
  assert.equal(q.caps.ignoreEmphasisEnabled, true);
  assert.deepEqual(V.demoRanks(q, ['aa', 'bbbb', 'ccc']), [1, 1, 1]);
});

test('视图要问的那几件事：档、拆字、词可见性', () => {
  assert.deepEqual(V.scopesOf('emphasisTwelve'), ['word', 'global']);
  assert.deepEqual(V.scopesOf('emphasisNine'), ['word', 'char', 'line']);
  assert.deepEqual(V.scopesOf('emphasisFour'), ['word']);
  const chars = V.PRESETS.filter((p) => V.needsChars(p.k)).map((p) => p.k);
  assert.deepEqual(chars, ['template-018-sub', 'template-011-sub', 'template-014-sub',
    'emphasisNine', 'emphasisSix']);
  assert.equal(V.wordVisibility('emphasisFifteen'), 'transient');
  assert.equal(V.wordVisibility('template-022-sub'), 'persistent');
});

test('目录卡从这里派生：id 就是 preset id，名字就是 label', () => {
  const cards = V.cards();
  assert.equal(cards.length, 25);
  assert.equal(cards[0].id, 'emphasisFifteen');
  assert.equal(cards[0].name, 'Template 003');
  cards.forEach((c) => {
    assert.equal(c.caption, c.id, 'caption 字段就是 preset id');
    assert.equal(c.cat, 'designed');
    assert.ok(V.byKey(c.id), c.id + ' 不在 PRESETS 里');
  });
});

/* ================= 八、第 72 轮那 8 份带进来的新机制 =================
   判据一律来自预设数据与预期画面，不来自名字。
   口径：**画面定视觉语法（分组、上下次序、字号差、入场轨迹），数据定选词。** */

test('hideBehindForeground 是哨兵：没有 matting 目标就整条 splice', () => {
  const p = V.byKey('emphasisSeven');            // Backdrop，`hidden` 里带一条哨兵
  assert.equal(V.HIDE_SENTINEL, 'injectedHiddenUuid');
  const prop = {type: 'hideBehindForeground', value: V.HIDE_SENTINEL};
  assert.equal(V.hideSpliced(prop, {}), true, '空列表 ⇒ splice');
  assert.equal(V.hideSpliced(prop, {hiddenUuids: []}), true);
  assert.equal(V.hideSpliced(prop, {hiddenUuids: ['a']}), false, '有目标就不 splice');
  assert.equal(V.hideSpliced({type: 'alpha'}, {}), false, '别的属性不归它管');
  // 原型恒走 splice 那一支：`hidden` 那一档解出来一条 `hide` 层都没有
  const off = V.layersOf(p, 'word', ['hidden'], {});
  assert.equal(off.filter((L) => L.target === 'hide').length, 0, '空列表下不该留层');
  assert.ok(off.filter((L) => L.target === 'color').length > 0,
    'splice 的是那一条 property，不是整个 entry——同一条 entry 里的色还要在');
  const on = V.layersOf(p, 'word', ['hidden'], {hiddenUuids: ['subject-1']});
  assert.deepEqual(on.filter((L) => L.target === 'hide').map((L) => L.ch.value),
    [['subject-1']], '有目标时那一层留下来（画不出遮挡，但语义在）');
  assert.equal(on.length, off.length + 1);
  /* Volt 的 `hideBg` 是一个**只装着哨兵**的标签，同时挂在高亮与非高亮两条规则上——
     原型里它因此什么都不发（`layersOf` 里剩下的那一条是 base 的淡入，不是它的）。 */
  const volt = V.byKey('template-020-sub');
  const base = V.layersOf(volt, 'word', [], {}).length;
  assert.equal(V.layersOf(volt, 'word', ['hideBg'], {}).length, base, 'hideBg 在原型里是空的');
  assert.equal(V.layersOf(volt, 'word', ['hideBg'], {hiddenUuids: ['x']}).length, base + 1);
});

test('splitByHighlight：连着的同类词成一行，高亮与非高亮之间一定断开', () => {
  const p = V.byKey('emphasisSeven');
  assert.equal(p.layout.lineTransform, 'splitByHighlight');
  const words = ['Ten', 'years', 'teaching', 'ballet'];
  const lay = V.layoutOf(p, words, ruler, {fz: 20, boxW: 4000, cur: 3, cueDur: 4, wins: WINS});
  // 容器给得足够宽，折行不会插手——分行完全由 splitByHighlight 决定
  assert.deepEqual(lay.lines.map((L) => L.words.map((i) => lay.words[i].wp.wordText)),
    [['Ten', 'years'], ['teaching', 'ballet']]);
  assert.deepEqual(lay.lines.map((L) => L.hot), [true, false]);
  /* `maxLines` 在这一路不当堆叠上限用：Volt 写着 1，画面上却要
     小字一行 ＋ 大字一行两组都在。 */
  const volt = V.byKey('template-020-sub');
  assert.equal(volt.layout.maxLines, 1);
  const vl = V.layoutOf(volt, words, ruler, {fz: 20, boxW: 4000, cur: 3, cueDur: 4, wins: WINS});
  assert.equal(vl.lines.length, 2, 'maxLines 1 把高亮那一组夹没了');
});

test('Volt 取的是**尾部**的词（relativeTo: totalWords ＋ 负 value），其余六份取头部', () => {
  const words = ['Ten', 'years', 'teaching', 'ballet'];
  const tail = V.applyRules(V.byKey('template-020-sub'), words).map((w) => w.rankName);
  /* 首词 `Ten` 长度 3 ≤ 4 ⇒ `wordIndex gte totalWords−2`，取**末尾两个**；
     其余六份同样的条件取的是 `wordIndex lte 1`（开头两个）。 */
  assert.deepEqual(tail, ['accessible', 'accessible', 'highlighted', 'highlighted'],
    'Volt 该高亮末尾那两个词');
  // 首词长度 > 4 时 Volt 只取最后一个（`eq totalWords−1`）
  assert.deepEqual(V.applyRules(V.byKey('template-020-sub'),
    ['Beyond', 'years', 'teaching', 'ballet']).map((w) => w.rankName),
  ['accessible', 'accessible', 'accessible', 'highlighted']);
  const head = V.applyRules(V.byKey('emphasisSeven'), words).map((w) => w.rankName);
  assert.deepEqual(head, ['highlighted', 'highlighted', 'accessible', 'accessible']);
  // Volt 的高亮词还要转全大写（`letterCasing: "uppercase"` 落在规则的 apply 上）
  const vl = V.layoutOf(V.byKey('template-020-sub'), words, ruler,
    {fz: 20, boxW: 4000, cur: 3, cueDur: 4, wins: WINS});
  assert.equal(vl.words[3].text, 'BALLET');
  assert.equal(vl.words[0].text, 'Ten', '正文那几个词不动大小写');
});

test('深度排版：两组两条轴，Volt 的正文组在高亮组**上面**（responsiveAxes 覆盖 axes）', () => {
  const p = V.byKey('emphasisSeven');
  // presetIR.axes 写的是 ±0.3，responsiveAxes 的 landscape 也是 ±0.3
  assert.deepEqual(V.depthAxes(p), {hotY: 0.3, bodyY: -0.3, hotAxis: 'top', bodyAxis: 'bottom',
    hotAlign: 'upperBound', bodyAlign: 'lowerBound'});
  // Volt：axes 写 ±0.3，responsiveAxes.landscape 写 0.35 / 0.39 —— 覆盖生效，且顺序反过来
  const volt = V.byKey('template-020-sub');
  assert.deepEqual(volt.ir.axes.top.pos, [0, 0.3]);
  assert.deepEqual(volt.layout.responsiveAxes.top.landscape, [0, 0.35]);
  const va = V.depthAxes(volt);
  assert.equal(va.hotY, 0.35);
  assert.equal(va.bodyY, 0.39, 'responsiveAxes 没覆盖上去');
  // Blaze 的两条轴同名（都是 top）⇒ 不分组，照常堆叠
  assert.equal(V.depthAxes(V.byKey('template-029-sub')), null);
  assert.equal(V.depthAxes(V.byKey('template-027-sub')), null, 'Memo 没有 lineAnnotation');

  const words = ['Ten', 'years', 'teaching', 'ballet'];
  const opts = {fz: 20, boxW: 400, cur: 3, cueDur: 4, wins: WINS};
  const back = V.layoutOf(p, words, ruler, opts);
  assert.equal(back.depth.bodyFirst, false, 'Backdrop：高亮在上、正文在下');
  assert.ok(back.lines[0].hot && !back.lines[1].hot);
  const vl = V.layoutOf(volt, words, ruler, opts);
  assert.equal(vl.depth.bodyFirst, true, 'Volt：正文在上、高亮在下');
  assert.equal(vl.lines[0].hot, false);
  assert.equal(vl.lines[1].hot, true);
  // 空档被夹到 DEPTH_GAP_EM；真值留在 rawGapEm 里（Backdrop 按字面是 (0.3+0.3)/0.072 em 量级）
  assert.equal(back.depth.gapEm, V.DEPTH_GAP_EM);
  assert.ok(back.depth.rawGapEm > V.DEPTH_GAP_EM, '真空档该比夹完的大得多');
  assert.equal(vl.depth.gapEm, vl.depth.rawGapEm, 'Volt 的 0.95em 夹不到，原样留着');
  assert.ok(vl.depth.gapEm < 1);
});

test('Ember 的 maxScale 30 / targetFillRatio 0.95 照数据夹，Slab 的 1 仍当没写', () => {
  const em = V.byKey('emphasisSixteen');
  assert.deepEqual(em.layout.sizeParams, {minScale: 0.1, maxScale: 30, targetFillRatio: 0.95});
  const words = ['A', 'years', 'teaching', 'ballet'];       // 首词极短 ⇒ 倍率会顶到上限
  const items = words.map((w, i) => ({natW: i === 0 ? 0.2 : 60, gap: 0,
    wp: {rank: i < 2 ? 6 : 1}}));
  const groups = V.scaleGroups(em, items, [[0, 1], [2, 3]]);
  assert.deepEqual(groups, [[0, 1]], 'splitByHighlight：连着的高亮段是一组');
  const s = V.measureScales(em, items, groups, 400);
  // 目标宽 = 400 × wrapWidth(0.85) × 0.95 = 323；组宽 60.2 ⇒ 5.36，没到 30
  assert.ok(s[0] > 5 && s[0] < 6, '实际 ' + s[0]);
  // 组宽压到极小时才顶到 30
  const tiny = V.measureScales(em, [{natW: 1, gap: 0, wp: {rank: 6}}], [[0]], 400);
  assert.equal(tiny[0], 30, '上限该是数据里的 30');
  // Slab 写的 maxScale 1 与预期画面矛盾 ⇒ 按无上限走
  const slab = V.byKey('emphasisFifteen');
  assert.equal(slab.layout.sizeParams.maxScale, 1);
  const big = V.measureScales(slab, [{natW: 1, gap: 0, wp: {rank: 6}}], [[0]], 400);
  assert.ok(big[0] > 100, 'Slab 的撑幅不许被 maxScale 1 压掉，实际 ' + big[0]);
});

test('Blaze：逐行倍率 ＋ greedyLineBreak ＋ wordPop / softShadow / scaleUp', () => {
  const p = V.byKey('template-029-sub');
  assert.equal(p.layout.perWordSizeAlgorithm, 'calculatePerLineHighlightScales');
  assert.deepEqual(p.layout.perWordSizeParams, {minScale: 0.1, maxScale: 5, targetFillRatio: 0.4});
  /* description 说自己用 newlineOnHighlight，**数据里是 greedyLineBreak**——
     又一处「描述是旧的，数据是真的」。 */
  assert.equal(p.layout.lineTransform, 'greedyLineBreak');
  assert.ok(/newlineOnHighlight/.test(p.note));
  /* 规则：首词不参选（`wordIndex gte 1`），首词长度 > 4 ⇒ 接着的两个词入选。
     预期画面：`Marketing` 小字、`TEAMS` `LOSE` 大字、`weeks` 小字。 */
  const words = ['Marketing', 'teams', 'lose', 'weeks'];
  const wp = V.applyRules(p, words);
  assert.deepEqual(wp.map((w) => w.rankName),
    ['accessible', 'highlighted', 'highlighted', 'accessible']);
  assert.deepEqual(wp[0].tags, ['softShadow', 'wordPop']);
  assert.deepEqual(wp[1].tags, ['scaleUp', 'highlightBounce', 'softShadow']);
  assert.equal(V.groupsConsecutive(p, 'scaleUp'), true);
  // 逐行那一档：一行里的高亮词是一组，一组一个值
  const items = [{natW: 40, gap: 2, wp: {rank: 1}}, {natW: 30, gap: 2, wp: {rank: 6}},
    {natW: 30, gap: 2, wp: {rank: 6}}, {natW: 40, gap: 2, wp: {rank: 1}}];
  const groups = V.scaleGroups(p, items, [[0, 1], [2, 3]]);
  assert.deepEqual(groups, [[1], [2]], '按行取本行的高亮词');
  const s = V.measureScales(p, items, groups, 500);
  /* 目标宽 = 500 × wrapWidth(0.53) ＝ 265，**不乘 targetFillRatio**：那一格只有
     `calculateHighlightedTextScale` 读（判据见 `measureScales` 上面那段——Blaze 的
     `TEAMS` 按基准字号量出来就已经比 0.4 的目标宽还宽一倍多，乘上去那个词会被缩小）。
     每组 30 宽 ⇒ 8.83，再被 maxScale 5 夹住。 */
  assert.equal(s[1], 5, '该被 maxScale 5 夹住，实际 ' + s[1]);
  assert.equal(s[0], 1);
  assert.equal(s[3], 1);
  // 两行不同宽时逐行取不同值（这正是「逐行」与「整条一个值」的差别）
  const items3 = [{natW: 40, gap: 2, wp: {rank: 1}}, {natW: 80, gap: 2, wp: {rank: 6}},
    {natW: 160, gap: 2, wp: {rank: 6}}, {natW: 40, gap: 2, wp: {rank: 1}}];
  const s2 = V.measureScales(p, items3, V.scaleGroups(p, items3, [[0, 1], [2, 3]]), 500);
  assert.ok(s2[1] > s2[2], '窄的那一行该撑得更大');
  assert.ok(Math.abs(s2[1] - 3.313) < 0.01, '实际 ' + s2[1]);
});

test('defaultHighlightStyles 是模板给 highlightStyle 的兜底（只有 Ember 有一条）', () => {
  const withDhs = V.PRESETS.filter((p) => p.dhs);
  assert.deepEqual(withDhs.map((p) => p.k), ['emphasisSixteen']);
  assert.deepEqual(withDhs[0].dhs, {font: 'Rubik Spray Paint'});
  /* preset 自己的 `highlightStyle` 赢——而它写的正好是同一个字体，
     所以这一格今天**没有可观察效果**，实现它是因为它是原件的一部分。 */
  assert.equal(V.highlightStyleOf(withDhs[0]).font, 'Rubik Spray Paint');
  assert.equal(withDhs[0].highlight.font, 'Rubik Spray Paint');
  // 兜底只补空位：preset 没写那一格时才轮到它
  const fake = {dhs: {font: 'A', color: '#111111'}, highlight: {font: 'B'}};
  assert.deepEqual(V.highlightStyleOf(fake), {font: 'B', color: '#111111'});
  assert.equal(V.highlightStyleOf({dhs: null, highlight: {font: 'B'}}).font, 'B');
});

test('fadeInWithLine：行那一档也吃逐词规则给的标签（Backdrop+ / Blaze）', () => {
  const p = V.byKey('emphasisTen');
  assert.ok(V.scopesOf('emphasisTen').indexOf('line') >= 0);
  const words = ['Ten', 'years', 'teaching', 'ballet'];
  const wp = V.applyRules(p, words);
  assert.ok(wp[2].tags.indexOf('fadeInWithLine') >= 0, '非高亮词才带 fadeInWithLine');
  assert.equal(wp[0].tags.indexOf('fadeInWithLine'), -1, '高亮词不带');
  const lay = V.layoutOf(p, words, ruler, {fz: 20, boxW: 2000, cur: 3, cueDur: 4, wins: WINS});
  const body = lay.lines.find((L) => !L.hot);
  const w0 = lay.words[body.words[0]];
  // 正文那一行刚起的时候整行 alpha 还没满（expoOut，从行首词前 0.08s 起）
  const early = V.plan(p, lay, w0.win[0] + 0.02, {}).ops
    .filter((o) => o.kind === 'text' && body.words.indexOf(lay.words.findIndex(
      (x) => x.text === o.text)) >= 0);
  const late = V.plan(p, lay, w0.win[0] + 1.5, {}).ops.filter((o) => o.kind === 'text');
  assert.ok(early.length === 0 || early[0].alpha < 1, '行淡入没生效');
  assert.ok(late.some((o) => o.alpha > 0.99), '过了窗口该满');
});
