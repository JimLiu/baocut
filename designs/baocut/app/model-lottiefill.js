/* model-lottiefill.js —— Lottie 的分色编辑（第 238 轮）。

   静态 SVG 贴纸的换色在 [model-svgfill.js](model-svgfill.js)：数一数源码里有几个
   填充色分组，就出几张色卡。第 238 轮五个动态分类换成 Noto 的 Lottie JSON 之后，
   「动态贴纸支持分色编辑」这句话得由这一层兑现——Lottie 的颜色不在属性里，而在
   图层的形状项（`ty: 'fl'` 填充 / `ty: 'st'` 描边，`c.k` 是 0–1 的 RGB 数组）与
   纯色图层（`ty: 1` 的 `sc`）上。

   两条与生成器逐字同源的规则（`scripts/dev/elements/generate.py` 的
   `lottie_colors`，manifest 里每一份的 `colors` 就是它的产物，本层的单测拿 81 份
   真素材与 manifest 对拍）：

   1. **只收静态色**。`c.a` 为真表示这条颜色本身是动画的（关键帧），那不是一个
      可以整体换掉的色区，跳过。
   2. **按出现次数排序，最多 8 组**。次数相同按第一次出现的先后——用户看到的第
      一张色卡就是画面上最大的那块色。

   `applyFills` 把第 i 组换成第 i 个覆盖色，颜色出现在哪里就换到哪里（和 SVG 那边
   「同一组的所有 fill 一起变」是同一个语义）。它返回**深拷贝**，原始 JSON 不动：
   lottie-web 会就地改它拿到的那份 `animationData`，共用一份会让两个贴纸互相串色。 */
(function () {
  const LIMIT = 8;

  /** `#abc` → `#AABBCC`；其余一律大写。 */
  function norm(color) {
    if (typeof color !== 'string') return null;
    const s = color.trim();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      return '#' + s.slice(1).split('').map((c) => c + c).join('').toUpperCase();
    }
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
    return null;
  }

  /** Lottie 的 `[r, g, b]`（0–1，偶尔 0–255）→ `#RRGGBB`。 */
  function rgbHex(value) {
    if (!Array.isArray(value) || value.length < 3) return null;
    const raw = value.slice(0, 3);
    if (!raw.every((x) => typeof x === 'number' && isFinite(x))) return null;
    const scaled = raw.some((c) => c > 1) ? raw.map((c) => c / 255) : raw;
    return '#' + scaled.map((c) => {
      const v = Math.round(Math.min(Math.max(c, 0), 1) * 255);
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('').toUpperCase();
  }

  /** `#RRGGBB` → `[r, g, b]`（0–1，三位小数，和 Noto 的原件同精度）。 */
  function hexRgb(hex) {
    const h = norm(hex);
    if (!h) return null;
    return [0, 2, 4].map((i) => Math.round(parseInt(h.slice(1 + i, 3 + i), 16) / 255 * 1000) / 1000);
  }

  /* 遍历一份 Lottie 里所有「静态色」的落点，回调拿到 `(hex, set)`：`set(newHex)`
     就地改那一处。这样取色与改色走的是同一条路径，不会一边多认一处一边漏改一处。 */
  function walk(doc, visit) {
    if (!doc || typeof doc !== 'object') return;
    const shapes = (list) => {
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        if (item.ty === 'fl' || item.ty === 'st') {
          const c = item.c;
          if (c && !c.a) {
            const hex = rgbHex(c.k);
            if (hex) visit(hex, (next) => { c.k = hexRgb(next) || c.k; });
          }
        } else if (item.ty === 'gr') shapes(item.it);
      }
    };
    const layers = [doc.layers].concat((doc.assets || []).map((a) => a && a.layers));
    for (const list of layers) {
      if (!Array.isArray(list)) continue;
      for (const layer of list) {
        if (!layer || typeof layer !== 'object') continue;
        if (layer.ty === 1 && typeof layer.sc === 'string') {
          const hex = norm(layer.sc);
          if (hex) visit(hex, (next) => { layer.sc = next; });
        }
        shapes(layer.shapes);
      }
    }
  }

  /** 出现次数最多的前 `limit` 组静态色，次数相同按第一次出现的先后。 */
  function colorsOf(doc, limit) {
    const count = new Map();
    const first = new Map();
    let n = 0;
    walk(doc, (hex) => {
      count.set(hex, (count.get(hex) || 0) + 1);
      if (!first.has(hex)) first.set(hex, n++);
    });
    return [...count.keys()]
      .sort((a, b) => (count.get(b) - count.get(a)) || (first.get(a) - first.get(b)))
      .slice(0, limit == null ? LIMIT : limit);
  }

  /** 与 `BC_SVGFILL.fillsOf` 同形的色卡表（属性页那一行读它）。 */
  function fillsOf(doc) {
    return colorsOf(doc).map((hex, i) => ({i: i, hex: hex}));
  }

  /** 覆盖表是不是「原样」（全空 / 逐项等于原色）——是的话不必重建 animationData。 */
  function isDefault(doc, list) {
    if (!list || !list.length) return true;
    const base = colorsOf(doc);
    return list.every((c, i) => !c || norm(c) === base[i]);
  }

  /** 第 i 组换成 `list[i]`（空位保留原色）。返回深拷贝，原件不动。 */
  function applyFills(doc, list) {
    if (!doc) return doc;
    if (isDefault(doc, list)) return doc;
    const base = colorsOf(doc);
    const map = new Map();
    base.forEach((hex, i) => {
      const to = norm((list || [])[i]);
      if (to && to !== hex) map.set(hex, to);
    });
    if (!map.size) return doc;
    const copy = JSON.parse(JSON.stringify(doc));
    walk(copy, (hex, set) => { if (map.has(hex)) set(map.get(hex)); });
    return copy;
  }

  Object.assign(window, {BC_LOTTIEFILL: {
    LIMIT, norm, rgbHex, hexRgb, walk, colorsOf, fillsOf, isDefault, applyFills,
  }});
})();
