/* 模板样式（caption-editor-redesign §3 / §5 / §6）在原型里的替身：场景草图、调整层与场景摘要。

   真实应用里模板样式是 `baocut.caption-scene-style/1`：一份完整的场景（节点、涂装、状态样式、
   动画表达式），核心先做调整层预处理再求值渲染；界面只读核心给的摘要（§6），不解析表达式树。
   原型没有核心，这里用一份**场景草图**代替场景，只装摘要与调整层要读到的东西；画法另由
   `toPaint` 折成轨键，交给组合样式那套 CSS 近似（涂装栈、当前词、动效、分页、强调词）。

   全是纯函数，四件事：
     · `apply(scene, adjust)`          调整层预处理（§5）：按值换色、换字体、字号倍率、落位覆盖常量；
     · `diagnostics(scene, adjust)`    调整里做不到的项（`CAPTION_ADJUST_UNSUPPORTED`）；
     · `describe(scene, adjust, ctx)`  场景摘要（§6）——调整页、样式库的效果标签与适配判定只读它；
     · `toPaint(scene, adjust, ctx)`   折成原型轨键，画布与缩略图照画。

   场景草图：
     fonts       [{key, family, weight, italic, tunedSpacing}]，第一款是正文
     text        {font, upper, spacing, lh}
     paints      由下往上 [{kind, …}]：fill（color | gradient {angle, stops} | texture）、stroke {color, width}、
                 shadow / inner-shadow {color, offset, blur}、glow {color, radius, strength}、
                 plate {color, opacity, corners, shape}、box {color, radius, padding}（逐词底块）、material {name, color}
     states      {active, read, unread, keyword}：active {mode, color, scale, box, glow}、read {color}、
                 unread {opacity}、keyword {color, font, scale, bold}
     animation   {in, out, loop, colors}：动效预设键；colors 是关键帧里写死的颜色
     layout      {x, y, width}：画布比例 0–1，或 {param: 名字}（由参数决定，调整层改不了）
     pagination  {mode: 'auto'} | {mode: 'fixed', wordsPerPage, rows}
     wordTags    选择器读的词标签，如 ['keyword']
     seeded      结果随 `presentation.seed` 变化；seedPalette 是各版轮换的强调色
     requires    渲染要的能力；设备没有时整张不可套用（样式包那一层判）

   颜色与长度是画进视频画面的内容，长度按 em。 */
(function () {
  const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const SCALE_MIN = 0.5;
  const SCALE_MAX = 2;
  const UNSUPPORTED = 'CAPTION_ADJUST_UNSUPPORTED';

  /* ---------- 颜色 ---------- */
  /** 规范成 `#RRGGBBAA`（§5：比较前规范），认不出的返回 null。 */
  function normColor(c) {
    const s = String(c == null ? '' : c).trim();
    if (!HEX.test(s)) return null;
    let h = s.slice(1).toUpperCase();
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    if (h.length === 6) h += 'FF';
    return '#' + h;
  }
  /** 写回画面用的短形：不透明时去掉 FF。 */
  const css = (n) => (n && n.slice(7) === 'FF' ? n.slice(0, 7) : n);
  /** 换色：`to` 没写透明度时保留原色的透明度（§5）。 */
  function swap(from, to) {
    const t = normColor(to);
    if (!t) return normColor(from);
    return String(to).trim().length === 9 ? t : t.slice(0, 7) + normColor(from).slice(7);
  }

  /* ---------- 调整层 ---------- */
  const PLACE = ['x', 'y', 'width'];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const isConst = (v) => typeof v === 'number';

  /** 去掉不起作用的项（换成自己的色、换回原字体、倍率 1），空了返回 null——「还原」就是删掉 `adjust`。 */
  function clean(adjust) {
    if (!adjust) return null;
    const out = {};
    const colors = (adjust.colors || []).filter((c) => normColor(c.from) && normColor(c.to) && swap(c.from, c.to) !== normColor(c.from));
    if (colors.length) out.colors = colors.map((c) => ({from: css(normColor(c.from)), to: c.to}));
    const fonts = (adjust.fonts || []).filter((f) => f && f.from && f.to && f.to.family);
    if (fonts.length) out.fonts = fonts;
    const s = adjust.fontScale == null ? 1 : clamp(+adjust.fontScale || 1, SCALE_MIN, SCALE_MAX);
    if (Math.abs(s - 1) > 1e-6) out.fontScale = Math.round(s * 100) / 100;
    const p = adjust.placement || {};
    const place = {};
    PLACE.forEach((k) => { if (isConst(p[k])) place[k] = clamp(p[k], 0, 1); });
    if (Object.keys(place).length) out.placement = place;
    return Object.keys(out).length ? out : null;
  }
  const isAdjusted = (adjust) => !!clean(adjust);

  /** 换一种颜色：`from` 是模板里的原值，同一个 `from` 只留一条（§5：from 不重复）。 */
  function withColor(adjust, from, to) {
    const f = normColor(from);
    const rest = ((adjust && adjust.colors) || []).filter((c) => normColor(c.from) !== f);
    return clean(Object.assign({}, adjust, {colors: rest.concat([{from: css(f), to}])}));
  }
  function withFont(adjust, key, to) {
    const rest = ((adjust && adjust.fonts) || []).filter((x) => x.from !== key);
    return clean(Object.assign({}, adjust, {fonts: to ? rest.concat([{from: key, to}]) : rest}));
  }
  const withScale = (adjust, s) => clean(Object.assign({}, adjust, {fontScale: s}));
  const withPlacement = (adjust, patch) =>
    clean(Object.assign({}, adjust, {placement: Object.assign({}, adjust && adjust.placement, patch)}));

  /** 调过之后的颜色 / 字体（原值找不到调整时就是原值）。 */
  function colorTo(adjust, value) {
    const f = normColor(value);
    const hit = ((adjust && adjust.colors) || []).find((c) => normColor(c.from) === f);
    return css(hit ? swap(value, hit.to) : f);
  }
  function fontTo(adjust, key) {
    const hit = ((adjust && adjust.fonts) || []).find((x) => x.from === key);
    return hit ? hit.to : null;
  }

  /* ---------- 遍历场景里的颜色 ----------
     `fn(color, use, animated)` 返回新颜色（不换就原样返回）。换色与摘要走同一份遍历，
     所以「摘要里列了几种颜色」与「换色能换到哪些位置」不会对不上。 */
  const KIND_USE = {fill: 'text', stroke: 'stroke', shadow: 'shadow', 'inner-shadow': 'shadow', glow: 'glow',
    plate: 'plate', box: 'word-box', material: 'material'};
  function mapColors(scene, fn) {
    const s = scene || {};
    const one = (c, use, animated) => (c ? fn(c, use, !!animated) : c);
    const paints = (s.paints || []).map((p) => {
      const use = KIND_USE[p.kind] || 'material';
      const q = Object.assign({}, p);
      if (q.color) q.color = one(q.color, use);
      if (q.gradient) q.gradient = Object.assign({}, q.gradient, {stops: q.gradient.stops.map(([at, c]) => [at, one(c, use)])});
      if (q.tint) q.tint = one(q.tint, use);
      return q;
    });
    const st = s.states || {};
    const states = {};
    Object.keys(st).forEach((k) => {
      const x = Object.assign({}, st[k]);
      const use = k === 'keyword' ? 'keyword' : k === 'read' ? 'read' : k === 'unread' ? 'unread' : 'active';
      if (x.color) x.color = one(x.color, use);
      if (x.box && x.box.color) x.box = Object.assign({}, x.box, {color: one(x.box.color, 'word-box')});
      if (x.glow && x.glow.color) x.glow = Object.assign({}, x.glow, {color: one(x.glow.color, 'glow')});
      states[k] = x;
    });
    const an = s.animation ? Object.assign({}, s.animation) : null;
    if (an && an.colors) an.colors = an.colors.map((c) => one(c, 'active', true));
    const palette = s.seedPalette ? s.seedPalette.map((c) => one(c, 'active')) : s.seedPalette;
    return Object.assign({}, s, {paints, states, animation: an, seedPalette: palette});
  }

  /* ---------- 调整层预处理（§5） ---------- */
  function apply(scene, adjust) {
    const a = clean(adjust);
    if (!a) return scene;
    let s = a.colors ? mapColors(scene, (c) => css(colorTo(a, c))) : Object.assign({}, scene);
    if (a.fonts) {
      s = Object.assign({}, s, {fonts: (s.fonts || []).map((f) => {
        const to = fontTo(a, f.key);
        return to ? Object.assign({}, f, {family: to.family, weight: to.weight || f.weight, italic: to.italic == null ? f.italic : to.italic}) : f;
      })});
    }
    if (a.fontScale) s = Object.assign({}, s, {fontScale: a.fontScale});
    if (a.placement) {
      const layout = Object.assign({}, s.layout);
      PLACE.forEach((k) => { if (a.placement[k] != null && isConst(layout[k])) layout[k] = a.placement[k]; });
      s = Object.assign({}, s, {layout});
    }
    return s;
  }

  /** 落位里由参数或表达式决定的那几项改不了：这一项报诊断，其余照常生效（§5）。 */
  function diagnostics(scene, adjust) {
    const a = clean(adjust);
    const layout = (scene && scene.layout) || {};
    const out = [];
    if (a && a.placement) {
      PLACE.forEach((k) => {
        if (a.placement[k] != null && !isConst(layout[k])) {
          out.push({code: UNSUPPORTED, field: 'placement.' + k, message: 'layout.' + k + ' is driven by a template parameter'});
        }
      });
    }
    return out;
  }
  /** 落位里哪几项能调（摘要的 `adjustable.placement` 与调整页的灰显读它）。 */
  const placeable = (scene) => PLACE.filter((k) => isConst(((scene && scene.layout) || {})[k]));

  /* ---------- 折成组合样式的几样（摘要的效果标签与画法共用） ---------- */
  function fillOf(p) {
    if (p.gradient) return {kind: 'linear', angle: p.gradient.angle == null ? 180 : p.gradient.angle, stops: p.gradient.stops};
    if (p.texture) return p.tint ? {kind: 'texture', texture: p.texture, tint: p.tint} : {kind: 'texture', texture: p.texture};
    return {kind: 'solid', color: p.color};
  }
  function stackOf(scene) {
    const ps = (scene && scene.paints) || [];
    const fill = ps.find((p) => p.kind === 'fill');
    const g = ps.find((p) => p.kind === 'glow');
    return {
      fill: fill ? fillOf(fill) : {kind: 'solid', color: '#FFFFFF'},
      /* 草图由下往上，最先画的描边是最外一圈；栈的描边由内向外，所以倒过来 */
      strokes: ps.filter((p) => p.kind === 'stroke').reverse().slice(0, 3).map((p) => ({color: p.color, width: p.width})),
      shadows: ps.filter((p) => p.kind === 'shadow' || p.kind === 'inner-shadow').slice(0, 3)
        .map((p) => ({color: p.color, offset: p.offset || [0, 0], blur: p.blur || 0, inner: p.kind === 'inner-shadow'})),
      glow: g ? {color: g.color, radius: g.radius, strength: g.strength == null ? 0.8 : g.strength} : null,
    };
  }
  function activeOf(scene, seed) {
    const st = (scene && scene.states) || {};
    const a = st.active;
    const aw = {mode: 'none', spoken: 'keep', unspoken: 'keep'};
    if (a) {
      Object.assign(aw, {mode: a.mode || 'color', color: a.color});
      if (a.scale) aw.scale = a.scale;
      if (a.mode === 'pop') aw.durationSeconds = 0.22;
      if (a.box) aw.box = {color: a.box.color, radius: a.box.radius == null ? 0.14 : a.box.radius, padding: a.box.padding || [0.16, 0.06]};
      if (a.glow) aw.glow = {color: a.glow.color, radius: a.glow.radius || 0.4};
      if (a.mode === 'sweep') aw.sweep = {unit: 'grapheme', guide: false, nextLine: false};
    }
    if (st.read) aw.spoken = 'tint';
    if (st.unread) { aw.unspoken = st.unread.hidden ? 'hidden' : 'dim'; if (st.unread.opacity != null) aw.dimOpacity = st.unread.opacity; }
    /* 换一版：随 seed 变的那份强调色（真实场景里是 seed 驱动的表达式） */
    if (scene && scene.seeded && scene.seedPalette && scene.seedPalette.length && aw.mode !== 'none') {
      const pick = scene.seedPalette[Math.abs(seed || 0) % scene.seedPalette.length];
      if (aw.mode === 'box' && aw.box) aw.box = Object.assign({}, aw.box, {color: pick});
      else aw.color = pick;
    }
    return aw;
  }
  function motionOf(scene) {
    const an = (scene && scene.animation) || {};
    const CS = window.BC_CS;
    const m = {};
    ['in', 'out', 'loop'].forEach((k) => {
      if (!an[k]) return;
      m[k] = CS ? CS.effect(k, an[k]) : {preset: an[k]};
    });
    return Object.keys(m).length ? m : null;
  }
  function paginationOf(scene) {
    const pg = scene && scene.pagination;
    return pg && pg.mode === 'fixed' && pg.wordsPerPage ? {wordsPerPage: pg.wordsPerPage, rows: pg.rows || null} : null;
  }
  /** 组合样式形状的一份近似（给 `BC_SURF.tags` 判效果标签用）。 */
  function bodyOf(scene, seed) {
    const ps = (scene && scene.paints) || [];
    const plate = ps.find((p) => p.kind === 'plate');
    const box = ps.find((p) => p.kind === 'box');
    const kw = scene && scene.states && scene.states.keyword;
    return {
      surface: Object.assign(stackOf(scene), {plate: plate || null, wordBox: box || null}),
      activeWord: activeOf(scene, seed), motion: motionOf(scene),
      emphasis: kw && (scene.wordTags || []).indexOf('keyword') >= 0 ? kw : null,
      layout: {pagination: paginationOf(scene)},
    };
  }

  /** 摘要的效果标签（§8 场景那一栏，原型按草图判）。 */
  function behaviors(scene) {
    const SURF = window.BC_SURF;
    const out = new Set(SURF ? SURF.tags(bodyOf(scene)) : []);
    const ps = (scene && scene.paints) || [];
    if (ps.some((p) => p.kind === 'inner-shadow')) out.add('shadow');
    if (ps.some((p) => p.kind === 'material' || p.texture)) out.add('texture');
    if (scene && scene.decorations) out.add('decoration');
    const order = SURF ? SURF.TAGS.map((t) => t.k) : Array.from(out);
    return order.filter((k) => out.has(k));
  }
  /** 要不要逐词时间：有当前词 / 念过 / 未念的状态、念到时触发的动效、固定词数分页。 */
  function needsWordTiming(scene) {
    const st = (scene && scene.states) || {};
    if (st.active || st.read || st.unread) return true;
    const m = motionOf(scene) || {};
    if (['in', 'out', 'loop'].some((k) => m[k] && m[k].trigger === 'spoken')) return true;
    return !!paginationOf(scene);
  }

  /* ---------- 场景摘要（§6） ---------- */
  const USE_ORDER = ['text', 'stroke', 'shadow', 'glow', 'active', 'read', 'unread', 'keyword', 'plate', 'word-box', 'material'];
  /* 覆盖占比在原型里按用途估：字身一整块，底板次之，描边、阴影、发光是一圈，状态色只落在一两个词上 */
  const AREA = {text: 1, plate: 0.7, 'word-box': 0.3, stroke: 0.25, read: 0.4, unread: 0.4, shadow: 0.15, glow: 0.12,
    active: 0.1, keyword: 0.06, material: 0.05};
  const LAYER_KIND = {fill: 'fill', stroke: 'stroke', shadow: 'shadow', 'inner-shadow': 'inner-shadow', glow: 'glow',
    plate: 'plate', box: 'box', material: 'material'};

  function describe(scene, adjust, ctx) {
    const c = ctx || {};
    const a = clean(adjust);
    const s = scene || {};
    const byValue = new Map();
    mapColors(s, (color, use, animated) => {
      const v = normColor(color);
      if (!v) return color;
      const e = byValue.get(v) || {value: css(v), uses: [], animated: false, area: 0};
      if (e.uses.indexOf(use) < 0) e.uses.push(use);
      if (animated) e.animated = true;
      e.area += animated ? 0.02 : AREA[use] || 0.05;
      byValue.set(v, e);
      return color;
    });
    const rank = (e) => Math.min.apply(null, e.uses.map((u) => USE_ORDER.indexOf(u)));
    const colors = Array.from(byValue.values())
      .map((e) => Object.assign(e, {uses: e.uses.slice().sort((x, y) => USE_ORDER.indexOf(x) - USE_ORDER.indexOf(y)),
        area: Math.round(e.area * 100) / 100, to: colorTo(a, e.value)}))
      .sort((x, y) => rank(x) - rank(y) || y.area - x.area);
    const fonts = (s.fonts || []).map((f) => ({key: f.key, family: f.family, weight: f.weight || 400, italic: !!f.italic,
      scripts: c.fontScripts ? c.fontScripts(f.family) : [], tunedSpacing: !!f.tunedSpacing, to: fontTo(a, f.key)}));
    const ps = s.paints || [];
    const m = motionOf(s);
    const tiers = [];
    const active = s.states && s.states.active;
    if (m || (active && (active.scale || active.mode === 'pop'))) tiers.push('glyph-motion');
    if (ps.some((p) => p.kind === 'fill' || p.kind === 'stroke' || p.kind === 'shadow' || p.kind === 'glow')) tiers.push('text-paint');
    if (ps.some((p) => p.texture || p.kind === 'material' || p.kind === 'inner-shadow')) tiers.push('texture-effects');
    if (s.decorations) tiers.push('derived-decoration');
    const pg = paginationOf(s);
    return {
      colors, fonts,
      wordTags: (s.wordTags || []).slice(),
      behaviors: behaviors(s),
      tiers,
      needsWordTiming: needsWordTiming(s),
      seeded: !!s.seeded,
      pagination: pg ? {mode: 'fixed', wordsPerPage: pg.wordsPerPage} : {mode: 'auto'},
      layers: ps.map((p, i) => ({nodeId: (p.node || 'text') + ':' + i, kind: p.texture ? 'image' : LAYER_KIND[p.kind] || 'material',
        detail: p.texture || p.name || (p.gradient ? 'gradient' : undefined)})),
      adjustable: {colors: colors.length > 0, fonts: fonts.length > 0, placement: placeable(s).length > 0, fontScale: true},
      placeable: placeable(s),
      diagnostics: diagnostics(s, a),
    };
  }

  /* ---------- 画法：折成原型轨键 ----------
     `ctx = {role: 'source' | 'translation', presentation: {wordTags, seed}}`。字号、落位不在这里：
     套用不搬字幕的家（落位与字号留在轨上），调整页改它们时连轨一起写。 */
  const CJK = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC'";
  function toPaint(scene, adjust, ctx) {
    const c = ctx || {};
    const pr = c.presentation || {};
    const s = apply(scene, adjust);
    const SURF = window.BC_SURF;
    const body = (s.fonts || [])[0] || {family: 'Inter', weight: 400};
    const t = s.text || {};
    const ps = s.paints || [];
    const plate = ps.find((p) => p.kind === 'plate');
    const box = ps.find((p) => p.kind === 'box');
    const stack = stackOf(s);
    const color = stack.fill.kind === 'solid' ? stack.fill.color : (stack.fill.stops ? stack.fill.stops[0][1] : stack.fill.tint || '#FFFFFF');
    const out = {
      font: body.family, stack: "'" + body.family + "', " + CJK + ', sans-serif', weight: body.weight || 400, bold: false,
      italic: !!body.italic, color, align: 'center', lh: t.lh || 120, spacing: t.spacing || 0, upper: t.upper ? 'upper' : '', mono: false,
      bg: plate ? plate.color : '#000000', opacity: plate ? plate.opacity : 0, corners: plate ? plate.corners || 0 : 0,
      pad: 20, plate: plate ? plate.shape || 'line' : 'line',
    };
    if (SURF) Object.assign(out, SURF.toPaint(stack, {color}));
    const src = (c.role || 'source') === 'source';
    const aw = activeOf(s, pr.seed);
    out.wordBackground = box ? {color: box.color, activeColor: aw.mode === 'box' && aw.box ? aw.box.color : box.color,
      paddingXEm: (box.padding || [0.16, 0.06])[0], paddingYEm: (box.padding || [0.16, 0.06])[1], radiusEm: box.radius == null ? 0.14 : box.radius} : null;
    const CS = window.BC_CS;
    const role = CS ? CS.forRole({activeWord: aw, motion: motionOf(s)}, {role: c.role || 'source'}) : {activeWord: aw, motion: motionOf(s)};
    out.activeWord = role.activeWord;
    out.motion = role.motion;
    if (src && role.activeWord.color) out.activeColor = role.activeWord.color;
    out.pagination = src ? paginationOf(s) : null;
    const kw = s.states && s.states.keyword;
    if (src && kw && (s.wordTags || []).indexOf('keyword') >= 0) {
      const kf = kw.font ? (s.fonts || []).find((f) => f.key === kw.font) : null;
      out.highlight = {on: true, color: kw.color, font: kf ? kf.family : null, bold: kw.bold !== false, italic: false,
        scale: Math.round((kw.scale || 1) * 100), marks: (pr.wordTags && pr.wordTags.keyword) || {}};
    } else out.highlight = null;
    out.wordAnim = 'none';
    out.caption = null;
    out.kinetic = null;
    out.textMotion = null;
    out.nativeStyle = null;
    return out;
  }

  /** 场景的规范化摘要（`origin.sceneSha256` 的替身）：原型用 FNV-1a，只为「调整前是哪一份」对得上。 */
  function digest(scene) {
    const seen = JSON.stringify(scene, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v).sort().reduce((o, key) => { o[key] = v[key]; return o; }, {}) : v));
    let h = 0x811c9dc5;
    for (let i = 0; i < seen.length; i++) { h ^= seen.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  window.BC_ADJ = {
    UNSUPPORTED, SCALE_MIN, SCALE_MAX, USE_ORDER,
    normColor, swap, clean, isAdjusted, withColor, withFont, withScale, withPlacement, colorTo, fontTo,
    mapColors, apply, diagnostics, placeable, behaviors, needsWordTiming, describe, toPaint, digest,
  };
})();
