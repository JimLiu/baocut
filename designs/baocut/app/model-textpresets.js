/* 文字预设库与文字动画目录 —— §13.5（第 59 轮整表重做）。

   **真相不在这里**：51 条预设的权威副本是核心的
   `core/presets/builtin/textpreset/*.json`（simple.01–13 / title.01–10 /
   lowerThird.01–20 / other.01–08），格式是 BCF。这一份是
   **照着核心那 51 个文件生成的**，逐字段对应，只做三件事：

     1. 单位换算。核心的长度写在 540 高的参考画幅里（`fontSize` / `letterSpacing` /
        `backgroundPadding` / `borderRadius` / `textOutline.width` 同一把尺），原型舞台
        的基准是 880×495，所以一律乘 495/540。`place` 的 x/y/w 与 shape 的 h 本来就是
        百分比，原样带过来。阴影的 `blur` / `distance` 是 em，留着不换。
     2. 文案本地化。带 `keyValue` 的那些（标题 / 简约 / 手写 / 衬线 / 打字机、
        以及 Other 那一组）翻成中文；**不带 keyValue 的一批不翻**——`bold`、`Editorial`、
        `Bauhaus`、`INDUSTRIAL` 那些是字体风格的名字，在任何语言下都不翻，翻了
        这张卡就不再是那款字的样张。人名与职位换成中文示例名（演示数据禁真实品牌名）。
     3. 补一列核心没有的 `pv`（目录卡上那一格的预览字号）——
        它属于目录呈现，不属于画面内容，核心自然不带。

   `box` 是这一组的包围盒，核心也没有：核心的 51 个文件只有逐元素的 `place`，成组的框
   是落地时算出来的。这里在生成期算好（文字块按字数估宽、按行数估高），免得每次开面板
   都重算一遍。

   动画目录 `ANIMS` 是**文字专用**的那三张表（In 19 / Out 16 /
   Loop 9），不是元素那一份（`BC_EL.ANIMS`，In/Out 各 13、Loop 10）。两份键名有重叠但不是
   一回事，所以文字面板读这一份。`core` 标的是核心 `bcut-motion` 的 preset registry 里
   有没有对应配方（enter 14 / exit 11 / loop 5，见 `preset_registry/mod.rs`），有对应的
   写上核心那一条的 id——空着的就是原型先行。

   颜色一律是**画进视频画面**的内容色，按文件登记在 `_ds_conformance.json`。
   这一层不碰 DOM，node --test 直接 require。 */
(function () {
  const CATS = [
    {k: 'all', label: '全部'}, {k: 'simple', label: '简单'},
    {k: 'title', label: '标题'}, {k: 'lower', label: '下三分'}, {k: 'other', label: '其它'},
  ];

  /* 字体：预设用到的那 25 款都是拉丁字体，本地化之后卡上是中文，所以每一款按**类别**
     落到一条带中文字面的栈里——手写体落楷体、衬线落宋体、等宽落等宽、粗展示体落黑体。
     名字保留原名，字体选择框里显示的还是它。 */
  const FONT_STACKS = {
    sans:  "'Source Sans 3', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    heavy: "'Source Sans 3', 'PingFang SC', 'Heiti SC', sans-serif",
    serif: "'Songti SC', 'Noto Serif SC', Georgia, serif",
    mono:  "ui-monospace, Menlo, 'Sarasa Mono SC', monospace",
    script: "'Kaiti SC', STKaiti, 'Xingkai SC', cursive",
    deco:  "'Yuanti SC', STHupo, 'PingFang SC', sans-serif",
  };
  const FONTS = {
    'Roboto': 'sans', 'Work Sans': 'sans', 'DM Sans': 'sans', 'Sora': 'sans',
    'Poppins': 'sans', 'Plus Jakarta Sans': 'sans', 'Montserrat': 'sans', 'Inter': 'sans',
    'Anton': 'heavy', 'Archivo Black': 'heavy', 'Big Shoulders Display': 'heavy', 'Bayon': 'heavy',
    'Newsreader': 'serif', 'PT Serif': 'serif', 'Libre Baskerville': 'serif', 'Abril Fatface': 'serif',
    'Source Code Pro': 'mono', 'Courier Prime': 'mono',
    'Damion': 'script', 'Just Me Again Down Here': 'script', 'Homemade Apple': 'script',
    'Shrikhand': 'deco', 'Monoton': 'deco', 'Lemon': 'deco', 'Climate Crisis': 'deco',
  };
  /** 字体名 → 能画中文的字体栈。没登记的落 sans。 */
  function fontStack(name) { return FONT_STACKS[FONTS[name] || 'sans']; }

  /* ---------- 文字动画目录 ----------
     `core` = 核心 `bcut-motion` 里对应那条配方的 id。第 156 轮起三张表逐格都有核心
     配方（台账 190），不再有 null。方向只有 slide 一条带；方向词是「侧」——入场写从哪一侧来、出场写往哪一侧去，与核心
     `slideL`（入从左来 / 出往左去）同义。 */
  const DIR4 = [{k: 'left', label: '左'}, {k: 'right', label: '右'},
                {k: 'up', label: '上'}, {k: 'down', label: '下'}];
  const A = (k, name, core, dirs) => ({k, name, core: core || null, dirs: dirs || null});
  const ANIMS = {
    in: [
      A('none', '无', 'none'), A('fade', '淡入', 'fade'), A('slide', '滑入', 'slideR', DIR4),
      A('block', '色块入', 'wipe'), A('zoom', '缩放入', 'zoomIn'), A('typewriter', '打字机', 'typewriter'),
      A('ascent', '升起', 'rise'), A('burst', '弹现', 'pop'), A('stomp', '砸落', 'drop'),
      A('compress', '压合', 'compress'), A('bounce', '弹跳', 'bounce'), A('wave', '波浪', 'wave'),
      A('fall', '坠落', 'fall'), A('skid', '甩入', 'skid'), A('flipboard', '翻牌', 'flipboard'),
      A('scale', '旋缩', 'spin'), A('dragonfly', '蜻蜓', 'dragonfly'), A('billboard', '广告牌', 'billboard'),
      A('roll', '滚入', 'roll'),
    ],
    out: [
      A('none', '无', 'none'), A('fade', '淡出', 'fade'), A('slide', '滑出', 'slideL', DIR4),
      A('block', '色块出', 'wipe'), A('zoom', '缩放出', 'zoomOut'), A('ascent', '下沉', 'sink'),
      A('burst', '弹散', 'shrink'), A('stomp', '砸出', 'drop'), A('compress', '展开', 'compress'),
      A('fall', '坠出', 'fall'), A('skid', '甩出', 'skid'), A('flipboard', '翻牌', 'flipboard'),
      A('scale', '旋缩', 'spin'), A('dragonfly', '蜻蜓', 'dragonfly'), A('billboard', '广告牌', 'billboard'),
      A('roll', '滚出', 'roll'),
    ],
    loop: [
      A('none', '无', 'none'), A('rotate', '旋转', 'rotate'), A('wavey', '波浪', 'float'),
      A('scale', '缩放', 'pulse'), A('heartBeat', '心跳', 'heartBeat'), A('vogue', 'Vogue', 'vogue'),
      A('dragonfly', '蜻蜓', 'dragonfly'), A('billboard', '广告牌', 'billboard'), A('roll', '滚动', 'roll'),
    ],
  };
  /** 核心的枚举名 → 目录里的那一格（预设数据里写的是核心名） */
  const FROM_CORE = {
    none: 'none', fade: 'fade', slideL: 'slide', slideR: 'slide', slideUp: 'slide', slideDown: 'slide',
    wipe: 'block', zoomIn: 'zoom', zoomOut: 'zoom', typewriter: 'typewriter', rise: 'ascent',
    sink: 'ascent', pop: 'burst', shrink: 'burst', drop: 'stomp', spin: 'scale', blurIn: 'fade',
    riseWords: 'ascent', compress: 'compress', bounce: 'bounce', wave: 'wave', fall: 'fall',
    skid: 'skid', flipboard: 'flipboard', dragonfly: 'dragonfly', billboard: 'billboard',
    roll: 'roll', rotate: 'rotate', float: 'wavey', pulse: 'scale', heartBeat: 'heartBeat',
    vogue: 'vogue',
  };
  const CORE_DIR = {slideL: 'left', slideR: 'right', slideUp: 'up', slideDown: 'down'};
  const find = (slot, k) => ANIMS[slot].filter((a) => a.k === k)[0] || ANIMS[slot][0];
  /** 预设里的核心名 → 面板认识的 `{k, dir, dur}` */
  function fromCore(slot, pair) {
    if (!pair) return {k: 'none'};
    const id = pair[0];
    return {k: FROM_CORE[id] || 'none', dir: CORE_DIR[id] || null, dur: pair[1] || 0.6};
  }
  /** 一条成员的三个槽 → `{in, out, loop}`，与元素那份 `elDocs[id].anim` 同形 */
  function animOf(e) {
    const a = (e && e.a) || {};
    return {in: fromCore('in', a.in), out: fromCore('out', a.out), loop: fromCore('loop', a.loop)};
  }

  /* ---------- 51 条预设（生成自 core/presets/builtin/textpreset/*.json） ---------- */
  const PRESETS = [
    {id: 'simple.01', cat: 'simple', lay: 'stack', n: 1, anim: false, dur: 5, order: 101, box: {x: 50, y: 50, w: 5.39, h: 5.75}, els: [
      {k: 'text', t: '标题', font: 'Roboto', b: true, color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 50, pv: 22},
    ]},
    {id: 'simple.02', cat: 'simple', lay: 'stack', n: 1, anim: false, dur: 5, order: 102, box: {x: 50, y: 50, w: 6.75, h: 8.17}, els: [
      {k: 'text', t: '简约', font: 'Montserrat', b: true, color: '#18191B', size: 23.7, lh: 1.2, bg: {color: '#FFFFFF', pad: 6, r: 7.1, mode: 'block'}, x: 50, y: 50, pv: 16},
    ]},
    {id: 'simple.03', cat: 'simple', lay: 'stack', n: 1, anim: false, dur: 5, order: 103, box: {x: 50, y: 50, w: 5.39, h: 5.75}, els: [
      {k: 'text', t: '手写', font: 'Damion', color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 50, pv: 24},
    ]},
    {id: 'simple.04', cat: 'simple', lay: 'stack', n: 1, anim: false, dur: 5, order: 104, box: {x: 50, y: 50, w: 5.39, h: 5.75}, els: [
      {k: 'text', t: '衬线', font: 'PT Serif', b: true, color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 50, pv: 20},
    ]},
    {id: 'simple.05', cat: 'simple', lay: 'stack', n: 1, anim: false, dur: 5, order: 105, box: {x: 50, y: 50, w: 8.08, h: 5.75}, els: [
      {k: 'text', t: '打字机', font: 'Source Code Pro', b: true, color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 50, pv: 13},
    ]},
    {id: 'simple.06', cat: 'simple', lay: 'stack', n: 1, anim: false, dur: 5, order: 106, box: {x: 50, y: 50, w: 5.92, h: 5.75}, els: [
      {k: 'text', t: 'bold', font: 'Poppins', b: true, color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 50, pv: 22},
    ]},
    {id: 'simple.07', cat: 'simple', lay: 'stack', n: 1, anim: false, dur: 5, order: 107, box: {x: 50, y: 50, w: 13.33, h: 5.75}, els: [
      {k: 'text', t: 'Editorial', font: 'Newsreader', i: true, color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 50, pv: 22},
    ]},
    {id: 'simple.08', cat: 'simple', lay: 'stack', n: 1, anim: false, dur: 5, order: 108, box: {x: 50, y: 50, w: 10.37, h: 5.75}, els: [
      {k: 'text', t: 'Elegant', font: 'Abril Fatface', color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 50, pv: 22},
    ]},
    {id: 'simple.09', cat: 'simple', lay: 'stack', n: 1, anim: false, dur: 5, order: 109, box: {x: 50, y: 50, w: 8.89, h: 5.75}, els: [
      {k: 'text', t: 'Modern', font: 'Sora', color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 50, pv: 22},
    ]},
    {id: 'simple.10', cat: 'simple', lay: 'stack', n: 1, anim: false, dur: 5, order: 110, box: {x: 50, y: 50, w: 13.33, h: 5.75}, els: [
      {k: 'text', t: 'Signature', font: 'Just Me Again Down Here', color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 50, pv: 22},
    ]},
    {id: 'simple.11', cat: 'simple', lay: 'stack', n: 1, anim: false, dur: 5, order: 111, box: {x: 50, y: 50, w: 10.37, h: 5.75}, els: [
      {k: 'text', t: 'Classic', font: 'Work Sans', color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 50, pv: 22},
    ]},
    {id: 'simple.12', cat: 'simple', lay: 'stack', n: 1, anim: false, dur: 5, order: 112, box: {x: 50, y: 50, w: 14.81, h: 5.75}, els: [
      {k: 'text', t: 'INDUSTRIAL', font: 'Big Shoulders Display', b: true, color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 50, pv: 22},
    ]},
    {id: 'simple.13', cat: 'simple', lay: 'stack', n: 1, anim: false, dur: 5, order: 113, box: {x: 50, y: 50, w: 11.85, h: 5.75}, els: [
      {k: 'text', t: 'RELIABLE', font: 'Work Sans', b: true, color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 50, pv: 22},
    ]},
    {id: 'title.01', cat: 'title', lay: 'stack', n: 2, anim: false, dur: 5, order: 201, box: {x: 50, y: 50.2, w: 7.49, h: 9.44}, els: [
      {k: 'text', t: 'bold', font: 'Poppins', b: true, color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 48.35, pv: 28},
      {k: 'text', t: 'Traditional', font: 'Newsreader', color: '#FFFFFF', size: 10.9, lh: 1.2, x: 50, y: 53.6, pv: 12},
    ]},
    {id: 'title.02', cat: 'title', lay: 'stack', n: 2, anim: false, dur: 5, order: 202, box: {x: 50, y: 50.2, w: 13.33, h: 9.44}, els: [
      {k: 'text', t: 'Editorial', font: 'Newsreader', color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 48.35, pv: 21},
      {k: 'text', t: 'Classic', font: 'Work Sans', color: '#FFFFFF', size: 10.9, lh: 1.2, x: 50, y: 53.6, pv: 12},
    ]},
    {id: 'title.03', cat: 'title', lay: 'stack', n: 2, anim: false, dur: 5, order: 203, box: {x: 50, y: 50.2, w: 8.89, h: 9.44}, els: [
      {k: 'text', t: 'Modern', font: 'Sora', color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 48.35, pv: 20},
      {k: 'text', t: 'Bauhaus', font: 'Poppins', color: '#FFFFFF', size: 10.9, lh: 1.2, x: 50, y: 53.6, pv: 12},
    ]},
    {id: 'title.04', cat: 'title', lay: 'stack', n: 2, anim: false, dur: 5, order: 204, box: {x: 50, y: 50.2, w: 10.37, h: 9.44}, els: [
      {k: 'text', t: 'Elegant', font: 'Abril Fatface', color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 48.35, pv: 20},
      {k: 'text', t: 'Light', font: 'Roboto', color: '#FFFFFF', size: 10.9, lh: 1.2, x: 50, y: 53.6, pv: 12},
    ]},
    {id: 'title.05', cat: 'title', lay: 'stack', n: 2, anim: false, dur: 5, order: 205, box: {x: 50, y: 49.92, w: 14.81, h: 11.6}, els: [
      {k: 'text', t: 'Signature', font: 'Just Me Again Down Here', color: '#FFFFFF', size: 18.8, lh: 1.2, x: 50, y: 46.4, pv: 18},
      {k: 'text', t: 'INDUSTRIAL', font: 'Big Shoulders Display', b: true, color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 52.85, pv: 18},
    ]},
    {id: 'title.06', cat: 'title', lay: 'stack', n: 2, anim: false, dur: 5, order: 206, box: {x: 50, y: 50.2, w: 11.85, h: 9.44}, els: [
      {k: 'text', t: 'RELIABLE', font: 'Work Sans', b: true, color: '#FFFFFF', size: 23.7, lh: 1.2, x: 50, y: 48.35, pv: 16},
      {k: 'text', t: '打字机', font: 'Courier Prime', color: '#FFFFFF', size: 10.9, lh: 1.2, x: 50, y: 53.6, pv: 8},
    ]},
    {id: 'title.07', cat: 'title', lay: 'scene', n: 2, anim: true, dur: 3.5, order: 207, box: {x: 50, y: 48.83, w: 64.94, h: 26.81}, els: [
      {k: 'text', t: '写一句\n标题', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 44.8, w: 64.94, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.01, rot: 180}, x: 50, y: 46.29, a: {in: ['zoomIn', 0.6], out: ['fade', 0.7]}},
      {k: 'text', t: '这里是副标题', font: 'Plus Jakarta Sans', color: '#FFFFFF', size: 15.8, w: 61.75, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.04, rot: 180}, x: 50, y: 60.32, d: 0.53, a: {in: ['rise', 0.6], out: ['fade', 0.7]}},
    ]},
    {id: 'title.08', cat: 'title', lay: 'scene', n: 2, anim: true, dur: 5, order: 208, box: {x: 50, y: 50.85, w: 61.25, h: 21.6}, els: [
      {k: 'text', t: '深度\n解读\n', font: 'Bayon', b: true, color: '#FFF049', size: 61.6, lh: 0.8, w: 61.25, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.01, rot: 180}, x: 50, y: 50, a: {in: ['zoomIn', 0.6]}},
      {k: 'text', t: '在这里写一句标题', font: 'Plus Jakarta Sans', b: true, color: '#FFF049', size: 8.3, ls: 8.3, w: 61.2, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.03, rot: 85}, x: 50, y: 60.64, a: {in: ['rise', 0.6]}},
    ]},
    {id: 'title.09', cat: 'title', lay: 'scene', n: 1, anim: true, dur: 3.5, order: 209, box: {x: 50, y: 50, w: 72.67, h: 20.41}, els: [
      {k: 'text', t: '写一句\n标题', font: 'Plus Jakarta Sans', color: '#FFFFFF', size: 42.1, w: 72.67, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.01, rot: 180}, x: 50, y: 50, a: {out: ['fade', 0.7]}},
    ]},
    {id: 'title.10', cat: 'title', lay: 'scene', n: 2, anim: true, dur: 3.5, order: 210, box: {x: 50, y: 49.72, w: 75.19, h: 23.16}, els: [
      {k: 'text', t: '这里是\n一句标题', font: 'Libre Baskerville', b: true, color: '#FFFFFF', size: 37.1, lh: 1.1, w: 75.19, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.01, rot: 180}, x: 50, y: 46.39, a: {in: ['zoomIn', 0.6], out: ['fade', 0.7]}},
      {k: 'text', t: '点标题或正文的任意位置\n就能直接开始输入。\n', font: 'Libre Baskerville', b: true, color: '#FFFFFF', size: 8.5, lh: 1.3, w: 37.97, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.01, rot: 180}, x: 50, y: 59.07, a: {in: ['zoomIn', 0.6], out: ['fade', 0.7]}},
    ]},
    {id: 'lowerThird.01', cat: 'lower', lay: 'scene', n: 3, anim: true, dur: 3.97, order: 301, box: {x: 50, y: 50.41, w: 36.83, h: 14.92}, els: [
      {k: 'rect', color: '#FFFFFF', w: 33.17, h: 14.92, r: [7.4, 7.4, 7.4, 7.4], x: 48.17, y: 50.41, a: {in: ['wipe', 0.6], out: ['fade', 0.77]}},
      {k: 'text', t: '艺术指导', font: 'Newsreader', i: true, color: '#000000', size: 18.9, al: 'left', w: 27.85, x: 47.98, y: 53.96, d: 0.2, a: {out: ['fade', 0.97]}},
      {k: 'text', t: '苏知白', font: 'Just Me Again Down Here', i: true, color: '#000000', size: 40.9, al: 'left', w: 34.41, x: 51.21, y: 48.03, d: 0.13, a: {in: ['typewriter', 0.6], out: ['fade', 0.67]}},
    ]},
    {id: 'lowerThird.02', cat: 'lower', lay: 'scene', n: 3, anim: true, dur: 4.33, order: 302, box: {x: 50, y: 50, w: 37.38, h: 14.85}, els: [
      {k: 'rect', color: '#FFFFFF', w: 34.24, h: 14.85, r: [7.3, 7.3, 7.3, 7.3], x: 48.43, y: 50, a: {in: ['wipe', 0.6], out: ['fade', 0.7]}},
      {k: 'text', t: '林见川', font: 'Newsreader', i: true, color: '#000000', size: 27.1, al: 'left', w: 31.33, x: 48.88, y: 47.61, d: 0.2, a: {in: ['fade', 0.3], out: ['fade', 0.77]}},
      {k: 'text', t: '艺术指导', font: 'DM Sans', color: '#000000', size: 16.3, al: 'left', w: 35.61, x: 50.89, y: 53.29, d: 0.33, a: {in: ['fade', 0.3], out: ['fade', 0.93]}},
    ]},
    {id: 'lowerThird.03', cat: 'lower', lay: 'scene', n: 3, anim: true, dur: 4.07, order: 303, box: {x: 50, y: 50.2, w: 31.91, h: 17.13}, els: [
      {k: 'text', t: '动效设计', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 8.4, al: 'left', w: 17.28, bg: {color: '#053AED', pad: 2.1, r: 0, mode: 'block'}, sh: {color: '#000000', a: 0.34, blur: 0.13, dist: 0.01, rot: 180}, x: 43.22, y: 57.32, d: 0.17, a: {out: ['fade', 0.7]}},
      {k: 'text', t: '周砚白', font: 'Climate Crisis', color: '#000000', size: 23.4, lh: 0.8, al: 'left', w: 31.91, x: 50, y: 51.69, a: {in: ['zoomIn', 0.6], out: ['fade', 0.6]}},
      {k: 'diamond', color: '#111111', w: 3.21, h: 5.53, x: 35.65, y: 44.4, a: {in: ['zoomIn', 0.6], out: ['fade', 0.6]}},
    ]},
    {id: 'lowerThird.04', cat: 'lower', lay: 'scene', n: 2, anim: true, dur: 4, order: 304, box: {x: 49.91, y: 49.19, w: 34.49, h: 11.79}, els: [
      {k: 'text', t: '沈屿声', font: 'Poppins', b: true, color: '#000000', size: 19.4, lh: 0.8, al: 'left', w: 29.67, bg: {color: '#AE8AFF', pad: 4.9, r: 5.9, mode: 'block'}, x: 47.5, y: 45.85, a: {in: ['zoomIn', 0.6], out: ['zoomOut', 0.6]}},
      {k: 'text', t: '艺术指导', font: 'Poppins', b: true, color: '#AE8AFF', size: 19.4, lh: 0.8, al: 'left', w: 31.45, bg: {color: '#000000', pad: 4.9, r: 5.9, mode: 'block'}, x: 51.43, y: 52.52, d: 0.07, a: {in: ['zoomIn', 0.6], out: ['zoomOut', 0.6]}},
    ]},
    {id: 'lowerThird.05', cat: 'lower', lay: 'scene', n: 2, anim: true, dur: 3.33, order: 305, box: {x: 20.42, y: 66.93, w: 33.65, h: 14.45}, els: [
      {k: 'text', t: '林\n见川', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 25.3, lh: 0.95, al: 'left', w: 33.65, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.01, rot: 180}, x: 20.42, y: 64.56, a: {in: ['slideR', 0.6], out: ['fade', 0.63]}},
      {k: 'text', t: '媒体关系统筹\n兼市场副总裁', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 7.5, lh: 1.1, al: 'left', w: 31.06, bg: {color: '#5544CC', pad: 1.9, r: 0, mode: 'block'}, x: 19.75, y: 72.1, a: {in: ['rise', 0.6], out: ['fade', 0.6]}},
    ]},
    {id: 'lowerThird.06', cat: 'lower', lay: 'scene', n: 2, anim: true, dur: 3.4, order: 306, box: {x: 19.12, y: 69.4, w: 29.77, h: 9.83}, els: [
      {k: 'text', t: '工作室创始人', font: 'Plus Jakarta Sans', b: true, color: '#323232', size: 9.1, al: 'left', w: 22.01, bg: {color: '#FFFFFF', pad: 2.3, r: 2.8, mode: 'block'}, x: 15.24, y: 72.75, a: {in: ['slideR', 0.6], out: ['slideL', 0.63]}},
      {k: 'text', t: '郑立言', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 18.1, al: 'left', w: 29.41, bg: {color: '#5544CC', pad: 4.5, r: 5.4, mode: 'block'}, x: 19.3, y: 67.59, a: {in: ['slideR', 0.6], out: ['slideL', 0.83]}},
    ]},
    {id: 'lowerThird.07', cat: 'lower', lay: 'scene', n: 4, anim: true, dur: 3.7, order: 307, box: {x: 19.78, y: 69.86, w: 31.8, h: 8.68}, els: [
      {k: 'rect', color: '#5544CC', w: 30.92, h: 7.76, x: 20.22, y: 70.32, a: {in: ['wipe', 0.6], out: ['wipe', 0.67]}},
      {k: 'rect', color: '#FFFFFF', w: 30.71, h: 7.58, x: 19.23, y: 69.31, a: {in: ['wipe', 0.6], out: ['wipe', 0.67]}},
      {k: 'text', t: '动效设计', font: 'Plus Jakarta Sans', b: true, color: '#323232', size: 9.5, al: 'left', w: 28.04, x: 19.39, y: 70.62, d: 0.27, a: {in: ['slideR', 0.6], out: ['slideL', 0.63]}},
      {k: 'text', t: '陈叙白', font: 'Plus Jakarta Sans', b: true, color: '#323232', size: 14, al: 'left', w: 28.03, x: 19.32, y: 68.01, d: 0.27, a: {in: ['slideR', 0.6], out: ['slideL', 0.63]}},
    ]},
    {id: 'lowerThird.08', cat: 'lower', lay: 'scene', n: 3, anim: true, dur: 3.87, order: 308, box: {x: 20.04, y: 66.44, w: 32.46, h: 16.04}, els: [
      {k: 'rect', color: '#5544CC', w: 1.34, h: 15.05, x: 4.48, y: 66.63, d: 0.3, a: {in: ['wipe', 0.6], out: ['wipe', 0.63]}},
      {k: 'text', t: '高\n行舟', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 36.6, lh: 0.9, al: 'left', w: 30.09, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.01, rot: 180}, x: 21.23, y: 65.08, a: {in: ['slideR', 0.6], out: ['slideL', 0.63]}},
      {k: 'text', t: '产品经理', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 10, ls: 10, al: 'left', w: 25.22, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.01, rot: 180}, x: 19.17, y: 73.25, d: 0.37, a: {in: ['rise', 0.5], out: ['fade', 0.73]}},
    ]},
    {id: 'lowerThird.09', cat: 'lower', lay: 'scene', n: 4, anim: true, dur: 3.6, order: 309, box: {x: 15.96, y: 65.53, w: 24.2, h: 17.52}, els: [
      {k: 'rect', color: '#FFFFFF', w: 24.15, h: 8.86, x: 15.94, y: 61.2, a: {in: ['wipe', 0.6], out: ['wipe', 0.63]}},
      {k: 'rect', color: '#5544CC', w: 24.2, h: 8.85, x: 15.96, y: 69.87, d: 0.03, a: {in: ['wipe', 0.6], out: ['wipe', 0.63]}},
      {k: 'text', t: '陈\n叙白', font: 'Plus Jakarta Sans', b: true, color: '#5544CC', size: 16.1, lh: 0.85, al: 'left', w: 21.03, x: 16.18, y: 61, d: 0.2, a: {in: ['slideR', 0.6], out: ['slideL', 0.63]}},
      {k: 'text', t: '产品经理\n影视制作部', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 9.9, al: 'left', w: 21.41, x: 16.42, y: 69.81, d: 0.2, a: {in: ['rise', 0.6], out: ['fade', 0.73]}},
    ]},
    {id: 'lowerThird.10', cat: 'lower', lay: 'scene', n: 3, anim: true, dur: 3.8, order: 310, box: {x: 21.35, y: 67.89, w: 35.35, h: 13.13}, els: [
      {k: 'text', t: '温', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 24.8, lh: 0.9, al: 'left', w: 30.81, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.01, rot: 180}, x: 19.08, y: 63.58, a: {in: ['slideL', 0.6], out: ['fade', 0.63]}},
      {k: 'text', t: '亦然', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 24.8, lh: 0.9, al: 'left', w: 30.81, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.01, rot: 180}, x: 19.08, y: 68.27, a: {in: ['slideR', 0.6], out: ['fade', 0.63]}},
      {k: 'text', t: '艺术指导 · 创意工作室', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 10.1, ls: 10.1, al: 'left', w: 34.69, bg: {color: '#5544CC', pad: 2.6, r: 0}, x: 21.68, y: 72.71, d: 0.57, a: {in: ['rise', 0.6], out: ['fade', 0.63]}},
    ]},
    {id: 'lowerThird.11', cat: 'lower', lay: 'scene', n: 3, anim: true, dur: 3.7, order: 311, box: {x: 17.99, y: 68.39, w: 27.52, h: 11.66}, els: [
      {k: 'text', t: '上海', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 9.3, al: 'left', w: 8.53, bg: {color: '#5544CC', pad: 2.3, r: 0, mode: 'block'}, x: 8.5, y: 64.15, a: {in: ['slideR', 0.6], out: ['slideL', 0.63]}},
      {k: 'rect', color: '#5544CC', w: 27.02, h: 7.19, x: 18.24, y: 70.62, d: 0.03, a: {in: ['slideR', 0.6], out: ['slideL', 0.63]}},
      {k: 'text', t: '马砚', font: 'Plus Jakarta Sans', b: true, color: '#5544CC', size: 19.8, ls: 19.8, al: 'left', w: 24.97, bg: {color: '#FFFFFF', pad: 5, r: 0, mode: 'block'}, x: 17.15, y: 69.6, d: 0.02, a: {in: ['slideR', 0.6], out: ['slideL', 0.63]}},
    ]},
    {id: 'lowerThird.12', cat: 'lower', lay: 'scene', n: 4, anim: true, dur: 3.67, order: 312, box: {x: 19.1, y: 69.95, w: 30.65, h: 8.57}, els: [
      {k: 'rect', color: '#FFFFFF', alpha: 0.302, w: 30.64, h: 8.57, x: 19.1, y: 69.95, d: 0.53, a: {in: ['wipe', 0.6], out: ['wipe', 0.63]}},
      {k: 'rect', color: '#5544CC', w: 1.85, h: 8.56, x: 4.7, y: 69.96, a: {in: ['wipe', 0.6], out: ['wipe', 0.3]}},
      {k: 'text', t: '创意监制', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 8, al: 'left', w: 18, sh: {color: '#000000', a: 0.1, blur: 0.5, dist: 0.01, rot: 90}, x: 16.55, y: 71.53, d: 0.7, a: {in: ['slideR', 0.3], out: ['slideL', 0.37]}},
      {k: 'text', t: '卢青野', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 14.8, al: 'left', w: 25.96, sh: {color: '#000000', a: 0.1, blur: 0.3, dist: 0.06, rot: 90}, x: 20.36, y: 68.6, d: 0.7, a: {in: ['slideR', 0.3], out: ['slideL', 0.37]}},
    ]},
    {id: 'lowerThird.13', cat: 'lower', lay: 'scene', n: 2, anim: true, dur: 3.8, order: 313, box: {x: 18.96, y: 66.92, w: 30.26, h: 15.17}, els: [
      {k: 'text', t: '沈\n屿声', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 31.9, lh: 0.9, al: 'left', w: 30.26, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.01, rot: 180}, x: 18.96, y: 65.13, a: {in: ['slideR', 0.6], out: ['fade', 0.67]}},
      {k: 'text', t: '艺术指导 @ 屿声工作室', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 9.6, al: 'left', w: 29.3, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.01, rot: 180}, x: 18.53, y: 73.34, d: 0.7, a: {in: ['rise', 0.6], out: ['fade', 0.7]}},
    ]},
    {id: 'lowerThird.14', cat: 'lower', lay: 'scene', n: 3, anim: true, dur: 3.63, order: 314, box: {x: 21.5, y: 66.7, w: 34.22, h: 15.27}, els: [
      {k: 'text', t: '麦承宇', font: 'Plus Jakarta Sans', b: true, color: '#323232', size: 14.1, al: 'left', w: 34.03, bg: {color: '#FFFFFF', pad: 3.6, r: 4.2}, x: 21.51, y: 61.5, a: {in: ['slideR', 0.6], out: ['slideL', 0.6]}},
      {k: 'text', t: '创意监制', font: 'Plus Jakarta Sans', b: true, color: '#323232', size: 14.1, al: 'left', w: 34.19, bg: {color: '#FFFFFF', pad: 3.6, r: 4.2}, x: 21.51, y: 66.74, a: {in: ['slideL', 0.6], out: ['slideR', 0.6]}},
      {k: 'text', t: '@ 创意组', font: 'Inter', b: true, color: '#FFFFFF', size: 14.1, al: 'left', w: 31.33, bg: {color: '#5544CC', pad: 3.6, r: 4.2}, x: 20.05, y: 71.9, a: {in: ['slideR', 0.6], out: ['slideL', 0.6]}},
    ]},
    {id: 'lowerThird.15', cat: 'lower', lay: 'scene', n: 2, anim: true, dur: 3.28, order: 315, box: {x: 18.89, y: 66.68, w: 29.25, h: 15.28}, els: [
      {k: 'text', t: '陈\n叙白', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 22.3, lh: 1.05, al: 'left', w: 28.81, bg: {color: '#5544CC', pad: 5.6, r: 0}, x: 19.11, y: 64.9, a: {in: ['slideR', 0.6], out: ['slideL', 0.65]}},
      {k: 'text', t: '上海 · 2026', font: 'Plus Jakarta Sans', b: true, color: '#323232', size: 10.2, w: 18.98, bg: {color: '#FFFFFF', pad: 2.6, r: 0, mode: 'block'}, x: 13.76, y: 72.56, d: 0.01, a: {in: ['slideR', 0.6], out: ['slideL', 0.83]}},
    ]},
    {id: 'lowerThird.16', cat: 'lower', lay: 'scene', n: 2, anim: true, dur: 3.73, order: 316, box: {x: 21.39, y: 68.7, w: 35.45, h: 11.2}, els: [
      {k: 'rect', color: '#5544CC', w: 12.83, h: 1.25, x: 10.35, y: 73.67, d: 0.43, a: {in: ['wipe', 0.6], out: ['wipe', 0.6]}},
      {k: 'text', t: '贺\n知遥', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 24.7, lh: 0.95, al: 'left', w: 35.45, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.01, rot: 180}, x: 21.39, y: 67.84, a: {in: ['rise', 0.6], out: ['fade', 0.63]}},
    ]},
    {id: 'lowerThird.17', cat: 'lower', lay: 'scene', n: 2, anim: true, dur: 3.8, order: 317, box: {x: 20.24, y: 69.86, w: 32.98, h: 8.92}, els: [
      {k: 'text', t: '姜叙', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 25.4, ls: 50.8, al: 'left', w: 32.98, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.04, rot: 180}, x: 20.24, y: 68.48, a: {in: ['rise', 0.6], out: ['fade', 0.63]}},
      {k: 'text', t: '资深剪辑', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 9.3, ls: 9.3, al: 'left', w: 22.88, bg: {color: '#5544CC', pad: 2.4, r: 0, mode: 'block'}, x: 15.71, y: 72.71, d: 0.33, a: {in: ['slideR', 0.6], out: ['fade', 0.73]}},
    ]},
    {id: 'lowerThird.18', cat: 'lower', lay: 'scene', n: 3, anim: true, dur: 3.37, order: 318, box: {x: 22.39, y: 70.97, w: 36.98, h: 6.52}, els: [
      {k: 'ellipse', color: '#5544CC', w: 6.3, h: 6.3, x: 7.05, y: 70.97, a: {in: ['slideR', 0.6], out: ['fade', 0.67]}},
      {k: 'arrow', color: null, w: 2.75, h: 2.54, x: 7.07, y: 70.98, a: {in: ['slideR', 0.6], out: ['fade', 0.67]}},
      {k: 'text', t: '沈屿声', font: 'Plus Jakarta Sans', color: '#FFFFFF', size: 18.9, al: 'left', w: 28.74, bg: {color: '#5544CC', pad: 4.8, r: 0}, x: 26.51, y: 70.97, d: 0.16, a: {in: ['wipe', 0.6], out: ['fade', 0.67]}},
    ]},
    {id: 'lowerThird.19', cat: 'lower', lay: 'scene', n: 3, anim: true, dur: 4.47, order: 319, box: {x: 19.45, y: 70.1, w: 31.17, h: 9.05}, els: [
      {k: 'rect', color: '#5544CC', w: 1.04, h: 7.29, x: 4.39, y: 70.51, a: {in: ['wipe', 0.6], out: ['wipe', 0.73]}},
      {k: 'text', t: '@anli', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 25.1, al: 'left', w: 29.01, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.01, rot: 180}, x: 20.53, y: 68.62, d: 0.03, a: {in: ['rise', 0.6], out: ['fade', 0.63]}},
      {k: 'text', t: '上海', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 12.7, al: 'left', w: 26.16, sh: {color: '#000000', a: 0.1, blur: 0.2, dist: 0.01, rot: 180}, x: 19.28, y: 73.09, d: 0.03, a: {in: ['rise', 0.6], out: ['fade', 0.63]}},
    ]},
    {id: 'lowerThird.20', cat: 'lower', lay: 'scene', n: 3, anim: true, dur: 4.3, order: 320, box: {x: 19.68, y: 70.12, w: 31.59, h: 8.32}, els: [
      {k: 'rect', color: '#5544CC', w: 31.59, h: 8.32, r: [4.1, 4.1, 4.1, 4.1], x: 19.68, y: 70.12, a: {in: ['wipe', 0.6], out: ['fade', 0.69]}},
      {k: 'text', t: '陈叙白', font: 'Plus Jakarta Sans', b: true, color: '#FFFFFF', size: 11.5, al: 'left', w: 28.45, x: 20.51, y: 69.02, d: 0.3, a: {in: ['fade', 0.6], out: ['fade', 0.6]}},
      {k: 'text', t: '市场总监', font: 'Plus Jakarta Sans', color: '#D1D3FB', size: 9.4, al: 'left', w: 22.11, x: 17.42, y: 71.5, d: 0.3, a: {in: ['fade', 0.6], out: ['fade', 0.69]}},
    ]},
    {id: 'other.01', cat: 'other', lay: 'scene', n: 2, anim: true, dur: 4.43, order: 401, box: {x: 50, y: 50, w: 76.59, h: 30.01}, els: [
      {k: 'text', t: '这是你的', font: 'Anton', color: '#FFFFFF', size: 51.3, lh: 1.1, al: 'left', w: 49.5, bg: {color: '#000000', pad: 12.8, r: 0, mode: 'block'}, x: 36.46, y: 43.28, a: {in: ['drop', 0.6]}},
      {k: 'text', t: '演示标题', font: 'Anton', color: '#FFFFFF', size: 51.3, lh: 1.1, al: 'left', w: 76.59, bg: {color: '#000000', pad: 12.8, r: 0, mode: 'block'}, x: 50, y: 56.72, a: {in: ['rise', 0.6]}},
    ]},
    {id: 'other.02', cat: 'other', lay: 'stack', n: 3, anim: true, dur: 5, order: 402, box: {x: 50, y: 50, w: 100, h: 62.99}, els: [
      {k: 'text', t: '正在直播', font: 'Anton', color: '#000000', size: 74.2, lh: 1.2, w: 100, x: 50, y: 27.5, pv: 16, a: {in: ['drop', 0.6]}},
      {k: 'text', t: '正在直播', font: 'Anton', color: '#000000', size: 74.2, lh: 1.2, w: 100, x: 50, y: 50, pv: 16, a: {in: ['rise', 0.6]}},
      {k: 'text', t: '正在直播', font: 'Anton', color: '#000000', size: 74.2, lh: 1.2, w: 100, x: 50, y: 72.5, pv: 16, a: {in: ['drop', 0.6]}},
    ]},
    {id: 'other.03', cat: 'other', lay: 'stack', n: 1, anim: false, dur: 5, order: 403, box: {x: 50, y: 50, w: 100, h: 30.6}, els: [
      {k: 'text', t: '糖果\r\n小铺', font: 'Shrikhand', color: '#6D36D5', size: 89.1, lh: 0.85, w: 100, x: 50, y: 50, pv: 23},
    ]},
    {id: 'other.04', cat: 'other', lay: 'stack', n: 1, anim: false, dur: 5, order: 404, box: {x: 50, y: 50, w: 100, h: 43.2}, els: [
      {k: 'text', t: '好\r\n心情', font: 'Monoton', color: '#FFFFFF', size: 89.1, lh: 1.2, w: 100, x: 50, y: 50, pv: 20},
    ]},
    {id: 'other.05', cat: 'other', lay: 'stack', n: 3, anim: true, dur: 5, order: 405, box: {x: 50, y: 50.59, w: 80, h: 27.41}, els: [
      {k: 'text', t: '感谢', font: 'Archivo Black', color: '#000000', size: 29.7, lh: 1.2, w: 80, x: 50, y: 40.48, pv: 8, a: {in: ['drop', 0.6]}},
      {k: 'text', t: '观看', font: 'Archivo Black', color: '#FFFFFF', size: 49.5, lh: 1.2, w: 80, bg: {color: '#FF0800', pad: 12.4, r: 0, mode: 'block'}, x: 50, y: 52.47, d: 0.4, pv: 13, a: {in: ['pop', 0.6]}},
      {k: 'text', t: '点赞、评论、订阅', font: 'Roboto', b: true, color: '#000000', size: 13.4, lh: 1.2, w: 80, bg: {color: '#F5F000', pad: 3.3, r: 4, mode: 'block'}, x: 50, y: 62, d: 1.8, pv: 4, a: {in: ['rise', 0.6]}},
    ]},
    {id: 'other.06', cat: 'other', lay: 'stack', n: 1, anim: false, dur: 5, order: 406, box: {x: 50, y: 50, w: 100, h: 26.98}, els: [
      {k: 'text', t: '咖啡\r\n时间', font: 'Shrikhand', color: '#FFFFFF', size: 74.2, lh: 0.9, w: 100, x: 50, y: 50, pv: 23},
    ]},
    {id: 'other.07', cat: 'other', lay: 'stack', n: 2, anim: false, dur: 5, order: 407, box: {x: 50, y: 51.28, w: 100, h: 47.23}, els: [
      {k: 'text', t: '健康\r\n餐！', font: 'Lemon', color: '#FFFFFF', size: 64.3, lh: 1.2, w: 100, x: 50, y: 43.25, pv: 20},
      {k: 'text', t: '食谱', font: 'Homemade Apple', color: '#FFFFFF', size: 44.5, lh: 1.2, w: 100, x: 50, y: 69.5, pv: 14},
    ]},
    {id: 'other.08', cat: 'other', lay: 'stack', n: 5, anim: true, dur: 5, order: 408, box: {x: 50, y: 50, w: 100, h: 100.8}, els: [
      {k: 'text', t: '健身', font: 'Archivo Black', color: '#000000', alpha: 0, size: 69.3, lh: 1.2, w: 100, ol: {color: '#E8005D', w: 4.6}, x: 50, y: 8, pv: 14, a: {in: ['drop', 0.6]}},
      {k: 'text', t: '健身', font: 'Archivo Black', color: '#000000', alpha: 0, size: 69.3, lh: 1.2, w: 100, ol: {color: '#E8005D', w: 4.6}, x: 50, y: 29, pv: 14, a: {in: ['rise', 0.6]}},
      {k: 'text', t: '健身', font: 'Archivo Black', color: '#E8005D', size: 69.3, lh: 1.2, w: 100, sh: {color: '#F65D94', a: 0.57, blur: 0.2, dist: 0.03, rot: 45}, x: 50, y: 50, pv: 14, a: {in: ['drop', 0.6]}},
      {k: 'text', t: '健身', font: 'Archivo Black', color: '#000000', alpha: 0, size: 69.3, lh: 1.2, w: 100, ol: {color: '#E8005D', w: 4.6}, x: 50, y: 71, pv: 14, a: {in: ['rise', 0.6]}},
      {k: 'text', t: '健身', font: 'Archivo Black', color: '#000000', alpha: 0, size: 69.3, lh: 1.2, w: 100, ol: {color: '#E8005D', w: 4.6}, x: 50, y: 92, pv: 14, a: {in: ['drop', 0.6]}},
    ]},
  ];

  /* ---------- 预设成员 ↔ 样式袋 ----------
     面板改的是样式袋（键名是 `font` / `size` / `bold`…，见 `BC_EL.SHARED.text`），
     预设数据用的是紧凑键（`b` / `i` / `al`…）。两边各画一遍就会分叉，所以只留这一对
     互转，画布与目录卡都走 `textCss`。装饰三件（底 / 影 / 描边）原样带过去——它们
     今天没有面板控件，但画面上得画出来，丢了这张卡就不是这张卡了。 */
  function toStyle(e) {
    const st = {font: e.font, size: e.size, color: e.color, bold: !!e.b, italic: !!e.i,
      align: e.al || 'center', lineHeight: e.lh || 1, letterSpacing: e.ls || 0};
    if (e.alpha != null) st.alpha = e.alpha;
    if (e.bg) st.bg = e.bg;
    if (e.sh) st.sh = e.sh;
    if (e.ol) st.ol = e.ol;
    return st;
  }
  function fromStyle(st) {
    const s = st || {};
    return {font: s.font, size: s.size, color: s.color, b: !!s.bold, i: !!s.italic,
      al: s.align, lh: s.lineHeight, ls: s.letterSpacing, alpha: s.alpha,
      bg: s.bg, sh: s.sh, ol: s.ol};
  }

  /** 目录卡上「几件」那个角标只数画面上的件数，与 `els.length` 同义 */
  function byCat(cat) {
    return cat && cat !== 'all' ? PRESETS.filter((p) => p.cat === cat) : PRESETS.slice();
  }
  function get(id) { return PRESETS.filter((p) => p.id === id)[0] || null; }

  /* ---------- 画一条成员 ----------
     目录卡与画布走**同一条**换算：卡片传的是缩略图那点大小的 k，画布传的是舞台缩放
     系数。两边各写一份的话，「点下去画面就是缩略图的样子」这句话第二天就不成立了。 */
  const px = (v, k) => Math.round(v * k * 100) / 100;

  /** 文字成员 → 行内样式（k = 相对 880×495 基准的缩放系数） */
  function textCss(e, k) {
    const sz = px(e.size || 24, k);
    const st = {
      fontFamily: fontStack(e.font), fontSize: sz,
      fontWeight: e.b ? 800 : 400, fontStyle: e.i ? 'italic' : null,
      lineHeight: e.lh == null ? 1.2 : e.lh, textAlign: e.al || 'center',
      whiteSpace: 'pre-wrap', margin: 0,
      /* alpha 为 0 的那几条是**只留描边的空心字**（other.08），不能用 opacity 压——
         那样连描边一起没了。 */
      color: e.alpha === 0 ? 'transparent' : e.color,
      opacity: e.alpha == null || e.alpha === 0 ? null : e.alpha,
    };
    if (e.ls) st.letterSpacing = px(e.ls, k);
    if (e.bg && e.bg.enabled !== false) {
      st.background = e.bg.color;
      st.padding = px(e.bg.pad || 0, k) + 'px';
      st.borderRadius = px(e.bg.r || 0, k);
      /* `wrap` 是**逐行**贴底（每行一块），`block` 是整块一张底。 */
      if (e.bg.mode !== 'block') {
        st.display = 'inline'; st.boxDecorationBreak = 'clone';
        st.WebkitBoxDecorationBreak = 'clone';
      }
      if (e.bg.alpha != null) st.background = rgba(e.bg.color, e.bg.alpha);
    }
    if (e.sh && e.sh.enabled !== false) {
      const rad = (e.sh.rot || 0) * Math.PI / 180;
      st.textShadow = px(e.sh.dist * Math.cos(rad) * e.size, k) + 'px '
        + px(e.sh.dist * Math.sin(rad) * e.size, k) + 'px '
        + px(e.sh.blur * e.size, k) + 'px ' + rgba(e.sh.color, e.sh.a);
    }
    if (e.ol && e.ol.enabled !== false) {
      st.WebkitTextStroke = px(e.ol.w, k) + 'px ' + e.ol.color;
      st.paintOrder = 'stroke fill';
    }
    return st;
  }

  /** #RRGGBB + 透明度 → rgba()（阴影色只在这里用，画面内容色不进 token 表） */
  function rgba(hex, a) {
    const h = String(hex || '#000000').replace('#', '');
    const rgb = h.length === 8 ? h.slice(0, 6) : h;
    const n = parseInt(rgb.length === 3 ? rgb.split('').map((c) => c + c).join('') : rgb, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ','
      + ((a == null ? 1 : a) * (h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1)) + ')';
  }

  /** 形状成员 → 行内样式 */
  function shapeCss(e, k) {
    const st = {background: e.color, width: e.w + '%', paddingTop: (e.h * 495 / 880) + '%'};
    if (e.alpha != null) st.opacity = e.alpha;
    if (e.k === 'ellipse') st.borderRadius = '50%';
    else if (e.r) st.borderRadius = e.r.map((r) => px(r, k) + 'px').join(' ');
    if (e.k === 'diamond') st.clipPath = 'polygon(50% 0,100% 50%,50% 100%,0 50%)';
    if (e.k === 'arrow') st.clipPath = 'polygon(0 30%,60% 30%,60% 0,100% 50%,60% 100%,60% 70%,0 70%)';
    return st;
  }

  /** 一条成员在画面上的落位（相对某个原点偏移；dx/dy 是整组被拖走的量） */
  function placeCss(e, dx, dy) {
    return {position: 'absolute', left: (e.x + (dx || 0)) + '%', top: (e.y + (dy || 0)) + '%',
      transform: 'translate(-50%, -50%)' + (e.rot ? ' rotate(' + e.rot + 'deg)' : ''),
      width: (e.w != null && e.k === 'text' ? e.w + '%' : e.k === 'text' ? 'auto' : e.w + '%')};
  }

  window.BC_TP = {CATS, FONTS, FONT_STACKS, ANIMS, DIR4, PRESETS, FROM_CORE,
    fontStack, find, fromCore, animOf, byCat, get, toStyle, fromStyle,
    textCss, shapeCss, placeCss, rgba, px};
})();
