/* 字幕的**分层涂装**（caption-editor-redesign §4）——组合样式 v2 的 `surface`。

   v1 的涂装一样一份：一个字色、一道描边、一层阴影（辉光是距离为 0 的阴影）。
   v2 换成一个栈：字身填充（纯色 / 渐变 / 纹理）、0–3 层描边、0–3 层阴影（可以是内阴影）、
   一层发光。轨上存成一个键 `layers`；底板与逐词底块仍是原来那几个键（`bg` / `opacity` /
   `plate`… 与 `wordBackground`），栈不重复存它们。

   这一层做四件事，全是纯函数：

     · `normalize` / `fromPaint`  栈的默认值，以及 v1 涂装键 → 栈（打开旧轨时的机械升级）；
     · `toPaint`                  栈 → v1 镜像键（字色、第一层描边、第一层阴影），旧读者照读；
     · `cssOf`                    栈 → 一组 CSS 属性与变量，`paintCss` 合进行容器的内联样式；
     · `tags`                     一份组合样式能看见的效果（§8 的效果标签）。

   **CSS 怎么画**（原型的近似，真实渲染走核心场景）：
     - 渐变与纹理是 `background-clip: text`。它只认元素自己的字形——当前词、逐字动画那些
       有 transform 的子元素不在父元素的剪裁里——所以填充不挂在行容器上，挂在词与字的
       最内层（`.aw-t` / `.aw-g`），由行容器上的 `--tx-*` 变量传下去（app/subtitle-active.css）。
     - 描边：纯色字身时第一层用 `-webkit-text-stroke` ＋ `paint-order: stroke fill`（与 v1 同一
       画法），其余各层与渐变字身的全部描边用四向 `drop-shadow` 链：每一道把上一道的结果往四个
       方向各推一层宽度，合起来是一圈方形膨胀。
     - 阴影、发光都是 `drop-shadow`，接在描边后面——阴影是「描过边的字」的阴影。
     - 内阴影没有 CSS 对应，近似成字身顶部压一道阴影色的渐变。

   描边的 `width` 是这一圈**朝外看得见的厚度**（em），由内向外逐圈叠加；v1 的 `outlineW`
   是居中笔宽，换算是 `outlineW / 320`。

   长度全按 em 存（与 v1 的 em 口径一致），换算成 px 只在 `cssOf` 里，所以 13px 的缩略图与
   画布上的大字是同一个样子。颜色是画进视频画面的内容色，按文件登记在 `_ds_conformance.json`。 */
(function () {
  const MAX_LAYERS = 3;

  /* ---------- 纹理库（§4：只来自内置纹理库） ----------
     真实应用随附 PNG；原型用 CSS 渐变画一张近似的「纹理」，同名同义。 */
  const TEXTURES = [
    {k: 'metal', name: '金属', image: 'linear-gradient(180deg, #FFFFFF 0%, #D9DEE5 38%, #8D96A3 52%, #F4F6F8 70%, #A7AFBA 100%)'},
    {k: 'gold', name: '鎏金', image: 'linear-gradient(180deg, #FFF6C8 0%, #F5C542 40%, #B8860B 55%, #FFE58A 75%, #C9971C 100%)'},
    {k: 'neon-tube', name: '霓虹管', image: 'linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 30%, #FFD1F2 50%, #FFFFFF 70%, #FFFFFF 100%)'},
    {k: 'paper', name: '纸张', image: 'repeating-linear-gradient(115deg, #F3EBDD 0 0.12em, #E7DCC8 0.12em 0.2em, #F7F1E6 0.2em 0.34em)'},
    {k: 'chalk', name: '粉笔', image: 'repeating-linear-gradient(80deg, #FFFFFF 0 0.06em, #E2E6EA 0.06em 0.1em, #FFFFFF 0.1em 0.18em, #C9CFD6 0.18em 0.21em)'},
    {k: 'ink', name: '油墨', image: 'repeating-linear-gradient(160deg, #1F1F1F 0 0.08em, #3A3A3A 0.08em 0.11em, #262626 0.11em 0.2em)'},
  ];
  const texture = (k) => TEXTURES.find((t) => t.k === k) || null;

  /* ---------- 效果标签（§8） ---------- */
  const TAGS = [
    {k: 'active-color', name: '当前词变色'},
    {k: 'active-box', name: '当前词底块'},
    {k: 'sweep', name: '扫色'},
    {k: 'word-pop', name: '逐词弹出'},
    {k: 'reveal', name: '逐字显现'},
    {k: 'line-motion', name: '整行入场'},
    {k: 'loop', name: '循环动效'},
    {k: 'stroke', name: '描边'},
    {k: 'shadow', name: '阴影'},
    {k: 'glow', name: '发光'},
    {k: 'gradient', name: '渐变'},
    {k: 'texture', name: '纹理'},
    {k: 'plate', name: '底板'},
    {k: 'keyword', name: '关键词'},
    {k: 'multiline', name: '多行排版'},
    {k: 'decoration', name: '表情装饰'},
  ];
  const tagName = (k) => (TAGS.find((t) => t.k === k) || {name: k}).name;

  const r4 = (v) => Math.round(v * 10000) / 10000;
  const isFill = (f) => !!f && (f.kind === 'linear' || f.kind === 'texture' || f.kind === 'solid');

  /** 一个栈的完整值：缺的键补默认，层数截到 3。`fill` 为 null 表示纯色字身，颜色在轨的 `color` 上。 */
  function normalize(stack) {
    const s = stack || {};
    const fill = isFill(s.fill) && s.fill.kind !== 'solid' ? s.fill : null;
    return {
      fill,
      strokes: (s.strokes || []).filter((x) => x && x.color).slice(0, MAX_LAYERS)
        .map((x) => ({color: x.color, width: +x.width || 0})),
      shadows: (s.shadows || []).filter((x) => x && x.color).slice(0, MAX_LAYERS)
        .map((x) => ({color: x.color, offset: [+(x.offset || [0, 0])[0] || 0, +(x.offset || [0, 0])[1] || 0],
          blur: +x.blur || 0, inner: !!x.inner})),
      glow: s.glow && s.glow.color ? {color: s.glow.color, radius: +s.glow.radius || 0.3, strength: s.glow.strength == null ? 0.8 : +s.glow.strength} : null,
    };
  }

  /** v1 涂装键 → 栈（§4「/1 升级到 /2 是机械的」）。距离为 0 的阴影就是 v1 的辉光。 */
  function fromPaint(p) {
    const L = p || {};
    const out = {fill: null, strokes: [], shadows: [], glow: null};
    // v1 的描边是居中的 `fz × outlineW / 160`，被字身盖掉朝内的一半；栈存的是朝外看得见的那一圈
    if (L.outline) out.strokes.push({color: L.outlineColor || '#000000', width: r4((L.outlineW || 8) / 320)});
    if (L.shadow) {
      const d = (L.shDist == null ? 12 : L.shDist) / 100;
      const b = (L.shBlur == null ? 24 : L.shBlur) / 100;
      const c = L.shColor || '#000000D9';
      if (d === 0) out.glow = {color: c, radius: r4(b * 2.2), strength: 0.8};
      else {
        const a = ((L.shAngle == null ? 90 : L.shAngle) * Math.PI) / 180;
        out.shadows.push({color: c, offset: [r4(Math.cos(a) * d), r4(Math.sin(a) * d)], blur: r4(b), inner: false});
      }
    }
    return out;
  }

  /** 这一份涂装画出来的栈：有 `layers` 读它，没有按 v1 键升级。 */
  function layersOf(p) {
    return p && p.layers ? normalize(p.layers) : fromPaint(p);
  }

  /** 栈 → v1 镜像键：第一层描边、第一层外阴影（或发光）、字色。旧读者（导出预览的旧路、
   *  品牌页小卡、属性页的旧段）照读这一组，不必认识栈。 */
  function toPaint(stack, base) {
    const s = normalize(stack);
    const out = {layers: s};
    const b = base || {};
    out.color = b.color || (s.fill && s.fill.kind === 'linear' ? s.fill.stops[0][1] : '#FFFFFF');
    const st = s.strokes[0];
    out.outline = !!st;
    out.outlineColor = st ? st.color : '#000000';
    out.outlineW = st ? r4(st.width * 320) : 0;
    const sh = s.shadows.find((x) => !x.inner);
    if (sh) {
      const [x, y] = sh.offset;
      out.shadow = true;
      out.shDist = r4(Math.hypot(x, y) * 100);
      out.shAngle = r4(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
      out.shBlur = r4(sh.blur * 100);
      out.shColor = sh.color;
    } else if (s.glow) {
      out.shadow = true;
      out.shDist = 0; out.shAngle = 90;
      out.shBlur = r4((s.glow.radius / 2.2) * 100);
      out.shColor = s.glow.color;
    } else {
      out.shadow = false;
    }
    return out;
  }

  /** 填充 → CSS 图像。纹理带 `tint` 时在上面压一层半透明的色。 */
  function fillImage(fill) {
    if (!fill) return null;
    if (fill.kind === 'linear') {
      const stops = (fill.stops || []).map(([pos, c]) => c + ' ' + Math.round(pos * 100) + '%').join(', ');
      return 'linear-gradient(' + (fill.angle == null ? 180 : fill.angle) + 'deg, ' + stops + ')';
    }
    if (fill.kind === 'texture') {
      const t = texture(fill.texture) || TEXTURES[0];
      return fill.tint ? 'linear-gradient(' + fill.tint + ', ' + fill.tint + '), ' + t.image : t.image;
    }
    return null;
  }

  const px = (em, fz) => Math.round(em * fz * 100) / 100;
  /** 一道描边的四向膨胀。宽于 2.5px 时拆成两步，免得字角上露出缝。 */
  function strokeChain(st, fz) {
    const w = Math.max(0.5, px(st.width, fz));
    const steps = w > 2.5 ? 2 : 1;
    const d = Math.round((w / steps) * 100) / 100;
    const out = [];
    for (let i = 0; i < steps; i++) {
      out.push('drop-shadow(' + d + 'px 0 0 ' + st.color + ')', 'drop-shadow(-' + d + 'px 0 0 ' + st.color + ')',
        'drop-shadow(0 ' + d + 'px 0 ' + st.color + ')', 'drop-shadow(0 -' + d + 'px 0 ' + st.color + ')');
    }
    return out;
  }

  /** 栈 → 行容器上的 CSS（属性 ＋ `--tx-*` 变量）。`color` 是纯色字身的色（轨的 `color`）。
   *  返回的对象直接 `Object.assign` 进 `paintCss` 的结果。 */
  function cssOf(stack, color, fz) {
    const s = normalize(stack);
    const out = {};
    const rich = !!s.fill;
    const filters = [];
    s.strokes.forEach((st, i) => {
      if (i === 0 && !rich) {
        out.WebkitTextStroke = Math.max(0.5, +(px(st.width, fz) * 2).toFixed(2)) + 'px ' + st.color;
        out.paintOrder = 'stroke fill';
      } else filters.push.apply(filters, strokeChain(st, fz));
    });
    s.shadows.filter((x) => !x.inner).forEach((sh) => {
      filters.push('drop-shadow(' + px(sh.offset[0], fz) + 'px ' + px(sh.offset[1], fz) + 'px ' + px(sh.blur, fz) + 'px ' + sh.color + ')');
    });
    if (s.glow) {
      const r = Math.max(1, px(s.glow.radius, fz));
      filters.push('drop-shadow(0 0 ' + Math.round(r * 0.5 * 100) / 100 + 'px ' + s.glow.color + ')');
      if (s.glow.strength > 0.5) filters.push('drop-shadow(0 0 ' + r + 'px ' + s.glow.color + ')');
    }
    if (filters.length) out['--tx-filter'] = filters.join(' ');
    let image = fillImage(s.fill);
    const inner = s.shadows.find((x) => x.inner);
    if (inner) {
      // 内阴影的近似：顶部压一道阴影色，往下过渡回字身
      const base = image || 'linear-gradient(' + color + ', ' + color + ')';
      const depth = Math.min(60, Math.max(18, Math.round((Math.abs(inner.offset[1]) + inner.blur) * 100)));
      image = 'linear-gradient(180deg, ' + inner.color + ' 0%, transparent ' + depth + '%), ' + base;
    }
    if (image) {
      out['--tx-fill'] = image;
      out['--tx-clip'] = 'text';
      out['--tx-tfc'] = 'transparent';
      if (s.fill && s.fill.kind === 'texture') out['--tx-size'] = 'auto';
    }
    return out;
  }

  /** 当前词、念过染色这些「这个词换个颜色」的地方要把填充撤掉，否则渐变字身盖着换不了色。 */
  function inkVars(color) {
    return color ? {'--tx-fill': 'none', '--tx-clip': 'border-box', '--tx-tfc': color} : null;
  }

  /* ---------- 效果标签（§8 判据，组合样式这一栏） ---------- */
  const POP_IN = {'pop': 1, 'elastic-pop': 1, 'scale-in': 1, impact: 1, stomp: 1};
  const REVEAL_IN = {typewriter: 1, 'typewriter-cursor': 1, feather: 1, 'char-stagger': 1, 'wave-in': 1};

  /** 一份组合样式（`{surface, activeWord, motion, emphasis, layout}`，或一份轨上的涂装）能看见的效果。
   *  `layers` 优先，没有就按 v1 键升级再判。 */
  function tags(body) {
    const b = body || {};
    const out = new Set();
    const aw = b.activeWord || {};
    const mode = aw.mode || 'none';
    if (mode === 'color' || mode === 'scale' || mode === 'lift' || mode === 'pop' || mode === 'stretch') out.add('active-color');
    if (mode === 'box') out.add('active-box');
    if (mode === 'sweep') out.add('sweep');
    if (mode === 'pop') out.add('word-pop');
    if (mode === 'glow') { out.add('active-color'); out.add('glow'); }
    if (aw.unspoken === 'hidden') out.add('reveal');
    const m = b.motion || {};
    const inn = m.in;
    if (inn) {
      if (POP_IN[inn.preset]) out.add('word-pop');
      if (REVEAL_IN[inn.preset] || inn.unit === 'grapheme') out.add('reveal');
      if (inn.unit === 'cue' || inn.unit === 'line') out.add('line-motion');
    }
    if (m.loop) out.add('loop');
    const surf = b.surface || {};
    const stack = surf.strokes || surf.shadows || surf.fill || surf.glow ? normalize(surf) : layersOf(b.layers ? b : Object.assign({}, b, surfaceKeys(surf)));
    if (stack.strokes.length) out.add('stroke');
    if (stack.shadows.length) out.add('shadow');
    if (stack.glow) out.add('glow');
    if (stack.fill && stack.fill.kind === 'linear') out.add('gradient');
    if (stack.fill && stack.fill.kind === 'texture') out.add('texture');
    if (surf.plate || surf.wordBox || b.opacity > 0 || b.wordBackground) out.add('plate');
    if (b.emphasis) out.add('keyword');
    const pg = (b.layout && b.layout.pagination) || b.pagination;
    if (pg && pg.rows && pg.rows.length > 1) out.add('multiline');
    return TAGS.map((t) => t.k).filter((k) => out.has(k));
  }
  /** v1 正文的 `surface`（`stroke` / `shadow` 单数）→ 旧涂装键，`tags` 里升级用。 */
  function surfaceKeys(surf) {
    const o = {};
    if (surf.stroke) { o.outline = true; o.outlineColor = surf.stroke.color; o.outlineW = surf.stroke.width * 160; }
    if (surf.shadow) {
      const [x, y] = surf.shadow.offset || [0, 0];
      o.shadow = true; o.shColor = surf.shadow.color;
      o.shDist = Math.hypot(x, y) * 100; o.shAngle = (Math.atan2(y, x) * 180) / Math.PI; o.shBlur = (surf.shadow.blur || 0) * 100;
    }
    return o;
  }

  /* ---------- 栈的编辑（属性页「涂装」一段用） ---------- */

  /** 加一层：描边加在最外、阴影加在最下。到 3 层就不加（返回原栈）。
   *  描边的 `width` 是这一圈自己的厚度（由内向外逐圈叠加），新加的一圈照抄上一圈。 */
  function addLayer(stack, kind, seed) {
    const s = normalize(stack);
    const list = kind === 'stroke' ? s.strokes : s.shadows;
    if (list.length >= MAX_LAYERS) return s;
    const last = list[list.length - 1];
    const next = kind === 'stroke'
      ? {color: seed || (last ? last.color : '#000000'), width: last ? last.width : 0.06}
      : {color: seed || '#000000B3', offset: [0, 0.06], blur: 0.1, inner: false};
    return Object.assign({}, s, kind === 'stroke' ? {strokes: s.strokes.concat([next])} : {shadows: s.shadows.concat([next])});
  }
  function setLayer(stack, kind, i, patch) {
    const s = normalize(stack);
    const key = kind === 'stroke' ? 'strokes' : 'shadows';
    return Object.assign({}, s, {[key]: s[key].map((x, j) => (j === i ? Object.assign({}, x, patch) : x))});
  }
  function removeLayer(stack, kind, i) {
    const s = normalize(stack);
    const key = kind === 'stroke' ? 'strokes' : 'shadows';
    return Object.assign({}, s, {[key]: s[key].filter((x, j) => j !== i)});
  }
  /** 上下挪一层（`dir` = -1 往里 / +1 往外）。挪不动时原样返回。 */
  function moveLayer(stack, kind, i, dir) {
    const s = normalize(stack);
    const key = kind === 'stroke' ? 'strokes' : 'shadows';
    const j = i + dir;
    if (j < 0 || j >= s[key].length) return s;
    const list = s[key].slice();
    const t = list[i]; list[i] = list[j]; list[j] = t;
    return Object.assign({}, s, {[key]: list});
  }
  /** 字身换一种填充：纯色（null）/ 渐变 / 纹理。渐变的起止色从当前字色派生，纹理默认金属。 */
  function setFill(stack, kind, color) {
    const s = normalize(stack);
    if (kind === 'solid') return Object.assign({}, s, {fill: null});
    if (kind === 'linear') {
      const keep = s.fill && s.fill.kind === 'linear' ? s.fill : null;
      return Object.assign({}, s, {fill: keep || {kind: 'linear', angle: 180, stops: [[0, color || '#FFFFFF'], [1, '#FFD84D']]}});
    }
    const keep = s.fill && s.fill.kind === 'texture' ? s.fill : null;
    return Object.assign({}, s, {fill: keep || {kind: 'texture', texture: 'metal'}});
  }
  const fillKind = (stack) => (normalize(stack).fill ? normalize(stack).fill.kind : 'solid');

  /** 栈里用到的颜色（去重、保序），调色板与「已调整」判定用。 */
  function colorsOf(stack, color) {
    const s = normalize(stack);
    const out = [];
    const add = (c) => { if (c && out.indexOf(c) < 0) out.push(c); };
    if (!s.fill) add(color);
    else if (s.fill.kind === 'linear') s.fill.stops.forEach(([, c]) => add(c));
    else add(s.fill.tint);
    s.strokes.forEach((x) => add(x.color));
    s.shadows.forEach((x) => add(x.color));
    if (s.glow) add(s.glow.color);
    return out;
  }

  window.BC_SURF = {MAX_LAYERS, TEXTURES, TAGS, texture, tagName,
    normalize, fromPaint, layersOf, toPaint, fillImage, cssOf, inkVars, tags,
    addLayer, setLayer, removeLayer, moveLayer, setFill, fillKind, colorsOf};
})();
