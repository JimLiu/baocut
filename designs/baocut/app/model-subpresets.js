/* 字幕样式目录 —— **31 份，数据逐字段写定**（第 62 轮把内置目录整表换掉）。

   此前这里是原型自己编的 12 份「涂装」（`looks`）＋ 31 张目录卡：涂装只有色 / 字重 /
   描边 / 阴影 / 底板几个键，字体、行高、字距、大小写、逐词动效的高亮色全是画廊那一层
   现编的。那套东西的毛病不在好不好看，在于**它不对着任何东西**——改一个数没有判据，
   加一份样式也没有判据。

   **下面 `PRESETS` 数组里的每一个数都是定死的，不是照着截图调的**：默认值、合并规则、
   描边与阴影的默认、底板的构造都已经折进每一份里。31 份从 `prettymarketer` 起到 `yeet`
   止，顺序也是定的。这张表改它要有依据。

   **不在这里的是哪一族，以及为什么**：`emphasis*` 与 `template-*-sub` 那一族**没有
   具体样式**——`style` 里只有 `emphasisPreset: <id>` 一个指针，真正的排版与图层在另一套
   「动态模板」引擎里（见 `model-motioncaption.js`）。那不是一份涂装表，是另一个功能。
   BaoCut 这一侧对应的东西是**动效字幕**（`caption-*` 16 份配方，
   核心 `bcut-subtitle-render/caption_recipe.rs` 已经烧进二进制），它仍自成一区。

   ---

   ## 单位换算（这一层唯一在做的事）

   这些数几乎全是**按字号归一**的（描边粗细、阴影模糊与位移、底板圆角与内边距），
   原型的涂装函数 `paintCss` 本来就是同一个模型——「字号是唯一的自变量」是画廊那条
   「点下去画面就是缩略图的样子」的承诺所要求的。所以换算是一一对应的，不是重新调值：

   | 预设字段 | 这里 | 换算 | 为什么 |
   |---|---|---|---|
   | `outline.size` | `outlineW` | ×160 | `paintCss` 的描边是 `fz × 0.05 × outlineW/8`，也就是 `fz × outlineW/160`；乘 160 之后描边正好是 `fz × size` |
   | `shadow.size` | `shBlur` | ×100 | 两边都是「占字号的百分之几」 |
   | `shadow.offset{x,y}` | `shDist` / `shAngle` | 极坐标 | 偏移本来就是由 `distance`（0–100）与 `direction`（度）这对极坐标生成的，这里做的是它的逆运算 |
   | `background.cornerRadius` | `corners` | ×100 | **这一轮把圆角从 px 改成占字号的百分比**——见下 |
   | `background.innerPadding` | `pad` | ×100 | 同上，四边都是 .2 |
   | `letterSpacing` | `spacing` | ×2 | 预设的字距是**默认字号下的 px**；同一份预设数据里同时有 `letterSpacing: -3` 与 `letterSpacingEm: -.06`，比值就是 50，而 `spacing` 存的是 1/100 em，于是 ×100/50 = ×2 |
   | `lineHeight` | `lh` | ×100 | 都是行高倍数 |
   | `letterCasing` | `upper` | 逐档对应 | `none/uppercase/lowercase/capitalize` ↔ `''/upper/lower/title`，四档一样多 |

   **圆角改成百分比**是这一轮唯一一处语义变更（此前是 px）。理由是 px 圆角**不跟字号缩放**：
   同一份样式在 13px 的缩略图与画布上的大字上会是两个形状，而画廊那条承诺要求它们是同一个
   形状。预设的 `cornerRadius` 本来就是归一的（`.3`），改过来之后两边同一把尺。

   ## 字体

   预设用到的 13 款是拉丁字体，且**把字重编进了族名**（`Poppins Extrabold` / `Rubik Black` /
   `Montserrat Semibold`…）——那不是 13 个族，是 7 个族的 13 个字重。所以这里拆成
   （族, 字重）两个键：族名去 Google Fonts 取，字重落到 `weight`，预设的 `emphasis: bold`
   再在这之上把字重顶到至少 700（B 钮就是这么叠的）。

   `Komika Axis` 与 `The Bold Font` 不在 Google Fonts 上，栈里保留原名（装了就用得上），
   后面各跟一款同族气质的替身。每条栈末尾都挂中文字体：画廊样张的下面那行是中文
   （`specimen.sub`），拉丁字体一个 CJK 字形都没有。

   ## 颜色

   全部是**画进视频画面**的内容色（字色、底色、描边、阴影、当前词高亮），不是 S2 表面，
   按文件登记在 `_ds_conformance.json`。一份样式的颜色就是它本身，换成 token 那张卡就
   不是那张卡了——与 `model-textpresets.js` 同一条。8 位十六进制里的 alpha 原样带着：
   底色那一路会拆成「不透明色 ＋ 不透明度」两格（属性页那颗滑杆才有东西可写），
   字色 / 描边 / 阴影那三路 CSS 直接认，不拆。

   这一层不碰 DOM，`node --test` 直接 require。 */
(function () {

  /* ---------- 预设表 ----------
     顺序是定的，别按字母排——目录把 `prettymarketer` 摆在第一位
     是有意的，画廊第一屏看见什么由它决定。

     `cat` 是预设的 `category`；`casing` 是 `letterCasing`；`anim` / `animColor`
     是 `animation` / `animationColor`（逐词动效与它的高亮色，这两件事也算进样式）。
     `shadow.x/y` 是归一化偏移，`bg.type` 是 `lines`（逐行贴底）还是 `block`（整条一块）。 */
  const PRESETS = [
    {k: 'prettymarketer', name: 'Pretty Little Marketer', cat: 'Social',
     font: 'Montserrat', color: '#ffffffff', emphasis: 'bold', align: 'center', lh: 1.25, ls: 0, casing: 'none',
     anim: 'colourHighlight', animColor: '#ffcdd0ff',
     shadow: {size: .38, x: .08335900445507967, y: .08632077604063812, color: '#2b292aff'},
     outline: {size: .03, color: '#2b292aff'}, bg: null},
    {k: 'ali', name: 'Ali', cat: 'Social',
     font: 'Poppins SemiBold', color: '#000000ff', emphasis: 'normal', align: 'center', lh: 2, ls: .3, casing: 'none',
     anim: 'karaoke', animColor: '#ff9de9ff',
     shadow: null,
     outline: null, bg: {type: 'lines', color: '#fafbffff', radius: .3, pad: .2}},
    {k: 'slay', name: 'Slay', cat: 'Social',
     font: 'Komika Axis', color: '#ffffff', emphasis: 'normal', align: 'center', lh: 1.25, ls: -1, casing: 'uppercase',
     anim: 'colourHighlight', animColor: '#6474FF',
     shadow: null,
     outline: {size: .17, color: '#000000'}, bg: null},
    {k: 'kitty', name: 'Kitty', cat: 'Social',
     font: 'Squada One', color: '#ffffff', emphasis: 'normal', align: 'center', lh: .95, ls: -1, casing: 'uppercase',
     anim: 'colourHighlight', animColor: '#ff3ed4ff',
     shadow: null,
     outline: {size: .13, color: '#000000'}, bg: null},
    {k: 'hustle', name: 'Hustle', cat: 'Social',
     font: 'The Bold Font', color: '#ffffff', emphasis: 'normal', align: 'center', lh: 1.15, ls: .5, casing: 'uppercase',
     anim: 'colourHighlight', animColor: '#80ffc9ff',
     shadow: {size: 0, x: .09367828489024016, y: .1040402755668352, color: '#000000'},
     outline: {size: .14, color: '#000000'}, bg: null},
    {k: 'grape', name: 'Grape', cat: 'Social',
     font: 'The Bold Font', color: '#262323ff', emphasis: 'normal', align: 'center', lh: 1.05, ls: -1, casing: 'uppercase',
     anim: 'colourHighlight', animColor: '#6147ffff',
     shadow: null,
     outline: null, bg: {type: 'lines', color: '#ffffffff', radius: .3, pad: .2}},
    {k: 'karl', name: 'Karl', cat: 'Social',
     font: 'Poppins SemiBold', color: '#ffffff', emphasis: 'normal', align: 'center', lh: 1.15, ls: 0, casing: 'uppercase',
     anim: 'floatInBottom', animColor: '#000000',
     shadow: {size: .25, x: -.01, y: 1.224646799147353e-18, color: '#000000ff'},
     outline: null, bg: null},
    {k: 'sprout', name: 'Sprout', cat: 'Social',
     font: 'Poppins', color: '#ffffffff', emphasis: 'bold', align: 'center', lh: 1.15, ls: 0, casing: 'none',
     anim: 'colourHighlight', animColor: '#b6ff60ff',
     shadow: {size: .25, x: -.13, y: -1.592040838891559e-17, color: '#000000'},
     outline: null, bg: null},
    {k: 'flex', name: 'Flex', cat: 'Social',
     font: 'The Bold Font', color: '#ffffff', emphasis: 'normal', align: 'center', lh: 1.25, ls: 1, casing: 'lowercase',
     anim: 'floatInBottom', animColor: '#000000',
     shadow: {size: 0, x: .1433948202423267, y: .1246512155081964, color: '#000000'},
     outline: {size: .13, color: '#000000'}, bg: null},
    {k: 'snugle', name: 'Snugle', cat: 'Social',
     font: 'The Bold Font', color: '#ffffff', emphasis: 'normal', align: 'center', lh: 1.8, ls: .5, casing: 'uppercase',
     anim: 'colourHighlight', animColor: '#ff9de9ff',
     shadow: null,
     outline: null, bg: {type: 'lines', color: '#00000066', radius: .3, pad: .2}},
    {k: 'mint', name: 'Mint', cat: 'Social',
     font: 'Anton', color: '#ffffffff', emphasis: 'normal', align: 'center', lh: 1.05, ls: -1, casing: 'uppercase',
     anim: 'colourHighlight', animColor: '#80ffc9ff',
     shadow: {size: .12, x: .0964181414529809, y: .1149066664678467, color: '#000000'},
     outline: {size: .03, color: '#000000'}, bg: null},
    {k: 'rizz', name: 'Rizz', cat: 'Social',
     font: 'Poppins Extrabold', color: '#ffffff', emphasis: 'normal', align: 'center', lh: 1.2, ls: -1, casing: 'uppercase',
     anim: 'colourHighlight', animColor: '#FDFA14',
     shadow: {size: .11, x: .1597714252055694, y: .1654481540778898, color: '#000000B3'},
     outline: {size: .06, color: '#000000'}, bg: null},
    {k: 'lime', name: 'Lime', cat: 'Social',
     font: 'The Bold Font', color: '#232323ff', emphasis: 'normal', align: 'center', lh: 1.05, ls: -1, casing: 'uppercase',
     anim: 'dropIn', animColor: '#80ffc9ff',
     shadow: null,
     outline: null, bg: {type: 'lines', color: '#b6ff60ff', radius: .3, pad: .2}},
    {k: 'phantom', name: 'Phantom', cat: 'Social',
     font: 'Poppins Extrabold', color: '#ffffff', emphasis: 'normal', align: 'center', lh: 1.25, ls: -1, casing: 'none',
     anim: 'boxHighlight', animColor: '#6147FF',
     shadow: {size: .15, x: -.01, y: -1.224646799147353e-18, color: '#0000004D'},
     outline: null, bg: null},
    {k: 'bulb', name: 'Bulb', cat: 'Social',
     font: 'Poppins Extrabold', color: '#ffffff', emphasis: 'normal', align: 'center', lh: .9, ls: -3.12, casing: 'uppercase',
     anim: 'reveal', animColor: '#6147FF',
     shadow: {size: 1, x: -.01, y: -1.224646799147353e-18, color: '#ffffff'},
     outline: {size: .01, color: '#000000'}, bg: null},
    {k: 'vegas', name: 'Vegas', cat: 'Social',
     font: 'Poppins Extrabold', color: '#ffffff', emphasis: 'normal', align: 'center', lh: 1.25, ls: -1, casing: 'uppercase',
     anim: 'flipClock', animColor: '#6147FF',
     shadow: {size: .99, x: -.01, y: -1.224646799147353e-18, color: '#FF25CE'},
     outline: {size: .02, color: '#ff98e9'}, bg: null},
    {k: 'boba', name: 'Boba', cat: 'Social',
     font: 'Rubik Black', color: '#ffffff', emphasis: 'normal', align: 'center', lh: .95, ls: -1, casing: 'uppercase',
     anim: 'dropIn', animColor: '#FDFA14',
     shadow: null,
     outline: {size: .18, color: '#000000'}, bg: null},
    {k: 'matcha', name: 'Matcha', cat: 'Social',
     font: 'Bangers', color: '#b6ff60ff', emphasis: 'normal', align: 'center', lh: 1.05, ls: -1, casing: 'uppercase',
     anim: 'karaoke', animColor: '#80ffc9ff',
     shadow: null,
     outline: {size: .1, color: '#000000'}, bg: null},
    {k: 'shadeplay', name: 'Shadeplay', cat: 'Business',
     font: 'Poppins Medium', color: '#ffffff', emphasis: 'normal', align: 'center', lh: 2, ls: 0, casing: 'none',
     anim: 'none', animColor: '#000000',
     shadow: {size: .62, x: -.01, y: -1.224646799147353e-18, color: '#00000066'},
     outline: null, bg: {type: 'lines', color: '#00000080', radius: 0, pad: .2}},
    {k: 'simple', name: 'Simple', cat: 'Business',
     font: 'Poppins', color: '#ffffff', emphasis: 'bold', align: 'center', lh: 1.2, ls: 1, casing: 'none',
     anim: 'none', animColor: '#000000',
     shadow: {size: .1, x: 3.061616997868383e-18, y: .05, color: '#000000ff'},
     outline: null, bg: null},
    {k: 'casper', name: 'Casper', cat: 'Business',
     font: 'Poppins', color: '#ffffff', emphasis: 'bold', align: 'center', lh: 1.25, ls: 0, casing: 'none',
     anim: 'none', animColor: '#000000',
     shadow: {size: .17, x: .08335900445507967, y: .08632077604063812, color: '#000000cc'},
     outline: {size: .04, color: '#000000'}, bg: null},
    {k: 'corpo', name: 'Corpo', cat: 'Business',
     font: 'Poppins', color: '#ffffff', emphasis: 'bold', align: 'center', lh: 1.2, ls: 1, casing: 'none',
     anim: 'none', animColor: '#000000',
     shadow: {size: .6, x: -.01, y: -1.224646799147353e-18, color: '#000000b3'},
     outline: null, bg: null},
    {k: 'boo', name: 'Boo', cat: 'Business',
     font: 'Poppins', color: '#ffffff', emphasis: 'bold', align: 'center', lh: 1.9, ls: .5, casing: 'none',
     anim: 'dropIn', animColor: '#000000',
     shadow: null,
     outline: null, bg: {type: 'lines', color: '#00000066', radius: 0, pad: .2}},
    {k: 'beans', name: 'Beans', cat: 'Business',
     font: 'Poppins Extrabold', color: '#ffffff', emphasis: 'normal', align: 'center', lh: 1.2, ls: -1, casing: 'uppercase',
     anim: 'karaoke', animColor: '#000000',
     shadow: {size: .81, x: -.05, y: -6.123233995736766e-18, color: '#000000'},
     outline: {size: .06, color: '#000000'}, bg: null},
    {k: 'plain', name: 'Plain', cat: 'Business',
     font: 'Poppins', color: '#ffffff', emphasis: 'bold', align: 'center', lh: 1.05, ls: .5, casing: 'none',
     anim: 'dropIn', animColor: '#000000',
     shadow: {size: .48, x: -.009998476951563914, y: -.0001745240643728344, color: '#000000'},
     outline: {size: .07, color: '#000000'}, bg: null},
    {k: 'capri', name: 'Capri', cat: 'Retro',
     font: 'Montserrat Semibold', color: '#FFFC86', emphasis: 'italic', align: 'center', lh: 1.05, ls: .5, casing: 'none',
     anim: 'none', animColor: '#000000',
     shadow: {size: .04, x: .05500000000000001, y: .09526279441628825, color: '#000000'},
     outline: {size: .05, color: '#000000'}, bg: null},
    {k: 'lowkey', name: 'Lowkey', cat: 'Retro',
     font: 'Poppins', color: '#ffffff', emphasis: 'bold', align: 'center', lh: 1.4, ls: 0, casing: 'none',
     anim: 'none', animColor: '#000000',
     shadow: {size: .62, x: -.01, y: -1.224646799147353e-18, color: '#000000cc'},
     outline: null, bg: {type: 'lines', color: '#000000ff', radius: 0, pad: .2}},
    {k: 'vinta', name: 'Vinta', cat: 'Retro',
     font: 'Poppins', color: '#FDFA14', emphasis: 'bold', align: 'center', lh: 1.4, ls: .5, casing: 'none',
     anim: 'floatInBottom', animColor: '#000000',
     shadow: {size: 0, x: -.06156614753256583, y: .07880107536067221, color: '#000000'},
     outline: {size: .06, color: '#000000'}, bg: null},
    {k: 'slant', name: 'Slant', cat: 'Retro',
     font: 'Poppins', color: '#ffffff', emphasis: 'italic', align: 'center', lh: 1.05, ls: .5, casing: 'none',
     anim: 'dropIn', animColor: '#000000',
     shadow: null,
     outline: null, bg: {type: 'lines', color: '#000000', radius: 0, pad: .2}},
    {k: 'diego', name: 'Diego', cat: 'Retro',
     font: 'Poppins', color: '#FDFA14', emphasis: 'bold', align: 'center', lh: 1.4, ls: .5, casing: 'none',
     anim: 'highlight', animColor: '#000000',
     shadow: null,
     outline: null, bg: {type: 'lines', color: '#000000', radius: .3, pad: .2}},
    {k: 'yeet', name: 'Yeet', cat: 'Retro',
     font: 'Shrikhand', color: '#ffffff', emphasis: 'normal', align: 'center', lh: 1.2, ls: -1, casing: 'none',
     anim: 'floatInBottom', animColor: '#000000',
     shadow: {size: .6, x: -.14, y: -1.714505518806295e-17, color: '#000000ff'},
     outline: {size: .02, color: '#000000'}, bg: null},
  ];

  /* ---------- 字体：族名 → （CSS 栈, 基准字重） ----------
     预设把字重编进了族名，所以这张表把它拆回来。栈末尾一律挂中文字体——画廊样张
     下面那行是中文，拉丁字体一个 CJK 字形都没有。 */
  const CJK = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC'";
  const F = (fam, weight, fallback) => ({
    fam, weight, stack: "'" + fam + "', " + (fallback ? fallback + ', ' : '') + CJK + ', sans-serif',
  });
  const FONTS = {
    'Arimo':               F('Arimo', 400, 'Arial'),
    'Montserrat':          F('Montserrat', 400),
    'Montserrat Semibold': F('Montserrat', 600),
    'Poppins':             F('Poppins', 400),
    'Poppins Medium':      F('Poppins', 500),
    'Poppins SemiBold':    F('Poppins', 600),
    'Poppins Extrabold':   F('Poppins', 800),
    'Anton':               F('Anton', 400),
    'Bangers':             F('Bangers', 400),
    'Squada One':          F('Squada One', 400),
    'Shrikhand':           F('Shrikhand', 400),
    'Rubik Black':         F('Rubik', 900),
    // Google Fonts 上没有这两款；栈里留着原名（本机装了就用得上），后面跟一款同族气质的替身
    'Komika Axis':         F('Komika Axis', 400, "'Bangers'"),
    'The Bold Font':       F('The Bold Font', 900, "'Poppins'"),
  };
  const DEFAULT_FONT = F('Poppins', 400);
  function fontOf(name) { return FONTS[name] || DEFAULT_FONT; }

  /* ---------- 动效 ----------
     第 66 轮起**没有映射表了**：目录的键就是样式里 `animation` 的枚举键（见 model-subanim.js
     里那 17 条），所以从样式里的 `animation` 到目录格之间是恒等的，也就没有
     「按名字对错了」的余地——前三轮的错全出在那张翻译表上。

     唯一要翻的是 `stack` 那一条：样式里写的是 `bgHighlight`（实现名），目录里用的是枚举名
     `stack`。这一条在 model-subanim.js 的 `ALIAS` 里也记着同一件事。 */
  const ALIAS = {bgHighlight: 'stack'};
  /** 预设的动画名 → 目录的键。目录里没有的落 `none`，不硬塞。 */
  function animOf(name) {
    const k = ALIAS[name] || name;
    return window.BC_SA && window.BC_SA.byKey(k) ? k : 'none';
  }

  /** 预设的 `letterCasing` → 本目录 `cases` 的键（四档对四档）。 */
  const CASING = {none: '', uppercase: 'upper', lowercase: 'lower', capitalize: 'title'};
  /** 预设的 `category` → 本目录 `cats` 的键。
   *  只有这三档：`category` 另外那两档（`Dynamic` / `ContentAware`）里装的全是不在这里的
   *  `emphasis*` 与 `template-*-sub`，一份具体样式都没有。表里不写它们，
   *  是为了让「目录里出现了一个 `cats` 没有的分类」在改动时立刻现形，而不是悄悄少一张卡。 */
  const CATS = {Social: 'social', Business: 'business', Retro: 'retro'};

  /* ---------- 颜色 ----------
     预设的色串有 6 位与 8 位两种。**只有底色需要拆**：属性页那颗「不透明度」滑杆要有
     东西可写，混在一个 8 位串里它就是个摆设。字色 / 描边 / 阴影不拆——CSS 直接认 8 位，
     而那三处也没有对应的滑杆。 */
  function splitAlpha(s) {
    const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(String(s || ''));
    if (!m) return {hex: s, pct: 100};
    return {hex: '#' + m[1].toUpperCase(), pct: m[2] ? Math.round(parseInt(m[2], 16) / 255 * 100) : 100};
  }
  /** alpha 是 ff 的 8 位串收成 6 位。同一个颜色，少两位噪音。 */
  function trimOpaque(s) {
    const m = /^#([0-9a-fA-F]{6})[fF]{2}$/.exec(String(s || ''));
    return m ? '#' + m[1] : s;
  }

  /* ---------- 一份预设 → 一份涂装 ----------
     返回的键就是**轨上的键**：套用样式（`editor.jsx` 的 `stagePreset`）把这一份整个
     铺到轨上，画廊缩略图与属性页预览条读的也是它，所以三处不可能画得不一样。 */
  function paint(p) {
    const f = fontOf(p.font);
    const bold = p.emphasis === 'bold' || p.emphasis === 'bolditalic';
    const bg = p.bg ? splitAlpha(p.bg.color) : null;
    const out = {
      font: p.font, stack: f.stack,
      /* `weight` 是**族自带的**字重，`bold` 是 B 钮——两个键，不合成一个。
         合成了的话属性页上关掉 B 画面不会有任何反应（`Poppins Extrabold` 的 800 已经
         焊进那一个数里了）。叠加规则在 `paintCss`：`bold` 把字重顶到至少 700，所以
         `Poppins + bold` 是 700、`Poppins Extrabold + normal` 仍是 800。 */
      weight: f.weight,
      bold: bold,
      italic: p.emphasis === 'italic' || p.emphasis === 'bolditalic',
      color: trimOpaque(p.color),
      align: p.align,
      lh: Math.round(p.lh * 100),
      spacing: Math.round(p.ls * 2),
      upper: CASING[p.casing] || '',
      mono: false,
      // 底板：没有就是不透明度 0（底色留默认的黑，属性页把开关拨回来时有个起点）
      bg: bg ? bg.hex : '#000000',
      opacity: bg ? bg.pct : 0,
      corners: p.bg ? Math.round(p.bg.radius * 100) : 0,
      pad: p.bg ? Math.round(p.bg.pad * 100) : 20,
      plate: p.bg && p.bg.type === 'block' ? 'block' : 'line',
      outline: !!p.outline,
      outlineColor: p.outline ? trimOpaque(p.outline.color) : '#000000',
      outlineW: p.outline ? Math.round(p.outline.size * 160) : 0,
      shadow: !!p.shadow,
      activeColor: trimOpaque(p.animColor),
    };
    if (p.shadow) {
      // offset 是由 distance / direction 极坐标生成的；这里做它的逆运算
      const d = Math.sqrt(p.shadow.x * p.shadow.x + p.shadow.y * p.shadow.y);
      const deg = Math.atan2(p.shadow.y, p.shadow.x) * 180 / Math.PI;
      out.shDist = Math.round(d * 100);
      out.shAngle = (Math.round(deg) + 360) % 360;
      out.shBlur = Math.round(p.shadow.size * 100);
      out.shColor = p.shadow.color;
    } else {
      out.shDist = 12; out.shAngle = 90; out.shBlur = 24; out.shColor = '#000000cc';
    }
    return readable(out);
  }

  /* ---------- 一处有意的补丁：没有底板就必须有描边 ----------
     预设里有五份白字既没底板也没描边（`karl` / `sprout` / `phantom` / `simple` /
     `corpo`），只靠一层阴影托字——阴影本来就淡（`phantom` 是 `#0000004D`），落在
     白墙、天空、雪地这类亮画面上字就化进去了。字幕看不清等于没有字幕，所以这里补一道
     与 Classic（`model-defaultsub.js`）同款的黑描边：`#000000`、`outlineW 11`
     （字号的 11/160 ≈ 7%，App 侧 `textOutline.width` 14）。

     判据是**画面上有没有底板**（`opacity > 0`），不看阴影强弱：半透明底板（`snugle` /
     `boo` 40%、`shadeplay` 50%）与实底板已经把字和画面隔开，不加。自己带描边的
     那些（哪怕细如 `bulb` 的 2）保留原值——那是预设的设计，这里只补缺，不改粗细。
     `PRESETS` 数组本身不动：数据仍是原样，改动只在这一个函数里，
     有 `node --test` 钉着「每一份没有底板的涂装都带描边」。 */
  const READABLE_OUTLINE = {color: '#000000', w: 11};
  function readable(look) {
    if (look.opacity > 0 || look.outline) return look;
    return Object.assign(look, {outline: true, outlineColor: READABLE_OUTLINE.color, outlineW: READABLE_OUTLINE.w});
  }

  /** 涂装表：键就是预设的 key，目录卡的 `look` 指的是它。 */
  const LOOKS = {};
  PRESETS.forEach((p) => { LOOKS[p.k] = paint(p); });

  /** 目录卡的三种形态。预设只管一门语言一条轨，所以**只有 `orig` 是它原本的形态**；
   *  双语与仅译文是 BaoCut 自己的形态（一门语言一条轨，见 `model-substyle.js`），
   *  由同一份涂装派生——双语两行同款，因为一份样式讲的就是「一条字幕长什么样」，
   *  给译文行另配一款是在替样式做决定。 */
  function cards(form) {
    /* 名字**不带形态后缀**（第 74 轮去掉「· 双语 / · 仅译文」）：翻译 Tab 改成按
       形态分区之后，区头已经说了这一区是什么，卡名再说一遍就是三十一遍——而且
       同一份样式在两个 Tab 里该叫同一个名字，它们本来就是同一份涂装。 */
    const prefix = {orig: 'v-', bi: 'vb-', trans: 'vt-'}[form];
    return PRESETS.map((p) => {
      const c = {id: prefix + p.k, name: p.name, form: form,
        cat: CATS[p.cat] || 'social', look: p.k, anim: animOf(p.anim)};
      if (form === 'bi') c.look2 = p.k;
      // 仅译文的画面上没有原文，词级时间戳的宿主不在场——逐词动效一律 none
      if (form === 'trans') c.anim = 'none';
      return c;
    });
  }

  window.BC_VS = {PRESETS, LOOKS, FONTS, CASING, CATS,
    fontOf, animOf, splitAlpha, trimOpaque, paint, readable, READABLE_OUTLINE, cards};
})();
