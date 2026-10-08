/* 画布浮动工具条的配置表 —— §14.3。
   ============================================================================
   每一类元素一条配置，形状是：

     { visible: [组, 组, …], more: [组, 组, …] }

   `visible` 的每一组是条子上的一段，**组之间有一条竖分隔线**；`more` 的每一组是
   溢出菜单里的一段，段之间是横分隔线，组里再嵌一层数组表示「一行图标钮」
   （`[['bold','italic'], ['align-left','align-center','align-right']]` = 两行钮）。
   矢量与媒体那四类的第一段是**一行四枚**（垂直翻转 · 水平翻转 · 适应画布 · 填满画布），
   第 43 轮改过来——此前拆成两行、后两枚还是宽文字钮。
   第 85 轮再分回**两簇**（`[[翻转两枚], [画布两枚]]`）：一行没错，但
   两对之间要空一档，翻转与画布本来就不是一件事；第 43 轮收成一簇是矫枉过正，
   那一轮要治的是「两行」，不是「两簇」。
   此前原型把 inline 拍成了一条平的 chip 流，分段信息全丢了——分段本身是语义：
   颜色/字体/字号是一组，动画/效果是另一组，它们之间不该看起来一样近。

   逐类型的词表里，下面几处此前是猜的：
     · 贴纸走 `SVG` 那一条（`fill-list` ＋ `animation`）——位图贴纸（`stickers`）
       与矢量贴纸（`SVG`）分成两套：位图**没有颜色控件**，矢量则列出素材里**每一个填充色**
       分别改。BaoCut 的贴纸目录是 SVG，所以走 `SVG` 这一条；
       第 39.1 轮那个「着色 · 只染单色层」是猜的，逐色改比压成剪影准确得多。
     · 文本**组**走 `groups`：只有 `ungroup` / `delete` 两件（不放「存到品牌库」，
       见下面那条规则），**没有溢出菜单**——组本身没有可调的属性，能调的都在成员身上。

   **「存到品牌库」不上条子，只进菜单**（第 79 轮立、第 82 与 84.1 两轮收窄）。
   **条子上一处都不放**——存是「调完之后」的动作，浮动条是「正在调」的地方，把一个终点
   摆在最挤的那根条子上，等于占一格去放一件与当前编辑无关的事。**菜单里三处都有**：
   文字在 `copy / arrange` 那一段末尾（第 82 轮），图片与视频在 `replace-*` 之后
   （第 84.1 轮，用户裁决「也放回去」）。
   拦了两轮的理由是「品牌库没有素材这一格，存下去没有落点」；第 84.1 轮把落点补上了：
   品牌库分 Videos / Images / Audio / Colors / Fonts / Saved Items / Subtitles 七节，
   BaoCut 的品牌页此前缺前两节，补齐即可。
   **动图贴纸那一条不放**。
   属性面板那两个入口照旧：文字是 Edit text 的「存为文字样式 +」（`panel-text.jsx`），
   字幕是属性页页脚那条 savebar（`panel-subprops.jsx`）。

   不上条子的（记录在案，不画）：魔法工具、改稿、生成视频、清理音频、配音改写这类 AI 入口，
   BaoCut 的对应物在 AI 工具面板，不从画布条子上开第二个口子；第 145 轮普通视频
   的 `transitions` 已补原型选择器，独立于核心格式，等待评审后落地。
   ============================================================================ */
(function () {
  /* 每一项的显示名与形态。`icon: true` = 只出图标、不出字。 */
  const ITEM = {
    // —— 文字
    'text-styles':   {label: '样式', icon: true},
    color:           {label: '颜色', swatch: true},
    font:            {label: '字体', chip: true},
    size:            {label: '字号', chip: true},
    animation:       {label: '动画', icon: true},
    transitions:     {label: '转场', chip: true},
    'save-to-brand-kit': {label: '存到品牌库'},
    bold:            {label: 'B', row: true},
    italic:          {label: 'I', row: true},
    /* 这三条的 `label` 是**悬停提示**（这一行摆的是图标，不是字），第 89.2 轮与属性页
       那三档的 `tip` 对齐成同一套说法——同一个控件在两处叫两个名字没有道理。 */
    'align-left':    {label: '左对齐', row: true},
    'align-center':  {label: '居中', row: true},
    'align-right':   {label: '右对齐', row: true},
    'line-height':   {label: '行高', sub: true},
    'letter-spacing': {label: '字距', sub: true},
    // —— 通用
    copy:            {label: '复制'},
    arrange:         {label: '层级', sub: true},
    properties:      {label: '属性'},
    'adjust-timing': {label: '调整时间', sub: true},
    delete:          {label: '删除', tone: 'neg'},
    'flip-horizontal': {label: '水平翻转', row: true},
    'flip-vertical': {label: '垂直翻转', row: true},
    'fit-canvas':    {label: '适应画布', row: true},
    'fill-canvas':   {label: '填满画布', row: true},
    opacity:         {label: '不透明度', sub: true},
    'round-corners': {label: '圆角', sub: true},
    // —— 各类型专属
    border:          {label: '描边', chip: true},
    filters:         {label: '滤镜'},
    effects:         {label: '效果'},
    'fill-list':     {label: '填充色', fills: true},
    adjust:          {label: '调整', chip: true},
    'progress-picker': {label: '样式', chip: true},
    'wave-picker':   {label: '样式', chip: true},
    /* 声波 / 进度的色槽（第 213 轮）。**数量与标题不在这里**——它们按款不同
       （`BC_EL.WAVES` / `PROGRESS` 的 `colors` / `labels`），与 `fill-list` 同构：配置表只说「这里摆一段色点」。 */
    'wave-colors':   {label: '颜色', fills: true},
    'progress-colors': {label: '颜色', fills: true},
    'counter-mode':  {label: '模式', chip: true},
    'volume-levels': {label: '音量档位', sub: true},
    volume:          {label: '音量', icon: true},
    speed:           {label: '变速', icon: true},
    'replace-image': {label: '替换图片'},
    'crop-video': {label: '智能裁剪'},
    'replace-video': {label: '替换视频'},
    'replace-sticker': {label: '替换贴纸'},
    'detach-audio':  {label: '分离音频'},
    ungroup:         {label: '解组'},
    /* —— 字幕（§16.3）。条子最前那一格是同位的两件：换一条轨来编辑（`sub-scope`），
       以及这一笔落在全部字幕还是仅这一条（`sub-cue-scope`）——后者就是 Detach 的语义，
       只是写成一个说得出口的作用域，不是一颗链/断链钮。 */
    'sub-scope':     {label: '目标'},
    'sub-cue-scope': {label: '作用域', chip: true},
    'sub-edit':      {label: 'Edit'},
    'sub-style':     {label: 'Styles', chip: true},
    'sub-animation': {label: 'Animation', chip: true},
    case:            {label: '大小写'},
    'apply-style-to-global': {label: '应用到所有字幕'},
    'hide-subs':     {label: '隐藏字幕'},
    // —— BaoCut 自有
    'overlay-opacity': {label: '不透明度', chip: true},
    'frame-style':   {label: '样式', chip: true},
    'tpl-props':     {label: '模板属性'},
    'tpl-edit':      {label: '编辑版面'},
    'tpl-remove':    {label: '移除模板', tone: 'neg'},
  };

  const BAR = {
    /* 文字这一条第 82 轮重排，此前自己加的两处收掉了：
         · 条子上不再把「样式」单拎到最前——条子是 `颜色 字体 字号 │ 两枚图标钮`，
           我们那颗 ☀ 站在最前面是第 20 轮的旧摆法；
         · `more` 里那一段「样式 · 动画」（第 42 轮加的第二入口）去掉；
         · **`save-to-brand-kit` 回到 `copy / arrange` 那一段末尾**。
           第 79 轮那条规则因此收窄成「**条子上**不放」——存是调完之后的动作，不该占
           条子上那一格；菜单里是二级，与 Copy / 层级同段，那是它该在的地方。
       **Text Behind Person 不做**（用户点名）：条子与 `more` 里都不画
       （`hide-text-behind`）——BaoCut 没有人像分割这条链路。 */
    text: {
      visible: [['color', 'font', 'size'], ['text-styles', 'animation']],
      more: [[['bold', 'italic'], ['align-left', 'align-center', 'align-right']],
             ['line-height', 'letter-spacing'],
             ['copy', 'arrange', 'save-to-brand-kit'],
             ['properties'],
             ['adjust-timing', 'delete']],
    },
    // 文本组：只有解组与删除两件，而且**没有 more**
    textgroup: {
      visible: [['ungroup'], ['delete']],
    },
    /* 视频。第 84 轮把 `more` 漏掉的那一段补回来：**滤镜 · 效果 · 调整**
       （摆在圆角与 Copy 之间）。此前只当它们是 AI 入口跳过了——`filters` 与
       `effects` 是 LUT 贴图与着色器库、`adjust` 是九项色彩校正，都不是 AI。
       AI 链路保留在 AI 工具面板；第 145 轮补可交互转场原型。 */
    video: {
      visible: [['animation', 'transitions'], ['volume', 'speed']],
      more: [[['flip-vertical', 'flip-horizontal'], ['fit-canvas', 'fill-canvas']],
             ['opacity', 'round-corners'],
             ['filters', 'effects', 'adjust'],
             ['copy', 'arrange'],
             ['adjust-timing', 'crop-video', 'replace-video', 'detach-audio', 'save-to-brand-kit', 'delete']],
    },
    image: {
      visible: [['animation'], ['adjust']],
      more: [[['flip-vertical', 'flip-horizontal'], ['fit-canvas', 'fill-canvas']],
             ['opacity', 'round-corners'],
             ['copy', 'arrange'],
             ['adjust-timing', 'replace-image', 'save-to-brand-kit', 'delete']],
    },
    shape: {
      visible: [['color'], ['border'], ['animation']],
      more: [[['flip-vertical', 'flip-horizontal'], ['fit-canvas', 'fill-canvas']],
             ['copy', 'arrange'],
             ['properties'],
             ['adjust-timing', 'delete']],
    },
    // 贴纸走 `SVG` 那一条：素材里有几个填充色就列几个
    sticker: {
      visible: [['fill-list'], ['animation']],
      more: [[['flip-vertical', 'flip-horizontal'], ['fit-canvas', 'fill-canvas']],
             ['copy', 'arrange'],
             ['properties'],
             ['adjust-timing', 'delete']],
    },
    /* 彩纸（第 231 轮）：条子上只留动画；颜色 / 形状 / 运动 / 发射都在专属属性页，
       条子上摆不下也不该摆（一颗「属性」进那一页）。不做翻转与适配画布——它已铺满。 */
    confetti: {
      visible: [['animation']],
      more: [['copy', 'arrange'], ['properties'], ['adjust-timing', 'delete']],
    },
    /* 白板手绘：与彩纸同一口径——手 / 纸 / 画时都在专属属性页，条子上只留动画。 */
    whiteboard: {
      visible: [['animation']],
      more: [['copy', 'arrange'], ['properties'], ['adjust-timing', 'delete']],
    },
    /* **位图 / 动态贴纸走 `stickers` 一条**（第 84 轮，用户：「动态贴纸本质
       也是视频」）。与上面那条 `sticker`（`SVG`）的差别：位图没有填充色可换，
       于是第一段换成 `adjust`；`more` 里多出「不透明度 ·
       圆角」，少掉「属性」——能调的都在这张条子与 Adjust 页上，没有第二层属性。
       图片那条的 `replace-image` 在这里是 `replace-sticker`：位次相同，落点换成贴纸目录
       ——素材面板里没有贴纸这一栏。 */
    stickerimg: {
      visible: [['animation'], ['adjust']],
      more: [[['flip-vertical', 'flip-horizontal'], ['fit-canvas', 'fill-canvas']],
             ['opacity', 'round-corners'],
             ['copy', 'arrange'],
             ['adjust-timing', 'replace-sticker', 'delete']],
    },
    /* 色点（1–2 枚）排在样式下拉**之前**（第 213 轮）。
       此前这两族的颜色只能钻进属性页改，而浮动条的基线是「大部分类型都能直接在条子上改色」。
       两条彩虹边框（`colors == 0`）一格都不出——判据在那两张表里。 */
    progress: {
      visible: [['progress-colors'], ['progress-picker'], ['animation']],
      more: [['copy', 'arrange'], ['adjust-timing', 'delete']],
    },
    wave: {
      visible: [['wave-colors'], ['wave-picker'], ['animation']],
      more: [['volume-levels'], ['copy', 'arrange'], ['adjust-timing', 'delete']],
    },
    /* 计时（第 88 轮）。**它是一条文字元素**（ADR-CT01），所以条子照 `text` 那一条
       摆「颜色 字体 字号」，只把最前面换成这一类独有的模式下拉；`text-styles` 不摆——
       文字样式预设是一整套排版（字重 / 描边 / 底板 / 对齐），套在一格逐秒换字的读数上
       没有对应物。三颗写的是**计时自己的键**（`cntColor` / `cntFont` / `cntSize`，
       在 `stage-toolbar.jsx` 里按 kind 换）：计时读画布共用袋而文字元素逐元素持有样式，
       共用 `color` / `size` 会让改一次计时把画面上还没设过色的文字一起染了。 */
    counter: {
      visible: [['counter-mode'], ['color', 'font', 'size'], ['animation']],
      /* 第 89.1 轮：`more` 的第一段与 `text` 同形（B / I ＋ 三对齐）。对齐是这一轮
         用户点名要的，B / I 顺带从属性页镜到这里——文字元素这两行本来就在 `more` 里，
         计时是同一条元素，两处形状不同只会让人以为它是另一种东西。 */
      more: [[['bold', 'italic'], ['align-left', 'align-center', 'align-right']],
             ['copy', 'arrange'], ['properties'], ['adjust-timing', 'delete']],
    },
    /* 第 102 轮重排了 `more`：
         · 第一段是**两簇一行**：B / I 一簇，大小写与对齐同簇。我们此前把 `case`
           单开一段，那是把「这一行怎么排」拆成了两件事；对齐留三档直选，
           不收成一颗下拉，所以这一簇是「三档对齐 ＋ 大小写」。
         · 末段补 `save-to-brand-kit`——落点是品牌页的
           「字幕样式」一节（`panel-brand.jsx`）。第 79 轮那条规则收的是**条子**，
           菜单里文字 / 图片 / 视频三处都有，字幕缺着才是不一致。
         · **仍然不放 `delete`**。§16.3 立过：字幕的时间与内容真相在
           transcript `words[]`，画布侧只提供隐藏——一颗红色 Delete 在这儿要么是
           假的（其实只是隐藏），要么删的是转录结果，两种都不该由画布上一颗钮承担。
           `hide-subs` 留在原位。 */
    subtitle: {
      visible: [['sub-scope', 'sub-cue-scope'], ['color', 'font', 'size'],
                ['sub-edit', 'sub-style', 'sub-animation']],
      more: [[['bold', 'italic'], ['align-left', 'align-center', 'align-right', 'case']],
             ['line-height', 'letter-spacing'],
             ['apply-style-to-global', 'save-to-brand-kit', 'hide-subs']],
    },
    // —— 以下三类是 BaoCut 自有的元素，按同一套形状排
    overlay: {
      visible: [['overlay-opacity'], ['animation']],
      more: [['arrange'], ['adjust-timing', 'delete']],
    },
    vframe: {
      visible: [['color'], ['frame-style']],
      more: [['arrange'], ['adjust-timing', 'delete']],
    },
    tpl: {
      visible: [['tpl-props', 'tpl-edit'], ['tpl-remove']],
    },
  };

  /* 字号下拉的档位。条子上的 `size` 与 Text 面板的字号选择器读同一份——两处各写一份，
     迟早出现「条子上有 56、面板里没有」。 */
  const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 120, 140];

  /** 贴纸这一类的条子**由素材决定走哪一条**：能分色的走 `SVG`（`fill-list`），
      不能分色的走 `stickers`（`adjust` ＋ 不透明度 / 圆角）。素材还没读到（`null`）时
      按矢量算——贴纸目录里绝大多数能分色，猜错一次的代价是少两行菜单，反过来是
      摆一个永远读不出填充色的空段。其余类型原样返回。

      第 238 轮起 `.json`（Lottie）也在能分色那一边：五个内置动态分类换成了 Noto 的
      Lottie，颜色在图层的形状项上，判据在 [model-lottiefill.js](model-lottiefill.js)。
      判「能不能分色」这件事只有 `BC_STSRC.fillMode` 一份真身，这里在它在场时直接问它；
      单独 require 本文件的单测拿不到它，才走下面那条同义的正则。
      `src` 也可以是 `{src, kind}`——品牌库上传的源是 `blob:…`，扩展名没了。 */
  function barKind(kind, src) {
    if (kind === 'clip') return 'video';
    if (kind !== 'sticker' || !src) return kind;
    const S = typeof window === 'undefined' ? null : window.BC_STSRC;
    if (S) return S.fillMode(src) === 'none' ? 'stickerimg' : 'sticker';
    const url = src && typeof src === 'object' ? src.src : src;
    return /\.(svg|json)(\?|$)/i.test(url || '') ? 'sticker' : 'stickerimg';
  }

  /** 条子上的分段（每组一段，段间画竖分隔线）。没有配置就退回一颗「属性」。 */
  function visible(kind) {
    const b = BAR[barKind(kind)];
    return b && b.visible ? b.visible : [['properties']];
  }
  /** 溢出菜单的分段；`groups` 与 `tpl` 那种没有 more 的返回 null——**不画那颗 `···`**。 */
  function more(kind) {
    const b = BAR[barKind(kind)];
    return b && b.more ? b.more : null;
  }
  const item = (id) => ITEM[id] || {label: id};
  /** 一组里嵌套数组 = 一行图标钮（`[['bold','italic'], […]]`） */
  const isRow = (g) => Array.isArray(g) && g.some((x) => Array.isArray(x));

  // Selected video chrome is measured in stage space; its content stays clipped to the frame.
  function videoPlacement(box, area, bar) {
    const maxWidth = Math.max(0, area.width - 16), width = Math.min(bar.width, maxWidth);
    const left = Math.max(area.left + 8, Math.min(box.left + box.width / 2 - width / 2, area.right - width - 8));
    const below = box.bottom + 12;
    const desired = below + bar.height <= area.bottom - 8 ? below : box.top - bar.height - 40;
    return {left: Math.round(left - area.left),
      top: Math.round(Math.max(area.top + 8, Math.min(desired, area.bottom - bar.height - 8)) - area.top),
      maxWidth: Math.round(maxWidth)};
  }

  // 长菜单优先向上并在可用空间里滚动，不让窗口夹取把菜单压在触发按钮上。
  function videoMenuLayout(anchor, height) {
    const above = Math.max(0, anchor.top - 26), below = Math.max(0, height - anchor.bottom - 26);
    const up = above >= 240 || above >= below;
    return {dir: up ? 'up' : 'down', maxHeight: up ? above : below};
  }
  window.BC_BAR = {ITEM, BAR, SIZES, visible, more, item, isRow, barKind, videoPlacement, videoMenuLayout};
})();
