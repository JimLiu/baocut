/* model-elements.js —— 对着定下来的目录数与核心 preset 把目录钉住。
   这些数不是随手写的：形状网格 24 格里 23 格归形状、arrow 是不出格的
   端点形状，声波 10（第 232 轮自有配方），进度 14（网格次序 / 枚举次序，
   都不含落成文字元素的 countdown / countup——那两格第 88 轮起在「计时」自成一组，
   见 docs/design/elements/bcut-counter-element-design.md），动画 13/13/10。 */
const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-textpresets.js');   // newText 读它的预设与动画目录
require('./model-shape-paths.js');   // model-elements.js 的形状几何（生成物）
require('./model-elements.js');
require('./model-waveicons.js');      // 声波缩略图（10 枚示意图，geometry.py 生成）
require('./model-progicons.js');     // 进度缩略图（14 枚内联 SVG）
require('./model-counticons.js');    // 计时缩略图（2 枚内联 SVG）
const E = window.BC_EL;
const WI = window.BC_WAVEICON;
const PI = window.BC_PROGICON;
const CI = window.BC_CNTICON;
const TP = window.BC_TP;
const SD = window.BC_SHAPE;

test('形状网格是 24 格；形状组 23 格（arrow 不出格），rect 占两格', () => {
  assert.strictEqual(E.SHAPE_TILES.length, 24);
  assert.strictEqual(E.SHAPES.length, 23);
  assert.ok(!E.SHAPES.some((s) => s.k === 'arrow'), 'arrow 不该留在形状组');
  assert.strictEqual(E.SHAPES.filter((s) => s.k === 'rect').length, 2);
  assert.strictEqual(E.SHAPES[0].r, 0);
  assert.strictEqual(E.SHAPES[1].r, 10);
});

/* 批注整类退场之后 `line` / `arrow` 两款端点形状都不出格（与 `bcut-editor-core`
   的 `ENDPOINT_SHAPES` 同解）：网格照旧 24 格占位，唯一名只剩形状组那 23 个。 */
test('唯一形状名是核心 24 个 id 减去两款端点形状', () => {
  // 23 格里 `rect` 占两格（直角 / 圆角），所以唯一名是 22 个
  assert.strictEqual(E.shapeNames().length, 22);
  assert.ok(E.shapeNames().indexOf('arrow') < 0);
  assert.ok(E.shapeNames().indexOf('line') < 0);
});

test('每一格形状都有可画的路径', () => {
  E.SHAPES.forEach((s) => assert.ok(/^M[-\d.]/.test(s.path), s.k + ' 没有路径'));
});

test('形状几何整份来自核心的生成表，原型不留第二份', () => {
  // 20 条 outline 由 gen_element_shape_paths.rs 从 core/presets/builtin/shape/*.json
  // 发出来（`model-shape-paths.js`），另外三份孪生在 apps/baocut、apps/mac、
  // designs/baocut-mac。第 39 轮那份手描的删了：同一个 id 在原型与在 App、Mac 上
  // 画出来必须是同一个东西。
  assert.strictEqual(SD.IDS.length, 20);
  E.SHAPES.forEach((s) => {
    if (s.k === 'rect' || s.k === 'ellipse') return;   // 参数化，不进生成表
    assert.strictEqual(s.path, SD.d(s.k), s.k + ' 的路径不是核心那一条');
  });
  // 反过来：生成表里的每一条都摆在网格上
  SD.IDS.forEach((id) => assert.ok(E.SHAPES.some((s) => s.k === id), id + ' 没进网格'));
});

test('显示名照画面取，不照 id——那几个名不副实的格子', () => {
  // core/presets/builtin/shape/*.json 里有几个 id 与画出来的图形对不上。
  // id 保持不变，名字跟画面走，
  // 与 apps/mac 的 ElementCatalogue（Block Arrow / Cross / Plus / Speech Bubble…）对齐。
  assert.strictEqual(E.SHAPE_NAMES.squig2, '块状箭头');
  assert.strictEqual(E.SHAPE_NAMES.squig, '波浪边圆');
  assert.strictEqual(E.SHAPE_NAMES.tick2, '叉');
  assert.strictEqual(E.SHAPE_NAMES.cross, '加号');
  assert.strictEqual(E.SHAPE_NAMES.cross2, '圆角加号');
  assert.strictEqual(E.SHAPE_NAMES.chevron2, '锯齿带');
  assert.strictEqual(E.SHAPE_NAMES.sharp2, '对话气泡');
  // 每一格都有名字，且没有两格重名——重名的话下拉里认不出是哪一个
  const names = E.shapeNames().map((k) => E.SHAPE_NAMES[k]);
  names.forEach((n, i) => assert.ok(n, E.shapeNames()[i] + ' 没有显示名'));
  assert.strictEqual(new Set(names).size, names.length, '有两格重名');
});

test('配色按 5 色循环，第 5 格回到蓝而不是绿；格子的颜色是格子的属性', () => {
  assert.strictEqual(E.shapeColor(0).fill, E.PALETTE.red.fill);
  assert.strictEqual(E.shapeColor(4).fill, E.PALETTE.blue.fill);
  assert.strictEqual(E.shapeColor(5).fill, E.shapeColor(0).fill);
  // 同一个 rect 占两格，两格的颜色不同——颜色跟下标走，不跟形状走
  assert.notStrictEqual(E.SHAPES[0].fill, E.SHAPES[1].fill);
  E.SHAPES.forEach((s) => assert.notStrictEqual(s.fill, s.outline, s.k));
});

test('调色板是七色 × BASE/LIGHTER/DARKER', () => {
  assert.strictEqual(E.PALETTE.yellow.fill, '#FFD646');
  assert.strictEqual(E.PALETTE.blue.outline, '#3598DF');
  assert.strictEqual(E.PALETTE.purple.outline, '#8A5BD8');
  assert.strictEqual(E.PALETTE.red.lighter, '#FFC9C7');
  assert.ok(E.PALETTE.pink, '粉色档不能少，进度条 border 的默认主色就是它');
});

test('声波 10 款；Spectrum Area / Dots / Pulse Rings / Ribbons 是双色；示波器两款无 dB 控件', () => {
  assert.strictEqual(E.WAVES.length, 10);
  const by = (k) => E.WAVES.filter((w) => w.k === k)[0];
  ['spectrum_area', 'dots', 'pulse_rings', 'ribbons'].forEach((k) => assert.strictEqual(by(k).colors, 2, k));
  ['bars', 'bars_rounded', 'bars_bottom', 'ring_bars', 'oscilloscope', 'ring_wave']
    .forEach((k) => assert.strictEqual(by(k).colors, 1, k));
  assert.strictEqual(by('oscilloscope').db, false);
  assert.strictEqual(by('ring_wave').db, false);
  assert.strictEqual(by('bars').db, true);
  // 色板标题来自核心 `colorLabels`（Bars / Fill / Line / Dots / Peaks…），不是猜的
  assert.deepStrictEqual(by('pulse_rings').labels, ['核心', '环']);
  assert.deepStrictEqual(by('ribbons').labels, ['丝带 A', '丝带 B']);
  // 旧款名不再是目录成员（核心经别名表兼容旧文档，原型只认新 id）
  ['trio_wave', 'simi', 'formation', 'beam', 'ripple_wave'].forEach((k) => assert.strictEqual(by(k), undefined, k));
});

test('声波的默认主色与 dB 来自核心配方', () => {
  const by = (k) => E.WAVES.filter((w) => w.k === k)[0];
  assert.strictEqual(by('ring_bars').main, '#FFAC46');
  assert.strictEqual(by('ribbons').second, '#A477DA');
  assert.strictEqual(by('oscilloscope').minDb, -120);
  assert.strictEqual(by('oscilloscope').maxDb, -10);
  assert.strictEqual(by('bars').minDb, -80);
});

test('10 款声波逐款有一枚示意图，宽件 156×52、方形族 70×70', () => {
  const keys = E.WAVES.map((w) => w.k).sort();
  assert.deepStrictEqual(Object.keys(WI.ICONS).sort(), keys,
    '声波目录与 model-waveicons.js 对不上');
  E.WAVES.forEach((w) => {
    const art = WI.ICONS[w.k];
    assert.ok(art.c.length > 0, w.k + ' 没有任何图元');
    assert.strictEqual(art.vb, w.aspect === 'square' ? '0 0 70 70' : '0 0 156 52', w.k);
  });
});

test('缩略图着色全部走 CSS 变量；双色四款才引用副色变量', () => {
  const paint = (k) => JSON.stringify(WI.ICONS[k]);
  E.WAVES.forEach((w) => {
    assert.ok(paint(w.k).indexOf('var(--color-main)') >= 0, w.k + ' 没有引用主色变量');
    assert.strictEqual(paint(w.k).indexOf('var(--color-secondary)') >= 0, w.colors === 2,
      w.k + ' 副色变量与 colors 对不上');
  });
});

test('进度：枚举与网格都是 14，两个次序不同；countdown / countup 两处都不收', () => {
  assert.strictEqual(E.PROGRESS.length, 14);
  assert.strictEqual(E.PROG_TILES.length, 14);
  assert.strictEqual(E.PROGRESS[0].k, 'normal');       // 下拉第一项是 Rectangle
  assert.strictEqual(E.PROG_TILES[0].k, 'rounded');    // 网格第一格是圆角条
  assert.ok(E.PROGRESS.map((p) => p.k).join() !== E.PROG_TILES.map((p) => p.k).join(),
    '两个次序被合成了一个');
  ['countdown', 'countup'].forEach((k) => {
    assert.strictEqual(E.progOf(k), null, k + ' 落成的是文字元素，不该在进度目录里');
  });
});

test('14 款进度逐款有一枚缩略图，条是 232×8、方形族 80×80', () => {
  assert.deepStrictEqual(Object.keys(PI.ICONS).sort(), E.PROGRESS.map((p) => p.k).sort(),
    '进度目录与 model-progicons.js 对不上');
  E.PROGRESS.forEach((p) => {
    const art = PI.ICONS[p.k];
    assert.ok(art.c.length > 0, p.k + ' 没有任何图元');
    // strobe_border 是唯一的 88×88：描边宽 7 要留出笔画的一半
    const want = p.aspect === 'bar' ? '0 0 232 8'
      : p.k === 'strobe_border' ? '0 0 88 88' : '0 0 80 80';
    assert.strictEqual(art.vb, want, p.k);
  });
});

test('进度色板编制分四类而不是一类', () => {
  const spec = (k) => [E.progOf(k).colors, E.progOf(k).labels];
  assert.deepStrictEqual(spec('normal'), [2, ['条', '底']]);
  assert.deepStrictEqual(spec('border'), [2, ['条', '背景']]);
  assert.deepStrictEqual(spec('strobe_border'), [2, ['颜色 1', '颜色 2']]);
  assert.deepStrictEqual(spec('snake'), [2, ['前景', '背景']]);
  // 彩虹那两条整段颜色不出，游走彩虹只出一张且落在主色上
  assert.deepStrictEqual(spec('rainbow_border'), [0, []]);
  assert.deepStrictEqual(spec('reverse_rainbow_border'), [0, []]);
  assert.deepStrictEqual(spec('snake_rainbow'), [1, ['背景']]);
  assert.deepStrictEqual(spec('snake_spin_rainbow'), [1, ['背景']]);
  E.PROGRESS.forEach((p) => assert.strictEqual(p.labels.length, p.colors, p.k));
  // 网格里横跨两列的正是 bar 那两款（`square` 为假）
  assert.deepStrictEqual(E.PROGRESS.filter((p) => !p.square).map((p) => p.k),
    ['normal', 'rounded']);
});

/* ---------- 计时（第 88 轮，docs/design/elements/bcut-counter-element-design.md） ---------- */

test('计时是两款，缩略图是两枚 80×80 内联 SVG；它不在进度目录里', () => {
  assert.deepStrictEqual(E.COUNTERS.map((c) => c.k), ['countdown', 'countup']);
  assert.deepStrictEqual(Object.keys(CI.ICONS).sort(), ['countdown', 'countup']);
  E.COUNTERS.forEach((c) => {
    const art = CI.ICONS[c.k];
    assert.strictEqual(art.vb, '0 0 80 80', c.k);
    assert.ok(art.c.length > 0, c.k + ' 没有任何图元');
  });
  // 计时缩略图不吃颜色变量：那两个色是写死的
  const flat = JSON.stringify(CI.ICONS);
  assert.strictEqual(flat.indexOf('--color-main'), -1, '计时缩略图不该有颜色变量');
  // 两族分开：计时既不进进度枚举，也不进进度网格
  E.COUNTERS.forEach((c) => assert.strictEqual(E.progOf(c.k), null, c.k));
  assert.ok(!E.PROG_TILES.some((p) => p.fam === 'count'));
});

test('钟面三档只改写法，不改换值节奏', () => {
  assert.deepStrictEqual(E.COUNT_FORMATS.map((f) => f.k), ['s', 'mm:ss', 'hh:mm:ss']);
  assert.strictEqual(E.counterFormat(10, 's'), '10');
  assert.strictEqual(E.counterFormat(10, 'mm:ss'), '00:10');
  assert.strictEqual(E.counterFormat(10, 'hh:mm:ss'), '00:00:10');
  assert.strictEqual(E.counterFormat(3661, 'hh:mm:ss'), '01:01:01');
  // `mm:ss` 不进位到小时：选了这一档就不该突然冒出小时段（设计稿 §3）
  assert.strictEqual(E.counterFormat(6000, 'mm:ss'), '100:00');
});

test('§3.1 的规范算例：24.12 起、10s 的倒计时逐窗显示 10…1', () => {
  const [s0, s1] = [24.12, 34.12];
  const at = (t) => E.counterText('countdown', 's', t, s0, s1);
  assert.strictEqual(at(24.12), '10');
  assert.strictEqual(at(25.11), '10');
  // 换值锚在 end：end − k 那一刻正好跳到 k。**浮点残差在这里最毒**——
  // 34.12 − 25.12 在 IEEE 754 下是 9.000000000000004，直接 ceil 会多显示一秒
  assert.strictEqual(at(25.12), '9');
  assert.strictEqual(at(33.12), '1');
  assert.strictEqual(at(34.11), '1', '倒计时不显示 0');
  assert.strictEqual(at(34.12), null, '半开区间：t = end 起不再渲染');
  assert.strictEqual(at(24.11), null);
  // 同窗口的正计时依次 0…9
  assert.strictEqual(E.counterText('countup', 's', s0, s0, s1), '0');
  assert.strictEqual(E.counterText('countup', 's', 33.12, s0, s1), '9');
  assert.strictEqual(E.counterText('countup', 's', 34.11, s0, s1), '9', '正计时不显示总长');
  // 钟面只换写法
  assert.strictEqual(E.counterText('countdown', 'mm:ss', s0, s0, s1), '00:10');
});

test('时长不是整秒时，零头落在锚定的那一端', () => {
  // 10.5s 的倒计时：首窗 [0, 0.5) 显示 11，其后整秒窗 10…1
  const down = (t) => E.counterText('countdown', 's', t, 0, 10.5);
  assert.strictEqual(down(0), '11');
  assert.strictEqual(down(0.49), '11');
  assert.strictEqual(down(0.5), '10');
  assert.strictEqual(down(9.5), '1');
  assert.strictEqual(down(10.49), '1');
  // 同一条的正计时：末窗 [10, 10.5) 显示 10
  const up = (t) => E.counterText('countup', 's', t, 0, 10.5);
  assert.strictEqual(up(0), '0');
  assert.strictEqual(up(9.99), '9');
  assert.strictEqual(up(10), '10');
  assert.strictEqual(up(10.49), '10');
});

test('下一次换值可预告；末窗之后没有下一次', () => {
  assert.strictEqual(E.counterNextChange('countdown', 0, 0, 10), 1);
  assert.strictEqual(E.counterNextChange('countup', 0, 0, 10), 1);
  assert.strictEqual(E.counterNextChange('countdown', 9.5, 0, 10), null, '末窗之后元素就消失了');
  assert.strictEqual(E.counterNextChange('countup', 9.5, 0, 10), null);
  assert.strictEqual(E.counterNextChange('countdown', 20, 0, 10), null, '窗外没有下一次');
  // 非整秒：倒计时头一格短（0.5s），正计时最后一格短
  assert.strictEqual(E.counterNextChange('countdown', 0, 0, 10.5), 0.5);
  assert.strictEqual(E.counterNextChange('countup', 0, 0, 10.5), 1);
  assert.strictEqual(E.counterNextChange('countup', 10.2, 0, 10.5), null);
});

test('新建一条计时默认 10 秒，撞到片尾就裁到片尾', () => {
  assert.strictEqual(E.COUNT_SPAN, 10, '默认时长不走通用的 NEW_SPAN（5s）');
  // 片尾还宽裕：整整 10 秒
  assert.deepStrictEqual(E.counterSpan(0, 206), {start: 0, end: 10});
  assert.deepStrictEqual(E.counterSpan(12.4, 206), {start: 12.4, end: 22.4});
  // 片尾只剩 6 秒：那就是一条 6 秒的计时——**起点不往前挪**，元素要留在播放头上
  assert.deepStrictEqual(E.counterSpan(200, 206), {start: 200, end: 206});
  // 只剩不到 MIN_SPAN：允许越过片尾保住最短一段（与 spanAt 其余调用点同一条）
  assert.deepStrictEqual(E.counterSpan(205.9, 206), {start: 205.9, end: 206.4});
  // 时长跟着裁，读数也跟着裁：6 秒的倒计时从 6 数起，不是从 10
  const sp = E.counterSpan(200, 206);
  assert.strictEqual(E.counterText('countdown', 's', sp.start, sp.start, sp.end), '6');
  // 而默认那一档正是设计稿 §3.1 规范算例的时长：起手第一格就是 10
  const full = E.counterSpan(24.12, 206);
  assert.strictEqual(E.counterText('countdown', 's', full.start, full.start, full.end), '10');
});

test('计时有文字那一批字符样式，但走自己的画布键', () => {
  assert.deepStrictEqual(E.toStage('counter', {mode: 'countup', format: 'mm:ss'}),
    {cntMode: 'countup', cntFmt: 'mm:ss'});
  // 字体 / 字号 / 颜色 / 加粗 / 斜体 / 对齐——与 Text 面板同一批控件
  assert.deepStrictEqual(E.toStage('counter',
    {font: 'Inter', size: 96, color: '#FFFFFF', bold: true, italic: false, align: 'right'}),
    {cntFont: 'Inter', cntSize: 96, cntColor: '#FFFFFF', cntBold: true, cntItalic: false,
     cntAlign: 'right'});
  assert.deepStrictEqual(E.fromStage('counter', {cntMode: 'countdown', cntSize: 72}),
    {mode: 'countdown', size: 72});
  /* 键名必须与文字那一条**逐个错开**：计时读画布共用袋、文字元素逐元素持有样式，
     共用一个键会让改一次计时把画面上还没设过色的文字一起染了。 */
  Object.keys(E.SHARED.counter).forEach((k) => {
    assert.notStrictEqual(E.SHARED.counter[k], E.SHARED.text[k],
      k + ' 与文字共用了同一个画布键');
  });
});

test('进度的默认主副色来自核心配方（边框类的副色是全透明）', () => {
  const by = (k) => E.progOf(k);
  assert.strictEqual(by('rounded').main, '#3CADFF');
  assert.strictEqual(by('rounded').second, '#C4E6FF');
  assert.strictEqual(by('border').main, E.PALETTE.pink.fill);
  assert.strictEqual(by('border').second, E.TRANSPARENT);
});

test('Loop 一律无方向，每一档的第一格恒是「无」', () => {
  E.ANIMS.loop.forEach((a) => assert.strictEqual(a.dirs, null, a.k));
  ['in', 'out', 'loop'].forEach((slot) => assert.strictEqual(E.ANIMS[slot][0].k, 'none', slot));
});

test('方向被展开进后端枚举值，不是独立字段', () => {
  assert.strictEqual(E.animEnum('in', 'slide', 'up'), 'inSlideUp');
  assert.strictEqual(E.animEnum('out', 'gentleFloat', 'down'), 'outGentleFloatDown');
  assert.strictEqual(E.animEnum('in', 'spin', 'cw'), 'inSpinRight');
  assert.strictEqual(E.animEnum('in', 'spin', 'ccw'), 'inSpinLeft');
  assert.strictEqual(E.animEnum('in', 'fade', 'up'), 'inFade', '不支持方向的动画不该拼方向');
  assert.strictEqual(E.animEnum('loop', 'none'), 'none');
});

test('动画摘要按 In · Out · Loop 顺序拼，全无时给一句话', () => {
  assert.strictEqual(E.animSummary({in: {k: 'none'}, out: {k: 'none'}, loop: {k: 'none'}}), '未设置');
  assert.strictEqual(E.animSummary({in: {k: 'fade'}, out: {k: 'none'}, loop: {k: 'sway'}}), '淡入 · 摇摆');
});

test('归一化坐标与百分比互转', () => {
  assert.strictEqual(E.pct(0.5), 50);
  assert.strictEqual(E.pct(0.084375), 8.4);
  assert.strictEqual(E.unpct(15), 0.15);
});

test('两款项目模板的目录选择写入同一份画布样式状态', () => {
  assert.deepStrictEqual(E.toStage('tpl', {templateId: 't2'}), {templateId: 't2'});
  assert.deepStrictEqual(E.fromStage('tpl', {templateId: 't1'}), {templateId: 't1'});
});

test('层级四个动作有边界', () => {
  assert.strictEqual(E.zAction(3, 'front', 9), 9);
  assert.strictEqual(E.zAction(3, 'back', 9), 0);
  assert.strictEqual(E.zAction(9, 'up', 9), 9);
  assert.strictEqual(E.zAction(0, 'down', 9), 0);
});

test('锁比时另一边跟随，不锁时只改一边', () => {
  const box = {w: 40, h: 20};
  assert.deepStrictEqual(E.resize(box, 'w', 60, true), {w: 60, h: 30});
  assert.deepStrictEqual(E.resize(box, 'h', 40, true), {w: 80, h: 40});
  assert.deepStrictEqual(E.resize(box, 'w', 60, false), {w: 60, h: 20});
});

test('画布与属性页经同一张对照表换算，不各存一份', () => {
  const RED = E.PALETTE.red.fill, ORANGE = E.PALETTE.orange.fill, GREEN = E.PALETTE.green.fill;
  assert.deepStrictEqual(E.toStage('shape', {fill: RED, outlineW: 3}), {fill: RED, borderW: 3});
  assert.deepStrictEqual(E.toStage('wave', {style: 'oscilloscope', main: ORANGE}),
    {waveStyle: 'oscilloscope', waveColor: ORANGE});
  assert.deepStrictEqual(E.toStage('shape', {tStart: 4, w: 40}), {}, '几何与时间只归属性页，不进画布样式袋');
  assert.deepStrictEqual(E.toStage('sticker', {anim: {in: {k: 'fade'}}}), {},
    'anim 是逐元素的，不进画布共用样式袋');
  assert.deepStrictEqual(E.fromStage('progress', {progStyle: 'donut', progColor: GREEN, rot: 12}),
    {style: 'donut', main: GREEN});
  assert.deepStrictEqual(E.fromStage('tpl', {fill: RED}), {}, '没有对照的类型不带任何键回去');
});

test('文字的字符样式八项全在对照表里（第 42 轮：文字面板与画布同源）', () => {
  // 面板上改的每一项都要能落到画布样式袋——漏一项就是「面板动了画布不动」
  const patch = {font: '思源黑体', size: 52, color: 'var(--gray-25)', bold: false, italic: true,
                 align: 'left', lineHeight: 1.6, letterSpacing: 4};
  assert.deepStrictEqual(E.toStage('text', patch), patch, '文字这一条是恒等映射，键名两边同名');
  assert.deepStrictEqual(E.fromStage('text', Object.assign({rot: 12, opacity: 50}, patch)), patch,
    '回来的只有字符样式，几何与时间不跟着走');
  assert.deepStrictEqual(E.toStage('text', {tStart: 3, width: 420, stylePreset: 'a1'}), {},
    '起止走 elDocs、容器宽走 pose、Styles 预设只归面板，三者都不进共用样式袋');
});

/* 矢量贴纸的填充色分组与换色第 122 轮整段搬到 `model-svgfill.js`，
   覆盖在 `model-svgfill.test.js`——这里原来那两条随 `E.fillsOf` /
   `E.recolor` 一起撤掉，同一件事不留两份判据。 */

test('新元素落在播放头上，默认 5 秒', () => {
  const s = E.spanAt(12.4, 206);
  assert.strictEqual(s.start, 12.4);
  assert.strictEqual(s.end, 17.4);
});

test('撞到片尾裁到片尾，起点不动（与核心 textpreset::instantiate 同口径）', () => {
  const s = E.spanAt(204, 206);
  assert.strictEqual(s.start, 204, '起点恒等于播放头——挪走就不在用户放的地方了');
  assert.strictEqual(s.end, 206);
});

test('贴着片尾点也留得下最短一档（核心的 film_end.max(start + MIN_SPAN)）', () => {
  const s = E.spanAt(206, 206);
  assert.strictEqual(s.start, 206);
  assert.strictEqual(s.end, 206.5);
});

test('片长比默认时长还短时裁到片尾', () => {
  const s = E.spanAt(2, 3);
  assert.strictEqual(s.start, 2);
  assert.strictEqual(s.end, 3);
});

test('空白项目开放式片尾：新元素保留完整默认长度、起点恒等于播放头', () => {
  const s = E.spanAt(12.4, Infinity);
  assert.strictEqual(s.start, 12.4);
  assert.strictEqual(s.end, 17.4);
  const tail = E.spanAt(30, Infinity, 8);
  assert.deepStrictEqual(tail, {start: 30, end: 38}, '内容末端之后照样落完整长度，时长随之延长');
});

test('播放头在 0 或负数上都从 0 起', () => {
  assert.strictEqual(E.spanAt(0, 206).start, 0);
  assert.strictEqual(E.spanAt(-5, 206).start, 0);
  assert.strictEqual(E.spanAt(undefined, 206).start, 0);
});

test('单元素预设落成一条文字元素，文字与样式都从预设来', () => {
  const p = TP.get('simple.01');                    // 目录第一格：Roboto 粗体「标题」
  const e = E.newText(p, {playT: 30, total: 206, seq: 2});
  assert.strictEqual(e.kind, 'text');
  assert.strictEqual(e.id, 'e-txt-2');
  assert.strictEqual(e.text, p.els[0].t);
  assert.strictEqual(e.style.color, p.els[0].color, '色值原样带过来，不在这一层解释');
  assert.strictEqual(e.style.bold, true);
  assert.strictEqual(e.style.size, p.els[0].size);
  assert.strictEqual(e.style.font, 'Roboto');
  assert.strictEqual(e.start, 30);
  assert.strictEqual(e.end, 35, '时长取预设自己的 dur');
  assert.ok(e.added, '要标出「用户造的」——演示那十二条删不掉，这些能删');
});

test('组的起点恒等于播放头，成员的延迟从那里往后数', () => {
  const p = TP.get('lowerThird.01');                // 三件：色块 + 职位 + 姓名
  const e = E.newText(p, {playT: 42, total: 206, seq: 1});
  assert.strictEqual(e.kind, 'textgroup');
  assert.strictEqual(e.start, 42, '播放头就是落点');
  assert.strictEqual(e.end, 45.97, '时长取预设的 3.97s');
  assert.deepStrictEqual(e.members.map((m) => m.delay), p.els.map((x) => x.d || 0),
    '错峰是预设设计的一部分，不按固定步长重排');
});

test('成员带着自己的落位与动画落地（场景式预设不压成一列）', () => {
  const e = E.newText(TP.get('lowerThird.03'), {playT: 10, total: 206, seq: 1});
  assert.ok(e.box && e.box.w > 0, '组要有包围盒，画布靠它把成员摆回原位');
  e.members.forEach((m) => {
    assert.ok(m.place && m.place.x != null, m.id + ' 缺落位');
    assert.ok(m.anim && m.anim.in && m.anim.out, m.id + ' 缺动画');
  });
  assert.strictEqual(e.members[2].kind, 'shape', '形状件也是成员，不是被丢掉的那一类');
});

test('没有预设（添加文本框）也能造出一条，带占位文字', () => {
  const e = E.newText(null, {playT: 5, total: 206, seq: 1});
  assert.strictEqual(e.kind, 'text');
  assert.ok(e.text.length > 0);
  assert.strictEqual(e.preset, null);
});

test('多元素预设落成文本组：成员数对得上，id 不撞', () => {
  const p = TP.get('title.01');
  const e = E.newText(p, {playT: 30, total: 206, seq: 4});
  assert.strictEqual(e.kind, 'textgroup');
  assert.strictEqual(e.members.length, p.els.length);
  assert.strictEqual(e.members[0].text, p.els[0].t);
  assert.strictEqual(new Set(e.members.map((m) => m.id)).size, p.els.length, '成员 id 不能撞');
  assert.strictEqual(e.members[0].name, '标题', '字号最大的那条是标题');
});

test('两次新建的 id 不撞（序号由调用方递进）', () => {
  const a = E.newText(null, {playT: 1, total: 206, seq: 1});
  const b = E.newText(null, {playT: 2, total: 206, seq: 2});
  assert.notStrictEqual(a.id, b.id);
});

test('时间轴块上写的是文字内容，太长截断', () => {
  assert.strictEqual(E.textLabel('本地优先'), '本地优先');
  assert.strictEqual(E.textLabel('一二三四五六七八九十一二三', 5), '一二三四五…');
  assert.strictEqual(E.textLabel('  换  行 ', 20), '换 行');
  assert.strictEqual(E.textLabel(''), '文字');
});

test('连着新建的几块字依次往下错开，不互相盖住（四档一循环）', () => {
  const ys = [1, 2, 3, 4, 5].map((seq) => E.newText(null, {playT: 10, total: 206, seq}).place.y);
  assert.deepStrictEqual(ys, [50, 57, 64, 71, 50]);
  ys.forEach((y) => assert.ok(y > 0 && y < 100, '错开之后仍在画面里'));
});

/* ---------- 文本组的成员投影（第 58.1 轮） ---------- */

test('成员的文字与样式从同一张文档表里取（成员 id 是唯一的）', () => {
  const el = {id: 'g1', members: [{id: 'm1', text: '原文', delay: 0}, {id: 'm2', text: '副标', delay: 0.13}]};
  const out = E.projectMembers(el, {m1: {text: '改过的'}, m2: {style: {bold: true}}});
  assert.strictEqual(out[0].text, '改过的');
  assert.strictEqual(out[0].delay, 0, '没被覆盖的字段原样留着');
  assert.strictEqual(out[1].text, '副标');
  assert.strictEqual(out[1].style.bold, true);
});

test('删过成员的组，成员表以组自己那条文档为准', () => {
  const el = {id: 'g1', members: [{id: 'm1', text: 'a'}, {id: 'm2', text: 'b'}]};
  const out = E.projectMembers(el, {g1: {members: [{id: 'm2', text: 'b'}]}});
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'm2');
});

test('不是组的元素没有成员表', () => {
  assert.strictEqual(E.projectMembers({id: 'e1'}, {}), null);
});

test('dropMember 只拿掉那一条', () => {
  const list = [{id: 'm1'}, {id: 'm2'}, {id: 'm3'}];
  assert.deepStrictEqual(E.dropMember(list, 'm2').map((m) => m.id), ['m1', 'm3']);
  assert.strictEqual(E.dropMember(list, 'nope').length, 3);
  assert.strictEqual(E.dropMember(null, 'm1').length, 0);
});

/* ---------- 画面调整（第 58.2 轮） ---------- */

test('两组九项：颜色校正五项、效果四项', () => {
  assert.deepStrictEqual(E.FX_COLOR.map((f) => f.k), ['bright', 'contrast', 'exposure', 'hue', 'saturate']);
  assert.deepStrictEqual(E.FX_EFFECT.map((f) => f.k), ['sharpen', 'noise', 'blur', 'vignette']);
  E.FX_COLOR.forEach((f) => assert.strictEqual(f.min, -100, f.k + ' 是双向的'));
  E.FX_EFFECT.forEach((f) => assert.strictEqual(f.min, 0, f.k + ' 只有单向'));
});

test('恒等的调整不产出 filter（与核心 effects.rs 同口径）', () => {
  assert.strictEqual(E.fxCss(null), null);
  assert.strictEqual(E.fxCss(E.FX0), null);
  assert.ok(E.fxIdentity({}));
  assert.ok(!E.fxIdentity({hue: 1}));
});

test('六项走 CSS filter，各自的换算固定', () => {
  assert.strictEqual(E.fxCss({bright: 100}), 'brightness(2)');
  assert.strictEqual(E.fxCss({contrast: -50}), 'contrast(0.5)');
  assert.strictEqual(E.fxCss({saturate: 100}), 'saturate(2)');
  assert.strictEqual(E.fxCss({hue: 100}), 'hue-rotate(180deg)');
  assert.strictEqual(E.fxCss({blur: 50}), 'blur(10px)');
  assert.strictEqual(E.fxCss({gray: 100}), 'grayscale(1)');
});

test('曝光比亮度缓：同一个数字给出的 brightness 更小', () => {
  assert.strictEqual(E.fxCss({exposure: 100}), 'brightness(1.667)');
  assert.notStrictEqual(E.fxCss({exposure: 60}), E.fxCss({bright: 60}));
});

test('锐化量化成四档，对着四份预声明的 SVG 滤镜', () => {
  assert.strictEqual(E.sharpStep(0), 0);
  assert.strictEqual(E.sharpStep(1), 1);
  assert.strictEqual(E.sharpStep(100), E.SHARP_STEPS);
  assert.strictEqual(E.fxCss({sharpen: 100}), 'url(#bcfx-sharp4)');
});

test('噪点与暗角是盖上去的一层，不进 filter', () => {
  assert.strictEqual(E.fxCss({noise: 50, vignette: 50}), null, 'CSS 没有这两个原语');
  const ls = E.fxLayers({noise: 50, vignette: 50});
  assert.deepStrictEqual(ls.map((l) => l.k), ['vignette', 'noise']);
  assert.strictEqual(E.fxLayers(null).length, 0);
  ls.forEach((l) => assert.ok(l.opacity > 0 && l.opacity <= 1));
});

test('多项叠加的顺序固定（同一份值只会得到同一个字符串）', () => {
  const a = E.fxCss({bright: 20, blur: 10, saturate: 50});
  const b = E.fxCss({saturate: 50, blur: 10, bright: 20});
  assert.strictEqual(a, b);
});

test('核心今天认得的只有三项，其余是建议扩展项', () => {
  assert.deepStrictEqual(Object.keys(E.FX_CORE).sort(), ['blur', 'bright', 'gray']);
  const ext = E.FX_COLOR.concat(E.FX_EFFECT).filter((f) => !E.FX_CORE[f.k]).map((f) => f.k);
  assert.deepStrictEqual(ext, ['contrast', 'exposure', 'hue', 'saturate', 'sharpen', 'noise', 'vignette']);
});

/* ---------- 动画目录（第 58.2 轮补 Ken Burns 与 Zoom 槽） ---------- */

test('In / Out 各 13 格（都有 Ken Burns）、Loop 10 格', () => {
  assert.strictEqual(E.ANIMS.in.length, 13);
  assert.strictEqual(E.ANIMS.out.length, 13);
  assert.strictEqual(E.ANIMS.loop.length, 10);
  ['in', 'out'].forEach((slot) => {
    assert.ok(E.ANIMS[slot].some((a) => a.k === 'kenBurns'), slot + ' 少了 Ken Burns');
  });
});

test('Zoom 是第四个槽：四档深度，可以叠好几段', () => {
  assert.deepStrictEqual(E.ZOOMS.map((z) => z.k), ['none', 'shallow', 'moderate', 'deep']);
  assert.strictEqual(E.ZOOM_SCALE.none, 1);
  assert.ok(E.ZOOM_SCALE.deep > E.ZOOM_SCALE.moderate);
  const one = E.addZoom(null);
  assert.strictEqual(one.length, 1);
  const two = E.addZoom(one);
  assert.strictEqual(two.length, 2);
  assert.strictEqual(two[1].speed, one[0].speed, '新段沿用上一段的速度');
});

test('图片的共用键覆盖圆角四角、不透明度与九项调整', () => {
  const keys = Object.keys(E.SHARED.image);
  ['opacity', 'radius', 'radiusTL', 'radiusLock', 'bright', 'contrast', 'exposure', 'hue',
   'saturate', 'sharpen', 'noise', 'blur', 'vignette'].forEach((k) => assert.ok(keys.indexOf(k) >= 0, k));
});


test('视频的共用键 = 图片那一批 ＋ 音量 / 变速 / 淡入淡出', () => {
  const keys = Object.keys(E.SHARED.video);
  Object.keys(E.SHARED.image).forEach((k) => assert.ok(keys.indexOf(k) >= 0, '缺了 ' + k));
  ['vol', 'rate', 'fadeOn', 'fadeIn', 'fadeOut'].forEach((k) => assert.ok(keys.indexOf(k) >= 0, k));
});

test('覆盖层的不透明度不与贴纸 / 视频抢同一个键', () => {
  assert.strictEqual(E.SHARED.overlay.opacity, 'ovlOpacity');
  assert.strictEqual(E.SHARED.sticker.opacity, 'opacity');
  assert.strictEqual(E.SHARED.video.opacity, 'opacity');
});

test('滤镜与效果：两张单选表，第一格都是「无」', () => {
  assert.strictEqual(E.FILTERS[0].k, 'none');
  assert.strictEqual(E.EFFECTS[0].k, 'none');
  assert.strictEqual(E.presetCss(E.FILTERS[0]), null, '「无」不产出任何 filter');
  assert.strictEqual(E.presetCss(E.EFFECTS[0]), null);
  // 词表分组：Calm / Clean / Cottage / Peckham 各三档
  ['calm', 'clean', 'cottage', 'peckham'].forEach((fam) => {
    assert.strictEqual(E.FILTERS.filter((f) => f.k.indexOf(fam) === 0).length, 3, fam);
  });
});

test('效果的强度是真的：0 = 不加，1 = 满，中间线性插值', () => {
  const inv = E.effectOf('invert');
  assert.strictEqual(E.presetCss(inv, 0), null);
  assert.strictEqual(E.presetCss(inv, 1), 'invert(1)');
  assert.strictEqual(E.presetCss(inv, 0.5), 'invert(0.5)');
  // 越界夹住，不产出 invert(2)
  assert.strictEqual(E.presetCss(inv, 9), 'invert(1)');
});

test('滤镜 / 效果排在手动九项之前：先定色调再微调', () => {
  const css = E.fxCss({filter: 'clean1', effect: 'invert', effectI: 1, bright: 20});
  assert.ok(css.indexOf('invert(1)') < css.indexOf('brightness(1.2)'), '手动调整在后');
  assert.ok(css.indexOf('contrast(1.08)') < css.indexOf('invert(1)'), '调色在效果之前');
  // 都没挂时与此前一致：只剩手动那几项
  assert.strictEqual(E.fxCss({bright: 20}), 'brightness(1.2)');
  assert.strictEqual(E.hasStack({}), false);
  assert.strictEqual(E.hasStack({effect: 'old'}), true);
});

test('变速档位就是弹层上那四颗 chip，其余算 Custom', () => {
  assert.deepStrictEqual(E.SPEEDS, [0.5, 1, 1.5, 2]);
  assert.ok(E.isPresetSpeed(1.5));
  assert.ok(!E.isPresetSpeed(1.25));
  assert.ok(E.SPEED_MIN < 0.5 && E.SPEED_MAX > 2);
});

/* ---------- 对齐词表（第 89.1 轮收成一处） ---------- */

test('对齐三档是一张共用表，键名就是 CSS 的 text-align', () => {
  assert.deepStrictEqual(E.ALIGNS.map((a) => a.k), ['left', 'center', 'right']);
  // 计时的默认档是居中——画布默认值与这张表对得上
  assert.ok(E.ALIGNS.some((a) => a.k === 'center'));
});

/* 第 89.2 轮：三档摆的是 S2 的 `TextAlign*` 原件，不是汉字。 */
test('对齐三档是纯图标段，每一档都带名字', () => {
  assert.deepStrictEqual(E.ALIGNS.map((a) => a.icon),
    ['align-left', 'align-center', 'align-right']);
  E.ALIGNS.forEach((a) => {
    assert.ok(!a.label, '纯图标段不再摆汉字');
    // `tip` 同时是 aria-label 与悬停提示：没有它这一格在屏幕上没有名字
    assert.ok(a.tip, a.k + ' 缺 tip');
  });
});
