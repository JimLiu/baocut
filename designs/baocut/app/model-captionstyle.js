/* 字幕样式模型：按维度组合，预设只是取值（设计稿 docs/design/subtitle/caption-style-model-design.md）。

   一份样式是七个独立维度各取一个值：字体 typography、涂装 surface、落位 layout、
   当前词 activeWord、动效 motion、强调词 emphasis、排版模式 layout.mode。画廊里的
   预设只是这七个维度上的一组默认取值（§1、§3）。这一层是**原型版的编译层**（§8）：

     · `presets()`      内置预设的完整表（§7），每份都显式写出 `activeWord`；
     · `fromAnim/toAnim` 19 格逐词动画目录 ↔ activeWord + motion.in 的查表（§4）；
     · `toTrack/fromTrack` 新正文 ↔ 原型轨上的键（`paintCss` 读的涂装键 ＋ `wordAnim` /
       `activeColor` / `textMotion` / `wordBackground` / `highlight` / `kinetic`）。

   **真实应用不编译到这些键**：`packages/ui` 与内核编译的是 Studio 样式
   （`wordAnimation` / `textMotion` / `wordBackground`…，§8 那张表）。这里编译到原型轨键，
   是因为原型的画布、缩略图与导出预览今天读的就是它们。

   ## 两处有意的决定（交付说明里逐条列出）

   1. **分类计数**：§7 写「基础 3、社交 9、商务 7、复古 6、动效 7、动态排版 1」，加起来
      33，而 §10 说的是 31 + 12 = 43 份。按现有数据机械换算：基础 3（经典、Shorts、简洁 ＝
      原 `simple` 挪进来）、社交 20（预设表 Social 18 ＋ 朗读强调、逐词底块）、商务 6、
      复古 6、动效 7、动态排版 1，共 43。画廊按这张表陈列，不再按 `BC_SD.representative`
      的家族别名折叠（折叠之后商务只剩 1 张、复古 0 张，§7 的分区就空了）。
   2. **往返的区分位**：§4 表里 `rotateHighlight` 与 `colourHighlight` 都落 `color`，
      `rotateFlipClock` 与 `flipClock` 只差「带旋转」——不加一位就往返不回来。这里加一个
      原型专用的 `tilt: true`（activeWord 上或 motion.in 上），表示「随机旋转位」；
      `impactPop` 与 `impact` 按 §4 用 `intensity 1.3` 区分。

   颜色字面值都是**画进视频画面**的内容色（当前词色、底块色），按文件登记在
   `_ds_conformance.json`。这一层不碰 DOM，`node --test` 直接 require。 */
(function () {
  const SCHEMA = 'baocut.caption-style/1';

  /* ---------- 分类（§7）：只按气质分 ---------- */
  const CATEGORIES = [
    {k: 'basic', name: '基础', note: '新建项目与竖屏发布的默认'},
    {k: 'social', name: '社交'},
    {k: 'business', name: '商务'},
    {k: 'retro', name: '复古'},
    {k: 'motion', name: '动效', note: '以入场为主的设计'},
    {k: 'kinetic', name: '动态排版', note: '字幕铺在画面上，镜头跟着念到的词走'},
  ];

  /* ---------- 当前词（§4） ---------- */
  const ACTIVE_MODES = [
    {k: 'none', name: '无'},
    {k: 'color', name: '变色'},
    {k: 'box', name: '底块'},
    {k: 'scale', name: '放大'},
    {k: 'lift', name: '上抬'},
    {k: 'underline', name: '下划线'},
    {k: 'sweep', name: '扫色'},
  ];
  const SPOKEN = [{k: 'keep', name: '不变'}, {k: 'tint', name: '染色'}, {k: 'dim', name: '变淡'}];
  const UNSPOKEN = [{k: 'keep', name: '不变'}, {k: 'dim', name: '变淡'}, {k: 'hidden', name: '不画'}];
  const modeName = (k) => (ACTIVE_MODES.find((m) => m.k === k) || ACTIVE_MODES[0]).name;

  /** 当前词的默认值：读的人不必每次判空。`durationSeconds` 默认 0.16（§4）。 */
  const ACTIVE_DEFAULTS = {mode: 'none', spoken: 'keep', unspoken: 'keep', durationSeconds: 0.16, dimOpacity: 0.5};
  function normActive(aw) {
    const out = Object.assign({}, ACTIVE_DEFAULTS, aw || {});
    if (out.mode === 'sweep') {
      out.sweep = Object.assign({unit: 'grapheme', guide: false, nextLine: false}, out.sweep || {});
      // 扫色本身就是染过（§5），与 spoken: tint 互斥
      if (out.spoken === 'tint') out.spoken = 'keep';
    }
    return out;
  }

  /* ---------- 动效（§3.5） ----------
     每一条带默认的触发、单位与时长。`trigger: 'spoken'` 的那几条是逐词动画目录里
     「念到时入场」那几格的真身，`enter` 的那几条是 Studio 的 textMotion。 */
  const E = (k, name, trigger, unit, dur, stagger) => ({k, name, trigger, unit, durationSeconds: dur, staggerSeconds: stagger || 0});
  const MOTION_PRESETS = {
    in: [
      E('typewriter', '打字机', 'enter', 'grapheme', 0.04, 0.04),
      E('fade-up', '淡入上移', 'enter', 'cue', 0.3),
      E('rise', '升起', 'enter', 'cue', 0.36),
      E('cascade', '逐词落下', 'enter', 'word', 0.22, 0.04),
      E('pop', '弹出', 'enter', 'word', 0.24, 0.05),
      E('blur-in', '柔焦', 'enter', 'cue', 0.38),
      E('slide-mask', '滑入', 'enter', 'line', 0.36, 0.08),
      E('wave-in', '波浪入场', 'enter', 'grapheme', 0.32, 0.025),
      E('drop-in', '落入', 'spoken', 'word', 0.4),
      E('float-in-top', '上方浮入', 'spoken', 'word', 0.4),
      E('float-in-bottom', '下方浮入', 'spoken', 'word', 0.4),
      E('scale-in', '放大入场', 'spoken', 'word', 0.36),
      E('impact', '冲击', 'spoken', 'word', 0.3),
      E('flip', '翻页', 'spoken', 'word', 0.4),
      E('stomp', '跺脚', 'spoken', 'word', 0.36),
      E('stack', '堆叠', 'spoken', 'word', 0.3),
    ],
    out: [
      E('fade-down', '淡出下移', 'enter', 'cue', 0.22),
      E('sink', '下沉', 'enter', 'cue', 0.3),
      E('pop-out', '弹出消失', 'enter', 'word', 0.2, 0.03),
      E('blur-out', '柔焦消失', 'enter', 'cue', 0.3),
      E('typewriter-erase', '逐字擦除', 'enter', 'grapheme', 0.03, 0.03),
    ],
    loop: [
      E('pulse', '脉动', 'enter', 'cue', 1.2),
      E('wave', '波浪', 'enter', 'grapheme', 0.96, 0.03),
      E('shimmer', '闪烁', 'enter', 'cue', 1.6),
      E('swing', '摇摆', 'enter', 'word', 1.2, 0.08),
    ],
  };
  const STAGES = [{k: 'in', name: '入场'}, {k: 'out', name: '退场'}, {k: 'loop', name: '循环'}];
  const UNITS = [{k: 'cue', name: '整条'}, {k: 'line', name: '逐行'}, {k: 'word', name: '逐词'}, {k: 'grapheme', name: '逐字'}];
  const TRIGGERS = [{k: 'enter', name: '出现时'}, {k: 'spoken', name: '念到时'}];
  const motionPreset = (stage, k) => (MOTION_PRESETS[stage] || []).find((p) => p.k === k) || null;

  /** 一条动效的完整值：缺的键由那条预设的默认补齐。 */
  function effect(stage, preset, over) {
    const p = motionPreset(stage, preset);
    if (!p) return null;
    return Object.assign({preset: p.k, unit: p.unit, trigger: p.trigger, durationSeconds: p.durationSeconds,
      staggerSeconds: p.staggerSeconds, intensity: 1, easing: 'easeOutQuad'}, over || {});
  }
  /** 动效里有没有东西：三格都空 = 静态（`motion` 省略）。 */
  function hasMotion(m) { return !!(m && (m.in || m.out || m.loop)); }

  /* ---------- 19 格目录 ↔ activeWord + motion.in（§4 那张表） ----------
     `in` 一栏是 trigger: spoken、unit: word 的入场。 */
  const CELLS = {
    none:            {aw: {mode: 'none'}},
    colourHighlight: {aw: {mode: 'color'}},
    boxHighlight:    {aw: {mode: 'box'}, radius: 0.5},
    stack:           {aw: {mode: 'box'}, radius: 0.2, in: 'stack'},
    highlight:       {aw: {mode: 'none', spoken: 'dim', unspoken: 'dim'}},
    karaoke:         {aw: {mode: 'none', unspoken: 'dim'}},
    reveal:          {aw: {mode: 'none', unspoken: 'hidden'}},
    bounce:          {aw: {mode: 'lift', lift: 0.22}},
    paint:           {aw: {mode: 'none', spoken: 'tint'}},
    dropIn:          {aw: {mode: 'color'}, in: 'drop-in'},
    floatInTop:      {aw: {mode: 'color'}, in: 'float-in-top'},
    floatInBottom:   {aw: {mode: 'color'}, in: 'float-in-bottom'},
    scaleIn:         {aw: {mode: 'color'}, in: 'scale-in'},
    impact:          {aw: {mode: 'color'}, in: 'impact'},
    impactPop:       {aw: {mode: 'color'}, in: 'impact', intensity: 1.3},
    stomp:           {aw: {mode: 'color'}, in: 'stomp'},
    flipClock:       {aw: {mode: 'color'}, in: 'flip'},
    rotateFlipClock: {aw: {mode: 'color'}, in: 'flip', tilt: true},
    rotateHighlight: {aw: {mode: 'color', tilt: true}},
  };
  const CELL_KEYS = Object.keys(CELLS);
  /** 目录里 `bgHighlight` 是 `stack` 的实现名（同 model-subanim.js 的 ALIAS）。 */
  const CELL_ALIAS = {bgHighlight: 'stack'};

  /** 高亮块上的字色：块底亮就落墨、暗就落纸（同 `BC_WA.inkOn`，这一层不依赖它）。 */
  function inkOn(color) {
    const m = /^#([0-9a-fA-F]{6})/.exec(String(color || ''));
    if (!m) return '#131313';
    const n = parseInt(m[1], 16);
    const L = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return L > 0.6 ? '#131313' : '#FFFFFF';
  }
  /** `#RRGGBB(AA)` → 6 位大写；认不出的原样返回。 */
  function hex6(c) {
    const m = /^#([0-9a-fA-F]{6})/.exec(String(c || ''));
    return m ? '#' + m[1].toUpperCase() : c;
  }

  /** 一格目录 → `{activeWord, motion}`。`animColor` 落在用得上颜色的那几档上。 */
  function fromAnim(cell, animColor) {
    const k = CELL_ALIAS[cell] || cell;
    const row = CELLS[k] || CELLS.none;
    const aw = Object.assign({}, row.aw);
    const c = animColor ? hex6(animColor) : null;
    if (c) {
      if (aw.mode === 'color' || aw.mode === 'lift') aw.color = c;
      if (aw.mode === 'box') { aw.box = {color: c, radius: row.radius, padding: [0.2, 0.08]}; aw.color = inkOn(c); }
      if (aw.spoken === 'tint') aw.spokenColor = c;
    } else if (aw.mode === 'box') {
      aw.box = {color: '#FFD84D', radius: row.radius, padding: [0.2, 0.08]};
    }
    const active = normActive(aw);
    if (!row.in) return {activeWord: active, motion: null};
    const over = {trigger: 'spoken', unit: 'word'};
    if (row.intensity) over.intensity = row.intensity;
    if (row.tilt) over.tilt = true;
    return {activeWord: active, motion: {in: effect('in', row.in, over)}};
  }

  const SPOKEN_CELL = {'drop-in': 'dropIn', 'float-in-top': 'floatInTop', 'float-in-bottom': 'floatInBottom',
    'scale-in': 'scaleIn', stomp: 'stomp', stack: 'stack'};
  /** activeWord + motion → 最近的目录格；目录里没有这个组合时返回 null
   *  （渲染走通用路径，内核侧「待落地」）。只看决定格子的那几位：模式、两根小轴、
   *  念到时的入场与区分位；颜色、放大倍数、过渡时长不参与选格。 */
  function toAnim(activeWord, motion) {
    const aw = normActive(activeWord);
    const inn = motion && motion.in && motion.in.trigger === 'spoken' ? motion.in : null;
    const plain = aw.spoken === 'keep' && aw.unspoken === 'keep';
    if (inn) {
      if (inn.preset === 'stack') return aw.mode === 'box' && plain ? 'stack' : null;
      if (!plain || (aw.mode !== 'color' && aw.mode !== 'none')) return null;
      if (inn.preset === 'impact') return (inn.intensity || 1) >= 1.2 ? 'impactPop' : 'impact';
      if (inn.preset === 'flip') return inn.tilt ? 'rotateFlipClock' : 'flipClock';
      return SPOKEN_CELL[inn.preset] || null;
    }
    if (aw.mode === 'none') {
      const key = aw.spoken + '/' + aw.unspoken;
      return {'keep/keep': 'none', 'dim/dim': 'highlight', 'keep/dim': 'karaoke',
        'keep/hidden': 'reveal', 'tint/keep': 'paint'}[key] || null;
    }
    if (!plain) return null;
    if (aw.mode === 'color') return aw.tilt ? 'rotateHighlight' : 'colourHighlight';
    if (aw.mode === 'box') return 'boxHighlight';
    if (aw.mode === 'lift') return 'bounce';
    return null;    // scale / underline / sweep：目录没有这一格
  }

  /* ---------- 涂装键 ↔ typography + surface（单位见 model-subpresets.js 表头） ----------
     原型的涂装键全是按字号归一的整数百分比；新正文用 em 与比例。原型解析不出的键
     （CSS 字体栈、族自带字重与 B 钮两个键）留在 `legacy` 下原样回写（§8）。 */
  const CASING = {'': 'none', upper: 'upper', lower: 'lower', title: 'title'};
  const CASING_BACK = {none: '', upper: 'upper', lower: 'lower', title: 'title'};
  const r6 = (v) => +(+v).toFixed(6);

  function fromLook(look) {
    const L = look || {};
    const weight = L.weight || 400;
    const typography = {
      fontFamily: L.font || 'System',
      fontWeight: L.bold ? Math.max(weight, 700) : weight,
      italic: !!L.italic,
      size: 0.055,
      lineHeight: (L.lh || 120) / 100,
      letterSpacing: (L.spacing || 0) / 100,
      casing: CASING[L.upper || ''] || 'none',
      align: L.align || 'center',
    };
    const surface = {color: L.color || '#FFFFFF'};
    if (L.outline) surface.stroke = {color: L.outlineColor || '#000000', width: r6((L.outlineW || 0) / 160)};
    if (L.shadow) {
      const a = (L.shAngle == null ? 90 : L.shAngle) * Math.PI / 180;
      const d = (L.shDist == null ? 12 : L.shDist) / 100;
      surface.shadow = {color: L.shColor || '#000000', offset: [r6(Math.cos(a) * d), r6(Math.sin(a) * d)],
        blur: r6((L.shBlur == null ? 24 : L.shBlur) / 100)};
    }
    if (L.opacity > 0) {
      const pad = (L.pad == null ? 20 : L.pad) / 100;
      surface.plate = {mode: L.plate === 'block' ? 'block' : 'line', color: L.bg, opacity: L.opacity / 100,
        padding: [r6(pad * 1.4), r6(pad)], radius: (L.corners || 0) / 100};
    }
    if (L.wordBackground) {
      const w = L.wordBackground;
      surface.wordBox = {color: w.color, padding: [w.paddingXEm, w.paddingYEm], radius: w.radiusEm};
    }
    const legacy = {stack: L.stack, weight: weight, bold: !!L.bold, mono: !!L.mono,
      shDist: L.shDist, shAngle: L.shAngle, shBlur: L.shBlur, shColor: L.shColor, plate: L.plate, bg: L.bg, pad: L.pad, corners: L.corners};
    return {typography, surface, legacy};
  }

  /** typography + surface → 原型涂装键（`paintCss` / `plateCss` 读的那一组）。 */
  function paintOf(body) {
    const T = body.typography || {};
    const S = body.surface || {};
    const G = body.legacy || {};
    const out = {
      font: T.fontFamily, stack: G.stack || "'" + T.fontFamily + "', sans-serif",
      weight: G.weight != null ? G.weight : T.fontWeight,
      bold: G.bold != null ? G.bold : T.fontWeight >= 700,
      italic: !!T.italic, color: S.color, align: T.align || 'center',
      lh: r6((T.lineHeight || 1.2) * 100), spacing: r6((T.letterSpacing || 0) * 100),
      upper: CASING_BACK[T.casing] || '', mono: !!G.mono,
    };
    const P = S.plate;
    out.bg = P ? P.color : (G.bg || '#000000');
    out.opacity = P ? Math.round(P.opacity * 100) : 0;
    out.corners = P ? Math.round(P.radius * 100) : (G.corners == null ? 0 : G.corners);
    out.pad = P ? Math.round(P.padding[1] * 100) : (G.pad == null ? 20 : G.pad);
    out.plate = P ? (P.mode === 'block' ? 'block' : 'line') : (G.plate || 'line');
    out.outline = !!S.stroke;
    out.outlineColor = S.stroke ? S.stroke.color : '#000000';
    out.outlineW = S.stroke ? r6(S.stroke.width * 160) : 0;
    out.shadow = !!S.shadow;
    if (S.shadow) {
      const [x, y] = S.shadow.offset;
      const fresh = {shDist: r6(Math.hypot(x, y) * 100), shAngle: r6(((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360),
        shBlur: r6(S.shadow.blur * 100)};
      // 原值能对上就用原值（极坐标来回一次有浮点尾巴）
      ['shDist', 'shAngle', 'shBlur'].forEach((k) => {
        out[k] = G[k] != null && Math.abs(G[k] - fresh[k]) < 1e-3 ? G[k] : fresh[k];
      });
      out.shColor = S.shadow.color;
    } else {
      out.shDist = G.shDist == null ? 12 : G.shDist; out.shAngle = G.shAngle == null ? 90 : G.shAngle;
      out.shBlur = G.shBlur == null ? 24 : G.shBlur; out.shColor = G.shColor || '#000000cc';
    }
    return out;
  }

  /* ---------- 编译：新正文 → 原型轨键（§8 的原型版） ---------- */
  const WORD_KEYS = ['activeWord', 'motion', 'wordAnim', 'activeColor', 'textMotion', 'wordBackground'];
  const PAINT_KEYS = ['font', 'stack', 'weight', 'bold', 'italic', 'color', 'align', 'lh', 'spacing', 'upper', 'mono',
    'bg', 'opacity', 'corners', 'pad', 'plate', 'outline', 'outlineColor', 'outlineW',
    'shadow', 'shDist', 'shAngle', 'shBlur', 'shColor'];

  /** 译文 / 没有词级时间的轨：当前词恒 none，念到时触发的入场改成出现时（没有「念到」可言）。 */
  function forRole(body, ctx) {
    const c = ctx || {};
    const timed = (c.role || 'source') === 'source' && c.hasWordTiming !== false;
    if (timed) return {activeWord: normActive(body.activeWord), motion: hasMotion(body.motion) ? body.motion : null};
    let motion = null;
    if (hasMotion(body.motion)) {
      motion = {};
      STAGES.forEach(({k}) => {
        const e = body.motion[k];
        if (e) motion[k] = Object.assign({}, e, {trigger: 'enter'});
      });
    }
    return {activeWord: normActive({mode: 'none'}), motion};
  }

  /** Studio `textMotion` 那一份：出现时触发的入场 / 退场 / 循环 ＋ 当前词的放大叠加与扫色。 */
  function textMotionOf(aw, motion) {
    const tm = {version: 1};
    if (motion) {
      STAGES.forEach(({k}) => {
        const e = motion[k];
        if (!e || e.trigger === 'spoken') return;
        tm[k] = {preset: e.preset, unit: e.unit, durationSeconds: e.durationSeconds, staggerSeconds: e.staggerSeconds || 0,
          intensity: e.intensity == null ? 1 : e.intensity, easing: e.easing || 'easeOutQuad'};
      });
    }
    if (aw.mode === 'sweep') tm.karaoke = {color: aw.color, guide: !!aw.sweep.guide, nextLine: !!aw.sweep.nextLine};
    else if (aw.scale && aw.scale !== 1 && aw.mode !== 'box') {
      tm.emphasis = {color: aw.color, scale: aw.scale, durationSeconds: aw.durationSeconds};
    }
    return Object.keys(tm).length > 1 ? tm : null;
  }

  /** 新正文 → 原型轨键。`ctx = {role: 'source' | 'translation', hasWordTiming, highlight, kinetic}`。
   *  返回的对象**可以整个铺到轨上**：涂装键 ＋ 词级那几件（`WORD_KEYS`）＋ 两个新键
   *  `activeWord` / `motion`（画布与缩略图的通用路径读这两个，派生键给导出与旧读者）。 */
  function toTrack(body, ctx) {
    const c = ctx || {};
    const role = forRole(body, c);
    const aw = role.activeWord;
    const out = paintOf(body);
    out.activeWord = aw;
    out.motion = role.motion;
    out.wordAnim = toAnim(aw, role.motion) || 'none';
    if ((c.role || 'source') === 'source' && aw.color) out.activeColor = aw.color;
    const wb = body.surface && body.surface.wordBox;
    out.wordBackground = wb ? {color: wb.color, activeColor: aw.mode === 'box' && aw.box ? aw.box.color : wb.color,
      paddingXEm: wb.padding[0], paddingYEm: wb.padding[1], radiusEm: wb.radius} : null;
    out.textMotion = textMotionOf(aw, role.motion);
    if (c.highlight || body.emphasis) {
      const em = body.emphasis || {};
      out.highlight = Object.assign({on: false, marks: {}}, c.highlight || {},
        em.color ? {color: em.color} : null, em.fontFamily ? {font: em.fontFamily} : null,
        em.bold != null ? {bold: em.bold} : null, em.italic != null ? {italic: em.italic} : null,
        em.scale ? {scale: Math.round(em.scale * 100)} : null);
    }
    out.kinetic = body.layout && body.layout.mode === 'sequence' ? (c.kinetic || body.layout.sequence || null) : null;
    return out;
  }

  /** 原型轨 → 新正文（尽力）：有 `activeWord` 就用它，没有按 `wordAnim` 查表（旧文档）。 */
  function fromTrack(track) {
    const t = track || {};
    const base = fromLook(t);
    const legacyCell = t.wordAnim || 'none';
    const parsed = fromAnim(legacyCell, t.activeColor);
    let aw = t.activeWord ? normActive(t.activeWord) : parsed.activeWord;
    let motion = t.motion !== undefined ? t.motion : parsed.motion;
    if (!t.activeWord && t.textMotion) {
      const tm = t.textMotion;
      if (tm.karaoke) aw = normActive({mode: 'sweep', color: tm.karaoke.color, sweep: {guide: tm.karaoke.guide, nextLine: tm.karaoke.nextLine}});
      else if (tm.emphasis) aw = normActive({mode: 'color', color: tm.emphasis.color, scale: tm.emphasis.scale, durationSeconds: tm.emphasis.durationSeconds});
      STAGES.forEach(({k}) => {
        if (!tm[k]) return;
        motion = Object.assign({}, motion);
        motion[k] = Object.assign({trigger: 'enter'}, tm[k]);
      });
    }
    if (t.wordBackground && t.wordBackground.activeColor && aw.mode === 'none' && !t.activeWord) {
      aw = normActive({mode: 'box', box: {color: t.wordBackground.activeColor, radius: t.wordBackground.radiusEm, padding: [0.2, 0.08]}});
    }
    const body = {schema: SCHEMA, typography: base.typography, surface: base.surface,
      layout: {mode: t.kinetic ? 'sequence' : 'line', anchor: t.valign === 'top' ? 'top' : t.valign === 'center' ? 'center' : 'bottom',
        y: t.y == null ? 0.86 : t.y / 100, width: t.width == null ? 0.8 : t.width / 100, maxLines: 2},
      activeWord: aw, legacy: base.legacy};
    if (hasMotion(motion)) body.motion = motion;
    if (t.kinetic) body.layout.sequence = t.kinetic;
    if (t.highlight) {
      const h = t.highlight;
      body.emphasis = {color: h.color, fontFamily: h.font || undefined, bold: !!h.bold, italic: !!h.italic, scale: (h.scale || 100) / 100};
    }
    return body;
  }

  /** 把一份轨上的当前词 / 动效改一笔，返回要写回轨上的补丁（词级那几件）。
   *  涂装键不在补丁里——「换当前词不改涂装」（§10 验收）就靠这一条。 */
  function patchWord(track, change, ctx) {
    const body = fromTrack(track);
    if (change.activeWord) body.activeWord = normActive(Object.assign({}, body.activeWord, change.activeWord));
    if ('motion' in change) body.motion = change.motion;
    const full = toTrack(body, Object.assign({role: track.role === 'source' || !track.role ? 'source' : 'translation'}, ctx));
    const out = {};
    WORD_KEYS.forEach((k) => { out[k] = full[k] === undefined ? null : full[k]; });
    return out;
  }

  /** 这份样式会不会动（缩略图要不要跑节拍器）。 */
  function moves(aw, motion) {
    const a = normActive(aw);
    return a.mode !== 'none' || a.spoken !== 'keep' || a.unspoken !== 'keep' || hasMotion(motion);
  }

  /* ---------- 内置预设（§7） ---------- */
  const STUDIO = {
    'studio-focus': {cat: 'social', aw: {mode: 'color', color: '#FC75E9', scale: 1.18, durationSeconds: 0.2}},
    'studio-word-tiles': {cat: 'social', aw: {mode: 'box', color: '#191919', scale: 1.04, durationSeconds: 0.14,
      box: {color: '#FFD84D', radius: 0.12, padding: [0.2, 0.1]}}},
    'studio-word-drop': {cat: 'motion', aw: {mode: 'color', color: '#6147FF'}},
    'studio-paper-typewriter': {cat: 'motion', aw: {mode: 'none', unspoken: 'hidden'}},
    'studio-line-swipe': {cat: 'motion', aw: {mode: 'color', color: '#FF6B5B'}},
    'studio-soft-focus': {cat: 'motion', aw: {mode: 'color', color: '#FFD84D'}},
    'studio-rise-settle': {cat: 'motion', aw: {mode: 'color', color: '#FFD84D'}},
    'studio-kinetic-wave': {cat: 'motion', aw: {mode: 'color', color: '#FFE547'}},
    'studio-ktv': {cat: 'motion', aw: {mode: 'sweep', color: '#FF6A1A', sweep: {unit: 'grapheme', guide: true, nextLine: true}}},
  };
  const BASIC = {
    classic: {name: '经典', aw: {mode: 'color', color: '#18E1D6'}},
    shorts: {name: 'Shorts', aw: {mode: 'lift', lift: 0.22, color: '#FFE14D'}, layout: {anchor: 'bottom', y: 0.72, width: 0.6}},
    simple: {name: '简洁', aw: {mode: 'color', color: '#FFFFFF', scale: 1.06}},
  };
  const VS_CAT = {Social: 'social', Business: 'business', Retro: 'retro'};
  /* 预设表里 `animationColor` 是占位黑（`#000000`）而那一格本来不消费颜色时，机械换算会把
     当前词涂成黑色——黑描边上的黑字。这时换一个读得出的强调色：先试 Shorts 的黄，与字色
     太近就换经典的青。交付说明里列出了受影响的几份。 */
  const FALLBACK_ACTIVE = ['#FFE14D', '#18E1D6'];
  function rgbDist(a, b) {
    const p = (c) => { const m = /^#([0-9a-fA-F]{6})/.exec(String(c || '')); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const x = p(a), y = p(b);
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  }
  function readableActive(cell, animColor, look) {
    const usesColour = cell === 'colourHighlight' || cell === 'boxHighlight' || cell === 'stack' || cell === 'paint' || cell === 'rotateHighlight';
    const c = hex6(animColor);
    if (usesColour || (c !== '#000000' && rgbDist(c, look.color) > 120)) return c;
    return FALLBACK_ACTIVE.find((x) => rgbDist(x, look.color) > 120) || FALLBACK_ACTIVE[0];
  }

  function body(key, name, category, look, aw, motion, extra) {
    const base = fromLook(look);
    const b = {schema: SCHEMA, id: 'v-' + key, key, name, category, look: key,
      typography: base.typography, surface: base.surface,
      layout: Object.assign({mode: 'line', anchor: 'bottom', y: 0.86, width: 0.8, maxLines: 2}, extra && extra.layout),
      activeWord: normActive(aw), legacy: base.legacy, preset: {id: key, revision: 1}};
    if (hasMotion(motion)) b.motion = motion;
    if (extra && extra.marker) b.layoutMarker = extra.marker;
    return b;
  }
  /** TextMotion 的 in/out/loop → motion（trigger: enter）。 */
  function motionOfTextMotion(tm) {
    if (!tm) return null;
    const m = {};
    STAGES.forEach(({k}) => { if (tm[k]) m[k] = Object.assign({trigger: 'enter'}, tm[k]); });
    return hasMotion(m) ? m : null;
  }

  let cache = null;
  /** 内置预设的完整表，形状是 `CaptionStyleBody`（§3）外加原型陈列用的几个键
   *  （`id` / `key` / `name` / `category` / `look`）。顺序：基础 → 31 份（原序，`simple`
   *  挪去基础）→ 9 份 Studio → 倒鸭子。读 `BC_DS` / `BC_VS` / `BC_SD`，缺哪个跳过哪一族。 */
  function presets() {
    if (cache) return cache;
    const W = typeof window !== 'undefined' ? window : {};
    const out = [];
    if (W.BC_DS) {
      out.push(body('classic', BASIC.classic.name, 'basic', W.BC_DS.LOOKS.classic, BASIC.classic.aw));
      out.push(body('shorts', BASIC.shorts.name, 'basic', W.BC_DS.LOOKS.shorts, BASIC.shorts.aw, null,
        {layout: BASIC.shorts.layout, marker: 'shorts'}));
    }
    if (W.BC_VS) {
      const simple = W.BC_VS.LOOKS.simple;
      if (simple) out.push(body('simple', BASIC.simple.name, 'basic', simple, BASIC.simple.aw));
      W.BC_VS.PRESETS.forEach((p) => {
        if (p.k === 'simple') return;
        const look = W.BC_VS.LOOKS[p.k];
        const cell = CELL_ALIAS[p.anim] || p.anim;
        const r = fromAnim(cell, readableActive(cell, p.animColor, look));
        out.push(body(p.k, p.name, VS_CAT[p.cat] || 'social', look, r.activeWord, r.motion));
      });
    }
    if (W.BC_SD) {
      const names = {};
      W.BC_SD.cards('orig').forEach((c) => { names[c.look] = c.name; });
      Object.keys(W.BC_SD.LOOKS).forEach((k) => {
        const s = STUDIO[k] || {cat: 'motion', aw: {mode: 'color', color: '#FFD84D'}};
        out.push(body(k, names[k] || k, s.cat, W.BC_SD.LOOKS[k], s.aw, motionOfTextMotion(W.BC_SD.LOOKS[k].textMotion)));
      });
    }
    const casper = W.BC_VS && W.BC_VS.LOOKS.casper;
    if (casper) {
      const dz = body('daoyazi', '倒鸭子', 'kinetic', casper, {mode: 'color', color: '#FF9B42'}, null, {layout: {mode: 'sequence'}});
      dz.look = 'casper';
      out.push(dz);
    }
    cache = out;
    return out;
  }
  const byKey = (k) => presets().find((p) => p.key === k) || null;
  const family = (id) => String(id || '').replace(/^v[bt]?-/, '');

  /** 给目录卡补上分类、当前词与动效（data.js 的目录仍按三形态生成，id 不变）。
   *  仅译文那一形态画面上没有原文，当前词恒 none（`forRole`）。 */
  function annotate(card) {
    const p = byKey(family(card.id));
    if (!p) return card;
    const role = forRole(p, {role: card.form === 'trans' ? 'translation' : 'source'});
    return Object.assign({}, card, {cat: p.category, activeWord: role.activeWord, motion: role.motion});
  }

  /** 画廊陈列：一份预设一张卡（`screen` 形态），**不按家族别名折叠**，顺序同 `presets()`。 */
  function galleryCards(catalog) {
    const byFam = {};
    (catalog || []).forEach((c) => {
      const k = family(c.id);
      if (!byFam[k] || c.form === 'orig') byFam[k] = c;
    });
    return presets().filter((p) => byFam[p.key]).map((p) => {
      const c = byFam[p.key];
      return Object.assign({}, c, {id: 'v-' + p.key, form: 'screen', look2: c.look2 || c.look, name: p.name,
        cat: p.category, activeWord: p.activeWord, motion: p.motion || null});
    });
  }

  /** 卡上角标：当前词模式名（「变色」「扫色」…）。 */
  function badge(aw) {
    const a = normActive(aw);
    if (a.mode === 'none' && a.unspoken === 'hidden') return '逐词显现';
    if (a.mode === 'none' && (a.unspoken === 'dim' || a.spoken !== 'keep')) return '变淡';
    return modeName(a.mode);
  }

  /* ---------- 渲染用的小算术（纯，画布与缩略图共用） ---------- */

  /** 一个词在时间 `t`（秒，相对 cue 起点）的扫色进度 0–1；词均分 cue（演示口径同 `BC_WA.at`）。 */
  function wordProgress(t, dur, n, i) {
    if (!(n > 0) || !(dur > 0)) return 0;
    const w = dur / n;
    return Math.max(0, Math.min(1, (t - i * w) / w));
  }
  /** 一个词扫到第几个字：`unit: 'word'` 时整词在起点瞬间换色。 */
  function sweptGraphemes(progress, count, unit) {
    if (unit === 'word') return progress > 0 ? count : 0;
    return Math.max(0, Math.min(count, Math.floor(progress * count + 1e-9)));
  }

  window.BC_CS = {SCHEMA, CATEGORIES, ACTIVE_MODES, SPOKEN, UNSPOKEN, ACTIVE_DEFAULTS, MOTION_PRESETS, STAGES, UNITS, TRIGGERS,
    CELLS, CELL_KEYS, WORD_KEYS, PAINT_KEYS,
    modeName, normActive, motionPreset, effect, hasMotion, inkOn,
    fromAnim, toAnim, fromLook, paintOf, forRole, toTrack, fromTrack, patchWord, moves,
    presets, byKey, family, annotate, galleryCards, badge, wordProgress, sweptGraphemes};
})();
