/* 默认字幕样式 —— **新建项目种下的那一份涂装**，画廊第一区那张卡。

   这一份**不在预设目录里**（那 31 份在 [model-subpresets.js](model-subpresets.js)，数据逐字段写定），
   所以它单独一个文件、单独一个命名空间：混进 `BC_VS.LOOKS` 或 `BC_VS.cards()` 会让那张写定的
   表多出一行，而核心侧的预设目录正是拿 `V.LOOKS` / `V.cards(form)` 生成的——多一份就等于
   目录里凭空多出一份样式，还会与核心手写的那张卡撞号。

   **为什么要有这张卡**：画廊的选中态按**出处戳**判（卡的 id 要在目录里查得到），而新建
   文档种下的样式此前戳的是一个目录里没有的 id，于是刚建的项目一进样式面板一张卡都不亮，
   随手点过别的卡之后也没有回头路。把种子那份涂装本身摆成第一张卡，这两件一起解决。

   **逐字段对着种子写**（核心 `bcut-workspace::studio::projection::default_style` 与
   `studio/seed/data.json`，核心侧的同一张卡在 `bcut-editor-core::style_library::classic_look`）。
   两边的单位不一样，换算与 `model-subpresets.js` 表头那张表同一把尺：

   | 种子（落库值） | 这里 | 换算 |
   |---|---|---|
   | `lineHeight: 1.2` | `lh: 120` | ×100 |
   | `textOutline.width: 14` | `outlineW: 11` | ÷1.25（落库值是居中笔宽，原型存的是 `fz×outlineW/160` 的那个 `outlineW`） |
   | `dropShadow.{distance: .08, blur: .12}` | `shDist: 8` / `shBlur: 12` | ×100 |
   | `dropShadow.{rotation: 45, opacity: .9}` | `shAngle: 45` / `shColor` 的 alpha `E6` | 极坐标角度原样；不透明度并回 8 位色串 |
   | `borderRadius: 15` / `backgroundPadding: 10` | `corners: 28` / `pad: 19` | 圆角 ×55/30、内边距 ×(100×0.8)/(30×1.4)；底板关着，这两个数只是把滑杆拨回来时的起点 |

   `background: false` 在这一层就是 `opacity: 0`（与目录里那几张没有底板的卡同一种写法）；
   底色留着，属性页那颗不透明度滑杆才有东西可写。

   色值是**画进视频画面**的内容色（字色、描边、阴影、当前词高亮），不是 S2 表面，
   按文件登记在 `_ds_conformance.json`——同 model-subpresets.js / model-textpresets.js 那一条。

   这一层不碰 DOM，`node --test` 直接 require。 */
(function () {

  /** 种子那份涂装。键与轨上的键一一对应，与 `BC_VS.paint()` 的返回同一个形状。 */
  const LOOK = {
    /* 种子写的是 `fontFamily: "system"`（内核按平台兜底成系统正文字体）。原型这一层
       要的是一个能在字体框里查得到的名字，所以叫 `System`，栈末尾照例挂中文字体。 */
    font: 'System',
    stack: "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
    weight: 400,
    bold: true,
    italic: false,
    color: '#FFFFFF',
    align: 'center',
    lh: 120,
    spacing: 0,
    upper: '',
    mono: false,
    // 底板默认关着（`opacity: 0`），底色与圆角/内边距留着当起点
    bg: '#000000',
    opacity: 0,
    corners: 28,
    pad: 19,
    plate: 'line',
    outline: true,
    outlineColor: '#000000',
    outlineW: 11,
    shadow: true,
    shDist: 8,
    shAngle: 45,
    shBlur: 12,
    shColor: '#000000E6',
    activeColor: '#18E1D6',
  };

  /* ---------- Shorts（2026-09-27，设计稿 bcut-shorts-design §5.2，契约 6） ----------
     竖屏发布用的内置预设：粗体大字、念到的词高亮成强调色、描边 ＋ 投影、没有底板。
     它和「经典」一样**不在预设目录里**，也**不进用户的品牌库**（那是用户数据），随产品发。
     涂装只管颜色与笔画；字号（约画宽 5.5%）、水平居中与「块下沿贴 y = 76% 再让出描边投影」是**落位**，
     不在涂装里——涂装会被原样抄到译文轨上，落位要按画面上有几条轨一起算
     （`BC_SHORTS.captionLayout`，卡上的 `layout: 'shorts'` 是记号，`stagePreset` 见到就落）。 */
  const SHORTS_LOOK = Object.assign({}, LOOK, {
    weight: 800,
    lh: 110,
    outlineW: 14,
    shDist: 6,
    shAngle: 90,
    shBlur: 10,
    activeColor: '#FFE14D',
  });

  /** 涂装表，形状同 `BC_VS.LOOKS`（目录卡的 `look` 指的是它的键）。 */
  const LOOKS = {classic: LOOK, shorts: SHORTS_LOOK};

  /** 三种形态各一张，规矩与 `BC_VS.cards()` 一模一样：双语两行同款，
   *  仅译文那张画面上没有原文、词级时间戳的宿主不在场，所以逐词动效恒 `none`。 */
  function cards(form) {
    const prefix = {orig: 'v-', bi: 'vb-', trans: 'vt-'}[form];
    const c = {id: prefix + 'classic', name: '经典', form: form,
      cat: 'default', look: 'classic', anim: 'colourHighlight'};
    if (form === 'bi') c.look2 = 'classic';
    if (form === 'trans') c.anim = 'none';
    /* Shorts 那张自成一区（`cat: 'shorts'`），逐词弹跳；仅译文那张同样没有词通道 */
    const sh = {id: prefix + 'shorts', name: 'Shorts', form: form,
      cat: 'shorts', look: 'shorts', anim: form === 'trans' ? 'none' : 'bounce', layout: 'shorts'};
    if (form === 'bi') sh.look2 = 'shorts';
    return [c, sh];
  }

  window.BC_DS = {LOOK, SHORTS_LOOK, LOOKS, cards};
})();
