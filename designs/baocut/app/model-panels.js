/* 分屏同框的纯模型（docs/design/shorts-framing §3–§4、§8）：版式与间距 → 格子，格子里的取景点 → 原片在格子里的盒，
   「要看见的源区域」→ 这一格的取景点与放大，换版式、互换、放到上格、只留一人、在一格里缩放、一人改分屏的默认格子，
   字幕的接缝，以及画布与属性面板的文案。
   不碰 DOM、不依赖 React；node --test 直接 require。

   元素文档的 `panels: [{rect: {x, y, w, h}, focal: {x, y, zoom}}]`：`rect` 是画面的百分比（左上角与宽高），`focal` 与
   BC_FRAMING 的取景点同义，只是「刚好铺满」指铺满这一格。有 `panels` 时视频按格子画，元素自己的 `focal` 不参与，
   去掉 `panels` 时回到它。对应视频格式的 `VideoItem.panels`。 */
(function () {
  const F = typeof window !== 'undefined' && window.BC_FRAMING ? window.BC_FRAMING
    : (typeof require === 'function' ? require('./model-framing.js') : null);
  const MAX_ZOOM = F ? F.MAX_ZOOM : 4;
  /* 格子间距的上限（画布短边的百分比）。 */
  const GAP_MAX = 10;
  /* 每一格的放大量（成片一个像素对原片几个像素）超过它就提醒发虚。 */
  const UPSCALE_WARN = 2.5;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const round = (v, d) => { const k = Math.pow(10, d); return Math.round(v * k) / k; };

  /** 间距（画布短边的百分比）在横、竖两个方向上各占画面宽、高的几个百分点：横缝竖缝像素相同。`outRatio` 是画面宽 ÷ 高。 */
  function gapPercents(gap, outRatio) {
    const g = clamp(+gap || 0, 0, GAP_MAX), r = outRatio > 0 ? outRatio : 9 / 16;
    return r <= 1 ? {gx: g, gy: g * r} : {gx: g / r, gy: g};
  }
  /** 一条边（`[0, 100]`）切成 `n` 段、段间留 `g`：每段的起点与长度。起点取三位小数，终点是倒过来那一段起点的镜像，
      所以前后对称、最后一段收在 100（三行不留间距是 33.333 / 33.334 / 33.333）。 */
  function cuts(n, g) {
    const step = (100 - (n - 1) * g) / n + g;
    return Array.from({length: n}, (_, i) => {
      const a = round(i * step, 3), b = round(100 - round((n - 1 - i) * step, 3), 3);
      return {at: a, len: round(b - a, 3)};
    });
  }

  /** 版式的格子（画面百分比）。`rows` 2–3 行整宽，`grid` 田字格，`spotlight` 上一下二（上格整宽，下面左右两格）；
      `gap` 是格子之间的间距（画布短边的百分比，0–10），`outRatio` 是画面宽高比（留间距时才用得上）。格数不对时 null。 */
  function rectsFor(layout, n, gap, outRatio) {
    const {gx, gy} = gapPercents(gap, outRatio);
    if (layout === 'grid' && n === 4) {
      const xs = cuts(2, gx), ys = cuts(2, gy);
      return [0, 1, 2, 3].map((i) => ({x: xs[i % 2].at, y: ys[i >> 1].at, w: xs[i % 2].len, h: ys[i >> 1].len}));
    }
    if (layout === 'rows' && (n === 2 || n === 3)) return cuts(n, gy).map((c) => ({x: 0, y: c.at, w: 100, h: c.len}));
    if (layout === 'spotlight' && n === 3) {
      const xs = cuts(2, gx), ys = cuts(2, gy);
      return [{x: 0, y: 0, w: 100, h: ys[0].len}].concat(xs.map((c) => ({x: c.at, y: ys[1].at, w: c.len, h: ys[1].len})));
    }
    return null;
  }
  /** 人数对应的缺省版式：2–3 人 `rows`，4 人 `grid`，其余不分屏。 */
  const layoutFor = (n) => (n === 2 || n === 3 ? 'rows' : n === 4 ? 'grid' : null);
  /** 这么多格时能选的版式（属性面板「格子」那一行）：三格多一个「上一下二」。 */
  const layoutsFor = (n) => (n === 3 ? ['rows', 'spotlight'] : layoutFor(n) ? [layoutFor(n)] : []);
  /** 这组格子是哪种版式、留了多少间距（读回来时用）：按第一条缝量出间距，再与那种版式的格子逐格比；认不出时 null。 */
  function layoutOf(panels, outRatio) {
    const n = (panels || []).length;
    if (!n) return null;
    const r = outRatio > 0 ? outRatio : 9 / 16;
    for (const layout of layoutsFor(n)) {
      const a = panels[0].rect, b = panels[1].rect;
      const unit = gapPercents(1, r);
      const gap = layout === 'grid' ? (b.x - (a.x + a.w)) / unit.gx : (b.y - (a.y + a.h)) / unit.gy;
      const g = round(clamp(gap, 0, GAP_MAX), 2);
      const rects = rectsFor(layout, n, g, r);
      if (rects && rects.every((x, i) => sameRect(x, panels[i].rect))) return {layout, gap: g};
    }
    return null;
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

  /** 按镜头分段取景时一个多人全景镜头的格子：区域按中心横坐标从左到右排进版式（最左的人在最上面 / 左上）。
      `opts.layout` 缺省按人数；`spotlight` 时 `opts.main`（`regions` 里的下标）放上格，其余按左右进下面两格；`opts.gap` 是间距。 */
  function panelsFrom(regions, srcRatio, outRatio, opts) {
    const o = opts || {};
    const all = regions || [];
    const layout = o.layout || layoutFor(all.length);
    const byX = (list) => list.slice().sort((a, b) => (a.left + (1 - a.right)) - (b.left + (1 - b.right)));
    const list = layout === 'spotlight' && all[o.main] ? [all[o.main]].concat(byX(all.filter((_, i) => i !== o.main))) : byX(all);
    const rects = rectsFor(layout, list.length, o.gap, outRatio);
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

  /* ---------- 换格子：保留每格看得见的那块原片 ---------- */

  /** 一格看得见的那块原片：中心与高（源的比例）。 */
  function viewOf(panel, srcRatio, outRatio) {
    const w = windowOf(panel.focal, srcRatio, cellRatio(panel.rect, outRatio));
    return {cx: w.left + w.w / 2, cy: w.top + w.h / 2, h: w.h};
  }
  /** 让新格子 `rect` 看得见以 `view.cx, cy` 为中心、高 `view.h` 的那块原片：放大夹在 [1, MAX_ZOOM]，碰到原片边往里推。 */
  function focalFor(view, rect, srcRatio, outRatio) {
    const c = F.coverSize(srcRatio, cellRatio(rect, outRatio));
    const u1 = 1 / c.w, v1 = 1 / c.h;
    const zoom = clamp(v1 / view.h, 1, MAX_ZOOM);
    const u = u1 / zoom, v = v1 / zoom;
    const at = (center, kept) => (kept < 1 - 1e-9 ? clamp(center - kept / 2, 0, 1 - kept) / (1 - kept) : 0.5);
    return {x: round(at(view.cx, u), 4), y: round(at(view.cy, v), 4), zoom: round(zoom, 3)};
  }
  /** 换成另一组格子（换版式、改间距）：第 i 格的人进新的第 i 格，各自保留看得见的那块原片的中心与高。 */
  function relayout(panels, rects, srcRatio, outRatio) {
    if (!panels || !rects || rects.length !== panels.length) return panels;
    return panels.map((p, i) => ({rect: rects[i], focal: focalFor(viewOf(p, srcRatio, outRatio), rects[i], srcRatio, outRatio)}));
  }
  /** 两格的人对调，各自保留看得见的那块原片（上一下二的「放到上格」：格子宽高比不同，不能直接换取景点）。 */
  function swapViews(panels, a, b, srcRatio, outRatio) {
    if (!panels || !panels[a] || !panels[b]) return panels;
    const va = viewOf(panels[a], srcRatio, outRatio), vb = viewOf(panels[b], srcRatio, outRatio);
    return panels.map((p, i) => (i === a ? {rect: p.rect, focal: focalFor(vb, p.rect, srcRatio, outRatio)}
      : i === b ? {rect: p.rect, focal: focalFor(va, p.rect, srcRatio, outRatio)} : p));
  }

  /** 在一格里缩放（滚轮、捏合）：`factor` 是放大的倍数，`at` 是指针在这一格里的位置（0–1）。指针下那一点对着的原片位置
      不动，放大夹在 [1, MAX_ZOOM]，碰到原片边往里推。`hit` 说碰到了什么：'max' / 'min' / 'edge'，没碰到时 null。 */
  function zoomAt(panels, i, factor, at, srcRatio, outRatio) {
    const p = panels && panels[i];
    if (!p) return {panels, hit: null};
    const ratio = cellRatio(p.rect, outRatio);
    const w = windowOf(p.focal, srcRatio, ratio);
    const z0 = clamp(+p.focal.zoom || 1, 1, MAX_ZOOM);
    const want = z0 * factor;
    const zoom = clamp(want, 1, MAX_ZOOM);
    let hit = want > MAX_ZOOM + 1e-9 ? 'max' : want < 1 - 1e-9 ? 'min' : null;
    const sx = w.left + at.x * w.w, sy = w.top + at.y * w.h;
    const u = w.w * z0 / zoom, v = w.h * z0 / zoom;
    const along = (s, f, kept) => {
      if (kept >= 1 - 1e-9) return 0.5;
      const left = s - f * kept, next = clamp(left, 0, 1 - kept);
      if (Math.abs(left - next) > 1e-4 && !hit) hit = 'edge';
      return next / (1 - kept);
    };
    const focal = {x: round(along(sx, at.x, u), 4), y: round(along(sy, at.y, v), 4), zoom: round(zoom, 3)};
    return {panels: panels.map((q, k) => (k === i ? {rect: q.rect, focal} : q)), hit};
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

  /** 把一段的格子套到另一段：格数相同才套，格子（版式与间距）与各格的取景点照搬。 */
  function applyTo(from, to) {
    if (!from || !to || from.length !== to.length) return null;
    return from.map((p) => ({rect: Object.assign({}, p.rect), focal: Object.assign({}, p.focal)}));
  }

  /** 格子的叫法：两格、三行按上下，上一下二是上、左下、右下，四格按左上、右上、左下、右下。 */
  function names(n, layout) {
    if (n === 2) return ['上', '下'];
    if (n === 3) return layout === 'spotlight' ? ['上', '左下', '右下'] : ['上', '中', '下'];
    if (n === 4) return ['左上', '右上', '左下', '右下'];
    return [];
  }

  /* ---------- 分屏段字幕挂到接缝（视频格式规范 §5.6，短视频分屏设计 §7） ---------- */

  const TOUCH = 0.05;
  /* 隔着的缝不到这么高（画面高的百分比）时仍算接缝，接缝取缝的中线。 */
  const SEAM_GAP_MAX = 10;
  /** 格子之间的横向接缝（画面高的百分比，升序）：一格的下边与另一格的上边相接、或隔着不到 `SEAM_GAP_MAX` 的缝，两格横向
   *  有重叠的地方；隔着缝时取缝的中线。上下两格与田字格是 50，三行是 33.333 / 66.667；左右并排的两格没有。 */
  function seams(panels) {
    const out = [];
    (panels || []).forEach(({rect: a}) => {
      const edge = a.y + a.h;
      if (edge <= TOUCH || edge >= 100 - TOUCH) return;
      const below = panels.filter(({rect: b}) => b.y - edge >= -TOUCH && b.y - edge <= SEAM_GAP_MAX
        && b.x < a.x + a.w - TOUCH && a.x < b.x + b.w - TOUCH).map(({rect: b}) => b.y);
      if (!below.length) return;
      const seam = round((edge + Math.max(edge, Math.min(...below))) / 2, 3);
      if (!out.some((s) => Math.abs(s - seam) <= TOUCH)) out.push(seam);
    });
    return out.sort((x, y) => x - y);
  }

  /** 画面上分屏视频的时间段 `[{start, end, seams}]`：`elements` 里没隐藏、元素文档带 `panels` 的视频，时间段先取文档的。 */
  function spansOf(elements, elDocs, dur) {
    return (elements || []).flatMap((e) => {
      const d = (elDocs || {})[e.id] || {};
      if (e.kind !== 'video' || d.hidden || !d.panels || !d.panels.length) return [];
      const start = d.start == null ? (e.start || 0) : d.start;
      const end = d.end == null ? (e.end == null ? dur : e.end) : d.end;
      const s = seams(d.panels);
      return s.length ? [{start, end, seams: s}] : [];
    });
  }

  /** 这一刻（`t`）画面上离 `y` 最近的接缝；这一刻不是分屏时 null。 */
  function seamFor(spans, t, y) {
    const span = (spans || []).find((s) => s.start <= t && t < s.end);
    if (!span) return null;
    return span.seams.reduce((best, s) => (best == null || Math.abs(s - y) < Math.abs(best - y) ? s : best), null);
  }

  /** 一句字幕挂到接缝时各轨锚线的平移量：`on` 是样式的 `panelSeam !== false`，`start` 是这一句自己的开始（不含提前显示），
   *  `lines` 是这一句在画的各轨 `{y, ownY}`（`ownY`：这一句的逐条覆盖自己写了 `y`，不挪）。开始的那一刻是分屏时，整块
   *  （各轨锚线的中点）平移到离它最近的接缝上，各轨按中线对齐；否则 null。原型各轨各自摆，拿锚线的中点代替块的中线。 */
  function captionSeam(spans, on, start, lines) {
    if (!on || !lines.length || lines.some((l) => l.ownY)) return null;
    const ys = lines.map((l) => (l.y == null ? 86 : l.y));
    const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
    const seam = seamFor(spans, start, mid);
    return seam == null ? null : round(seam - mid, 3);
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
    applyAllTip: '把这一段的格子（版式、间距与各格的放大与位置）套到这支视频的其它分屏段 · 格数相同的才套，一人段不动',
    appliedAll: (n) => `已套到 ${n} 段分屏`,
    toSplit: '已改成分屏 · 上格取原片左半、下格取右半，在格子里调位置',
    toSingle: '已改成一人 · 回到这一段原来的取景',
    soloed: (name) => `已只留${name}格的人`,
    swapped: '已互换上下',
    whyTitle: '分屏怎么改',
    why: '剪成短视频时，原片切到几个人的全景、一个竖屏框装不下所有人，就把每个人各放一格。格子的位置是固定的，同一支里每个人始终在同一格。',
    how: '在一格里拖动可以挪这个人，滚轮或捏合放大缩小；格子、间距、互换、换回一个人，在属性面板的「版式」里改。',
    dragTip: '拖动挪这一格里的人 · 滚轮或捏合缩放这一格',
    hit: {edge: '已经到原片边上了', max: '最多放大到 4 倍', min: '最小是铺满这一格'},
    grid: '格子',
    layouts: {rows: '三行', spotlight: '上一下二'},
    gap: '间距',
    toTop: (name) => `${name}格放到上格`,
    movedTop: (name) => `已把${name}格的人放到上格`,
    /* 字幕属性「位置」段的一行（行名用 `split`） */
    seam: '挂到两格的接缝上',
    upscaled: '这一格放得太大，画面会发虚',
  };

  const api = {MAX_ZOOM, GAP_MAX, UPSCALE_WARN, gapPercents, rectsFor, layoutFor, layoutsFor, layoutOf, sameRect, cellRatio, boxIn,
    windowOf, regionToFocal, upscaleOf, panelsFrom, defaultPanels, swap, viewOf, relayout, swapViews, zoomAt, withFocal, soloFrom,
    applyTo, names, seams, spansOf, seamFor, captionSeam, COPY};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.BC_PANELS = api;
})();
