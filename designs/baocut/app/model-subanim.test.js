/* node --test designs/baocut/app/model-subanim.test.js
   这一份钉的是**动效数据换算有没有走样**。判据分三层：

     1. 数据：17 条、顺序固定、关键帧逐个数对得上。这一层里我写死了几组
        原始数值——它们就是判据本身，改数据时这几条必须跟着一起看。
     2. 换算：关键帧 → CSS 的每一条规则各钉一例（位移是身位百分比、缓动逐帧、
        块的 alpha 不能落到 opacity 上……）。
     3. 一致性：签名帧与真运动**从同一条轨采样**，所以两者不可能分叉——这是前三轮
        接连读错之后加的那道闸门。 */
const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-subanim.js');
require('./model-shape-paths.js');
require('./model-elements.js');
require('./model-textpresets.js');
require('./model-substyle.js');
require('./model-wordanim.js');
require('./model-subpresets.js');
require('./model-motioncaption.js');   // data.js 的动效字幕那一区派生自它
require('./model-template.js');
require('./model-cut.js');   // data.js 的剪口建议派生自它（第 192 轮）
require('./model-defaultsub.js'); // data.js 的画廊第一区（默认样式那张卡）
require('./data.js');
const A = window.BC_SA;
const D = window.BC_DATA;

/* ---------- 数据：17 条 ---------- */

test('字幕动效目录那 17 条，顺序固定', () => {
  const catalog = A.ANIMS.filter((a) => !a.local).map((a) => a.k);
  assert.deepEqual(catalog, ['none', 'boxHighlight', 'flipClock', 'highlight', 'karaoke', 'impact',
    'reveal', 'floatInTop', 'floatInBottom', 'scaleIn', 'dropIn', 'impactPop', 'colourHighlight',
    'rotateFlipClock', 'rotateHighlight', 'stack', 'stomp']);
  // `rotateZigZag` 不在目录里
  assert.equal(A.byKey('rotateZigZag'), null);
});

test('过了版本表与组合表——读到的不能是被顶替掉的那条', () => {
  // 版本表：colourHighlight→V3、boxHighlight→V2、karaoke→V2
  assert.equal(A.tracksOf('karaoke')[0].kf, 'karaokeV2');
  assert.equal(A.tracksOf('colourHighlight')[0].kf, 'colourHighlightV3');
  assert.equal(A.tracksOf('boxHighlight')[0].kf, 'boxHighlightV2');
  // 组合表：floatIn* 是两条轨叠起来，rotateHighlight 一条整行一条逐词
  assert.deepEqual(A.tracksOf('floatInTop').map((t) => t.kf),
    ['composedFloatIn_col', 'composedFloatIn_top']);
  assert.deepEqual(A.tracksOf('rotateHighlight').map((t) => t.group), ['block', 'word']);
});

test('dropIn 的关键帧逐个数对得上', () => {
  // {0, y:-.1, scale 1.5, a:0, expoOut} → {.8, y:0, scale 1, a:1, expoOut}
  const kf = A.tracksOf('dropIn')[0].keyframes;
  assert.equal(kf.length, 2);
  assert.deepEqual(kf[0], {time: 0, translate: {x: 0, y: -0.1}, scale: {x: 1.5, y: 1.5},
    colour: {r: 1, g: 1, b: 1, a: 0}, easing: 'expoOut'});
  assert.equal(kf[1].time, 0.8);
  assert.equal(kf[1].scale.x, 1);
});

test('karaoke 只有一条透明度曲线，且拿不到颜色参数', () => {
  // 颜色参数只给 colourHighlight（字色）与 boxHighlight / bgHighlight（块色）配参数
  assert.equal(A.colourParamOf('karaoke'), null);
  assert.equal(A.colourParamOf('colourHighlight'), 'textColour');
  assert.equal(A.colourParamOf('boxHighlight'), 'boxColour');
  assert.equal(A.colourParamOf('stack'), 'boxColour');
  const kf = A.tracksOf('karaoke')[0].keyframes;
  assert.deepEqual(kf.map((k) => k.colour.a), [0.5, 1, 1]);
  kf.forEach((k) => assert.ok(!k.box, '卡拉OK 不垫块'));
});

test('group 与 blockTiming 是两件事，两个字段都留着', () => {
  assert.equal(A.tracksOf('flipClock')[0].group, 'block');
  assert.equal(A.byKey('flipClock').blockTiming, true);
  // stack（bgHighlight）是逐词的，但不带整行计时
  assert.equal(A.tracksOf('stack')[0].group, 'word');
  assert.ok(!A.byKey('stack').blockTiming);
});

/* ---------- 换算：关键帧 → CSS ---------- */

test('位移是**元素自己身位**的倍数，不是 em', () => {
  // slideRight 的 x:-1 = 挪走一整个身位，所以落 %
  assert.equal(A.transformOf({translate: {x: 0, y: -0.2}}), 'translate(0%, -20%)');
  assert.equal(A.transformOf({scale: {x: 1.5, y: 1.5}}), 'scale(1.5, 1.5)');
  // 纯 z 轴不加透视——那是平面内的倾斜，加了反而变形
  assert.equal(A.transformOf({rotation: {x: 0, y: 0, z: 9}}), 'rotateZ(9deg)');
  assert.ok(/^perspective/.test(A.transformOf({rotation: {x: -90, y: 0, z: 0}})));
  // 三样都没有就不写 transform：写 none 会把上一帧顶掉
  assert.equal(A.transformOf({colour: {a: 1}}), null);
});

test('块是一个能双向缩放的盒子，alpha 与 scale 各占一个自定义属性', () => {
  /* 落到 `opacity` 上会把字一起淡掉；落到外扩阴影的**厚度**上则装不下 `box.scale`
     ——Phantom 的胀缩就是这么丢的（第 67 轮）。 */
  const css = A.boxOf({box: {colour: {a: 0.75}, scale: {x: 0.9, y: 0.9}, cornerRounding: 0.5}});
  assert.equal(css.opacity, undefined, '块的 alpha 不能落到词的 opacity 上');
  assert.equal(css['--wa-box-a'], '0.75');
  assert.equal(css['--wa-box-s'], '0.9');
  assert.equal(css['--wa-box-r'], '0.5em', 'cornerRounding 是占字号的倍数（与 cornerRadius 同一把尺）');
  assert.equal(A.boxOf({box: {colour: {a: 1}, cornerRounding: 0.2}})['--wa-box-r'], '0.2em');
});

test('Phantom 的那下胀缩：块 .9 → 1.1 → 1，取帧与 CSS 两边都在', () => {
  const kf = A.tracksOf('boxHighlight')[0].keyframes;
  assert.deepEqual(kf.map((k) => k.box.scale.x), [0.9, 1.1, 1], 'boxHighlightV2 的原始三帧');
  const css = A.trackCss(A.tracksOf('boxHighlight')[0]);
  assert.match(css, /0% \{[^}]*--wa-box-s: 0\.9/);
  assert.match(css, /70% \{[^}]*--wa-box-s: 1\.1/);
  assert.match(css, /100% \{[^}]*--wa-box-s: 1;/);
  // 签名帧也得在这条曲线上（`tween` 按数插块，不整帧取起始那一份）
  const on = A.frame('boxHighlight', 1, 1, true);
  assert.ok(+on['--wa-box-s'] > 0.9 && +on['--wa-box-s'] <= 1.1, '静帧要落在胀缩途中');
  assert.equal(on['--wa-box-a'], '0.875');
});

test('缓动逐帧落在那一段上，square* 是阶跃', () => {
  const css = A.trackCss(A.tracksOf('dropIn')[0]);
  assert.match(css, /@keyframes va-dropIn/);
  assert.match(css, /0% \{[^}]*animation-timing-function: cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  assert.match(css, /\n {2}80% \{/, '关键帧停在它自己的 time 上，不折算成「有效时长」');
  assert.equal(A.EASING.squareIn, 'steps(1, end)');
  assert.equal(A.EASING.squareOut, 'steps(1, start)');
});

test('同一条轨被两条动效共用时只生成一次', () => {
  // colourHighlight 既是它自己，也是 rotateHighlight 的一半
  const css = A.keyframesCss();
  assert.equal(css.split('@keyframes va-colourHighlight ').length - 1, 1);
  assert.match(css, /@keyframes va-randomRotate/);
});

test('时长就是一个词的窗口，组合的两条轨逗号并列', () => {
  assert.equal(A.motion('dropIn', 620, 'word'), 'va-dropIn 620ms linear both');
  assert.equal(A.motion('floatInTop', 620, 'word'),
    'va-composedFloatIn_col 620ms linear both, va-composedFloatIn_top 620ms linear both');
  // 整行那一档只出整行的轨，逐词那一档只出逐词的
  assert.equal(A.motion('flipClock', 620, 'word'), null);
  assert.match(A.motion('flipClock', 620, 'block'), /^va-flipClock/);
  assert.match(A.motion('rotateHighlight', 620, 'block'), /^va-randomRotate/);
});

/* ---------- 一致性：签名帧从同一条轨上采样 ---------- */

test('签名帧就是这条轨上的一帧——两者不可能分叉', () => {
  A.ANIMS.forEach((a) => {
    a.tracks.filter((t) => t.group === 'word').forEach((track) => {
      // 「还没轮到」取首帧、「念过」取末帧，逐字段与轨对得上
      const first = A.styleOf(A.sampleAt(track, 0));
      const last = A.styleOf(A.sampleAt(track, 1));
      const before = A.frame(a.k, 2, 1), after = A.frame(a.k, 0, 1);
      if (track.keyframes[0].box) return;        // 块只画在当前词上（trackActiveElement）
      Object.keys(first).forEach((p) => assert.equal(before[p], first[p], a.k + ' 的首帧 ' + p));
      Object.keys(last).forEach((p) => assert.equal(after[p], last[p], a.k + ' 的末帧 ' + p));
    });
  });
});

test('卡拉OK：念过留在满色、还没念到半透明，没有块也不换色', () => {
  assert.deepEqual(A.frame('karaoke', 2, 1), {opacity: '0.5'});
  assert.deepEqual(A.frame('karaoke', 1, 1), {opacity: '1'});
  assert.deepEqual(A.frame('karaoke', 0, 1), {opacity: '1'});
});

test('荧光笔与卡拉OK 的差别在念过的词上', () => {
  // highlight 的末帧回到 a: .5，karaokeV2 停在 a: 1
  assert.equal(A.frame('highlight', 0, 1).opacity, '0.5');
  assert.equal(A.frame('karaoke', 0, 1).opacity, '1');
  // 静帧（reduced motion）下当前词取 35% 那一帧，两条都是满的
  assert.equal(A.frame('highlight', 1, 1, true).opacity, '1');
  assert.equal(A.frame('karaoke', 1, 1, true).opacity, '1');
});

test('内联是「歇在哪儿」，轨是「怎么过去的」——两者不写同一个时刻', () => {
  /* 会动的时候当前词内联取**末帧**：轨一跑完内联就该与它重合，否则每个词末尾闪一下。
     `highlight` 的末帧本来就回到 a: .5（念完暗回去），所以这里 .5 是对的，不是漏了。 */
  assert.equal(A.frame('highlight', 1, 1).opacity, '0.5');
  assert.equal(A.frame('impact', 1, 1).opacity, '0');
  // 静帧那一档才取中途，因为那一格得看得出是哪一种
  assert.equal(A.frame('impact', 1, 1, true).opacity, '1');
  assert.notDeepEqual(A.frame('dropIn', 1, 1), A.frame('dropIn', 1, 1, true));
});

test('冲击：一次只剩一个词——念过的也收走', () => {
  assert.equal(A.frame('impact', 0, 1).opacity, '0');
  assert.equal(A.frame('impact', 2, 1).opacity, '0');
  assert.equal(A.frame('impact', 1, 1, true).opacity, '1');
  // 逐词显形相反：念过的留着
  assert.equal(A.frame('reveal', 0, 1).opacity, '1');
});

test('块只画在当前词上——trackActiveElement 就是这个意思', () => {
  ['boxHighlight', 'stack'].forEach((k) => {
    assert.deepEqual(A.frame(k, 2, 1), {}, k + ' 不该给还没轮到的词垫块');
    assert.deepEqual(A.frame(k, 0, 1), {}, k + ' 不该给念过的词垫块');
    assert.ok(A.frame(k, 1, 1)['--wa-box-a'], k + ' 该给当前词垫块');
  });
  // 那 31 份预设里只有 Phantom 用 boxHighlight
  const V = window.BC_VS;
  const boxed = V.PRESETS.filter((p) => A.frame(V.animOf(p.anim), 1, 1)['--wa-box-a']);
  assert.deepEqual(boxed.map((p) => p.k), ['phantom']);
});

test('整行那一档不落在词上，签名帧画「正在进来」那一刻', () => {
  ['flipClock', 'scaleIn', 'stomp', 'rotateFlipClock'].forEach((k) => {
    assert.deepEqual(A.frame(k, 1, 1), {}, k + ' 是整行的，不该落在词上');
    assert.ok(A.lineFrame(k, 1, true).transform, k + ' 的签名帧要画得出正在进来');
    /* 落位那一帧不一定是「什么都没有」：`rotateFlipClock` 的末帧仍带 `rotateZ(10deg)`
       ——那条本来就是「翻进来之后留着一点倾斜」。所以判据是**进场与落位不同**，
       不是落位必须为空。 */
    assert.notDeepEqual(A.lineFrame(k, 1, true), A.lineFrame(k, 3), k + ' 进场与落位该看得出不同');
    assert.notEqual(A.lineFrame(k, 3).opacity, '0', k + ' 落位之后不该还是透明的');
  });
  // 逐词那一档反过来
  ['karaoke', 'dropIn', 'boxHighlight'].forEach((k) =>
    assert.deepEqual(A.lineFrame(k, 1, true), {}, k + ' 是逐词的，不该写到行上'));
});

test('箭头从轨上读，不另写一份', () => {
  assert.equal(A.dir('floatInTop'), '↓');
  assert.equal(A.dir('floatInBottom'), '↑');
  assert.equal(A.dir('dropIn'), '↓', 'dropIn 的首帧 y 是 -.1，也从上面来');
  assert.equal(A.dir('karaoke'), null);
});

/* ---------- 目录 ---------- */

test('目录的键就是预设里的动效键——中间没有翻译层', () => {
  const V = window.BC_VS;
  V.PRESETS.forEach((p) => assert.equal(V.animOf(p.anim), p.anim, p.k + ' 的动效被翻译过了'));
  // 唯一要翻的是 stack：预设里写的是它的实现名 bgHighlight
  assert.equal(V.animOf('bgHighlight'), 'stack');
  // 目录里没有的落 none，不硬塞
  assert.equal(V.animOf('rotateZigZag'), 'none');
});

test('目录 19 格：17 条 ＋ 核心认的两条，且格格不同名', () => {
  assert.equal(D.subtitle.anims.length, 19);
  const ks = D.subtitle.anims.map((a) => a.k);
  assert.equal(new Set(ks).size, 19);
  const local = A.ANIMS.filter((a) => a.local).map((a) => a.k);
  assert.deepEqual(local, ['bounce', 'paint'], '本地那两条要说得出为什么留着');
  local.forEach((k) => assert.ok(A.byKey(k).core, k + ' 留着的理由就是核心认它'));
});

test('每一格在画面上看得出不一样（第 52 轮的判据）', () => {
  const seen = new Map();
  D.subtitle.anims.forEach((a) => {
    // 比的是**静帧**：格子里看得出不一样，靠的就是这一帧
    const sig = JSON.stringify([A.frame(a.k, 2, 1, true), A.frame(a.k, 1, 1, true),
      A.frame(a.k, 0, 1, true), A.lineFrame(a.k, 1, true)]);
    const prev = seen.get(sig);
    assert.equal(prev, undefined, a.k + ' 与 ' + prev + ' 在格子里长得一模一样');
    seen.set(sig, a.k);
  });
});

/* ---------- 归一化：某一帧没写的通道 = 回默认值（第 68 轮） ---------- */

test('没写的通道回默认——否则 CSS 里那条属性根本不参与插值', () => {
  /* `composedFloatIn_top` 末帧是空的（`{time:1, easing:'cubicOut'}`），意思是
     位移回 0；`composedFloatIn_col` 的 `{time:.46}` / `{time:1}` 同理，意思是亮到 a=1。
     CSS 的规矩相反：没声明的属性不参与那条属性的插值。直接写进去的话浮入两条永远停在
     偏移位、不透明度一路 0——**动效直接画不出来**。 */
  const [col, top] = A.tracksOf('floatInTop');
  assert.deepEqual(col.keyframes.map((k) => k.colour.a), [0, 1, 1], '空帧补成 a=1');
  assert.deepEqual(top.keyframes[1].translate, {x: 0, y: 0}, '空帧补成位移 0');
  const css = A.trackCss(top);
  assert.match(css, /100% \{ transform: none;/, '末帧要显式回到恒等');
});

test('碰 transform 的轨每一帧都出 transform，恒等也出', () => {
  // flipClock 末帧旋转全 0——不出 transform 的话整行永远停在 -90°
  const css = A.trackCss(A.tracksOf('flipClock')[0]);
  assert.match(css, /0% \{[^}]*rotateX\(-90deg\)/);
  assert.match(css, /100% \{[^}]*transform: none/);
  // 不碰 transform 的轨不该凭空多出一个 transform
  assert.ok(!/transform/.test(A.trackCss(A.tracksOf('karaoke')[0])));
});

test('换色也回默认——不然词会从头到尾都是高亮色', () => {
  // colourHighlight（非 V3，rotateHighlight 用的那条）首末帧是空的
  const css = A.trackCss(A.tracksOf('rotateHighlight', 'word')[0]);
  assert.match(css, /0% \{[^}]*color: inherit/);
  assert.match(css, /100% \{[^}]*color: inherit/);
  assert.match(css, /1% \{[^}]*color: var\(--wa-active/);
});

test('圆角是占字号的倍数，不是占盒子短边——与 cornerRadius 同一把尺', () => {
  assert.equal(A.frame('boxHighlight', 1, 1, true)['--wa-box-r'], '0.5em');
  assert.equal(A.frame('stack', 1, 1, true)['--wa-box-r'], '0.2em');
});

test('17 条逐条自检：每条轨的每一帧都是完整的', () => {
  A.ANIMS.forEach((a) => a.tracks.forEach((tr) => {
    const chans = tr.used.filter((f) => f !== 'box');
    tr.keyframes.forEach((k) => chans.forEach((f) =>
      assert.notEqual(k[f], undefined, a.k + '/' + tr.kf + ' 的 ' + k.time + ' 帧缺 ' + f)));
    // 摊平之后每条轨的 CSS 里，每一帧声明的属性集合必须一样——不一样就是漏了通道
    const stops = A.trackCss(tr).split('\n').slice(1, -1);
    const props = stops.map((s) => (s.match(/[-a-z]+(?=:)/g) || [])
      .filter((x) => x !== 'animation-timing-function').sort().join(','));
    assert.equal(new Set(props).size, 1, a.k + '/' + tr.kf + ' 各帧声明的属性不一致：' + props.join(' | '));
  }));
});


/* ---------- blockScaling：变形相对整行，不相对词自己（第 69 轮） ---------- */

test('blockScaling 只在 dropIn 与 impactPop 的逐词轨上', () => {
  /* `group` 与 `blockScaling` 是两件事：前者说谁拿自己的时间窗，后者说变形相对谁。
     `stomp` 已经是 `group: 'block'` 却还标着 `blockScaling`——两者同义的话这个标记
     就是多余的，所以它们不同义。 */
  const marked = A.ANIMS.filter((a) => A.blockScaled(a.k)).map((a) => a.k);
  assert.deepEqual(marked, ['dropIn', 'impactPop']);
  // stomp 的轨带这个标记，但它是整行的——逐词那一档没有它，所以 blockScaled 为假
  assert.ok(A.tracksOf('stomp', 'block')[0].blockScaling);
  assert.equal(A.blockScaled('stomp'), false);
  // 不带标记的一律不挪原点
  ['karaoke', 'floatInTop', 'bounce', 'boxHighlight'].forEach((k) =>
    assert.equal(A.blockScaled(k), false, k + ' 不该按整行算变形'));
});

test('落入的幅度来自 scale 1.5，不是那 10% 的位移', () => {
  // 位移只有 -.1（一成词高），肉眼几乎看不见；「从外部落进来」是 scale 相对行心推出来的
  const kf = A.tracksOf('dropIn')[0].keyframes[0];
  assert.equal(kf.translate.y, -0.1);
  assert.equal(kf.scale.x, 1.5);
});
