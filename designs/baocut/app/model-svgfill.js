/* 矢量素材的填充色分组 —— §14.4（第 122 轮）。

   机制：

     · **颜色不是目录声明的，是把素材拉下来解析出来的。**遍历
       `path,rect,circle,ellipse,line,polyline,polygon,stop` 这八个标签，依次取
       `fill` 属性 → `style` 里的 fill → `stop-color`，抓其中的 hex。
     · **相同默认 hex 的节点归成一组**。组数 = 素材里不同填充色的个数，与元素类型无关。
     · **两条排除**：素材里含 `<image>`（位图套壳）→ 一张卡都不给；不同色 **> 15**
       种 → 一张卡都不给（那是插画，逐色改没有意义）。
     · 否则取**前 5 组**作为默认 `fillList`。
     · 改色时对该组的每个节点同时写 `fill` / `style` 的 fill / `stop-color`，
       再序列化成 `data:image/svg+xml;base64,…` 交给渲染器。

   三条容易写错的判据（都写在这里，别在别处再判一遍）：

     1. **组的次序按文档出现次序**，不按标签分批。若走
        `for (tag of tagNames) getElementsByTagName(tag)`，`podcast-02.svg`
        （一个 `<circle>` 在前、两条 `<path>` 在后）的第一张卡会是白色的路径、
        第二张才是黄色的圆——那是 `getElementsByTagName` 的副产物，不是设计。
     2. **改色作用到组里的每一个节点**。若组只记**最后一个**写进来的节点的标签、
        换色时再按标签过滤，跨标签的同色组就只有最后那个标签的节点会换色，画面上
        换一半。
     3. **`style` 里只认 / 只改 `fill:` 那一条声明**。拿整个 `style` 串去撞 hex，
        `stroke:#111` 也会被当成填充色读出来；换色时把整个 `style` 属性覆写成
        `fill:…`，`fill-rule` / `stroke` 会一起没掉。`fill="none"` / `url(#…)` /
        `currentColor` 一律不算颜色。

   `#RGB` 一律补齐成 `#RRGGBB` 再比（不补的话 `#fff` 与 `#FFFFFF` 会成两组）。
   这一层不碰 DOM，`node --test` 直接 require。 */
(function () {
  /** 只有这八个标签的填充色进色卡 */
  const TAGS = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'stop'];
  /** 默认 `fillList` 最多几张卡 */
  const MAX_SWATCHES = 5;
  /** 超过这么多种不同色就一张卡都不给 */
  const MAX_COLORS = 15;

  /* 三种写法依次试：8 位（带 alpha）→ 6 位 → 3 位简写。
     不加词边界：四位写法（`#RGBA`）读出来的是前三位。 */
  const HEX8 = /#[0-9A-Fa-f]{8}/;
  const HEX6 = /#[0-9A-Fa-f]{6}/;
  const HEX3 = /#[0-9A-Fa-f]{3}/;
  /** `style` 里的 fill 声明。`fill-opacity` / `fill-rule` 不会命中（它们后面不是冒号） */
  const STYLE_FILL = /(^|;)([ \t]*)fill[ \t]*:[ \t]*([^;]*)/i;
  /** 一个开始标签（属性值里的 `>` 由前两支吃掉，不会把标签切断） */
  const TAG_RE = /<([A-Za-z][A-Za-z0-9:_.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)\/?>/g;
  const ATTR_RE = /([A-Za-z_:][A-Za-z0-9:._-]*)[ \t\r\n]*=[ \t\r\n]*("([^"]*)"|'([^']*)')/g;

  /** 补齐三位简写并统一大写，好让 `#fff` 与 `#FFFFFF` 认成同一组 */
  function normHex(h) {
    const s = String(h || '').toUpperCase();
    return s.length === 4 ? '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3] : s;
  }

  /** 一个色值串里的 hex（`none` / `currentColor` / 渐变引用都读不出色） */
  function hexIn(s) {
    if (!s) return null;
    const t = String(s).replace(/url\([^)]*\)/g, ' ');
    const m = t.match(HEX8) || t.match(HEX6) || t.match(HEX3);
    return m ? m[0] : null;
  }

  /* ---------- 扫描 ----------
     Node 里没有 DOMParser，所以按标签 / 属性做一次确定性扫描。记的是**绝对偏移**，
     换色时按偏移原地替换——重新序列化一遍会把注释、缩进、`xml:space` 全洗掉，
     而这一份文本还要拿去和素材原文对拍。 */
  function scan(svgText) {
    const text = svgText == null ? '' : String(svgText);
    const nodes = [];
    let image = false;
    TAG_RE.lastIndex = 0;
    let m;
    while ((m = TAG_RE.exec(text))) {
      const tag = m[1].toLowerCase();
      if (tag === 'image') { image = true; continue; }
      if (TAGS.indexOf(tag) < 0) continue;
      const base = m.index + 1 + m[1].length;
      const attrs = {};
      ATTR_RE.lastIndex = 0;
      let a;
      while ((a = ATTR_RE.exec(m[2]))) {
        const raw = a[3] !== undefined ? a[3] : a[4];
        const start = base + a.index + a[0].length - raw.length - 1;
        attrs[a[1].toLowerCase()] = {v: raw, s: start, e: start + raw.length};
      }
      nodes.push({tag: tag, attrs: attrs});
    }
    return {image: image, nodes: nodes};
  }

  /** 一个节点上所有**承载填充色**的位置：`fill` 属性 / `style` 的 fill 声明 / `stop-color` */
  function carriers(node) {
    const out = [];
    const fill = node.attrs.fill;
    if (fill && hexIn(fill.v)) out.push({s: fill.s, e: fill.e, hex: hexIn(fill.v)});
    const style = node.attrs.style;
    if (style) {
      const sm = style.v.match(STYLE_FILL);
      if (sm) {
        const hex = hexIn(sm[3]);
        if (hex) {
          // 声明的值落在整段匹配的末尾，所以从匹配的右端往回量
          const at = style.s + sm.index + sm[0].length - sm[3].length;
          out.push({s: at, e: at + sm[3].length, hex: hex});
        }
      }
    }
    const stop = node.attrs['stop-color'];
    if (stop && hexIn(stop.v)) out.push({s: stop.s, e: stop.e, hex: hexIn(stop.v)});
    return out;
  }

  /* ---------- 分组 ----------
     一个节点的默认色取第一个读得出来的：`fill` → `style` → `stop-color`。
     同色归一组，组的次序 = 第一次出现的次序。 */
  function groupsOf(svgText) {
    const sc = scan(svgText);
    if (sc.image) return [];                      // 位图套壳：一张卡都不给
    const groups = [];
    const byHex = {};
    sc.nodes.forEach((node) => {
      const cs = carriers(node);
      if (!cs.length) return;
      const hex = normHex(cs[0].hex);
      let g = byHex[hex];
      if (!g) { g = {hex: hex, tag: node.tag, count: 0, spans: []}; byHex[hex] = g; groups.push(g); }
      g.count += 1;
      cs.forEach((c) => g.spans.push({s: c.s, e: c.e}));
    });
    return groups;
  }

  /** 色卡表：`[{hex, tag, count}]`。含 `<image>` 或超过 15 种色 → 空表；否则最多 5 组。 */
  function fillsOf(svgText) {
    const gs = groupsOf(svgText);
    if (gs.length > MAX_COLORS) return [];
    return gs.slice(0, MAX_SWATCHES)
      .map((g) => ({hex: g.hex, tag: g.tag, count: g.count}));
  }

  /** 默认 `fillList`（元素首次选中时种进文档的那一份） */
  function defaultFills(svgText) {
    return fillsOf(svgText).map((f) => f.hex);
  }

  /** `fillList` 与默认色逐项相等 = 这张素材还没被改过色，画面上直接用原 URL */
  function isDefault(svgText, fillList) {
    const def = defaultFills(svgText);
    const list = fillList || [];
    if (!list.length) return true;
    return def.length === list.length && def.every((h, i) => normHex(list[i]) === h);
  }

  /** 按 `fillList` 换色：第 i 张卡只换第 i 组那些节点的填充色，别的一律原样 */
  function applyFills(svgText, fillList) {
    const text = svgText == null ? '' : String(svgText);
    const list = fillList || [];
    if (!list.length) return text;
    const gs = groupsOf(text);
    const n = Math.min(gs.length, list.length, MAX_SWATCHES);
    const edits = [];
    for (let i = 0; i < n; i++) {
      const to = list[i];
      if (!to || typeof to !== 'string') continue;
      gs[i].spans.forEach((sp) => edits.push({s: sp.s, e: sp.e, t: to}));
    }
    if (!edits.length) return text;
    edits.sort((a, b) => a.s - b.s);
    let out = '';
    let at = 0;
    edits.forEach((ed) => {
      if (ed.s < at) return;
      out += text.slice(at, ed.s) + ed.t;
      at = ed.e;
    });
    return out + text.slice(at);
  }

  /** UTF-8 安全的 base64（浏览器 `btoa` 只吃 latin1） */
  function b64(s) {
    if (typeof Buffer !== 'undefined' && Buffer.from) return Buffer.from(s, 'utf8').toString('base64');
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(bin);
  }

  /* 盒子被拉成任意宽高（`pose.h` 生效）时，`object-fit: fill` 对外部 SVG 是没用的：
     SVG 自己的 `preserveAspectRatio` 优先级更高，图会在被拉长的盒子里留黑边（等比
     缩进）。所以拉伸这一档要改素材本身——给根 `<svg>` 写上 `preserveAspectRatio="none"`
     （已有就替换），再走 `dataUri` 交给 `<img>`。只动根标签的属性区，`<svg>` 内部
     嵌套的 `<image preserveAspectRatio>` 不碰。 */
  function stretch(svgText) {
    const s = svgText == null ? '' : String(svgText);
    const m = /<svg\b[^>]*>/i.exec(s);
    if (!m) return s;
    const tag = m[0];
    const selfClose = /\/>$/.test(tag);
    let attrs = tag.slice(4, tag.length - (selfClose ? 2 : 1));
    attrs = attrs.replace(/\s*preserveAspectRatio\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    const next = '<svg' + attrs.replace(/\s+$/, '') + ' preserveAspectRatio="none"'
      + (selfClose ? '/>' : '>');
    return s.slice(0, m.index) + next + s.slice(m.index + tag.length);
  }

  /** 换过色的素材交给渲染器的形态（base64 data URI） */
  function dataUri(svgText) {
    return 'data:image/svg+xml;base64,' + b64(svgText == null ? '' : String(svgText));
  }

  /* 内置矢量贴纸（`BC_SK.BUILTIN`，来自 `core/presets/builtin/sticker/*.json`）走的是
     同一条路：先把 `layers` 直译成一份 SVG 文本，色卡与换色就都是上面那几件，不用为
     「路径数组」再写第二份分组逻辑。几何与 `stage-elements.jsx` 原来那段逐字一致。 */
  function builtinSvg(layers) {
    const body = (layers || []).map((l) => '<path d="' + l.d + '" fill="' + (l.fill || 'none')
      + '" stroke="' + (l.stroke || 'none') + '" stroke-width="' + (l.w || 0)
      + '" stroke-linecap="round" stroke-linejoin="round"/>').join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="100%"'
      + ' style="display:block" aria-hidden="true">' + body + '</svg>';
  }

  /* 内置矢量贴纸画的是 `layers` 本身（不走文本替换，因为盒子高度那一档要靠
     `preserveAspectRatio`），所以这里给出「第 i 层此刻该用哪个填充色」：层的原色
     在色卡表里排第几，就取 `fillList` 的第几张。分组判据仍然是上面那一份。 */
  function layerFill(layers, fillList, i) {
    const layer = (layers || [])[i] || {};
    const own = normHex(layer.fill || '');
    const at = fillsOf(builtinSvg(layers)).map((c) => c.hex).indexOf(own);
    return (at >= 0 && (fillList || [])[at]) || layer.fill || 'none';
  }

  window.BC_SVGFILL = {
    TAGS, MAX_SWATCHES, MAX_COLORS,
    normHex, hexIn, groupsOf, fillsOf, defaultFills, isDefault, applyFills, stretch, dataUri,
    builtinSvg, layerFill,
  };
})();
