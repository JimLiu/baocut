// BaoCut Subtitle Studio — 字幕样式预设的唯一定义（Style 层的「预设」tab 与面板
// 工具行里的样式选择器共用）。预设是"一次点击就换一整套外观"的粗粒度入口：id 写进
// doc.style.preset（本地覆盖 bcs:style，Agent 写 data.json 时退位），style 是要铺进
// 覆盖层的字段补丁。
//
// 这张表是 Mac `SampleData.presets`（apps/mac/.../Adapters/SampleStyleDataAdapter.swift）
// 的 Studio 孪生：**同一批 id、同一个分组顺序、同一套外观参数**，名字取
// zh-Hans.lproj/Localizable.strings 里 Mac 自己的译名。Mac 的 SubStyle 是嵌套结构，
// Studio 的样式是扁平 blob，所以这里把 Mac 的 `baseStyle + over(&s)` 展平成
// `BASE + 覆盖`：每个预设都必须写全会变的字段，否则换预设时上一套的残留会留在
// 覆盖层里（预设是"一整套外观"，不是"补丁"）。
//
// 字体家族全部来自 font-catalog.js 的内置表（它本身就是 Mac fontLibrary 的孪生），
// 所以 Mac 用到的每个家族在 Studio 里都能真正渲染出来。
//
// 只有数据，没有 DOM/React 依赖：可以在 node 里直接 require 做断言。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_STYLE_PRESETS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Mac SubStyle() 的默认值，展平成 Studio 的字段名。
  const BASE = {
    fontFamily: 'Montserrat',
    fontSize: 30,
    fontColor: '#FFFFFF',
    bold: true,
    italic: false,
    underline: false,
    textTransform: 'none',
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    background: false,
    backgroundColor: '#000000CC',
    backgroundPadding: 10,
    backgroundStyle: 'wrap',
    borderRadius: 15,
    outline: false,
    textOutline: { on: false, color: '#000000', width: 0 },
    dropShadow: { on: false, blur: 0, distance: 0, rotation: 45, color: '#000000' },
    glow: { on: false },
    wordAnimation: { animationName: 'None' },
    transition: { transitionId: 'none', transitionSpeed: 50 },
  };

  // Mac 的效果构造器（DropShadow(...) / TextOutline(...)）在扁平模型里的等价物。
  const shadow = (blur, distance, color) => ({
    on: true, blur, distance, rotation: 45, color,
  });
  const stroke = (color, width) => ({ on: true, color, width });
  // 底板：Mac 写 backgroundColor，`transparent` 表示没有底板。
  const plate = (color, padding, radius) => ({
    background: true, backgroundColor: color, backgroundPadding: padding, borderRadius: radius,
  });
  // 逐词动画：与内核 normalizeWordAnimation 的配方名一一对应（WordFX 的孪生）。
  const wa = (name, over) => ({ animationName: name, ...(over || {}) });
  const waColor = (color) => wa('Color', { active: { color } });
  const waHighlight = (backgroundColor, color) => wa('Highlight', { active: { backgroundColor, color } });
  const waPaint = (color) => wa('Paint', { spoken: { color } });
  const tr = (transitionId) => ({ transitionId, transitionSpeed: 50 });

  const P = (id, name, group, over) => ({ id, name, group, style: { ...BASE, ...over } });

  const PRESETS = [
    // ---- 精选 ----
    P('DEFAULT_PRESET', '默认', '精选', {
      dropShadow: shadow(0.12, 0.08, '#000000'),
      outline: true, textOutline: stroke('#000000', 14),
      wordAnimation: waColor('#18E1D6'),
    }),
    P('DARK_OUTLINE', '深色描边', '精选', {
      fontFamily: 'Lexend Deca', fontSize: 38,
      dropShadow: shadow(0.07, 0.11, '#000000'),
      outline: true, textOutline: stroke('#000000', 15),
    }),
    P('HIGHLIGHTER', '荧光笔', '精选', {
      fontFamily: 'Lexend Deca', align: 'left',
      dropShadow: shadow(0.1, 0.08, '#404040'),
      wordAnimation: waColor('#FFF731'), transition: tr('magic-fade'),
    }),
    P('SPOKEN', '已读词', '精选', {
      fontFamily: 'Lexend Deca', fontSize: 38, align: 'left',
      dropShadow: shadow(0.37, 0.07, '#000000'),
      wordAnimation: wa('Reveal'), transition: tr('magic-fade'),
    }),
    // ---- 粗体 ----
    P('HEADLINE', '大标题', '粗体', {
      fontFamily: 'Bebas Neue', fontSize: 42,
      dropShadow: shadow(0.08, 0.1, '#202020'),
      outline: true, textOutline: stroke('#000000', 19),
    }),
    P('PRIME', '主打', '粗体', {
      fontFamily: 'Archivo Black', fontSize: 38, bold: false,
      dropShadow: shadow(0.5, 0.08, '#202020'),
      outline: true, textOutline: stroke('#202020', 50),
      transition: tr('magic-pop'),
    }),
    P('SWIFT', '灵动', '粗体', {
      fontFamily: 'Paytone One', fontSize: 38, italic: true, textTransform: 'uppercase',
      dropShadow: shadow(0.36, 0.11, '#000000'),
      outline: true, textOutline: stroke('#000000', 50),
      transition: tr('magic-pop'),
    }),
    P('CHILL', '松弛', '粗体', {
      fontFamily: 'Carter One', fontSize: 38,
      dropShadow: shadow(0.09, 0.11, '#000000'),
      outline: true, textOutline: stroke('#000000', 39),
      wordAnimation: waColor('#FFEA00'), transition: tr('magic-pop'),
    }),
    P('FOCUS', '聚焦', '粗体', {
      fontColor: '#FFEA00', fontFamily: 'Fredoka One', fontSize: 38, bold: false,
      dropShadow: shadow(0, 0.14, '#000000'),
      outline: true, textOutline: stroke('#000000', 31),
      wordAnimation: waColor('#FFFFFF'),
    }),
    P('ELECTRIC', '电光', '粗体', {
      fontFamily: 'Archivo Black', fontSize: 38, bold: false,
      dropShadow: shadow(0, 0.14, '#000000'),
      outline: true, textOutline: stroke('#000000', 31),
      wordAnimation: waHighlight('#00FF00', '#0D0D0D'),
    }),
    // ---- 简洁 ----
    P('CLASSIC_PRESET', '经典', '简洁', {
      ...plate('#FFFFFF', 25, 25), fontColor: '#000000', bold: false,
      wordAnimation: waColor('#0083E2'), transition: tr('magic-pop'),
    }),
    P('LIGHT_MODE', '浅色模式', '简洁', {
      ...plate('#FFFFFF', 25, 23), fontColor: '#000000', fontSize: 38, lineHeight: 1.15,
    }),
    P('DARK_MODE', '深色模式', '简洁', {
      ...plate('#000000', 25, 23), fontSize: 38, lineHeight: 1.15,
    }),
    P('DARK_LOFI', '暗调 Lofi', '简洁', {
      ...plate('#0000004D', 25, 16), fontFamily: 'Alata', fontSize: 38, lineHeight: 1.15,
    }),
    P('SERIF', '衬线', '简洁', {
      fontFamily: 'Source Serif 4', fontSize: 38, lineHeight: 1.15, borderRadius: 50,
      dropShadow: shadow(0.22, 0.07, '#000000'),
    }),
    P('MONOSPACE', '等宽', '简洁', {
      ...plate('#000000B3', 25, 0), fontFamily: 'Courier New', fontSize: 26,
      transition: tr('magic-flip'),
    }),
    // ---- 趣味 ----
    P('BUBBLY', '泡泡', '趣味', {
      fontFamily: 'Fredoka One', fontSize: 38,
      dropShadow: shadow(0.07, 0.11, '#FF4D8D'),
      outline: true, textOutline: stroke('#FF4D8D', 50),
      transition: tr('magic-pop'),
    }),
    P('ZAP', '闪电', '趣味', {
      fontFamily: 'Bangers', fontSize: 40, bold: false,
      dropShadow: shadow(0.06, 0.1, '#000000'),
      outline: true, textOutline: stroke('#000000', 19),
      wordAnimation: waColor('#9FFF51'),
    }),
    P('COMIC_PRESET', '漫画', '趣味', {
      ...plate('#FFE279', 25, 0), fontColor: '#000000', fontFamily: 'Comic Sans MS',
      bold: false, textTransform: 'uppercase',
      wordAnimation: wa('Bounce'), transition: tr('magic-pop'),
    }),
    P('GRAFITTI_PRESET', '涂鸦', '趣味', {
      ...plate('#C5E6FF', 25, 0), fontColor: '#21A2FF', fontFamily: 'Permanent Marker',
      bold: false, textTransform: 'uppercase',
      wordAnimation: waPaint('#196794'), transition: tr('magic-pop'),
    }),
    P('BUBBLE_GUM_PRESET', '泡泡糖', '趣味', {
      ...plate('#FF66A6', 25, 50), fontFamily: 'Fredoka One', bold: false,
      wordAnimation: wa('Bounce'), transition: tr('magic-flip'),
    }),
    P('HANDWRITING_PRESET', '手写', '趣味', {
      ...plate('#FFDCDC', 25, 25), fontColor: '#D23E3E', fontFamily: 'Dancing Script', fontSize: 40,
      wordAnimation: wa('Reveal'), transition: tr('magic-fade'),
    }),
    // ---- 复古 ----
    P('STRONG_PRESET', '强力', '复古', {
      ...plate('#D23E3E', 25, 0), fontFamily: 'Impact', textTransform: 'uppercase',
      wordAnimation: waColor('#FF9B97'), transition: tr('magic-pop'),
    }),
    P('MEME_TEXT_PRESET', '梗图文字', '复古', {
      fontFamily: 'Impact', bold: false, backgroundPadding: 25, borderRadius: 0,
      outline: true, textOutline: stroke('#000000', 12),
      wordAnimation: wa('Paint'), transition: tr('magic-pop'),
    }),
    P('TYPEWRITER_PRESET', '打字机', '复古', {
      ...plate('#FFFFFF', 25, 0), fontColor: '#000000', fontFamily: 'Courier New', bold: false,
      wordAnimation: wa('Reveal'), transition: tr('magic-flip'),
    }),
    P('ARCADE', '街机', '复古', {
      fontFamily: 'Press Start 2P', fontSize: 28, lineHeight: 1.4,
      backgroundPadding: 23, borderRadius: 10,
      dropShadow: shadow(0.02, 0.24, '#651FFF'),
    }),
    P('CONSOLE_PRESET', '终端', '复古', {
      ...plate('#000000', 25, 0), fontColor: '#3EFF51', fontFamily: 'Source Code Pro', bold: false,
      wordAnimation: wa('Reveal'), transition: tr('magic-fade'),
    }),
  ];

  // 分组顺序 = 表里第一次出现的顺序（Mac StylePresetGridPlanner.orderedGroups 同规则）。
  function groups() {
    const order = [];
    const byName = new Map();
    PRESETS.forEach((preset) => {
      if (!byName.has(preset.group)) { byName.set(preset.group, []); order.push(preset.group); }
      byName.get(preset.group).push(preset);
    });
    return order.map((name) => ({ name, presets: byName.get(name) }));
  }

  // 旧 id → 新 id。Studio 早期自带 6 个中文名预设，用户项目（和 CLI
  // `default_style()` 里的 `"preset": "classic"`）已经把它们写进磁盘了；改表不能让
  // 这些项目突然显示"自定义"。映射按外观最接近的一档给，不做二次迁移写盘 ——
  // 只有用户主动再点一次预设时才会落新 id。
  const LEGACY = {
    classic: 'DEFAULT_PRESET',   // 经典描边 = Mac 的 Default（描边 14 + 阴影 + 变色）
    clean: 'DARK_OUTLINE',       // 简洁白：同为 Lexend Deca 的干净一档
    boxed: 'DARK_MODE',          // 黑底白字
    pop: 'FOCUS',                // 醒目黄
    impact: 'HEADLINE',          // 大标题（Bebas Neue）
    serif: 'SERIF',              // 衬线纪录片
  };

  const byId = (id) => PRESETS.find((p) => p.id === id)
    || PRESETS.find((p) => p.id === LEGACY[id])
    || null;

  // 选择器触发器上显示的名字：命中预设显示预设名，手改过（preset 为空或未知）
  // 显示"自定义"。样式还没加载时给"默认"。
  function labelFor(style) {
    if (!style) return '默认';
    const hit = byId(style.preset);
    return hit ? hit.name : '自定义';
  }

  // 当前选中哪一块预设砖：旧 id 也要点亮它映射到的那一块。
  const selectedId = (style) => {
    const hit = byId(style && style.preset);
    return hit ? hit.id : null;
  };

  return { PRESETS, BASE, LEGACY, groups, byId, selectedId, labelFor };
});
