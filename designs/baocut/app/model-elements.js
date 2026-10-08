/* 元素目录的纯数据与派生（§14；第 39 轮重整，第 60 轮对齐核心）。

   四张表各有各的真相来源，第 60 轮起不再是一处手写：

   * **调色板** = 一张常量表：七色 × BASE/LIGHTER/DARKER，三档都是定值。
     此前 DARKER 一档只有红色是定值，其余是「按同一幅度压暗」猜的。
   * **形状网格** = 24 格 ＋ 取模五色环，与
     `apps/baocut` 的 `projection::element_tiles` 同一张表：**格子的颜色是格子的属性**，
     不是形状的属性（星形是红的，因为它排在第 21 格）。
   * **声波 / 进度** = `core/presets/builtin/{visualizer,progress}/*.json`：默认主副色、
     默认 dB、颜色控件个数与标签、有没有「控制」区块，全部读核心，不再猜。
   * **动画** = In 13 / Out 13 / Loop 10 ＋ Zoom 四档。

   这一层不碰 DOM，node --test 直接 require。 */
(function () {
  /* ---------- 调色板 ----------
     这些是**画进视频画面**的填色，不是 S2 表面，按文件登记在 _ds_conformance.json
     的 allow 里。`lighter` 是进度条的轨道色（核心配方的 `defaultSecondaryColor`
     取的就是它），`outline` 是形状网格的描边色（`DARKER` 那一档）。 */
  const PALETTE = {
    red:    {fill: '#FF4C45', lighter: '#FFC9C7', outline: '#E43A33', label: '红'},
    orange: {fill: '#FFAC46', lighter: '#FFE6C8', outline: '#E19436', label: '橙'},
    yellow: {fill: '#FFD646', lighter: '#FFF3C8', outline: '#E2BE3C', label: '黄'},
    green:  {fill: '#70DB74', lighter: '#D4F4D5', outline: '#57C35B', label: '绿'},
    blue:   {fill: '#3CADFF', lighter: '#C4E6FF', outline: '#3598DF', label: '蓝'},
    pink:   {fill: '#FF9FDC', lighter: '#FFE2F5', outline: '#E97FC2', label: '粉'},
    purple: {fill: '#A46CFF', lighter: '#E4D3FF', outline: '#8A5BD8', label: '紫'},
    white:  {fill: '#FFFFFF', lighter: '#FFFFFF', outline: '#D8D8D8', label: '白'},
  };
  /** 全透明（`TRANSPARENT`），进度条边框类的默认副色就是它 */
  const TRANSPARENT = '#FFFFFF00';
  /** 彩虹档（`rainbow_border` / `snake_rainbow` 那四款）的色环：调色板的六个 BASE。
      写在这里而不是各画各的——两处缩略图与画布要是三份色环，改一次就漂一处。 */
  const RAINBOW = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
  // 形状网格的取模五色环：第 5 格回到蓝，不是绿
  const SHAPE_CYCLE = ['red', 'blue', 'yellow', 'purple', 'blue'];
  const swatchList = () => ['red', 'orange', 'yellow', 'green', 'blue', 'pink', 'purple', 'white']
    .map((k) => PALETTE[k].fill);

  /* ---------- 形状 ----------
     路径统一画在 100×100 视框里，渲染时按元素的 width/height 拉伸。

     **几何不在这个文件里**：`model-shape-paths.js`（`window.BC_SHAPE`）是
     `core/presets/builtin/shape/*.json` 的生成物，与 `apps/baocut`、`apps/mac`、
     `designs/baocut-mac` 三份孪生同一个生成器、同一次写盘发出来
     （`apps/mac/scripts/gen_element_shape_paths.sh`）。第 39 轮那份
     手描的 24 条在第 60.2 轮删了：它与核心逐条不同，同一个 id 在原型上与在
     App v2、Mac 上画的是两个东西，而用户是靠缩略图认形状的。

     固定轮廓由 scripts/dev/elements/geometry.py 生成。
     旧 style id 继续可读，显示名按实际图形解释；rect / ellipse / segment 保持参数化。

     留在这里的只有参数化的两类：`rect` 磁贴与画布都用 `<rect>` 画（这条 `d` 只是
     兜底），`ellipse` 在核心是参数化椭圆，两者都不进生成表。 */
  const P = Object.assign({
    rect:     'M0 0H100V100H0Z',
    ellipse:  'M50 0A50 50 0 0 1 50 100A50 50 0 0 1 50 0Z',
  }, window.BC_SHAPE.D);
  /** 显示名照**画面**取，不照 id——见上。与 `apps/mac` 的 `ElementCatalogue` 对齐 */
  const SHAPE_NAMES = {
    rect: '矩形', ellipse: '椭圆', triangle: '三角形', rombus: '菱形', pentagon: '五边形',
    hex: '六边形', octagon: '八边形', squig: '波浪边圆', squig2: '块状箭头', line: '直线',
    arrow: '箭头', tick: '对勾', tick2: '叉', chevron: '下尖角', chevron2: '锯齿带',
    cross2: '圆角加号', cross: '加号', love2: '圆角心形', love: '心形', diamond: '钻石',
    star: '五角星', sharp: '十角芒星', star2: '十二角芒星', sharp2: '对话气泡',
  };

  /* 形状网格的 24 格，逐格 `[样式 id, 圆角]`——**下标就是取色下标**，插一格会把
     它后面所有格子的颜色都换掉。圆角那一格与直角那一格是同一个 `rect`：两个预设格，
     不是两种形状（所以形状枚举是 23 名，网格是 24 格）。

     第 11 格的 `arrow` 在网格里占一格，但它是**端点形状**
     （核心 `shape/arrow.json` 的 params 是 `endpoints`/`head`）。它曾与 `line` 一起
     归批注组；批注整类退场之后两款都不出格（与 `bcut-editor-core` 的
     `ENDPOINT_SHAPES` 同解）。它留在这张表里只为占住取色下标——挪掉它会把后面
     13 格的颜色全换一遍。 */
  const SHAPE_TILES = [
    ['rect', 0], ['rect', 10], ['ellipse', 0], ['triangle', 0],
    ['rombus', 0], ['pentagon', 0], ['hex', 0], ['octagon', 0],
    ['squig', 0], ['squig2', 0], ['arrow', 0], ['tick', 0],
    ['tick2', 0], ['chevron', 0], ['chevron2', 0], ['cross2', 0],
    ['cross', 0], ['love2', 0], ['love', 0], ['diamond', 0],
    ['star', 0], ['sharp', 0], ['star2', 0], ['sharp2', 0],
  ];
  const ARROW_TILE = 10;
  // 形状网格的描边粗细（outlineWidth）
  const OUTLINE_W = 3;

  /** 第 i 格的默认外观（取模五色环） */
  function shapeColor(i) {
    const p = PALETTE[SHAPE_CYCLE[i % SHAPE_CYCLE.length]];
    return {fill: p.fill, outline: p.outline};
  }
  const tileOf = (i) => {
    const [k, r] = SHAPE_TILES[i];
    const c = shapeColor(i);
    return {k, i, r, name: SHAPE_NAMES[k], path: P[k],
      fill: c.fill, outline: c.outline, outlineW: OUTLINE_W};
  };
  /** 形状组：网格顺序，跳过不出格的端点形状 arrow（23 格） */
  const SHAPES = SHAPE_TILES.map((_, i) => i).filter((i) => i !== ARROW_TILE).map(tileOf);
  /** 按网格下标取一格。**下标是网格位次，不是数组位次**——arrow 不出格，
      形状数组少了一格，用数组下标去查会从 tick 起整体错位一格。 */
  function shapeAt(i) {
    return SHAPES.filter((s) => s.i === i)[0] || SHAPES[0];
  }
  /** 唯一形状名（核心 `shape/*.json` 的 24 个 id 减去两款端点形状：网格 23 名） */
  function shapeNames() {
    const out = [];
    SHAPES.forEach((s) => { if (out.indexOf(s.k) < 0) out.push(s.k); });
    return out;
  }

  /* ---------- 可视化 · 声波（10 款自有配方，第 232 轮） ----------
     整表来自 `core/presets/builtin/visualizer/*.json`：`numColors` 决定色板出几个、
     `labels` 是那几个色板的标题（Bars / Wave / Fill / Line / Dots / Peaks / Core / Rings /
     Ribbon A / Ribbon B）、`db:false` 表示这一款**整个「控制」区块不渲染**
     （读时域行的示波器两款：oscilloscope / ring_wave）。
     旧版 15 款的 id 在核心经别名表落到这 10 款（trio_wave / formation* → bars 族，
     beam → oscilloscope，simi / harmony / waves → ribbons，frequency_lines / echo_lines → dots，
     ripple_wave → pulse_rings），原型只认新 id。
     缩略图不在这张表里：10 枚示意图 SVG 在 `model-waveicons.js`（`scripts/dev/elements/
     geometry.py` 按配方族生成），按 `k` 取。 */
  const W = (k, name, en, n, labels, main, second, min, max, db, aspect) =>
    ({k, name, en, fam: 'wave', colors: n, labels, main, second, minDb: min, maxDb: max,
      db: db, aspect});
  const WAVES = [
    W('bars', '柱状', 'Bars', 1, ['柱'], '#3CADFF', '#FFFFFF', -80, 40, true, 'free'),
    W('bars_rounded', '圆头柱', 'Bars Rounded', 1, ['柱'], '#FF6B9A', '#FFFFFF', -80, 40, true, 'free'),
    W('bars_bottom', '底对齐柱', 'Bars Bottom', 1, ['柱'], '#70DB74', '#FFFFFF', -80, 40, true, 'free'),
    W('ring_bars', '环形柱', 'Ring Bars', 1, ['柱'], '#FFAC46', '#FFFFFF', -80, 40, true, 'square'),
    W('oscilloscope', '示波器', 'Oscilloscope', 1, ['波形'], '#46E1FF', '#FFFFFF', -120, -10, false, 'free'),
    W('ring_wave', '环形波', 'Ring Wave', 1, ['波形'], '#B98CFF', '#FFFFFF', -120, -10, false, 'square'),
    W('spectrum_area', '频谱面积', 'Spectrum Area', 2, ['填充', '线条'], '#3CADFF', '#FFFFFF', -80, 40, true, 'free'),
    W('dots', '点阵', 'Dots', 2, ['点', '峰值'], '#3CADFF', '#FF4C45', -80, 40, true, 'free'),
    W('pulse_rings', '脉冲环', 'Pulse Rings', 2, ['核心', '环'], '#3CADFF', '#FFFFFF', -80, 40, true, 'square'),
    W('ribbons', '丝带', 'Ribbons', 2, ['丝带 A', '丝带 B'], '#437BDC', '#A477DA', -80, 40, true, 'free'),
  ];

  /* ---------- 可视化 · 进度（14 种） ----------
     整表来自 `core/presets/builtin/progress/*.json`。
     两个次序都是真的，别把它们合成一个：

     * `PROGRESS` = 核心的 `order`，属性页的 **Style 下拉**照它排。
     * `PROG_TILES` = 浏览面板**网格**的次序。

     countdown / countUp 两款**两处都不收**：它们建出来的是文字条目（计时是文字元素的
     派生内容，见下面「计时」一节），核心的进度枚举因此没有这两个 preset。摆在进度网格里
     等于把「点了会跳去 Text 面板」当成两款进度条。

     缩略图不在这张表里：那 14 枚内联 SVG 在 `model-progicons.js`，按 `k` 取。 */
  /** `colors` / `labels` 对应核心配方的 `numColors` / `colorLabels`。
      **四类而不是一类**：两条彩虹边框整段颜色不出（0），两条游走彩虹只出一张且标题是
      「背景」并落在**主色**上（1），其余两张，标题按款分成 条/底 · 条/背景 ·
      颜色 1/颜色 2 · 前景/背景。
      `square` 为假的就是 `bar` 那两款，网格里它们横跨两列。 */
  const G = (k, name, en, colors, labels, main, second, aspect) =>
    ({k, name, en, fam: 'prog', colors, labels, main, second, aspect,
      square: aspect !== 'bar'});
  const PROGRESS = [
    G('normal', '直角条', 'Rectangle', 2, ['条', '底'], '#FF4C45', '#FFC9C7', 'bar'),
    G('rounded', '圆角条', 'Rounded', 2, ['条', '底'], '#3CADFF', '#C4E6FF', 'bar'),
    G('circle', '圆环', 'Circle', 2, ['条', '底'], '#FFAC46', '#FFE6C8', 'square'),
    G('donut', '甜甜圈', 'Donut', 2, ['条', '底'], '#70DB74', '#D4F4D5', 'square'),
    G('border', '边框', 'Border', 2, ['条', '背景'], '#FF9FDC', TRANSPARENT, 'frame'),
    G('reverse_border', '反向边框', 'Reverse Border', 2, ['条', '背景'], '#3CADFF', TRANSPARENT, 'frame'),
    G('rainbow_border', '彩虹边框', 'Rainbow Border', 0, [], '#FFFFFF', TRANSPARENT, 'frame'),
    G('reverse_rainbow_border', '反向彩虹边框', 'Reverse Rainbow Border', 0, [], '#FFFFFF', TRANSPARENT, 'frame'),
    G('strobe_border', '频闪边框', 'Strobe Border', 2, ['颜色 1', '颜色 2'], '#FF4C45', '#A46CFF', 'frame'),
    G('reverse_strobe_border', '反向频闪边框', 'Reverse Strobe Border', 2, ['颜色 1', '颜色 2'], '#FF4C45', '#A46CFF', 'frame'),
    G('snake', '游走', 'Snake', 2, ['前景', '背景'], '#3CADFF', '#C4E6FF', 'square'),
    G('snake_spin', '游走旋转', 'Snake Spin', 2, ['前景', '背景'], '#FF4C45', '#FFC9C7', 'square'),
    G('snake_rainbow', '游走彩虹', 'Snake Rainbow', 1, ['背景'], '#E8E9EC', '#E8E9EC', 'square'),
    G('snake_spin_rainbow', '游走旋转彩虹', 'Snake Spin Rainbow', 1, ['背景'], '#E8E9EC', '#E8E9EC', 'square'),
  ];
  const progOf = (k) => PROGRESS.filter((p) => p.k === k)[0] || null;
  /** 浏览网格的次序（不含落成文字元素的计时两格） */
  const PROG_TILES = ['rounded', 'normal', 'border', 'reverse_border', 'donut', 'rainbow_border',
    'reverse_rainbow_border', 'circle', 'strobe_border', 'reverse_strobe_border', 'snake',
    'snake_spin', 'snake_rainbow', 'snake_spin_rainbow'].map(progOf);

  /* ---------- 可视化 · 计时（2 款） ----------
     依据 [`docs/design/elements/bcut-counter-element-design.md`](../../../docs/design/elements/bcut-counter-element-design.md)
     （设计稿 v0.1）。缩略图是两枚内联 SVG（`model-counticons.js`），与进度那 14 枚
     同类。

     **计时不是第九个 ElementKind，是文字元素的派生内容能力**（ADR-CT01）：`kind:"text"`
     带一个 `counter` 子对象之后，显示文本不再来自 `text` 字段，而是随播放头逐秒派生；
     字体、样式预设、摆位与动画整条复用文字链路。所以它在这里是**可视化下自己的一格
     chip**（进度 / 声波 / 计时），不塞回进度网格——点下去建的是文字条目，摆进进度里
     等于把「点了会跳去 Text 面板」当成两款进度条（第 87 轮据此把它们从进度里下架）。
     第 88 轮按用户裁决把创建入口收在可视化下自成一组：紧挨着进度（找它的人会去那里
     找），语义仍是文字。 */
  const CT = (k, name, en) => ({k, name, en, fam: 'count'});
  const COUNTERS = [
    CT('countdown', '倒计时', 'Countdown'),
    CT('countup', '正计时', 'Count Up'),
  ];
  const countOf = (k) => COUNTERS.filter((c) => c.k === k)[0] || COUNTERS[0];
  /** 新建一条计时的默认时长（秒）。**不走通用的 `NEW_SPAN`（5s）**：计时的时长就是
      它数多久，5 秒的倒计时只够跳四下，读不出「这是在倒数」；10 秒是设计稿 §3.1 那条
      规范算例本身的时长，也是倒计时最常见的那一档。铺到片尾（`endAnchor`）更不行——
      进度 / 声波那几条常驻元素是「随片长伸缩的装饰」，计时不是：数到 3 分 26 秒的
      倒计时是一件没人会要的东西。 */
  const COUNT_SPAN = 10;
  /** 新建一条计时的起止：落在播放头，长 `COUNT_SPAN`，**撞到片尾就裁到片尾**
      （片尾只剩 4 秒就是一条 4 秒的倒计时）。尾部规则整条复用 `spanAt`——与文字预设、
      绘制层同一条：起点不动、长度让位、只保底 `MIN_SPAN`。起点**不能**为了凑够 10 秒
      往前挪，那样元素就不在用户放播放头的地方了。 */
  const counterSpan = (playT, total) => spanAt(playT, total, COUNT_SPAN);
  /** 钟面三档（设计稿 §3 的封闭首批三值）。格式化的对象是 §2 公式算出来的**整数秒值**，
      所以**换值节奏与格式无关**——三档都是每秒一跳，只是写法不同。 */
  /* 文字横向对齐的词表（第 89.1 轮收成一处，89.2 轮换成图标）。三个挂点共用同一张表：
     Text 面板、计时属性页、字幕属性页——各写一份的话，改一处词就出现「左 / 中 / 右」
     与「左 / 居中 / 右」并存（字幕那一处第 89.1 轮时就是这么漂着的，89.2 轮收回来）。
     键名照 CSS 的 `text-align`，画面上直接喂给 `textAlign`。

     **摆的是图标不是汉字**（第 89.2 轮，用户裁决）：三枚是 Spectrum 2 的 `TextAlign*`
     原件（`app/icons.jsx` 的 DS 族）。汉字「左 / 中 / 右」在一行里与同排的 B / I 混成
     五个并排的字——`···` 菜单那一行第 82.1 轮就因为这个换过图标，属性页这一行漏了。
     `tip` 不是可选的：纯图标的段必须有名字，它同时是 `aria-label` 与悬停提示。 */
  const ALIGNS = [{k: 'left', icon: 'align-left', tip: '左对齐'},
                  {k: 'center', icon: 'align-center', tip: '居中'},
                  {k: 'right', icon: 'align-right', tip: '右对齐'}];

  const COUNT_FORMATS = [
    {k: 's', name: '秒', sample: '10'},
    {k: 'mm:ss', name: '分:秒', sample: '00:10'},
    {k: 'hh:mm:ss', name: '时:分:秒', sample: '00:00:10'},
  ];

  /* 边界只能在**量化过的时间栅格**上判，不能直接对两个浮点秒做减法再取整
     （设计稿 §4 的实现注记，本轮补写）：§3.1 那条 24.12 起、34.12 止的算例，
     `end − t` 在 t = 25.12 时是 9.000000000000004，直接 `ceil` 会多显示一秒，
     而残差的方向取决于两端各自的浮点表示——三端于是可能在同一帧给出不同读数。
     这里先按毫秒取整再比：毫秒是原型时间码的显示精度，也是 §3.1 算例里所有数的精度。 */
  const MS = (t) => Math.round((t || 0) * 1000);

  /** 此刻的整数秒读数；窗外（含 `t = end` 那一刻）返回 null。
      倒计时锚定 `end`、正计时锚定 `start`（ADR-CT02），窗口与所有元素一样是半开的
      ——所以倒计时**不显示 0**、正计时不显示总长。 */
  function counterValue(mode, t, start, end) {
    const ms = MS(t);
    const s0 = MS(start);
    const s1 = MS(end);
    if (!(s1 > s0)) return null;
    if (ms < s0 || ms >= s1) return null;
    return mode === 'countup'
      ? Math.floor((ms - s0) / 1000)
      : Math.ceil((s1 - ms) / 1000);
  }
  const pad2 = (n) => (n < 10 ? '0' + n : String(n));
  /** 整数秒值 → 钟面。`mm:ss` **不进位到小时**（设计稿 §3：选了这一档就不该突然冒出
      小时段），所以 100 分钟写成 `100:00` 而不是 `01:40:00`。 */
  function counterFormat(v, format) {
    if (v == null) return null;
    if (format === 'mm:ss') return pad2(Math.floor(v / 60)) + ':' + pad2(v % 60);
    if (format === 'hh:mm:ss') {
      return pad2(Math.floor(v / 3600)) + ':' + pad2(Math.floor(v / 60) % 60) + ':' + pad2(v % 60);
    }
    return String(v);
  }
  /** 画面上这一帧写的那串字（窗外是 null，画布画一个占位破折号） */
  function counterText(mode, format, t, start, end) {
    return counterFormat(counterValue(mode, t, start, end), format);
  }
  /** 下一次换值的时刻——retained 管线 `next_change` 调度的原型孪生（设计稿 §4）。
      末窗与窗外返回 null：那之后不再换值，元素直接消失。 */
  function counterNextChange(mode, t, start, end) {
    const v = counterValue(mode, t, start, end);
    if (v == null) return null;
    const s0 = MS(start);
    const s1 = MS(end);
    const next = mode === 'countup' ? s0 + (v + 1) * 1000 : s1 - (v - 1) * 1000;
    return next >= s1 ? null : next / 1000;
  }

  /* ---------- 动画 ----------
     面板是 In / Out / Loop 三个 tab。方向不是面板上的第四个 tab——后端的
     动画枚举把方向展开进枚举值（inSlideRight/Left/Up/Down…），所以
     只有**支持方向的那几条**才在选中后多出一排方向钮。 */
  const DIR4 = [{k: 'right', label: '向右'}, {k: 'left', label: '向左'},
                {k: 'up', label: '向上'}, {k: 'down', label: '向下'}];
  const DIR2 = [{k: 'cw', label: '顺时针'}, {k: 'ccw', label: '逆时针'}];
  const A = (k, name, dirs) => ({k, name, dirs: dirs || null});
  const ANIMS = {
    in: [
      A('none', '无'), A('fade', '淡入'), A('float', '浮入', DIR4), A('zoom', '缩放入'),
      A('kenBurns', 'Ken Burns 入'), A('drop', '落入'), A('slide', '滑入', DIR4), A('wipe', '擦入', DIR4), A('pop', '弹现'),
      A('bounce', '弹入'), A('spin', '旋入', DIR2), A('slideBounce', '滑弹入', DIR4),
      A('gentleFloat', '轻浮入', DIR4),
    ],
    out: [
      A('none', '无'), A('fade', '淡出'), A('float', '浮出', DIR4), A('zoom', '缩放出'),
      A('kenBurns', 'Ken Burns 出'), A('drop', '落出'), A('slide', '滑出', DIR4), A('wipe', '擦出', DIR4), A('pop', '弹散'),
      A('bounce', '弹出'), A('spin', '旋出', DIR2), A('slideBounce', '滑弹出', DIR4),
      A('gentleFloat', '轻浮出', DIR4),
    ],
    loop: [
      A('none', '无'), A('spin', '旋转'), A('spinSmooth', '匀速旋转'), A('spin3d', '3D 旋转'),
      A('bounce', '弹跳'), A('heartbeat', '心跳'), A('sway', '摇摆'), A('sway3d', '3D 摇摆'),
      A('squeezy', '挤压'), A('jiggle', '抖动'),
    ],
  };
  /* 动画面板有**第四个 tab：Zoom**——它不是 In/Out/Loop 那样的一次性预设，
     而是覆盖一段时长的运镜，深度分三档，且**可以叠好几段**（「再加一段缩放」）。 */
  const ZOOMS = [
    {k: 'none', name: '无'}, {k: 'shallow', name: '浅'},
    {k: 'moderate', name: '中'}, {k: 'deep', name: '深'},
  ];
  const ZOOM_SCALE = {none: 1, shallow: 1.08, moderate: 1.2, deep: 1.4};
  /** 再加一段：新段接在上一段后面，深度回到「中」、速度沿用上一段 */
  function addZoom(list) {
    const prev = (list || [])[(list || []).length - 1];
    return (list || []).concat([{k: 'moderate', speed: prev ? prev.speed : 1.2}]);
  }

  const find = (slot, k) => ANIMS[slot].filter((a) => a.k === k)[0] || ANIMS[slot][0];
  /** 后端枚举名：方向被展开进枚举值本身 */
  function animEnum(slot, k, dir) {
    if (k === 'none') return 'none';
    const a = find(slot, k);
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    if (!a.dirs || !dir) return slot + cap(k);
    if (a.dirs === DIR2) return slot + cap(k) + (dir === 'ccw' ? 'Left' : 'Right');
    return slot + cap(k) + cap(dir);
  }
  /** 属性页上「动画」那一行的摘要：三段各取当前值，全无时给一句话 */
  function animSummary(pick) {
    const parts = ['in', 'out', 'loop']
      .filter((s) => pick[s] && pick[s].k && pick[s].k !== 'none')
      .map((s) => find(s, pick[s].k).name);
    return parts.length ? parts.join(' · ') : '未设置';
  }

  /* ---------- 通用属性（时间轴条目字段） ----------
     translationX/Y、width/height 是 0..1 归一化，面板上按百分比呈现；
     rotation 是度；zIndex 走四个动作而不是数字输入。 */
  const pct = (v) => Math.round(v * 1000) / 10;
  const unpct = (v) => Math.round(v * 10) / 1000;
  function zAction(z, act, max) {
    if (act === 'front') return max;
    if (act === 'back') return 0;
    if (act === 'up') return Math.min(max, z + 1);
    return Math.max(0, z - 1);
  }
  /** 锁比时改宽高：改哪一边，另一边按初始比跟随 */
  function resize(box, key, v, lock) {
    const next = {...box, [key]: v};
    if (!lock) return next;
    const r = box.h === 0 ? 1 : box.w / box.h;
    if (key === 'w') next.h = Math.round((v / r) * 10) / 10;
    else next.w = Math.round(v * r * 10) / 10;
    return next;
  }

  /* ---------- 新建元素（§13.5 / §14.2） ----------
     落点是**播放头**：起点恒等于 playT。此前点一格只是选中画布上那块演示文字——
     目录点了半天，时间轴上一条都不多，画面上也没有新东西。

     尾部规则与核心 `bcut-motion` 的 `textpreset::instantiate` 逐字同构：起点不动，
     长度撞到片尾就裁到片尾，只保底 `MIN_SPAN`（这一档允许越过片尾，核心的
     `film_end.max(start + MIN_SPAN)` 就是这个意思）。**起点不能为了凑长度往前挪**——
     那样元素就不在用户放播放头的地方了，与「播放头就是落点」自相矛盾。 */
  const NEW_SPAN = 5;
  const MIN_SPAN = 0.5;
  const r2 = (v) => Math.round(v * 100) / 100;

  /** 播放头 → 新元素的起止 */
  function spanAt(playT, total, dur) {
    const start = Math.max(0, playT || 0);
    const d = dur == null ? NEW_SPAN : dur;
    const ceiling = Math.max(total || 0, start + MIN_SPAN);
    return {start: r2(start), end: r2(Math.min(start + d, ceiling))};
  }

  /** 时间轴块上写的那一行：文字元素写内容本身（台账 #28），太长就截 */
  function textLabel(text, max) {
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    const n = max || 12;
    return t.length > n ? t.slice(0, n) + '…' : (t || '文字');
  }

  /* ---------- 点一格 = 造一个元素（第 59 轮按核心那 51 条重写） ----------
     预设不再是「一串字面样式」，而是**一份带落位、时长、错峰与逐成员动画的场景**
     （`BC_TP.PRESETS`，生成自 `core/presets/builtin/textpreset/*.json`）。所以这里做的
     事变成三件：把组的起点钉在播放头上、把时长取自预设、把每一件原样搬成成员。

     **组的起点恒等于播放头**，成员的 `delay` 从那里往后数——预设自带的错峰是设计的
     一部分（下三分那批就是靠它一层层进场的），不能按固定 0.13s 重排。 */
  function newText(preset, opts) {
    const o = opts || {};
    const TP = window.BC_TP;
    const seq = o.seq || 1;
    if (!preset) {
      // 「添加文本框」：一个空文本，落在播放头，宽度给个能打字的默认值
      const span = spanAt(o.playT, o.total, NEW_SPAN);
      const y = 50 + ((seq - 1) % 4) * 7;
      return {id: 'e-txt-' + seq, kind: 'text', name: '文字', icon: 'text', hue: 'orange',
        added: true, preset: null, start: span.start, end: span.end,
        place: {x: 50, y: y, w: 40}, text: o.blank || '在这里输入文字',
        style: {}, anim: {in: {k: 'none'}, out: {k: 'none'}, loop: {k: 'none'}}};
    }
    const span = spanAt(o.playT, o.total, o.dur == null ? preset.dur : o.dur);
    const box = preset.box || {x: 50, y: 50, w: 40, h: 12};
    const base = {start: span.start, end: span.end, hue: 'orange', icon: 'text', added: true,
      preset: preset.id};
    if (preset.els.length === 1 && preset.els[0].k === 'text') {
      const e = preset.els[0];
      return Object.assign({}, base, {
        id: 'e-txt-' + seq, kind: 'text', name: textLabel(e.t),
        place: {x: e.x, y: e.y, w: e.w == null ? box.w : e.w},
        text: e.t, style: TP.toStyle(e), anim: TP.animOf(e),
      });
    }
    return Object.assign({}, base, {
      id: 'e-tgp-' + seq, kind: 'textgroup',
      name: '文本组 · ' + textLabel(firstText(preset.els)),
      place: {x: box.x, y: box.y, w: box.w}, box: box,
      members: preset.els.map((e, i) => memberOf(e, i, seq, preset)),
    });
  }

  /** 预设里的一件 → 文本组的一条成员 */
  function memberOf(e, i, seq, preset) {
    const TP = window.BC_TP;
    const id = 'm' + seq + '-' + (i + 1);
    const place = {x: e.x, y: e.y, w: e.w == null ? null : e.w, h: e.h == null ? null : e.h};
    const anim = TP.animOf(e);
    if (e.k !== 'text') {
      return {id: id, kind: 'shape', icon: 'shape', name: SHAPE_NAME[e.k] || '形状',
        text: SHAPE_NAME[e.k] || '形状', shape: e, delay: e.d || 0, place: place, anim: anim};
    }
    return {id: id, kind: 'text', icon: 'text', name: memberName(e, i, preset),
      text: e.t, delay: e.d || 0, style: TP.toStyle(e), place: place, anim: anim};
  }
  const SHAPE_NAME = {rect: '色块', ellipse: '圆点', diamond: '菱形', arrow: '箭头'};
  /** 成员名按**字号排序**取：最大的那条是标题，其余按出现次序编号 */
  function memberName(e, i, preset) {
    const texts = preset.els.filter((x) => x.k === 'text');
    const big = texts.reduce((a, b) => (b.size > a.size ? b : a), texts[0]);
    return e === big ? '标题' : '第 ' + (texts.indexOf(e) + 1) + ' 行';
  }
  const firstText = (els) => (els.filter((e) => e.k === 'text')[0] || {t: '文字'}).t;

  /* ---------- 画面调整（第 58.2 轮） ----------
     两组九项：颜色校正（亮度 / 对比度 / 曝光 / 色相 / 饱和度，−100…100）与
     效果（锐化 / 噪点 / 模糊 / 暗角，0…100）。

     **核心今天只认三项**：`bcut-timeline` 的 `Fx` 是 `{grayscale, blur, brightness}`
     （`effects.rs`：恒等的效果不产出条目）。其余六项要新字段，登记在分歧台账——
     原型先画全九项，实现按核心的节奏补。

     换算分三路，因为浏览器里能表达的手段不同：
       · 六项走 CSS `filter`（亮度 / 对比度 / 曝光 / 色相 / 饱和度 / 模糊）；
       · 锐化走 SVG `feConvolveMatrix`，量化成四档预声明的滤镜（`#bcfx-sharp1..4`），
         省得每改一格就生成一份新的 filter 定义；
       · 噪点与暗角是**盖在画面上的一层**，不是 filter——CSS 没有这两个原语。 */
  const FX0 = {bright: 0, contrast: 0, exposure: 0, hue: 0, saturate: 0,
               sharpen: 0, noise: 0, blur: 0, vignette: 0};
  const FX_COLOR = [
    {k: 'bright', label: '亮度', min: -100, max: 100},
    {k: 'contrast', label: '对比度', min: -100, max: 100},
    {k: 'exposure', label: '曝光', min: -100, max: 100},
    {k: 'hue', label: '色相', min: -100, max: 100},
    {k: 'saturate', label: '饱和度', min: -100, max: 100},
  ];
  const FX_EFFECT = [
    {k: 'sharpen', label: '锐化', min: 0, max: 100},
    {k: 'noise', label: '噪点', min: 0, max: 100},
    {k: 'blur', label: '模糊', min: 0, max: 100},
    {k: 'vignette', label: '暗角', min: 0, max: 100},
  ];
  /** 核心 `Fx` 今天认得的那三项——其余六项是建议扩展项 */
  const FX_CORE = {bright: true, blur: true, gray: true};
  const SHARP_STEPS = 4;

  function fxFull(fx) { return Object.assign({}, FX0, fx); }
  function fxIdentity(fx) {
    const f = fxFull(fx);
    return Object.keys(FX0).every((k) => !f[k]) && !f.gray;
  }
  /** 锐化量化成 1..4 档（0 = 不加滤镜），与 `#bcfx-sharpN` 的四份定义一一对应 */
  function sharpStep(v) {
    if (!v) return 0;
    return Math.max(1, Math.min(SHARP_STEPS, Math.ceil(v / 100 * SHARP_STEPS)));
  }
  function fxCss(fx) {
    const f = fxFull(fx);
    const out = [];
    // 滤镜与效果（第 84 轮）排在手动九项**之前**：先定整体色调与效果，再做手动微调
    const stack = stackCss(f);
    if (stack) out.push(stack);
    // 曝光与亮度都落到 brightness，但曲线不同：曝光更缓（1 + e/150），叠加时不会立刻打死
    if (f.bright) out.push('brightness(' + round3(1 + f.bright / 100) + ')');
    if (f.exposure) out.push('brightness(' + round3(1 + f.exposure / 150) + ')');
    if (f.contrast) out.push('contrast(' + round3(1 + f.contrast / 100) + ')');
    if (f.saturate) out.push('saturate(' + round3(1 + f.saturate / 100) + ')');
    if (f.hue) out.push('hue-rotate(' + round3(f.hue * 1.8) + 'deg)');
    if (f.gray) out.push('grayscale(' + round3(f.gray / 100) + ')');
    if (f.blur) out.push('blur(' + round3(f.blur / 100 * 20) + 'px)');
    if (f.sharpen) out.push('url(#bcfx-sharp' + sharpStep(f.sharpen) + ')');
    return out.length ? out.join(' ') : null;
  }
  /** 盖在画面上的那两层：暗角是径向渐变，噪点是确定性的细网点（没有随机数） */
  function fxLayers(fx) {
    const f = fxFull(fx);
    const out = [];
    if (f.vignette) {
      out.push({k: 'vignette', opacity: round3(f.vignette / 100),
        background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(0,0,0,0.85) 100%)'});
    }
    if (f.noise) {
      out.push({k: 'noise', opacity: round3(f.noise / 100 * 0.45),
        background: 'repeating-conic-gradient(rgba(255,255,255,0.9) 0% 25%, rgba(0,0,0,0.9) 0% 50%)',
        backgroundSize: '3px 3px'});
    }
    return out;
  }
  function round3(v) { return Math.round(v * 1000) / 1000; }

  /* ---------- 滤镜与效果（第 84 轮） ----------
     滤镜面板是两个 tab：**调色**与**效果**，各自单选，
     效果那一款还带一档强度。真做的话调色要 LUT 贴图、效果要着色器——本仓库没有这两批
     素材，核心也没有 LUT 这条链路（`bcut-timeline` 的 `Fx` 只有 `{grayscale, blur, brightness}`）。

     所以这里定下的是**分组、词表与交互，不是像素**：每一款写成一串 CSS filter 近似
     （Calm I/II/III、Peckham…），面板上明说这是近似。
     登记在分歧台账——LUT 与着色器要等核心有对应字段。

     两张表分开的理由：调色是**整体色调**（单选、无强度），效果是**叠加的
     处理**（单选、有强度）。合成一张表就得为「有没有强度」再开一个布尔。 */
  /** 一款 = 若干 [CSS 函数, 强度 0 时的值, 强度 1 时的值, 单位] */
  const FL = (k, name, en, parts) => ({k, name, en, parts});
  const FILTERS = [
    FL('none', '无', 'None', []),
    FL('calm1', '静谧 I', 'Calm I', [['saturate', 1, 0.9], ['hue-rotate', 0, -6, 'deg'], ['brightness', 1, 1.03]]),
    FL('calm2', '静谧 II', 'Calm II', [['saturate', 1, 0.8], ['hue-rotate', 0, -10, 'deg'], ['brightness', 1, 1.05], ['contrast', 1, 0.95]]),
    FL('calm3', '静谧 III', 'Calm III', [['saturate', 1, 0.68], ['hue-rotate', 0, -14, 'deg'], ['brightness', 1, 1.07], ['contrast', 1, 0.92]]),
    FL('clean1', '干净 I', 'Clean I', [['contrast', 1, 1.08], ['saturate', 1, 1.04]]),
    FL('clean2', '干净 II', 'Clean II', [['contrast', 1, 1.15], ['saturate', 1, 1.08], ['brightness', 1, 1.02]]),
    FL('clean3', '干净 III', 'Clean III', [['contrast', 1, 1.24], ['saturate', 1, 1.12], ['brightness', 1, 1.04]]),
    FL('cottage1', '田园 I', 'Cottage I', [['sepia', 0, 0.14], ['saturate', 1, 1.08], ['brightness', 1, 1.02]]),
    FL('cottage2', '田园 II', 'Cottage II', [['sepia', 0, 0.24], ['saturate', 1, 1.14], ['brightness', 1, 1.04]]),
    FL('cottage3', '田园 III', 'Cottage III', [['sepia', 0, 0.34], ['saturate', 1, 1.2], ['brightness', 1, 1.06], ['contrast', 1, 0.96]]),
    FL('peckham1', '佩克汉 I', 'Peckham I', [['saturate', 1, 1.2], ['hue-rotate', 0, 6, 'deg'], ['contrast', 1, 1.05]]),
    FL('peckham2', '佩克汉 II', 'Peckham II', [['saturate', 1, 1.35], ['hue-rotate', 0, 10, 'deg'], ['contrast', 1, 1.1]]),
    FL('peckham3', '佩克汉 III', 'Peckham III', [['saturate', 1, 1.5], ['hue-rotate', 0, 14, 'deg'], ['contrast', 1, 1.16]]),
  ];
  /** Effects：单选 ＋ 一档强度（0..1）。只收 CSS filter 表达得了的那几款——
      Pixelate / Halftone / RGB Split / VHS 这类要着色器，写不出来就不摆。 */
  const EFFECTS = [
    FL('none', '无', 'None', []),
    FL('invert', '反色', 'Invert', [['invert', 0, 1]]),
    FL('night_vision', '夜视', 'Night Vision', [['grayscale', 0, 1], ['sepia', 0, 1], ['hue-rotate', 0, 55, 'deg'], ['saturate', 1, 3.2], ['brightness', 1, 1.1]]),
    FL('thermal_vision', '热成像', 'Thermal Vision', [['invert', 0, 1], ['hue-rotate', 0, 95, 'deg'], ['saturate', 1, 3]]),
    FL('old', '做旧', 'Old', [['sepia', 0, 0.85], ['contrast', 1, 1.12], ['brightness', 1, 0.96]]),
    FL('polaroid', '宝丽来', 'Polaroid', [['sepia', 0, 0.35], ['saturate', 1, 1.4], ['contrast', 1, 0.9], ['brightness', 1, 1.08]]),
    FL('filmic', '胶片', 'Filmic', [['contrast', 1, 1.3], ['saturate', 1, 0.88], ['brightness', 1, 0.98]]),
    FL('snowy', '雪地', 'Snowy', [['brightness', 1, 1.18], ['saturate', 1, 0.55], ['contrast', 1, 1.12]]),
    FL('box_blur', '方块模糊', 'Box Blur', [['blur', 0, 6, 'px']]),
    FL('bokeh_blur', '焦外模糊', 'Bokeh Blur', [['blur', 0, 10, 'px'], ['brightness', 1, 1.06]]),
  ];
  const filterOf = (k) => FILTERS.filter((f) => f.k === k)[0] || FILTERS[0];
  const effectOf = (k) => EFFECTS.filter((f) => f.k === k)[0] || EFFECTS[0];
  /** 一款 → CSS。`t` 是强度（调色恒为 1，效果读 `effectI`） */
  function presetCss(item, t) {
    const a = t == null ? 1 : Math.max(0, Math.min(1, t));
    if (!item || !item.parts.length || a === 0) return null;
    return item.parts
      .map(([fn, from, to, unit]) => fn + '(' + round3(from + (to - from) * a) + (unit || '') + ')')
      .join(' ');
  }
  /** 样式袋里那两个键 → CSS（调色在前、效果在后：先定整体色调，再叠效果） */
  function stackCss(fx) {
    const f = fx || {};
    return [presetCss(filterOf(f.filter)), presetCss(effectOf(f.effect), f.effectI == null ? 1 : f.effectI)]
      .filter(Boolean).join(' ') || null;
  }
  /** 有没有挂着滤镜/效果——菜单行与面板按钮上那颗点读它 */
  const hasStack = (fx) => !!stackCss(fx);

  /* ---------- 变速与淡入淡出 ----------
     档位就是弹层上那四颗 chip，第五颗 `Custom` 打开一根滑杆（0.25×…4×）。
     淡入淡出是**一张卡**：一个开关 ＋ 两根滑杆，关掉时两根一起灰。 */
  const SPEEDS = [0.5, 1, 1.5, 2];
  const SPEED_MIN = 0.25;
  const SPEED_MAX = 4;
  const FADE_MAX = 5;
  const isPresetSpeed = (r) => SPEEDS.indexOf(r) >= 0;

  /* ---------- 圆角四角 ----------
     圆角开关打开后是**四个独立输入 ＋ 中间一枚链条钮**（锁上时四角一致）。核心 `place.radius` 今天只有一个数——四角独立要新字段，登记在分歧台账。
     锁上时四个数跟着改，解锁后各自为政；`radius` 恒等于左上那一格，好让只认一个数的
     那一侧（核心与 App）拿到一个说得通的值。 */
  const CORNERS = [['radiusTL', '左上'], ['radiusTR', '右上'], ['radiusBL', '左下'], ['radiusBR', '右下']];
  function radiusOf(st) {
    const base = (st || {}).radius || 0;
    const o = {};
    CORNERS.forEach(([k]) => { o[k] = (st || {})[k] == null ? base : st[k]; });
    return o;
  }
  /** 改一角：锁着就四角同改，并同步 `radius` 这个单值 */
  function setCorner(st, key, v) {
    const cur = radiusOf(st);
    if ((st || {}).radiusLock !== false) {
      const all = {radius: v};
      CORNERS.forEach(([k]) => { all[k] = v; });
      return all;
    }
    const next = Object.assign({}, cur, {[key]: v});
    return Object.assign({}, next, {radius: next.radiusTL});
  }
  /** 画到画面上的那一串（`k` 是画面缩放系数：面板里的数是 880 基准宽下的像素） */
  function radiusCss(st, k) {
    if (!st || !st.round) return null;
    const r = radiusOf(st);
    const px = (v) => Math.max(0, v * (k == null ? 1 : k)) + 'px';
    return [px(r.radiusTL), px(r.radiusTR), px(r.radiusBR), px(r.radiusBL)].join(' ');
  }

  /* ---------- 文本组的成员投影（第 58.1 轮） ----------
     成员和元素一样有自己的文字与样式，写在同一张 `elDocs` 表里（成员 id 是唯一的）。
     成员**表**本身也可能被改（删掉一条），改过的那份写在组自己那条文档上。
     组视图、时间轴的成员行、成员属性页读的都是这里出来的同一份。 */
  function projectMembers(el, docs) {
    const d = docs || {};
    const list = (d[el.id] && d[el.id].members) || el.members;
    if (!list) return null;
    return list.map((m) => Object.assign({}, m, d[m.id]));
  }
  /** 从成员表里拿掉一条（组只剩空表时由调用方决定整组怎么办） */
  function dropMember(list, id) {
    return (list || []).filter((m) => m.id !== id);
  }

  /* ---------- 画布 ↔ 属性页的共用键 ----------
     同一个元素的同一项属性有两个入口：画布上的浮动工具条与右侧属性页。两边各存一份
     必然漂——第 33 轮的 cue 表、第 34 轮的字幕样式文档都是为这件事收敛的。这里给出
     「属性页的键 → 画布样式袋的键」的对照，两边都经它换算，不各写各的。
     `anim` **不在这张表里**：它是逐元素的（`ctx.elDocs[id].anim`），不进画布共用袋——
     共用袋里的键按类型天然不重叠（fill / tint / waveStyle…），而 In/Out/Loop 每类都有，
     放进去就会变成「给贴纸设了入场，整屏元素条全都长出动画带」。 */
  /* 视频 / 图片 / 位图贴纸共用的那一批「画面」键：不透明度、
     四角圆角、九项调整，外加第 84 轮补的滤镜与效果两格。键名两边同名，所以是恒等
     映射——写成一份表，免得三处各抄一遍、抄漏一个。 */
  const MEDIA_KEYS = Object.assign(
    {opacity: 'opacity', radius: 'radius', round: 'round', radiusLock: 'radiusLock',
     gray: 'gray', filter: 'filter', effect: 'effect', effectI: 'effectI'},
    ...CORNERS.map(([k]) => ({[k]: k})),
    ...['bright', 'contrast', 'exposure', 'hue', 'saturate', 'sharpen', 'noise', 'blur', 'vignette']
      .map((k) => ({[k]: k})));

  const SHARED = {
    shape:    {fill: 'fill', outline: 'stroke', outlineW: 'borderW', shapeI: 'shapeI'},
    /* 贴纸多两个共用键（第 60.1 轮）：`asset` 是目录里点中的那张素材（静态 SVG /
       PNG 或带透明通道的动图），`builtin` 是核心那十款矢量贴纸的 id——两者互斥，
       画布按哪个非空决定画图片还是画路径。此前目录点一格只是选中，画面上那枚贴纸
       永远是演示装置那一张。 */
    /* 第 84 轮：**位图 / 动图贴纸**多出「画面」那一批键（位图贴纸没有颜色控件，
       能调的是不透明度 / 圆角 / 调整）。矢量贴纸不写这几项，
       同一张表里多几个没人写的键比分成两张表便宜。 */
    /* 换色**不在这张表里**（第 122 轮）：`fillList` 是逐元素的
       （`ctx.elDocs[id].fillList`，判据在 `model-svgfill.js`），共用袋是「同类元素长
       一个样」，而两张不同素材的第 2 组根本不是同一个色。第 39.1 轮那个整体着色
       （`tint`）同轮退场——矢量贴纸只按组换色，位图贴纸一个颜色控件都没有。 */
    /* `assetKind`（第 238 轮）：品牌库上传的贴纸源是 `blob:…`，扩展名没了，光看 URL
       判不出该不该起 lottie-web。收件时按字节判过一次，结论跟着样式袋走。内置素材
       有扩展名，这一格留空。 */
    /* `pet`（第 242 轮）：Codex Pet 雪碧图的元数据袋 `{version, state, name, author, license}`。
       版本决定图集行数（v1 九行 / v2 十一行），没有它画布算不出 background-size；署名
       跟着元素走是因为社区 pet 的许可五花八门，导出时要能报出来。 */
    sticker:  Object.assign({asset: 'asset', assetKind: 'assetKind', builtin: 'builtin', pet: 'pet'}, MEDIA_KEYS),
    /* 字幕（第 102 轮）。它的 `st` / `set` 不是元素样式袋，是**这一条字幕轨自己那份
       文档**（`stage.jsx` 的 `subSt` / `subSet`），所以只需要把两处叫法不同的键接上：
       画布词表叫 `lineHeight` / `letterSpacing`，字幕轨里叫 `lh` / `spacing`（后者是
       核心那套键名）。其余（`color` / `font` / `size` / `bold` / `italic` / `align`）
       两边同名，恒等回落即可。 */
    subtitle: {lineHeight: 'lh', letterSpacing: 'spacing'},
    /* 声波的 dB 窗与平滑第 211 轮进这张表：画布浮动条上的「音量档位」飞出与属性页
       「控制」那三行是**同一组值**（dB 下限、dB 上限与平滑
       就一份，属性页与画布浮动条两处都改它）。此前这三项只活在
       属性页自己的 local state 里，条子上那枚飞出无从读起——于是它退化成了一根写
       `vol` 的百分比滑杆，全仓没有一处读。 */
    wave:     {style: 'waveStyle', main: 'waveColor', second: 'waveColor2',
               mindb: 'waveMinDb', maxdb: 'waveMaxDb', smooth: 'waveSmooth'},
    progress: {style: 'progStyle', main: 'progColor', second: 'progTrack'},
    /* 彩纸（第 231 轮）：整袋 props（style / seed / colors / shapes / 倍率 / emit / 发射）
       作为**一个**键存进这一件自己的样式文档——它们只被 `BC_CONFETTI.sample` 一起读，
       拆成二十个键在面板与画布之间来回对照没有收益。 */
    confetti: {cf: 'confetti'},
    whiteboard: {wb: 'whiteboard'},
    /* 计时（第 88 轮）：`mode` / `format` 是**内容**的两个键（不是样式），但它们与画布
       浮动条上那枚模式下拉是同一份，所以照样走这张对照表。

       后面六个是**文字元素那一套基础字符样式**——计时就是一条文字元素（ADR-CT01），
       字体 / 字号 / 颜色 / 加粗 / 斜体 / 对齐本来就该有。但键名**必须与 `text` 那一条
       错开**：文字那一族是逐元素持有样式的（`OWN`），计时这一条是演示装置、读共用袋，
       两边共用 `color` / `size` 会让改一次计时把画面上的标题也染了。

       **对齐第 89.1 轮补上**（用户：「加上文字对齐：默认居中，还有居左居右；然后容器
       可以调整大小」）。第 88 轮的说法是「读数是单行、盒子跟着内容长，三档对齐一档都
       看不出来」——那句话的前提是盒子恒等于内容宽，而用户的裁决正是把这个前提去掉：
       容器可以拉宽（`BC_POSE.CAPS.counter.width` 同轮改成 true），三档对齐这才有得对。
       默认 `center`。 */
    counter:  {mode: 'cntMode', format: 'cntFmt',
               font: 'cntFont', size: 'cntSize', color: 'cntColor',
               bold: 'cntBold', italic: 'cntItalic', align: 'cntAlign'},
    /* 覆盖层的不透明度用**自己的键**（第 84 轮）：贴纸与视频也长出了
       「不透明度」，三类共用一个 `opacity` 的话，拉一下贴纸会把满屏的雪花一起调暗。 */
    overlay:  {opacity: 'ovlOpacity'},
    vframe:   {chrome: 'chrome', style: 'frameStyle'},
    tpl:      {templateId: 'templateId'},
    /* 视频（第 84 轮）：画面那一批与图片同一张表，
       再加视频独有的三件——音量、变速、音频淡入淡出。 */
    video:    Object.assign({vol: 'vol', rate: 'rate',
               fadeOn: 'fadeOn', fadeIn: 'fadeIn', fadeOut: 'fadeOut'}, MEDIA_KEYS),
    /* 图片（第 58.2 轮补齐）。三项「调整」对着核心 `Fx` 的
       三个字段：`brightness` / `blur` / `grayscale`——其余的对比度、曝光、
       色相、饱和度、噪点、锐化、暗角，核心一个都没有，画上去就是消费不掉的旋钮。 */
    image:    MEDIA_KEYS,
    /* 文字这一条第 42 轮补齐：文字面板与画布浮动条改的是**同一批**
       字符样式，键名在两边本来就同名，所以是恒等映射。此前只映了三项，于是面板上
       加粗、对齐、行高、字距改完画布不动——那是台账 #33。 */
    text:     {color: 'color', size: 'size', font: 'font', bold: 'bold', italic: 'italic',
               align: 'align', lineHeight: 'lineHeight', letterSpacing: 'letterSpacing',
               bg: 'bg', ol: 'ol', sh: 'sh', alpha: 'alpha'},
  };
  /** 属性页的一笔改动 → 画布样式袋要写的键值（无对照的键原样丢掉） */
  function toStage(kind, patch) {
    const map = SHARED[kind] || {};
    const out = {};
    Object.keys(patch).forEach((k) => { if (map[k]) out[map[k]] = patch[k]; });
    return out;
  }
  /** 画布样式袋 → 属性页初值（只取有对照的那几项） */
  function fromStage(kind, stage) {
    const map = SHARED[kind] || {};
    const out = {};
    Object.keys(map).forEach((k) => { if (stage[map[k]] !== undefined) out[k] = stage[map[k]]; });
    return out;
  }

  /* 矢量贴纸的填充色分组与换色第 122 轮整段搬到 [model-svgfill.js](model-svgfill.js)
     （`BC_SVGFILL`），判据逐条写定：标签白名单、三种 hex
     写法、`<image>` 与「超过 15 种色」两条排除、封顶 5 张卡、按组换色。这里原来那对
     `fillsOf` / `recolor` 是一条正则扫全文，认不出分组、也分不清 `stroke`，一并撤掉
     ——同一件事只留一份判据。 */

  window.BC_EL = {
    SHARED, toStage, fromStage,
    PALETTE, TRANSPARENT, RAINBOW, SHAPE_CYCLE, SHAPE_TILES, SHAPE_NAMES, OUTLINE_W, SHAPES,
    WAVES, PROGRESS, PROG_TILES, progOf, ANIMS, DIR4, DIR2,
    ALIGNS,
    COUNTERS, COUNT_FORMATS, COUNT_SPAN, counterSpan, countOf, counterValue, counterFormat, counterText, counterNextChange,
    swatchList, shapeColor, shapeAt, shapeNames, find, animEnum, animSummary,
    pct, unpct, zAction, resize,
    NEW_SPAN, spanAt, newText, textLabel, memberOf, projectMembers, dropMember,
    FX0, FX_COLOR, FX_EFFECT, FX_CORE, fxCss, fxLayers, fxIdentity, fxFull, sharpStep, SHARP_STEPS,
    FILTERS, EFFECTS, filterOf, effectOf, presetCss, stackCss, hasStack,
    SPEEDS, SPEED_MIN, SPEED_MAX, FADE_MAX, isPresetSpeed,
    ZOOMS, ZOOM_SCALE, addZoom, CORNERS, radiusOf, setCorner, radiusCss,
  };
})();
