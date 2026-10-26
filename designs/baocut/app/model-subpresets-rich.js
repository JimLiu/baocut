/* 内置字幕样式的扩充：60 份组合样式 v2（caption-editor-redesign §10）。

   每份都是 §4 那几样能力的组合——字身填充（纯色 / 渐变 / 纹理）、多层描边与阴影、发光、
   底板与逐词底块、新加的当前词模式（弹出 / 拉伸 / 发光）与动效（弹性弹出、逐行滑入、
   羽化、逐字错峰、打字机光标、整页慢推）、固定词数分页与关键词外观。不复刻任何现成模板，
   名字也不借谁的。

   分区：基础 +2、社交 +10、霓虹 8、电影 8、可爱 8、艺术 8、商务 +4、复古 +4、动效 +8。

   这一层给三样东西：
     · `ROWS`   每份一行：键、名字、分区、涂装、当前词、动效、落位与强调词；
     · `LOOKS`  涂装表（轨上的键：v1 镜像键 ＋ `layers` 栈，`BC_SURF.toPaint` 出），
                缩略图、套用与属性页读同一份；
     · `cards(form)` 目录卡，三种形态，规矩同 `BC_VS.cards`。
   `BC_CS.presets()` 把 `ROWS` 编成正文（schema `baocut.caption-style/2`），排在原有 43 份后面。

   字体只用两份入口已经加载的 Google Fonts 族，栈尾挂中文字体。颜色是画进视频画面的
   内容色，按文件登记在 `_ds_conformance.json`。这一层不碰 DOM，`node --test` 直接 require。 */
(function () {
  const SURF = window.BC_SURF;
  const CJK = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC'";
  const stackOf = (fam) => "'" + fam + "', " + CJK + ', sans-serif';

  /* ---------- 新分区（§10）：只按气质分 ---------- */
  const CATEGORIES = [
    {k: 'neon', name: '霓虹', note: '发光与灯管'},
    {k: 'cinema', name: '电影', note: '片名、片尾与宽银幕'},
    {k: 'cute', name: '可爱', note: '圆体、双层描边与弹跳'},
    {k: 'art', name: '艺术', note: '纸张、油墨、渐变与多行排版'},
  ];

  /* ---------- 涂装的紧凑写法 ----------
     f 字体族、w 字重、c 字色、it 斜体、up 全大写、ls 字距（1/100 em）、lh 行高（%）；
     fill: ['lin', 角度, 色…] 或 ['tex', 纹理, 叠色]；
     st: [[色, 厚度 em]…] 由内向外；sh: [[色, x, y, 模糊, 内阴影]…]；gl: [色, 半径, 强度]；
     plate: [色, 不透明度 %, 圆角 %, 内边距 %, 'line' | 'block']；wb: [色, 横 em, 纵 em, 圆角 em]。 */
  function fillOf(f) {
    if (!f) return null;
    if (f[0] === 'lin') {
      const cs = f.slice(2);
      return {kind: 'linear', angle: f[1], stops: cs.map((c, i) => [Math.round((i / (cs.length - 1)) * 100) / 100, c])};
    }
    return f[2] ? {kind: 'texture', texture: f[1], tint: f[2]} : {kind: 'texture', texture: f[1]};
  }
  function look(o, aw) {
    const stack = {
      fill: fillOf(o.fill),
      strokes: (o.st || []).map(([color, width]) => ({color, width})),
      shadows: (o.sh || []).map(([color, x, y, blur, inner]) => ({color, offset: [x, y], blur, inner: !!inner})),
      glow: o.gl ? {color: o.gl[0], radius: o.gl[1], strength: o.gl[2] == null ? 0.8 : o.gl[2]} : null,
    };
    const P = o.plate;
    const out = {
      font: o.f, stack: stackOf(o.f), weight: o.w || 400, bold: false, italic: !!o.it,
      color: o.c || '#FFFFFF', align: 'center', lh: o.lh || 120, spacing: o.ls || 0, upper: o.up ? 'upper' : '', mono: false,
      bg: P ? P[0] : '#000000', opacity: P ? P[1] : 0, corners: P ? P[2] : 0, pad: P ? P[3] : 20, plate: P ? P[4] || 'line' : 'line',
    };
    Object.assign(out, SURF.toPaint(stack, {color: out.color}));
    if (o.wb) out.wordBackground = {color: o.wb[0], activeColor: aw && aw.box ? aw.box.color : o.wb[0],
      paddingXEm: o.wb[1], paddingYEm: o.wb[2], radiusEm: o.wb[3]};
    const ac = aw && (aw.mode === 'box' && aw.box ? aw.box.color : aw.color);
    if (ac) out.activeColor = ac;
    return out;
  }

  /* 当前词的紧凑写法 */
  const C = (color, more) => Object.assign({mode: 'color', color}, more);
  const POP = (color, scale) => ({mode: 'pop', color, scale: scale || 1.22, durationSeconds: 0.22});
  const STRETCH = (color, scale) => ({mode: 'stretch', color, scale: scale || 1.25});
  const GLOW = (color, glow, radius) => ({mode: 'glow', color, glow: {color: glow, radius: radius || 0.4}});
  const LIFT = (color, lift) => ({mode: 'lift', color, lift: lift || 0.22});
  const SCALE = (color, scale) => ({mode: 'scale', color, scale: scale || 1.15});
  const BOX = (ink, color, radius, pad) => ({mode: 'box', color: ink, box: {color, radius: radius == null ? 0.14 : radius, padding: pad || [0.16, 0.06]}});
  const UNDER = (color) => ({mode: 'underline', color});
  const SWEEP = (color, unit, guide) => ({mode: 'sweep', color, sweep: {unit: unit || 'grapheme', guide: !!guide, nextLine: false}});
  const NONE = (more) => Object.assign({mode: 'none'}, more);

  /** 一行：键、名字、分区、涂装、当前词、动效 `{in: [预设, 覆盖], out, loop}`、落位补丁、强调词。 */
  const R = (k, name, cat, o, aw, motion, layout, emphasis) => ({k, name, cat, o, aw, motion: motion || null,
    layout: layout || null, emphasis: emphasis || null});
  const PAGE = (wordsPerPage, rows) => ({pagination: {wordsPerPage, rows: rows || null}});

  const ROWS = [
    /* ---- 基础 +2 ---- */
    R('fine-line', '细线白字', 'basic', {f: 'Inter', w: 700, st: [['#000000', 0.035]], sh: [['#00000066', 0, 0.04, 0.08]]}, C('#FFE14D')),
    R('soft-plate', '柔和底板', 'basic', {f: 'Inter', w: 500, plate: ['#1A1A1A', 62, 30, 22, 'line']}, C('#9EE6FF')),

    /* ---- 社交 +10 ---- */
    R('double-pop', '双层描边', 'social', {f: 'Poppins', w: 800, up: 1, st: [['#111111', 0.05], ['#FFD84D', 0.05]]}, POP('#FFD84D')),
    R('elastic-bold', '弹性大字', 'social', {f: 'Montserrat', w: 700, up: 1, st: [['#000000', 0.06]], sh: [['#000000', 0.04, 0.06, 0]]},
      C('#3DF5A4'), {in: ['elastic-pop']}),
    R('tile-pop', '方块逐词', 'social', {f: 'Archivo Black', wb: ['#00000099', 0.16, 0.06, 0.14]}, BOX('#111111', '#3DF5A4')),
    R('candy-gradient', '糖果渐变', 'social', {f: 'Rubik', w: 900, fill: ['lin', 180, '#FFFFFF', '#FFC2EC'], st: [['#3B0A45', 0.06]]},
      SCALE('#FF5FD2', 1.15)),
    R('sunset-word', '日落渐变', 'social', {f: 'Poppins', w: 800, fill: ['lin', 180, '#FFE66D', '#FF6B6B'], st: [['#2B0F0F', 0.05]]},
      C('#FFFFFF')),
    R('stretch-yellow', '拉伸黄字', 'social', {f: 'Anton', up: 1, c: '#FFE14D', st: [['#000000', 0.07]], sh: [['#000000', 0, 0.08, 0]]},
      STRETCH('#FFFFFF')),
    R('bubble-word', '气泡底块', 'social', {f: 'Rubik', w: 900, c: '#1C1C1C', wb: ['#FFFFFF', 0.18, 0.08, 0.5]},
      BOX('#FFFFFF', '#FF4F8B', 0.5, [0.18, 0.08])),
    R('marker-swipe', '荧光笔', 'social', {f: 'Inter', w: 900, st: [['#000000', 0.04]]}, BOX('#111111', '#E6FF4F', 0.04, [0.12, 0.02])),
    R('shadow-stack', '叠影', 'social', {f: 'Poppins', w: 800, up: 1, st: [['#000000', 0.03]],
      sh: [['#FF3D7F', 0.05, 0.05, 0], ['#3DD6FF', 0.1, 0.1, 0]]}, LIFT('#FFE14D', 0.2)),
    R('comic-burst', '漫画', 'social', {f: 'Bangers', c: '#FFE14D', ls: 4, st: [['#000000', 0.06], ['#FFFFFF', 0.04]],
      sh: [['#000000', 0.06, 0.08, 0]]}, POP('#FF4F4F', 1.25)),

    /* ---- 霓虹 8 ---- */
    R('neon-pink', '粉色霓虹', 'neon', {f: 'Montserrat', w: 600, up: 1, ls: 6, fill: ['tex', 'neon-tube', '#FF2BD633'],
      gl: ['#FF2BD6', 0.35, 0.9]}, GLOW('#FFFFFF', '#FF2BD6', 0.45)),
    R('neon-cyan', '青色灯管', 'neon', {f: 'Inter', w: 700, c: '#E8FDFF', gl: ['#00E5FF', 0.4, 0.95]}, SWEEP('#00E5FF')),
    R('neon-sign', '招牌灯', 'neon', {f: 'Pinyon Script', c: '#FFF2B3', gl: ['#FFB000', 0.4, 0.9]}, C('#FFFFFF'),
      {loop: ['shimmer']}),
    R('neon-duo', '双色霓虹', 'neon', {f: 'Rubik', w: 900, up: 1, st: [['#7A5CFF', 0.03]], gl: ['#7A5CFF', 0.45, 0.95]},
      GLOW('#FFFFFF', '#FF3DB8', 0.5)),
    R('neon-lime', '酸性绿', 'neon', {f: 'Squada One', up: 1, ls: 4, c: '#D9FF3D', gl: ['#7DFF3D', 0.35, 0.85]},
      SWEEP('#FFFFFF', 'word')),
    R('neon-tube', '灯管纹理', 'neon', {f: 'Bricolage Grotesque', w: 700, fill: ['tex', 'neon-tube', '#00E5FF22'],
      gl: ['#00C2FF', 0.4, 0.9]}, GLOW('#FFFFFF', '#00E5FF', 0.4)),
    R('neon-flicker', '闪烁霓虹', 'neon', {f: 'Special Gothic Expanded One', up: 1, c: '#FFE5F7', gl: ['#FF4FA3', 0.3, 0.8]},
      C('#FFFFFF'), {loop: ['shimmer', {intensity: 1.2}]}),
    R('neon-karaoke', '霓虹歌词', 'neon', {f: 'Poppins', w: 700, st: [['#1A0033', 0.03]], gl: ['#B03DFF', 0.3, 0.7]},
      SWEEP('#FF5BEF', 'grapheme', true)),

    /* ---- 电影 8 ---- */
    R('film-title', '片头字', 'cinema', {f: 'Montserrat', w: 400, up: 1, ls: 20, c: '#F2EFE8', sh: [['#00000099', 0, 0.03, 0.12]]},
      NONE(), {in: ['feather'], loop: ['slow-push']}),
    R('serif-credits', '衬线片尾', 'cinema', {f: 'Playfair Display', it: 1, sh: [['#000000B3', 0, 0.04, 0.1]]},
      NONE({unspoken: 'dim', dimOpacity: 0.55}), {in: ['feather']}),
    R('widescreen', '宽银幕', 'cinema', {f: 'Inter', w: 500, up: 1, ls: 16, plate: ['#000000', 100, 0, 30, 'block']},
      C('#F5C542'), {in: ['line-slide']}),
    R('noir', '黑色电影', 'cinema', {f: 'Libre Caslon Text', c: '#EDEDED', sh: [['#000000', 0.06, 0.06, 0.02]]},
      C('#FFFFFF', {unspoken: 'dim', dimOpacity: 0.6})),
    R('trailer', '预告片', 'cinema', {f: 'Anton', up: 1, ls: 6, fill: ['tex', 'metal'], sh: [['#000000CC', 0, 0.05, 0.1]]},
      NONE(), {in: ['blur-in'], loop: ['slow-push']}),
    R('subtitle-gold', '金色字幕', 'cinema', {f: 'Unna', w: 700, c: '#F5D27A', st: [['#1A1206', 0.025]],
      sh: [['#00000099', 0, 0.04, 0.08]]}, C('#FFFFFF'), {in: ['feather']}),
    R('documentary', '纪录片', 'cinema', {f: 'Instrument Serif', plate: ['#000000', 45, 10, 18, 'line']}, NONE(),
      {in: ['line-slide']}),
    R('scope-glow', '冷光片名', 'cinema', {f: 'Epilogue', w: 700, up: 1, ls: 12, c: '#E6F4FF', gl: ['#6FB8FF', 0.3, 0.6]},
      NONE(), {in: ['feather'], loop: ['slow-push']}),

    /* ---- 可爱 8 ---- */
    R('bubble-gum', '泡泡糖', 'cute', {f: 'Rubik', w: 900, st: [['#FF5FA2', 0.06], ['#FFFFFF', 0.05]],
      sh: [['#FF5FA266', 0, 0.08, 0.04]]}, LIFT('#FFE14D'), {loop: ['wave', {intensity: 0.6}]}),
    R('jelly', '果冻', 'cute', {f: 'Shrikhand', c: '#FFE14D', st: [['#7A3B00', 0.05]]}, POP('#FFFFFF', 1.2), {loop: ['swing']}),
    R('sticker', '贴纸', 'cute', {f: 'Rubik', w: 900, up: 1, c: '#2B2B2B', st: [['#FFFFFF', 0.08], ['#2B2B2B', 0.03]]},
      C('#FF5F5F')),
    R('crayon', '蜡笔', 'cute', {f: 'Gloria Hallelujah', st: [['#3D6BFF', 0.04]]}, C('#FFE14D'), {loop: ['wave', {intensity: 0.5}]}),
    R('marshmallow', '棉花糖', 'cute', {f: 'Rubik', w: 900, fill: ['lin', 180, '#FFFFFF', '#FFD6F0'],
      st: [['#B95AA0', 0.05], ['#FFFFFF', 0.04]]}, LIFT('#FFFFFF', 0.18)),
    R('doodle', '涂鸦', 'cute', {f: 'Indie Flower', w: 400, plate: ['#FF8FB1', 90, 50, 22, 'line']}, UNDER('#FFFFFF')),
    R('bouncy', '弹弹', 'cute', {f: 'Bangers', ls: 2, c: '#7CF5FF', st: [['#1B1464', 0.06]]}, LIFT('#FFE14D', 0.28),
      {in: ['drop-in']}),
    R('cloud-plate', '云朵底', 'cute', {f: 'Rubik', w: 900, c: '#4A3AFF', plate: ['#FFFFFF', 100, 60, 24, 'line']},
      SCALE('#FF5FA2', 1.18), {loop: ['pulse']}),

    /* ---- 艺术 8 ---- */
    R('paper-cut', '剪纸', 'art', {f: 'Archivo Black', up: 1, fill: ['tex', 'paper'], st: [['#2B2118', 0.03]],
      sh: [['#00000080', 0.04, 0.06, 0.04]]}, C('#FF6A3D')),
    R('ink-wash', '水墨', 'art', {f: 'Libre Caslon Text', w: 700, fill: ['tex', 'ink'], st: [['#F3EBDD', 0.05]]},
      NONE({unspoken: 'dim', dimOpacity: 0.5}), {in: ['feather']}),
    R('chalkboard', '粉笔', 'art', {f: 'Just Me Again Down Here', fill: ['tex', 'chalk'], sh: [['#00000066', 0, 0.03, 0.06]],
      plate: ['#20302A', 85, 12, 26, 'block']}, UNDER('#FFE14D'), {in: ['char-stagger']}),
    R('letterpress', '凸版', 'art', {f: 'Gloock', c: '#F1E6D2', sh: [['#00000099', 0, 0.06, 0.08, true], ['#00000080', 0, 0.04, 0.06]]},
      C('#FFD27A')),
    R('aurora', '极光', 'art', {f: 'Bricolage Grotesque', w: 700, fill: ['lin', 100, '#7CF5FF', '#B28CFF', '#FF8FD8'],
      st: [['#140A2E', 0.04]]}, GLOW('#FFFFFF', '#B28CFF', 0.35)),
    R('poster-stack', '海报叠排', 'art', {f: 'Anton', up: 1, st: [['#000000', 0.05]]}, C('#FF5B3D'), {in: ['pop']}, PAGE(3, [2, 1])),
    R('brush-red', '朱砂', 'art', {f: 'Lacquer', c: '#E83A2F', st: [['#FFFFFF', 0.04]], sh: [['#00000066', 0.03, 0.05, 0.04]]},
      SCALE('#FFFFFF', 1.12)),
    R('pixel-pair', '像素两行', 'art', {f: 'Jacquard 24', fill: ['lin', 180, '#FFFFFF', '#9AE6FF'], st: [['#002233', 0.04]]},
      C('#FFE14D'), null, PAGE(2, [1, 1])),

    /* ---- 商务 +4 ---- */
    R('slate-plate', '石板底', 'business', {f: 'Inter', w: 500, plate: ['#1F2933', 85, 16, 22, 'line']}, C('#8FD3FF')),
    R('brief', '简报', 'business', {f: 'IBM Plex Mono', w: 500, c: '#F5F5F5', plate: ['#000000', 55, 8, 20, 'line']},
      NONE({unspoken: 'dim', dimOpacity: 0.6}), {in: ['char-stagger']}),
    R('keynote', '发布会', 'business', {f: 'Montserrat', w: 600, st: [['#00000066', 0.02]], sh: [['#00000080', 0, 0.04, 0.12]]},
      C('#7FB2FF'), {in: ['line-slide']}),
    R('ledger', '报表', 'business', {f: 'Epilogue', w: 700, c: '#0F1720', plate: ['#FFFFFF', 92, 12, 22, 'line']}, UNDER('#2F6BFF')),

    /* ---- 复古 +4 ---- */
    R('chrome-80s', '八十年代', 'retro', {f: 'BBH Bartle', up: 1, fill: ['lin', 180, '#FFFFFF', '#9AD9FF', '#3B4C8F', '#F2B5FF'],
      st: [['#1B0F3A', 0.04]], sh: [['#FF3DB8', 0.05, 0.07, 0]]}, C('#FFE14D')),
    R('typewriter-tape', '打字纸条', 'retro', {f: 'IBM Plex Mono', c: '#1A1A1A', plate: ['#F2E8D5', 100, 6, 22, 'line']},
      NONE({unspoken: 'hidden'}), {in: ['typewriter-cursor']}),
    R('diner-sign', '餐馆招牌', 'retro', {f: 'Shrikhand', c: '#FF4F4F', st: [['#FFFFFF', 0.04]], sh: [['#2B1B5A', 0.08, 0.08, 0]]},
      C('#FFE14D')),
    R('gold-foil', '烫金', 'retro', {f: 'Playfair Display', w: 900, fill: ['tex', 'gold'], sh: [['#3A2500', 0.03, 0.05, 0.02]]},
      GLOW('#FFF6C8', '#FFC94D', 0.3)),

    /* ---- 动效 +8 ---- */
    R('elastic-words', '弹性逐词', 'motion', {f: 'Poppins', w: 800, st: [['#000000', 0.05]]}, C('#FFE14D'), {in: ['elastic-pop']}),
    R('line-cascade', '逐行入场', 'motion', {f: 'Inter', w: 700, sh: [['#000000B3', 0, 0.05, 0.1]], st: [['#00000080', 0.02]]},
      C('#7CF5FF'), {in: ['line-slide']}),
    R('page-three', '三词一页', 'motion', {f: 'Montserrat', w: 700, up: 1, st: [['#000000', 0.05]]}, SCALE('#FFE14D', 1.12),
      {in: ['pop']}, PAGE(3)),
    R('page-stack', '上二下一', 'motion', {f: 'Anton', up: 1, st: [['#000000', 0.05]]}, C('#3DF5A4'), {in: ['elastic-pop']}, PAGE(3, [2, 1])),
    R('keyword-zoom', '关键词放大', 'motion', {f: 'Poppins', w: 800, st: [['#000000', 0.05]]}, NONE(), null, null,
      {color: '#FFE14D', scale: 1.35, bold: true}),
    R('keyword-glow', '关键词发光', 'motion', {f: 'Inter', w: 900, st: [['#000000', 0.04]]}, C('#9EE6FF'), null, null,
      {color: '#FF5BEF', scale: 1.2, bold: true}),
    R('feather-in', '羽化逐字', 'motion', {f: 'Instrument Serif', sh: [['#000000B3', 0, 0.04, 0.12]], st: [['#00000066', 0.015]]},
      NONE(), {in: ['feather']}),
    R('char-cascade', '逐字错峰', 'motion', {f: 'Rubik', w: 900, st: [['#1B1464', 0.05]]}, C('#FFB13D'),
      {in: ['char-stagger'], out: ['pop-out']}),
  ];

  const LOOKS = {};
  ROWS.forEach((r) => { LOOKS[r.k] = look(r.o, r.aw); });

  /** 目录卡的三种形态，规矩同 `BC_VS.cards`：双语两行同款，仅译文没有当前词。 */
  function cards(form) {
    const prefix = {orig: 'v-', bi: 'vb-', trans: 'vt-'}[form];
    return ROWS.map((r) => {
      const c = {id: prefix + r.k, name: r.name, form, cat: r.cat, look: r.k, anim: 'none'};
      if (form === 'bi') c.look2 = r.k;
      return c;
    });
  }

  window.BC_RP = {CATEGORIES, ROWS, LOOKS, cards, fillOf};
})();
