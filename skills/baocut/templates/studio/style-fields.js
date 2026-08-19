// BaoCut Subtitle Studio — 样式面板的字段语义（纯函数 + 表）。
//
// 面板只允许写 Studio 样式模型里**已经有人消费**的字段：预览内核
// （subtitle-rendering.js / canvas-stage.jsx）与 CLI 烧录端读同一份扁平样式
// （studio/style.json 契约）。这里收口三类容易分叉的判据：
//
//   1. 效果分区的开关派生。`textOutline.on` / `dropShadow.on` 缺席时才回退到
//      「值是否非零」，与 subtitle-rendering.js effectStyle 同构；面板若自己另写
//      一份判据，就会出现「勾着但没画」。旧 style 只有布尔 `outline`，所以描边
//      开关必须同时写 `outline` 与 `textOutline.on`：内核优先读后者，只写前者
//      等于什么都没改（历史 bug）。
//   2. 半透明底板的 alpha：Studio 的 backgroundColor 是带 alpha 的十六进制
//      （默认 #000000B3），不透明度滑块必须在保留 RGB 的前提下换 alpha。
//   3. 开启一个全零效果时的种子值：勾上却看不出变化等于开关坏了。种子取
//      studio/data.json 的默认值，和 CLI 的 default_style() 同一套数。
//
// 只有数据与字符串/数值处理，没有 DOM/React 依赖：可以在 node 里直接 require。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_STYLE_FIELDS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // 层头部：ctx 决定标题与图标，不决定控件（Studio 的样式模型是整份 doc.style，
  // 两端共用；ctx 只说明你是从哪条字幕进来的）。
  // 标题与图标照抄 Mac StylePaneView.refresh 的 subject 分支（`Subtitle style` /
  // `Translation style` = 字幕样式 / 译文样式，图标 captions / comment）。
  const CTX = {
    sub: { icon: 'captions', title: '字幕样式' },
    bi: { icon: 'comment', title: '译文样式' },
  };
  const ctxMeta = (ctx) => CTX[ctx] || CTX.sub;

  // ----- 目标行（Mac StylePaneView.target + M120 §8 决策 6 的面包屑） -----
  //
  // Mac 把「控件在写哪一行」钉在舞台选中上（Store.subTarget），面板只**陈述**它并
  // 给一个回到两行的动作。Studio 的舞台选中已经带 line（stage.jsx 写
  // `{ kind:'sub', line }`），所以这里只做同一套钳制：
  //   · 非 bi 上下文（Transcript / Subtitle tab）画面上只有原文 → 恒为 orig；
  //   · bi 上下文里 both 永远可选（两行共用属性住在那儿，「仅译文」少了它就是死路）；
  //   · 选中的行如果当前根本不在画面上（比如「仅译文」时选了原文），退回默认目标 ——
  //     两行时是 both，一行时就是那一行。
  // 只在读的时候钳制、不回写选中：从观察者里改写选中会连锁刷新并抹掉用户意图。
  function clampTarget(ctx, mode, line) {
    if (ctx !== 'bi') return 'orig';
    const visible = mode === 'orig' ? ['orig'] : mode === 'trans' ? ['trans'] : ['orig', 'trans'];
    const want = line === 'orig' || line === 'trans' ? line : 'both';
    if (want === 'both' || visible.indexOf(want) >= 0) return want;
    return visible.length > 1 ? 'both' : visible[0];
  }
  const TARGET_LABEL = { orig: '原文', trans: '译文' };

  // 行级样式覆盖的键名：与内核 subtitle-rendering.js `lineStyleKey` 和烧录端
  // studio_export.rs 的 `origStyle` / `transStyle` 同一套（单测钉住一致性）。
  const lineKey = (line) => (line === true || line === 'trans' ? 'transStyle' : 'origStyle');

  // 行视图 = 根样式叠加该行的 partial，与内核 `nestedLineStyle` 同构：面板显示的
  // 值必须就是画面用的值，否则「改了没反应」。both / 单语上下文直接给根样式。
  function lineView(style, line) {
    const root = style || {};
    if (line !== 'orig' && line !== 'trans') return root;
    const override = root[lineKey(line)];
    return override && typeof override === 'object' ? { ...root, ...override } : root;
  }

  // 行级写入：补丁落进 origStyle / transStyle，而不是根上 —— 根是两行共用的底座，
  // 往根上写「原文的颜色」会连译文一起改（Mac 的两行本来就是两份 SubStyle）。
  // both / 单语上下文照旧写根。
  function linePatch(style, line, patch) {
    if (line !== 'orig' && line !== 'trans') return { ...patch };
    const key = lineKey(line);
    const current = (style || {})[key];
    return { [key]: { ...(current && typeof current === 'object' ? current : {}), ...patch } };
  }

  // 逐词动画：只列 normalizeWordAnimation 有专门配方的名字（Custom 是手写复合
  // 状态，面板给不出等价编辑，故不列）。名字与 Mac WordFX.names 一一对应。
  const WORD_ANIMATIONS = [
    { value: 'None', label: '无' },
    { value: 'Color', label: '变色' },
    { value: 'Highlight', label: '高亮' },
    { value: 'Reveal', label: '显现' },
    { value: 'Bounce', label: '跳动' },
    { value: 'Paint', label: '涂色' },
  ];
  // 入场：id 必须与 subtitle-rendering.js 的 TRANSITIONS 键一致。
  const TRANSITIONS = [
    { id: 'none', name: '无' },
    { id: 'magic-fade', name: '淡入' },
    { id: 'magic-pop', name: '弹入' },
    { id: 'magic-flip', name: '翻入' },
  ];
  const TEXT_COLORS = ['#FFFFFF', '#FFD43B', '#8CAAFF', '#7ADF93', '#FF8C7A', '#F5EFDC', '#111111'];
  const PLATE_COLORS = ['#000000B3', '#000000', '#1D1D1FCC', '#3B63F3CC', '#FFFFFFCC'];
  // 描边 / 阴影这类"墨"色：默认就是纯黑，所以它得在色板里
  const INK_COLORS = ['#000000', '#1D1D1F', '#FFFFFF', '#FFD43B', '#3B63F3'];
  // 发光是"光"，默认白色；给几个 CapCut 常见的霓虹色
  const GLOW_COLORS = ['#FFFFFF', '#FFD43B', '#18E1D6', '#FF66A6', '#9FFF51'];

  // 逐词动画的强调色绑定：与 Mac WordFX.accentBindings 同一张表，路径按 Studio 的
  // 扁平 wordAnimation 结构（spoken / active / unspoken 三段）写。种子值取内核
  // normalizeWordAnimation 的同名配方，面板不另起一套默认色。
  const ACCENTS = {
    Color: [{ key: 'active.color', label: '强调色', fallback: '#FFD43B' }],
    Highlight: [{ key: 'active.backgroundColor', label: '强调色', fallback: '#FFD43B', contrast: 'active.color' }],
    Paint: [{ key: 'spoken.color', label: '强调色', fallback: '#FFD43B' }],
  };

  // 效果种子 = studio/data.json 的默认值（CLI default_style() 同一套）。
  // glow 的种子取内核 effectStyle 的缺省（强度 50、范围 40、白色）。
  const DEF = {
    outline: { color: '#000000', width: 14 },
    shadow: { blur: 0.12, distance: 0.08, rotation: 45, color: '#000000', opacity: 0.9 },
    background: { backgroundColor: '#000000B3', backgroundPadding: 10, borderRadius: 15 },
    glow: { color: '#FFFFFF', intensity: 50, range: 40 },
  };

  const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);

  // ----- 颜色（够用就好：只支持面板会写出的 hex / rgba 两种写法） -----
  function parse(color) {
    const input = String(color == null ? '' : color).trim();
    if (!input || input === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    const hex = /^#([\da-f]{3,8})$/i.exec(input);
    if (hex) {
      let body = hex[1];
      if (body.length === 3 || body.length === 4) body = Array.from(body, (c) => c + c).join('');
      if (body.length === 6 || body.length === 8) {
        return {
          r: parseInt(body.slice(0, 2), 16),
          g: parseInt(body.slice(2, 4), 16),
          b: parseInt(body.slice(4, 6), 16),
          a: body.length === 8 ? parseInt(body.slice(6, 8), 16) / 255 : 1,
        };
      }
    }
    const rgba = /^rgba?\(([^)]+)\)$/i.exec(input);
    if (rgba) {
      const parts = rgba[1].split(',').map((part) => Number(part.trim()));
      if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
        return {
          r: parts[0], g: parts[1], b: parts[2],
          a: parts.length > 3 && Number.isFinite(parts[3]) ? Math.min(1, Math.max(0, parts[3])) : 1,
        };
      }
    }
    return null;
  }

  const pair = (value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).toUpperCase().padStart(2, '0');

  // alpha 一律写成 #RRGGBBAA：预览端 parseColor 与 CLI 的样式解析都认这一种，
  // 而 rgba() 字符串在 ASS 样式头那条路上要多一次转换。
  function withAlpha(color, alpha) {
    const rgb = parse(color) || { r: 0, g: 0, b: 0 };
    const a = Math.min(1, Math.max(0, num(alpha, 1)));
    return '#' + pair(rgb.r) + pair(rgb.g) + pair(rgb.b) + pair(a * 255);
  }
  function alphaOf(color) {
    const rgb = parse(color);
    return rgb ? rgb.a : 1;
  }
  const isTransparent = (color) => alphaOf(color) <= 0.01;
  // 换色但留住不透明度：色板上的颜色自带 alpha 时按它自己的来。
  function withRgb(color, next) {
    const incoming = parse(next);
    if (!incoming) return color;
    const hasOwnAlpha = /^#([\da-f]{4}|[\da-f]{8})$/i.test(String(next).trim())
      || /^rgba\(/i.test(String(next).trim());
    return hasOwnAlpha ? withAlpha(next, incoming.a) : withAlpha(next, alphaOf(color));
  }

  // ----- 底板 -----
  function backgroundOn(style) {
    const value = style || {};
    if (value.background != null) return Boolean(value.background);
    if (value.bgOn != null) return Boolean(value.bgOn);
    return !isTransparent(value.backgroundColor);
  }
  // 从「无底板」打开时颜色可能是全透明，此时连默认底板一起铺进去。
  function backgroundToggle(style, on) {
    const value = style || {};
    if (!on) return { background: false };
    return isTransparent(value.backgroundColor)
      ? { background: true, ...DEF.background }
      : { background: true };
  }

  // ----- 描边 -----
  function outlineOn(style) {
    const value = style || {};
    const outline = value.textOutline || {};
    if (outline.on != null) return Boolean(outline.on);
    if (value.outline != null) return Boolean(value.outline);
    return num(outline.width, 0) > 0 && !isTransparent(outline.color);
  }
  // 布尔 outline 与 textOutline 一起写：内核先读 textOutline.on，只改布尔的话
  // 开关会变成空动作。
  function outlineToggle(style, on) {
    const outline = (style || {}).textOutline || {};
    if (!on) return { outline: false, textOutline: { ...outline, on: false } };
    return {
      outline: true,
      textOutline: {
        ...outline,
        on: true,
        width: num(outline.width, 0) > 0 ? outline.width : DEF.outline.width,
        color: isTransparent(outline.color) ? DEF.outline.color : (outline.color || DEF.outline.color),
      },
    };
  }
  function outlinePatch(style, patch) {
    const outline = (style || {}).textOutline || {};
    const next = { ...outline, on: true, ...patch };
    return { outline: true, textOutline: next };
  }

  // ----- 发光 -----
  // 内核（subtitle-rendering.js effectStyle → canvas-stage 的 shadow 槽）与烧录端
  // （studio_export.rs 的 effect 槽）都在读 `glow`，Mac 也有这个分区，所以面板必须
  // 有它。缺席时的开关派生同内核：`on` 缺席就看 intensity 是否 > 0。
  function glowOn(style) {
    const glow = (style || {}).glow || {};
    if (glow.on != null) return Boolean(glow.on);
    return num(glow.intensity, 0) > 0;
  }
  function glowToggle(style, on) {
    const glow = (style || {}).glow || {};
    if (!on) return { glow: { ...glow, on: false } };
    const flat = !(num(glow.intensity, 0) > 0);
    return { glow: flat ? { ...glow, ...DEF.glow, on: true } : { ...glow, on: true } };
  }
  function glowPatch(style, patch) {
    const glow = (style || {}).glow || {};
    return { glow: { ...glow, on: true, ...patch } };
  }

  // ----- 逐词动画的强调色 -----
  const readPath = (object, path) => path.split('.')
    .reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), object);
  function accentColor(animation, binding) {
    const value = readPath(animation || {}, binding.key);
    return typeof value === 'string' && value ? value : binding.fallback;
  }
  // 背景型强调色要连文字色一起换，否则黄底黄字（同 Mac WordFX.contrastOn）。
  function contrastOn(color) {
    const rgb = parse(color);
    if (!rgb || rgb.a <= 0.01) return '#0D0D0D';
    return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) > 140 ? '#0D0D0D' : '#FFFFFF';
  }
  // 补丁必须带上 animationName：内核 normalizeWordAnimation 靠它选配方，
  // 只写一个 active.color 会让整段动画退回默认名。
  function accentPatch(animation, binding, color) {
    const next = {
      animationName: (animation || {}).animationName,
      spoken: { ...((animation || {}).spoken || {}) },
      active: { ...((animation || {}).active || {}) },
      unspoken: { ...((animation || {}).unspoken || {}) },
    };
    const [group, field] = binding.key.split('.');
    next[group][field] = color;
    if (binding.contrast) {
      const [cGroup, cField] = binding.contrast.split('.');
      next[cGroup][cField] = contrastOn(color);
    }
    return { wordAnimation: next };
  }

  // ----- 阴影 -----
  function shadowOn(style) {
    const shadow = (style || {}).dropShadow || {};
    if (shadow.on != null) return Boolean(shadow.on);
    return num(shadow.blur, 0) > 0 || num(shadow.distance, 0) > 0;
  }
  function shadowToggle(style, on) {
    const shadow = (style || {}).dropShadow || {};
    if (!on) return { dropShadow: { ...shadow, on: false } };
    const flat = !(num(shadow.blur, 0) > 0 || num(shadow.distance, 0) > 0);
    return { dropShadow: flat ? { ...shadow, ...DEF.shadow, on: true } : { ...shadow, on: true } };
  }
  // 阴影不透明度的显示值：内核把它和颜色合成成一个 rgba 才交给画布
  // （effectStyle.shadowColor），所以面板不能从那里读回来，只能镜像它的默认值
  // ——「描边开着」时 0.48，否则 0.6（subtitle-rendering.js effectStyle）。
  function shadowOpacity(style) {
    const value = style || {};
    const shadow = value.dropShadow || {};
    if (Number.isFinite(shadow.opacity)) return Math.min(1, Math.max(0, shadow.opacity));
    return value.outline ? 0.48 : 0.6;
  }
  function shadowPatch(style, patch) {
    const shadow = (style || {}).dropShadow || {};
    return { dropShadow: { ...shadow, on: true, ...patch } };
  }

  // 块级垂直锚点：缺席 = center（历史行为，与 blockVerticalAlign 一致）。
  const blockAlign = (style) => {
    const value = (style || {}).verticalAlign;
    return value === 'top' || value === 'bottom' || value === 'center' ? value : 'center';
  };

  return {
    CTX, ctxMeta, WORD_ANIMATIONS, TRANSITIONS, ACCENTS,
    TEXT_COLORS, PLATE_COLORS, INK_COLORS, GLOW_COLORS, DEF,
    clampTarget, TARGET_LABEL, lineKey, lineView, linePatch,
    parse, withAlpha, alphaOf, isTransparent, withRgb,
    backgroundOn, backgroundToggle,
    outlineOn, outlineToggle, outlinePatch,
    glowOn, glowToggle, glowPatch,
    accentColor, accentPatch, contrastOn,
    shadowOn, shadowToggle, shadowPatch, shadowOpacity,
    blockAlign,
  };
});
