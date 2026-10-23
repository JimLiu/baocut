/* 分屏同框的纯模型（docs/design/shorts-framing §3–§4、§8）：版式 → 格子，格子里的取景点 → 原片在格子里的盒，
   「要看见的源区域」→ 这一格的取景点与放大，互换、只留一人、一人改分屏的默认格子，以及画布与属性面板的文案。
   不碰 DOM、不依赖 React；node --test 直接 require。

   元素文档的 `panels: [{rect: {x, y, w, h}, focal: {x, y, zoom}}]`：`rect` 是画面的百分比（左上角与宽高），`focal` 与
   BC_FRAMING 的取景点同义，只是「刚好铺满」指铺满这一格。有 `panels` 时视频按格子画，元素自己的 `focal` 不参与，
   去掉 `panels` 时回到它。对应视频格式的 `VideoItem.panels`。 */
(function () {
  const F = typeof window !== 'undefined' && window.BC_FRAMING ? window.BC_FRAMING
    : (typeof require === 'function' ? require('./model-framing.js') : null);
  const MAX_ZOOM = F ? F.MAX_ZOOM : 4;
  /* 每一格的放大量（成片一个像素对原片几个像素）超过它就提醒发虚。 */
  const UPSCALE_WARN = 2.5;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const round = (v, d) => { const k = Math.pow(10, d); return Math.round(v * k) / k; };
  const third = 100 / 3;

  /** 版式的格子（画面百分比）。`rows` 2–3 行等高，`grid` 田字格；人数不在 2–4 时没有版式。 */
  function rectsFor(layout, n) {
    if (layout === 'grid' && n === 4) {
      return [{x: 0, y: 0, w: 50, h: 50}, {x: 50, y: 0, w: 50, h: 50}, {x: 0, y: 50, w: 50, h: 50}, {x: 50, y: 50, w: 50, h: 50}];
    }
    if (layout === 'rows' && n === 2) return [{x: 0, y: 0, w: 100, h: 50}, {x: 0, y: 50, w: 100, h: 50}];
    if (layout === 'rows' && n === 3) {
      return [{x: 0, y: 0, w: 100, h: round(third, 3)}, {x: 0, y: round(third, 3), w: 100, h: round(third, 3) + 0.001},
        {x: 0, y: round(2 * third, 3), w: 100, h: round(third, 3)}];
    }
    return null;
  }
  /** 人数对应的版式：2–3 人三行以内用 `rows`，4 人 `grid`，其余不分屏。 */
  const layoutFor = (n) => (n === 2 || n === 3 ? 'rows' : n === 4 ? 'grid' : null);
  /** 这组格子是哪种版式（读回来时用；认不出时 null）。 */
  function layoutOf(panels) {
    const n = (panels || []).length;
    const want = layoutFor(n);
    if (!want) return null;
    const rects = rectsFor(want, n);
    return rects.every((r, i) => sameRect(r, panels[i].rect)) ? want : null;
  }
  const sameRect = (a, b) => !!a && !!b && ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) < 0.01);

  /** 格子的宽高比：画面宽高比 × 格宽% ÷ 格高%。 */
  const cellRatio = (rect, outRatio) => (outRatio > 0 ? outRatio : 9 / 16) * rect.w / rect.h;

  /** 格子里原片的盒（单位是格子的比例：中心与宽高），同 BC_FRAMING.poseFor，只是「画面」换成这一格。 */
  function boxIn(focal, srcRatio, ratio) {
    const pose = F.poseFor(focal, srcRatio, ratio);
    return {x: pose.x / 100, y: pose.y / 100, w: pose.w / 100, h: pose.h / 100};
  }

  /** 这一格看得见原片的哪一块（源的比例：左、上、宽、高）。 */
  function windowOf(focal, srcRatio, ratio) {
    const b = boxIn(focal, srcRatio, ratio);
    const u = 1 / b.w, v = 1 / b.h;
    return {left: (b.w / 2 - b.x) / b.w, top: (b.h / 2 - b.y) / b.h, w: u, h: v};
  }

  /** 「要看见的源区域」（四边比例，同裁剪）→ 这一格的取景点：铺满之上放大到刚好装下区域，窗口以区域中心为中心，
      碰到原片边缘往里推。区域在放大 1 倍时都装不下时 `cropped` 为 true（区域中心对准，多出来的裁掉）。 */
  function regionToFocal(region, srcRatio, ratio) {
    const c = F.coverSize(srcRatio, ratio);
    const u1 = 1 / c.w, v1 = 1 / c.h;
    const l = clamp(+region.left || 0, 0, 1), t = clamp(+region.top || 0, 0, 1);
    const rw = Math.max(1e-3, 1 - l - clamp(+region.right || 0, 0, 1)), rh = Math.max(1e-3, 1 - t - clamp(+region.bottom || 0, 0, 1));
    const zoom = clamp(Math.min(u1 / rw, v1 / rh), 1, MAX_ZOOM);
    const u = u1 / zoom, v = v1 / zoom;
    const at = (start, size, kept) => (kept < 1 - 1e-9 ? clamp(start + size / 2 - kept / 2, 0, 1 - kept) / (1 - kept) : 0.5);
    return {focal: {x: round(at(l, rw, u), 4), y: round(at(t, rh, v), 4), zoom: round(zoom, 3)},
      cropped: rw > u1 + 1e-6 || rh > v1 + 1e-6};
  }

  /** 每一格的放大量：铺满这一格的缩放 × 放大倍数（像素）。`out` 是画面像素尺寸，`src` 是原片像素尺寸。 */
  function upscaleOf(panel, src, out) {
    const cw = out.width * panel.rect.w / 100, ch = out.height * panel.rect.h / 100;
    const s = Math.max(cw / src.width, ch / src.height);
    return s * F.zoomTo(panel.focal, panel.focal && panel.focal.zoom).focal.zoom;
  }

  /** 按镜头分段取景时一个多人全景镜头的格子：区域按中心横坐标从左到右排进版式（最左的人在最上面 / 左上）。 */
  function panelsFrom(regions, srcRatio, outRatio) {
    const list = (regions || []).slice().sort((a, b) => (a.left + (1 - a.right)) - (b.left + (1 - b.right)));
    const rects = rectsFor(layoutFor(list.length), list.length);
    if (!rects) return null;
    return rects.map((rect, i) => ({rect, focal: regionToFocal(list[i], srcRatio, cellRatio(rect, outRatio)).focal}));
  }

  /** 一人改分屏的默认格子：两格上下，上格取原片左半、下格取右半，放大 1.4（之后在格子里调）。 */
  function defaultPanels() {
    return rectsFor('rows', 2).map((rect, i) => ({rect, focal: {x: i ? 0.75 : 0.25, y: 0.4, zoom: 1.4}}));
  }

  /** 互换两格的人（格子不动，取景点对调）。只有两格时有意义。 */
  function swap(panels, a = 0, b = 1) {
    if (!panels || !panels[a] || !panels[b]) return panels;
    return panels.map((p, i) => (i === a ? {rect: p.rect, focal: panels[b].focal} : i === b ? {rect: p.rect, focal: panels[a].focal} : p));
  }

  /** 改一格的取景（放大与位置）；夹到 [0, 1] 与 [1, MAX_ZOOM]。 */
  function withFocal(panels, i, patch) {
    return panels.map((p, k) => {
      if (k !== i) return p;
      const f = Object.assign({}, p.focal, patch);
      return {rect: p.rect, focal: {x: round(clamp(+f.x, 0, 1), 4), y: round(clamp(+f.y, 0, 1), 4),
        zoom: round(clamp(+f.zoom || 1, 1, MAX_ZOOM), 3)}};
    });
  }

  /** 只留这一格的人：换成整幅一人的取景点，这个人仍落在原片里原来的横向位置（窗口中心对准这一格窗口的中心）。 */
  function soloFrom(panel, srcRatio, outRatio) {
    const w = windowOf(panel.focal, srcRatio, cellRatio(panel.rect, outRatio));
    const cx = w.left + w.w / 2;
    const c = F.coverSize(srcRatio, outRatio);
    const u = 1 / c.w;
    return {x: u < 1 - 1e-9 ? round(clamp(cx - u / 2, 0, 1 - u) / (1 - u), 4) : 0.5, y: 0.5, zoom: 1};
  }

  /** 把一段的格子取景套到另一段：格数相同才套，格子不动、各格的取景点照搬。 */
  function applyTo(from, to) {
    if (!from || !to || from.length !== to.length) return null;
    return to.map((p, i) => ({rect: p.rect, focal: Object.assign({}, from[i].focal)}));
  }

  /** 格子的叫法：两格、三格按上下，四格按左上、右上、左下、右下。 */
  function names(n) {
    if (n === 2) return ['上', '下'];
    if (n === 3) return ['上', '中', '下'];
    if (n === 4) return ['左上', '右上', '左下', '右下'];
    return [];
  }

  const COPY = {
    mode: (n) => `分屏 · ${n} 格`,
    section: '版式',
    single: '一人',
    split: '分屏',
    swap: '互换上下',
    solo: (name) => `只留${name}格的人`,
    zoom: '放大',
    posX: '左右位置',
    posY: '上下位置',
    applyAll: '套到整支',
    applyAllTip: '把这一段各格的放大与位置套到这支视频的其它分屏段 · 格数相同的才套，一人段不动',
    appliedAll: (n) => `已套到 ${n} 段分屏`,
    toSplit: '已改成分屏 · 上格取原片左半、下格取右半，在格子里调位置',
    toSingle: '已改成一人 · 回到这一段原来的取景',
    soloed: (name) => `已只留${name}格的人`,
    swapped: '已互换上下',
    whyTitle: '分屏怎么改',
    why: '剪成短视频时，原片切到几个人的全景、一个竖屏框装不下所有人，就把每个人各放一格。格子的位置是固定的，同一支里每个人始终在同一格。',
    how: '在一格里拖动可以挪这个人；放大、互换上下、换回一个人，在属性面板的「版式」里改。',
    dragTip: '拖动挪这一格里的人 · 只在这一格里挪',
    hit: {edge: '已经到原片边上了'},
    upscaled: '这一格放得太大，画面会发虚',
  };

  const api = {MAX_ZOOM, UPSCALE_WARN, rectsFor, layoutFor, layoutOf, sameRect, cellRatio, boxIn, windowOf, regionToFocal,
    upscaleOf, panelsFrom, defaultPanels, swap, withFocal, soloFrom, applyTo, names, COPY};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.BC_PANELS = api;
})();
