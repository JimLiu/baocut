/* Subtitle animation catalog: selector order and keyframe data (17 presets + 2 BaoCut presets).
   Animation-panel pixels use model-subcanvas.js and subtitle-canvas.jsx.
   CSS helpers below remain for legacy prototype stage and style-gallery rendering;
   they are not the Canvas sampler and do not define pixel-exact output.
   Known limits: the seeded RNG and 3D projection are not modelled here.
   See docs/design/product/product-design.md for the continuous sampler validation boundary. */
(function () {

  /* ---------- 缓动名 → CSS 曲线 ----------
     `square*` 是阶跃（表示「一下切换」，比如荧光笔的亮/灭），所以落 `steps`；
     其余按常见等价曲线换。`sinout` 是数据里的另一种拼写，与 `sinOut` 同一条。 */
  const EASING = {
    sinIn:       'cubic-bezier(0.12, 0, 0.39, 0)',
    sinOut:      'cubic-bezier(0.61, 1, 0.88, 1)',
    sinout:      'cubic-bezier(0.61, 1, 0.88, 1)',
    sinInOut:    'cubic-bezier(0.37, 0, 0.63, 1)',
    expoOut:     'cubic-bezier(0.16, 1, 0.3, 1)',
    cubicOut:    'cubic-bezier(0.33, 1, 0.68, 1)',
    quadOut:     'cubic-bezier(0.5, 1, 0.89, 1)',
    squareIn:    'steps(1, end)',
    squareOut:   'steps(1, start)',
    squareInOut: 'steps(1, end)',
  };

  /* ---------- 17 条 ----------
     顺序就是选择器里从上到下的顺序。`core` = 核心
     `bcut-subtitle-render::word_animation` 今天认的那个名字，null = 原型先行。
     `colourParam` 说这条拿不拿动效色、拿去当字色还是块色，`blockTiming` 是整行计时的标记，
     `group` 在每条轨上。 */
  const ANIMS = [
    {k: "none", name: "无", core: "None", tracks: []},
    {k: "boxHighlight", name: "药丸高亮", core: "Highlight", colourParam: "boxColour",
     tracks: [
       {kf: "boxHighlightV2", group: "word",
        keyframes: [
          {time: 0, box: {translate: {x: 0, y: 0}, scale: {x: 0.9, y: 0.9}, colour: {a: 0.75}, rotation: 0, underText: true, trackActiveElement: true, useCustomColour: true, cornerRounding: 0.5}, easing: "sinInOut"},
          {time: 0.7, box: {translate: {x: 0, y: 0}, scale: {x: 1.1, y: 1.1}, colour: {a: 1}, rotation: 0, underText: true, trackActiveElement: true, useCustomColour: true, cornerRounding: 0.5}, easing: "sinInOut"},
          {time: 1, box: {translate: {x: 0, y: 0}, scale: {x: 1, y: 1}, colour: {a: 1}, rotation: 0, underText: true, trackActiveElement: true, useCustomColour: true, cornerRounding: 0.5}, easing: "sinInOut"},
        ]},
     ]},
    {k: "flipClock", name: "翻页钟", core: null, blockTiming: true,
     tracks: [
       {kf: "flipClock", group: "block",
        keyframes: [
          {time: 0, rotation: {x: -90, y: 0, z: 0}, colour: {r: 0, g: 0, b: 0, a: 0}, easing: "expoOut"},
          {time: 1, rotation: {x: 0, y: 0, z: 0}, colour: {r: 1, g: 1, b: 1, a: 1}, easing: "expoOut"},
        ]},
     ]},
    {k: "highlight", name: "荧光笔", core: "Highlight",
     tracks: [
       {kf: "highlight", group: "word",
        keyframes: [
          {time: 0, colour: {r: 1, g: 1, b: 1, a: 0.5}},
          {time: 0.01, colour: {r: 1, g: 1, b: 1, a: 1}, easing: "squareIn"},
          {time: 0.99, colour: {r: 1, g: 1, b: 1, a: 1}, easing: "squareIn"},
          {time: 1, colour: {r: 1, g: 1, b: 1, a: 0.5}, easing: "squareOut"},
        ]},
     ]},
    {k: "karaoke", name: "卡拉OK", core: null,
     tracks: [
       {kf: "karaokeV2", group: "word",
        keyframes: [
          {time: 0, colour: {r: 1, g: 1, b: 1, a: 0.5}},
          {time: 0.1, colour: {r: 1, g: 1, b: 1, a: 1}, easing: "sinIn"},
          {time: 1, colour: {r: 1, g: 1, b: 1, a: 1}, easing: "squareIn"},
        ]},
     ]},
    {k: "impact", name: "冲击", core: null,
     tracks: [
       {kf: "impact", group: "word", centreElements: true,
        keyframes: [
          {time: 0, colour: {r: 1, g: 1, b: 1, a: 0}},
          {time: 0.01, colour: {r: 1, g: 1, b: 1, a: 1}, easing: "squareIn"},
          {time: 0.99, colour: {r: 1, g: 1, b: 1, a: 0}, easing: "squareIn"},
          {time: 1, colour: {r: 1, g: 1, b: 1, a: 0}, easing: "squareOut"},
        ]},
     ]},
    {k: "reveal", name: "逐词显形", core: "Reveal",
     tracks: [
       {kf: "reveal", group: "word",
        keyframes: [
          {time: 0, colour: {r: 1, g: 1, b: 1, a: 0}},
          {time: 0.01, colour: {r: 1, g: 1, b: 1, a: 1}, easing: "squareInOut"},
          {time: 1, colour: {r: 1, g: 1, b: 1, a: 1}, easing: "squareInOut"},
        ]},
     ]},
    {k: "floatInTop", name: "浮入 ↓", core: null,
     tracks: [
       {kf: "composedFloatIn_col", group: "word",
        keyframes: [
          {time: 0, colour: {a: 0}},
          {time: 0.46},
          {time: 1},
        ]},
       {kf: "composedFloatIn_top", group: "word",
        keyframes: [
          {time: 0, translate: {y: -0.2}},
          {time: 1, easing: "cubicOut"},
        ]},
     ]},
    {k: "floatInBottom", name: "浮入 ↑", core: null,
     tracks: [
       {kf: "composedFloatIn_col", group: "word",
        keyframes: [
          {time: 0, colour: {a: 0}},
          {time: 0.46},
          {time: 1},
        ]},
       {kf: "composedFloatIn_bottom", group: "word",
        keyframes: [
          {time: 0, translate: {y: 0.2}},
          {time: 1, easing: "cubicOut"},
        ]},
     ]},
    {k: "scaleIn", name: "放大入", core: null,
     tracks: [
       {kf: "scaleIn", group: "block",
        keyframes: [
          {time: 0, scale: {x: 0, y: 0}, colour: {r: 1, g: 1, b: 1, a: 0}, easing: "expoOut"},
          {time: 0.65, scale: {x: 1, y: 1}, colour: {r: 1, g: 1, b: 1, a: 1}, easing: "expoOut"},
        ]},
     ]},
    {k: "dropIn", name: "落入", core: null,
     tracks: [
       {kf: "dropIn", group: "word", blockScaling: true,
        keyframes: [
          {time: 0, translate: {x: 0, y: -0.1}, scale: {x: 1.5, y: 1.5}, colour: {r: 1, g: 1, b: 1, a: 0}, easing: "expoOut"},
          {time: 0.8, translate: {x: 0, y: 0}, scale: {x: 1, y: 1}, colour: {r: 1, g: 1, b: 1, a: 1}, easing: "expoOut"},
        ]},
     ]},
    {k: "impactPop", name: "冲击弹出", core: null,
     tracks: [
       {kf: "impactPop", group: "word", centreElements: true, blockScaling: true,
        keyframes: [
          {time: 0, colour: {r: 1, g: 1, b: 1, a: 0}},
          {time: 0.01, colour: {r: 1, g: 1, b: 1, a: 0.5}, scale: {x: 0.88, y: 0.88}, easing: "squareIn"},
          {time: 0.98, colour: {r: 1, g: 1, b: 1, a: 1}, scale: {x: 1, y: 1}, easing: "quadOut"},
          {time: 0.99, colour: {r: 1, g: 1, b: 1, a: 1}, easing: "quadOut"},
          {time: 1, colour: {r: 1, g: 1, b: 1, a: 0}, easing: "squareOut"},
        ]},
     ]},
    {k: "colourHighlight", name: "颜色高亮", core: "Color", colourParam: "textColour",
     tracks: [
       {kf: "colourHighlightV3", group: "word",
        keyframes: [
          {time: 0, colour: {useCustom: true, mixSecondary: 1e-9}},
          {time: 0.1, colour: {useCustom: true, mixSecondary: 1}},
          {time: 0.9, colour: {useCustom: true, mixSecondary: 1}},
          {time: 1, colour: {useCustom: true, mixSecondary: 1e-9}},
        ]},
     ]},
    {k: "rotateFlipClock", name: "旋转翻页", core: null,
     tracks: [
       {kf: "rotateFlipClock", group: "block",
        keyframes: [
          {time: 0, rotation: {x: -90, y: 0, z: 10, offsetWindow: {min: {x: 0, y: 0, z: -5}, max: {x: 0, y: 0, z: 5}}}, colour: {r: 0, g: 0, b: 0, a: 0}, flipflop: {rotate: true}, easing: "expoOut"},
          {time: 1, rotation: {x: 0, y: 0, z: 10, offsetWindow: {min: {x: 0, y: 0, z: -5}, max: {x: 0, y: 0, z: 5}}}, colour: {r: 1, g: 1, b: 1, a: 1}, flipflop: {rotate: true}, easing: "expoOut"},
        ]},
     ]},
    {k: "rotateHighlight", name: "旋转高亮", core: null,
     tracks: [
       {kf: "randomRotate", group: "block",
        keyframes: [
          {time: 0, rotation: {x: 0, y: 0, z: 6, offsetWindow: {min: {x: 0, y: 0, z: -3}, max: {x: 0, y: 0.5, z: 3}}}, flipflop: {rotate: true}},
          {time: 0.22, rotation: {x: 0, y: 0, z: 9, offsetWindow: {min: {x: 0, y: 0, z: -3}, max: {x: 0, y: 0.5, z: 3}}}, flipflop: {rotate: true}, easing: "sinout"},
          {time: 1, rotation: {x: 0, y: 0, z: 9, offsetWindow: {min: {x: 0, y: 0, z: -3}, max: {x: 0, y: 0.5, z: 3}}}, flipflop: {rotate: true}},
        ]},
       {kf: "colourHighlight", group: "word",
        keyframes: [
          {time: 0},
          {time: 0.01, colour: {useSecondary: true}, easing: "squareIn"},
          {time: 0.99, colour: {useSecondary: true}, easing: "squareIn"},
          {time: 1, easing: "squareOut"},
        ]},
     ]},
    {k: "stack", name: "方底高亮", core: null, colourParam: "boxColour",
     tracks: [
       {kf: "bgHighlight", group: "word",
        keyframes: [
          {time: 0, box: {translate: {x: 0, y: 0}, scale: {x: 0.92, y: 0.92}, colour: {a: 1}, rotation: 0, underText: true, trackActiveElement: true, useCustomColour: true, cornerRounding: 0.2}, easing: "sinInOut"},
          {time: 1, box: {translate: {x: 0, y: 0}, scale: {x: 0.92, y: 0.92}, colour: {a: 1}, rotation: 0, underText: true, trackActiveElement: true, useCustomColour: true, cornerRounding: 0.2}, easing: "sinInOut"},
        ]},
     ]},
    {k: "stomp", name: "跺脚", core: null, blockTiming: true,
     tracks: [
       {kf: "stomp", group: "block", blockScaling: true,
        keyframes: [
          {time: 0, scale: {x: 2.5, y: 2.5}, colour: {r: 1, g: 1, b: 1, a: 0}, easing: "sinOut"},
          {time: 1, scale: {x: 1, y: 1}, colour: {r: 1, g: 1, b: 1, a: 1}, easing: "expoOut"},
        ]},
     ]},
  ];

  /* ---------- 目录里另外两条，不在上面那 17 条里 ----------
     它们留着是因为**核心今天就认这两个名字**（`word_animation::Bounce` / `Paint`），
     不是随手加的花活。写法与上面 17 条同一种，所以生成器、取样、CSS 一视同仁。

     `bounce` 的关键帧本是**逐字母**文字动画的写法（`group: 'glyph'`），这里作用域
     按逐词用。
     `paint`（刷过）对应核心的语义「刷过去的词留住颜色」，按同一种写法补一条：
     起手不变，一开口换成高亮色并**留着**（与 `colourHighlight` 的区别正在这里：
     后者念完会退回本色）。 */
  ANIMS.push(
    {k: 'bounce', name: '弹跳', core: 'Bounce', local: '逐词弹跳：词淡入时向上跳一下再落回',
     tracks: [
       {kf: 'bounce', group: 'word',
        keyframes: [{time: 0, translate: {y: 0}, colour: {a: 0}}, {time: 0.5, translate: {y: -0.2}, colour: {a: 1}}, {time: 1, translate: {y: 0}, colour: {a: 1}}]},
     ]},
    {k: 'paint', name: '刷过', core: 'Paint', local: '刷过的词换成高亮色并一直保持',
     tracks: [
       {kf: 'paint', group: 'word',
        keyframes: [
          {time: 0},
          {time: 0.01, colour: {useCustom: true}, easing: "squareIn"},
          {time: 1, colour: {useCustom: true}},
        ]},
     ]}
  );

  /* ---------- 归一化：**某一帧没写的通道 = 回默认值** ----------
     这是关键帧数据的读法，也是第 68 轮补上的一处漏洞。证据在浮入那两条组合轨里：

       composedFloatIn_top: [{time:0, translate:{y:-.2}}, {time:1, easing:'cubicOut'}]
       composedFloatIn_col: [{time:0, colour:{a:0}},      {time:.46}, {time:1}]

     末帧什么都没写——词当然要落回 y=0、亮到 a=1，所以「没写」就是「回默认」。而 CSS 的
     `@keyframes` 是另一套规矩：**某一帧没声明的属性根本不参与那条属性的插值**。直接写进去
     的话，`0% { transform: translate(0%,-20%) }` 后面再没人声明 transform，词就永远停在
     偏移位上、`opacity: 0` 一路到底——浮入 ↑ / 浮入 ↓ 直接画不出来，翻页钟也永远翻不回来。

     所以在这里把每条轨**先摊平**：取这条轨用到的通道并集，逐帧补上没写的那些（位移 0、
     缩放 1、旋转 0、不透明 1、不换色）。摊平之后 CSS 与取样读的是同一份完整帧，两边
     都不必再猜「这一帧为什么少一个字段」。 */
  const DEFAULTS = {
    translate: {x: 0, y: 0}, scale: {x: 1, y: 1}, rotation: {x: 0, y: 0, z: 0},
    colour: {a: 1}, box: null,
  };
  const hasSwap = (c) => !!(c && (c.useCustom || c.useSecondary || c.mixSecondary != null));
  function normalize(track) {
    const used = new Set();
    const swaps = track.keyframes.some((k) => hasSwap(k.colour));
    track.keyframes.forEach((k) => Object.keys(k).forEach((f) => {
      if (f !== 'time' && f !== 'easing' && f !== 'flipflop') used.add(f);
    }));
    const keyframes = track.keyframes.map((k) => {
      const out = {time: k.time};
      if (k.easing) out.easing = k.easing;
      used.forEach((f) => {
        if (k[f] !== undefined) { out[f] = k[f]; return; }
        if (f === 'box') return;                       // 没写块 = 没有块
        out[f] = DEFAULTS[f];
      });
      if (out.colour) {
        const c = Object.assign({}, out.colour);
        // 只写了换色、没写 alpha 的那几帧补成不透明（`colourHighlight` 的中间两帧就是）
        if (c.a == null) c.a = 1;
        /* 换色也要「回默认」：这条轨里只要有一帧换色，没换的那几帧就得**显式**写回本色，
           否则 CSS 里 `color` 只在换色那几帧之间插值，词会从头到尾都是高亮色。
           `colourHighlight`（非 V3）的首末帧正是空的。 */
        if (swaps && !hasSwap(c)) c.mixSecondary = 0;
        out.colour = c;
      }
      return out;
    });
    // 这条轨碰不碰 transform：碰的话每一帧都要出 transform，哪怕是恒等
    const moving = ['translate', 'scale', 'rotation'].some((f) => used.has(f));
    return Object.assign({}, track, {keyframes, used: [...used], moving});
  }

  ANIMS.forEach((a) => { a.tracks = a.tracks.map(normalize); });

  const byKey = (k) => ANIMS.find((a) => a.k === k) || null;
  const tracksOf = (k, group) => {
    const a = byKey(k);
    return a ? a.tracks.filter((t) => !group || t.group === group) : [];
  };
  /** 这一条有没有整行那一档 / 逐词那一档。组合出来的两档都有（`rotateHighlight`）。 */
  const hasScope = (k, group) => tracksOf(k, group).length > 0;
  /** 这条动效的逐词变形是**相对整行**算的（轨上的 `blockScaling` 标记）。

   *  `group` 与 `blockScaling` 是两件事：前者说**谁拿自己的时间窗**（block = 整行一个、
   *  word = 每个词一个），后者说**变形相对谁**。证据是 `stomp` ——它已经是
   *  `group: 'block'` 了却还标着 `blockScaling`，如果两者同义这个标记就是多余的。
   *
   *  对逐词那一档，这个区别是看得见的：`dropIn` 的 `scale 1.5` 若相对**词自己**，词只是
   *  在原地胀一下；相对**整行**，它同时被推到离行心 1.5 倍远的地方，于是**从画面外侧
   *  落进来**——那正是「落入」该有的样子，也是原型此前缺的那一半幅度。
   *
   *  CSS 里落成变形原点：把原点挪到行心（视图量一次每个词到行心的偏移，写进 `--wa-ox`），
   *  于是 `scale(k)` 自动把词按 `k` 推离行心。不带这个标记的动效仍以基线为轴——
   *  「变形以基线为轴，词不会在行里乱窜」那条对它们仍然成立。 */
  const blockScaled = (k) => tracksOf(k, 'word').some((tr) => tr.blockScaling);

  /** 这条拿不拿 `animationColor`，拿去当字色还是块色。 */
  const colourParamOf = (k) => (byKey(k) || {}).colourParam || null;
  const moves = (k) => tracksOf(k).length > 0;

  /* ---------- 关键帧 → CSS ---------- */

  const num = (v) => (Math.round(v * 1e4) / 1e4);
  /** 一帧里的 transform。三样都是可选的，都没有就不写 `transform`（写 `none` 会
   *  把上一帧的值顶掉——同一条轨里位移与缩放常常只有一头声明）。 */
  function transformOf(kf, moving) {
    const out = [];
    const r = kf.rotation;
    // 有 x/y 轴旋转才需要透视；纯 z 轴（randomRotate）是平面内的倾斜，加了反而变形
    if (r && (r.x || r.y)) out.push('perspective(6em)');
    if (kf.translate && (kf.translate.x || kf.translate.y)) {
      // 位移是**元素自己尺寸的倍数**（slideRight 的 x:-1 = 挪走一整个身位）
      out.push('translate(' + num((kf.translate.x || 0) * 100) + '%, ' + num((kf.translate.y || 0) * 100) + '%)');
    }
    if (r) {
      if (r.x) out.push('rotateX(' + num(r.x) + 'deg)');
      if (r.y) out.push('rotateY(' + num(r.y) + 'deg)');
      if (r.z) out.push('rotateZ(' + num(r.z) + 'deg)');
    }
    if (kf.scale && (kf.scale.x !== 1 || kf.scale.y !== 1)) {
      out.push('scale(' + num(kf.scale.x) + ', ' + num(kf.scale.y) + ')');
    }
    /* 恒等那一帧也要**出** `transform: none`（只要这条轨碰 transform）：CSS 里没声明的
       属性不参与插值，末帧不出就等于「永远停在首帧那个姿态」。 */
    if (!out.length) return moving ? 'none' : null;
    return out.join(' ');
  }

  /** 一帧里的颜色。`a` 是不透明度；`useCustom` / `useSecondary` / `mixSecondary` 是
   *  「换成这条样式的 animationColor」——那一份由视图挂在 `--wa-active` 上。
   *  `mixSecondary` 只有 1 与 1e-9 两种取值（后者是「几乎不混」，等于不换）。 */
  function colourOf(kf) {
    const c = kf.colour;
    if (!c) return {};
    const out = {};
    if (c.a != null) out.opacity = String(num(c.a));
    const swap = c.useCustom || c.useSecondary;
    if (swap != null || c.mixSecondary != null) {
      const mix = c.mixSecondary == null ? (swap ? 1 : 0) : c.mixSecondary;
      out.color = mix > 0.5 ? 'var(--wa-active, currentColor)' : 'inherit';
    }
    return out;
  }

  /** 一帧里的底块。**块是一个真的盒子**（`.wd::before`），不是外扩阴影——第 67 轮改的。

     此前用 `box-shadow` 的外扩画块，于是 `box.scale` 只好落到「阴影多厚」上：
     `boxHighlightV2` 的 `.9 → 1.1 → 1` 变成 `.162em → .198em → .18em`，那点变化肉眼
     根本看不出来，Phantom 因此「只有一块底，没有那下胀缩」。块的缩放要缩的是**整个
     盒子的两个方向**，那是 `transform: scale()` 干的事，阴影厚度装不下。

     盒子走伪元素，所以：不参与布局（块滑过去时行宽是死的，这条纪律没变）、能双向
     缩放、`underText` 天然成立（伪元素画在字底下）。这一层只交出四个自定义属性，
     `.wd::before` 那几行怎么读它们在 ui.css 里；它们都用 `@property` 注册过，不然
     自定义属性只会**跳变**不会补间——那正是「有块但不动」的另一种写法。 */
  function boxOf(kf) {
    const b = kf.box;
    if (!b) return {};
    return {
      '--wa-box-a': String(num(b.colour && b.colour.a != null ? b.colour.a : 1)),
      '--wa-box-s': String(num(b.scale ? b.scale.x : 1)),
      /* `cornerRounding` 是**占字号的倍数**，不是「占盒子短边的几分之几」。判据是同族字段：
         样式那一层的底板圆角 `cornerRadius: .3` 按参考字号 25 落成 7.5px，也就是 .3 × 字号。
         动效这一层的 `cornerRounding` 用同一把尺，于是 `.5` → .5em、`.2` → .2em。
         第 67 轮这里乘了 2，没有依据，画出来的药丸圆了一倍。 */
      '--wa-box-r': num(b.cornerRounding || 0) + 'em',
      /* 块上的字色：这里**有意改字色**——块底亮就落墨色、暗就落纸色。
         既有纪律「看不出字的高亮等于没有高亮」，有测试钉着。 */
      color: 'var(--wa-ink, inherit)',
    };
  }

  /** 一条轨 → 一段 `@keyframes`。名字是 `va-<注册表里的键>`，所以在 devtools 里
   *  看见的名字与数据里的 `kf` 键一一对得上。 */
  function trackCss(track) {
    const stops = track.keyframes.map((kf) => {
      const decls = Object.assign({}, colourOf(kf), boxOf(kf));
      const tf = transformOf(kf, track.moving);
      if (tf) decls.transform = tf;
      if (kf.easing && EASING[kf.easing]) decls['animation-timing-function'] = EASING[kf.easing];
      const body = Object.keys(decls).map((k) => k + ': ' + decls[k] + ';').join(' ');
      return '  ' + num(kf.time * 100) + '% { ' + body + ' }';
    });
    return '@keyframes va-' + track.kf + ' {\n' + stops.join('\n') + '\n}';
  }

  /** 全部轨的 CSS。同一条轨可能被两条动效共用（`colourHighlight` 既是它自己，
   *  也是 `rotateHighlight` 的一半），所以按 `kf` 去重。 */
  function keyframesCss() {
    const seen = new Set();
    const out = [];
    ANIMS.forEach((a) => a.tracks.forEach((t) => {
      if (seen.has(t.kf)) return;
      seen.add(t.kf);
      out.push(trackCss(t));
    }));
    return out.join('\n');
  }

  /** 摆进 `style.animation` 的那一串。**时长就是一个词的窗口**（整行那一档是整条
   *  cue）——关键帧停在自己的 `time` 上，所以 `dropIn` 在 80% 处落位、剩下 20% 停着，
   *  `impact` 在 99% 处收走，都不需要另算一个「有效时长」。
   *  组合出来的那两条（`floatIn*`）有两条轨，逗号并列——它们碰的是不同的属性
   *  （一条管不透明度、一条管位移），不会打架。 */
  function motion(k, ms, group) {
    const list = tracksOf(k, group);
    if (!list.length) return null;
    return list.map((t) => 'va-' + t.kf + ' ' + Math.round(ms || 620) + 'ms linear both').join(', ');
  }

  /* ---------- 签名帧：**从同一条轨上采样**，不再手写 ----------
     此前签名帧是一张手写的表，与真运动各写一份——三次读错里有两次就是那张表跑偏了
     （卡拉OK 垫了块、落入停在中途）。现在它是同一份关键帧在某个时刻的取样，所以
     **两者不可能分叉**：静帧就是这条轨上的一帧。

     取样时刻按这个词与播放头的关系给：还没轮到取轨的**首帧**、正在念取 35%（看得出
     在动的那一刻）、念过取**末帧**。于是 `impact` 的「念过也收走」、`highlight` 的
     「前后都暗」、卡拉OK 的「念过留在满色」全是算出来的，不是各写一条 if。 */
  const SAMPLE_ON = 0.35;

  /** 段内进度。`square*` 是阶跃：`squareIn` 保持到段末才跳，`squareOut` 立刻跳；
   *  其余按线性取样——静帧不必解贝塞尔，差别落在小数点后。 */
  function ease01(name, p) {
    if (name === 'squareIn' || name === 'squareInOut') return 0;
    if (name === 'squareOut') return 1;
    return p;
  }
  const lerp = (a, b, p) => a + (b - a) * p;
  /** 两帧之间插一帧。只插数值（位移 / 缩放 / 旋转 / 不透明度）；颜色开关与底块
   *  是离散的，取**起始那一帧**的——它们本来就没有中间态。 */
  function tween(a, b, p) {
    const out = {time: lerp(a.time, b.time, p)};
    const pick = (k) => (a[k] !== undefined ? a[k] : b[k]);
    ['translate', 'scale', 'rotation'].forEach((k) => {
      if (!a[k] && !b[k]) return;
      const x = a[k] || {}, y = b[k] || {};
      const o = {};
      ['x', 'y', 'z'].forEach((ax) => {
        if (x[ax] === undefined && y[ax] === undefined) return;
        const dflt = k === 'scale' ? 1 : 0;
        o[ax] = lerp(x[ax] === undefined ? dflt : x[ax], y[ax] === undefined ? dflt : y[ax], p);
      });
      out[k] = o;
    });
    if (a.colour || b.colour) {
      const x = a.colour || {}, y = b.colour || {};
      out.colour = Object.assign({}, x);
      if (x.a !== undefined || y.a !== undefined) {
        out.colour.a = lerp(x.a === undefined ? 1 : x.a, y.a === undefined ? 1 : y.a, p);
      }
    }
    /* 块**按数插**：`scale` 与 `colour.a` 是连续的（`boxHighlightV2` 就靠这两样做出
       那下胀缩）。圆角与几个渲染端开关是离散的，取起始那一帧的。 */
    const bx = pick('box');
    if (bx) {
      const x = a.box || {}, y = b.box || {};
      out.box = Object.assign({}, bx);
      if (x.scale || y.scale) {
        const sx = (x.scale || {x: 1}).x, sy = (y.scale || {x: 1}).x;
        out.box.scale = {x: lerp(sx, sy, p), y: lerp(sx, sy, p)};
      }
      if ((x.colour && x.colour.a != null) || (y.colour && y.colour.a != null)) {
        const ax = x.colour && x.colour.a != null ? x.colour.a : 1;
        const ay = y.colour && y.colour.a != null ? y.colour.a : 1;
        out.box.colour = {a: lerp(ax, ay, p)};
      }
    }
    return out;
  }

  /** 这条轨在时刻 `t`（0–1）的那一帧。超出首末帧就取首末帧——CSS 的 `both` 也是这么收的。 */
  function sampleAt(track, t) {
    const ks = track.keyframes;
    if (t <= ks[0].time) return ks[0];
    const last = ks[ks.length - 1];
    if (t >= last.time) return last;
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i], b = ks[i + 1];
      if (t > b.time) continue;
      const span = b.time - a.time;
      return tween(a, b, ease01(a.easing, span ? (t - a.time) / span : 1));
    }
    return last;
  }

  /** 一帧 → 内联样式（驼峰键，React 认的那种）。 */
  function styleOf(kf, moving) {
    const d = Object.assign({}, colourOf(kf), boxOf(kf));
    const tf = transformOf(kf, moving);
    if (tf) d.transform = tf;
    const out = {};
    Object.keys(d).forEach((k) => {
      // 自定义属性原样留着——React 认 `--x`，转成驼峰它就写不进去了
      out[k.startsWith('--') ? k : k.replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = d[k];
    });
    return out;
  }

  /** 第 `i` 个词在「当前词是 `cur`」这一帧的样子（逐词那一档）。
   *  底块只画在**当前词**上：`trackActiveElement` 就是这个意思——一块底跟着
   *  当前词走，不是每个词各有一块。 */
  function frame(k, i, cur, still) {
    const list = tracksOf(k, 'word');
    if (!list.length) return {};
    /* 内联样式是这个词**歇在哪儿**，轨是它**怎么过去的**——两者不写同一个时刻，
       否则轨一跑完内联就从底下露出来，每个词末尾闪一下（第 66 轮实测到的）。
       所以会动的时候当前词内联取**末帧**（＝落位），中途的样子交给轨；
       `prefers-reduced-motion` 下轨不跑，才改取 35% 那一帧——那一格得看得出是哪一种。 */
    const t = i > cur ? 0 : (i === cur ? (still ? SAMPLE_ON : 1) : 1);
    let out = {};
    list.forEach((track) => {
      const kf = sampleAt(track, t);
      if (kf.box && i !== cur) return;          // trackActiveElement
      Object.assign(out, styleOf(kf, track.moving));
    });
    return out;
  }

  /** 整行那一档在这一帧的样子。`cur <= 1` 当作还在进场——签名帧因此画的是「正在
   *  进来」那一刻，停在落位那一帧的话它与「无」长得一模一样。 */
  function lineFrame(k, cur, still) {
    const list = tracksOf(k, 'block');
    if (!list.length) return {};
    const t = cur <= 1 ? (still ? SAMPLE_ON : 1) : 1;
    let out = {};
    list.forEach((track) => Object.assign(out, styleOf(sampleAt(track, t), track.moving)));
    return out;
  }

  /** 入场方向那个小箭头。**从轨上读**，不另写一份：位移为负 = 从上面来。
   *  `prefers-reduced-motion` 下轨不跑，那一格要靠箭头说清是从上面还是下面来。 */
  function dir(k) {
    const y = tracksOf(k, 'word').reduce((v, tr) => {
      const f = tr.keyframes[0];
      return f.translate && f.translate.y ? f.translate.y : v;
    }, 0);
    return y < 0 ? '\u2193' : (y > 0 ? '\u2191' : null);
  }

  window.BC_SA = {ANIMS, EASING, SAMPLE_ON, DEFAULTS, normalize, byKey, blockScaled, tracksOf, hasScope, colourParamOf, moves, dir,
    transformOf, colourOf, boxOf, sampleAt, styleOf, frame, lineFrame, trackCss, keyframesCss, motion};
})();
