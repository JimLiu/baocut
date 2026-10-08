/* model-geometry.js —— 元素几何面板：位置 · 大小 · 九宫钉点。
   逐函数镜像 `core/crates/bcut-editor-core/src/geometry_panel.rs`（设计稿
   `docs/design/elements/bcut-element-geometry-panel-design.md`），数字对拍见 model-geometry.test.js。

   面板是**投影**，不是真相：落盘仍是模板层 `box{x,y,w,h}`（左上制）与元素
   `pose{x,y,w,scaleY}`（中心制）。两种宿主先换成同一个画布盒 `{l,t,w,h}`（画布 %、左上原点），
   再按钉点投成面板四个数 X / Y / W / H：

     X = l        钉左    X = (l + w/2) − 50  钉中（0 = 居中）    X = 100 − (l + w)  钉右
     Y = t        钉顶    Y = (t + h/2) − 50  钉中               Y = 100 − (t + h)  钉底

   只在用户提交某个字段时反投影；没被改的轴沿用未取整的原值，所以打开面板、切钉点都不漂。
   钉点不落盘，会话内记忆，首次取 defaultPin。 */
(function () {
  const EPS = 1e-9;
  const ELEMENT_MIN_W = 2;
  const ELEMENT_MIN_PX = 10;
  const PIN_X = ['left', 'center', 'right'];
  const PIN_Y = ['top', 'middle', 'bottom'];

  /* Rust 的 f64::round 远离零取整；JS 的 Math.round 往 +∞，负半数会差一格 */
  const rnd = (v, k) => {
    const r = Math.sign(v) * Math.round(Math.abs(v) * k) / k;
    return r === 0 ? 0 : r;
  };
  const r1 = (v) => rnd(v, 10);
  const r3 = (v) => rnd(v, 1000);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const pin = (x, y) => ({x, y});
  /** 九格，行优先：grid()[row*3 + col]。 */
  const grid = () => PIN_Y.flatMap((y) => PIN_X.map((x) => pin(x, y)));
  const samePin = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
  const sx = (p) => (p === 'left' ? -1 : p === 'right' ? 1 : 0);
  const sy = (p) => (p === 'top' ? -1 : p === 'bottom' ? 1 : 0);

  function axisProject(start, size, s) {
    if (s < 0) return start;
    if (s > 0) return 100 - (start + size);
    return start + size / 2 - 50;
  }
  function axisUnproject(v, size, s) {
    if (s < 0) return v;
    if (s > 0) return 100 - size - v;
    return v + 50 - size / 2;
  }

  const projectRaw = (b, p) => ({x: axisProject(b.l, b.w, sx(p.x)), y: axisProject(b.t, b.h, sy(p.y)), w: b.w, h: b.h});
  function project(b, p) {
    const v = projectRaw(b, p);
    return {x: r1(v.x), y: r1(v.y), w: r1(v.w), h: r1(v.h)};
  }
  const unproject = (v, p) => ({l: axisUnproject(v.x, v.w, sx(p.x)), t: axisUnproject(v.y, v.h, sy(p.y)), w: v.w, h: v.h});

  /** 离哪条线（起边 / 中线 / 终边）最近；平手取靠前的（左 / 顶）。 */
  function nearest(start, size) {
    const d = [Math.abs(start), Math.abs(start + size / 2 - 50), Math.abs(100 - start - size)];
    let best = 0;
    for (let i = 1; i < 3; i += 1) if (d[i] < d[best] - EPS) best = i;
    return best;
  }
  const defaultPin = (b) => pin(PIN_X[nearest(b.l, b.w)], PIN_Y[nearest(b.t, b.h)]);

  /** 快捷动作 → 新钉点 + 目标面板值。action: 'snapToPin' | 'fullWidth' | 'fullHeight'。 */
  function quick(p, values, action) {
    if (action === 'fullWidth') return {pin: pin('left', p.y), values: Object.assign({}, values, {x: 0, w: 100})};
    if (action === 'fullHeight') return {pin: pin(p.x, 'top'), values: Object.assign({}, values, {y: 0, h: 100})};
    return {pin: p, values: Object.assign({}, values, {x: 0, y: 0})};
  }
  const repin = (b, p) => project(b, p);
  const changed = (target, shown) => Math.abs(target - shown) > EPS;

  /* ---------- 模板层 ---------- */
  const MIN_W = 4, MIN_H = 0.6;
  function clampBox(b) {
    const w = r1(clamp(b.w, MIN_W, 100));
    const h = r1(clamp(b.h, MIN_H, 100));
    return {x: r1(clamp(b.x, 0, 100 - w)), y: r1(clamp(b.y, 0, 100 - h)), w, h};
  }
  const layerBox = (b) => ({l: b.x, t: b.y, w: b.w, h: b.h});
  const layerFrom = (c) => clampBox({x: c.l, y: c.t, w: c.w, h: c.h});

  function layerApply(b0, p, target, lockRatio) {
    const cur = layerBox(b0);
    const shown = project(cur, p);
    const raw = projectRaw(cur, p);
    const dx = changed(target.x, shown.x), dy = changed(target.y, shown.y);
    const dw = changed(target.w, shown.w), dh = changed(target.h, shown.h);
    let w = dw ? target.w : cur.w;
    let h = dh ? target.h : cur.h;
    if (lockRatio && cur.w > 0 && cur.h > 0) {
      if (dw && !dh) h = cur.h * w / cur.w;
      else if (dh && !dw) w = cur.w * h / cur.h;
    }
    w = clamp(w, MIN_W, 100);
    h = clamp(h, MIN_H, 100);
    const l = dx || changed(w, cur.w) ? axisUnproject(dx ? target.x : raw.x, w, sx(p.x)) : cur.l;
    const t = dy || changed(h, cur.h) ? axisUnproject(dy ? target.y : raw.y, h, sy(p.y)) : cur.t;
    return layerFrom({l, t, w, h});
  }

  const layerSnapBox = (b, f) => ({x: b.x / 100 * f.w, y: b.y / 100 * f.h, w: b.w / 100 * f.w, h: b.h / 100 * f.h});
  const pose = () => window.BC_POSE;

  /** 版面编辑器拖动吸附：与元素同一套 BC_POSE.snapMove；on = false（⌥）不吸。
      返回 {box, guides:[{v, p}]}，p 是帧内像素。 */
  function snapLayerMove(moved, others, frame, on) {
    if (!(frame.w > 0 && frame.h > 0)) return {box: clampBox(moved), guides: []};
    const snaps = others.map((o) => layerSnapBox(o, frame));
    const out = pose().snapMove(layerSnapBox(moved, frame), frame, snaps, on);
    return {
      box: clampBox(Object.assign({}, moved, {x: moved.x + out.dx / frame.w * 100, y: moved.y + out.dy / frame.h * 100})),
      guides: out.guides,
    };
  }
  /** 此刻应画的导引线：容差吸收一位小数的取整。 */
  function layerGuides(b, others, frame) {
    const snaps = others.map((o) => layerSnapBox(o, frame));
    const tol = Math.max(0.06 / 100 * Math.max(frame.w, frame.h), 0.5);
    return pose().guidesFor(layerSnapBox(b, frame), frame, snaps, tol);
  }

  /* ---------- 元素 ---------- */
  const pinYFromVerticalAlign = (v) => (v === 'top' ? 'top' : v === 'bottom' ? 'bottom' : 'middle');
  const verticalAlignFor = (py) => (py === 'top' ? 'top' : py === 'bottom' ? 'bottom' : null);
  const topFromAnchor = (a, h, va) => (va === 'top' ? a : va === 'bottom' ? a - h : a - h / 2);
  const anchorFromTop = (t, h, va) => (va === 'top' ? t : va === 'bottom' ? t + h : t + h / 2);

  /** g = {x, y, boxW, boxH, frameW, frameH, placeW, scaleY = 1, valign = 'middle', heightTracksWidth = false}。 */
  function norm(g) {
    return Object.assign({scaleY: 1, valign: 'middle', heightTracksWidth: false}, g);
  }
  function elementBox(g0) {
    const g = norm(g0);
    const fw = Math.max(g.frameW, EPS), fh = Math.max(g.frameH, EPS);
    const w = g.boxW / fw * 100, h = g.boxH / fh * 100;
    return {l: g.x - w / 2, t: topFromAnchor(g.y, h, g.valign), w, h};
  }

  /** 写回 {x, y, w: place.w, scaleY}。limits = {x:[lo,hi], y:[lo,hi]}，缺省 = 允许出框。 */
  function elementApply(g0, p, target, lockRatio, limits) {
    const g = norm(g0);
    const cur = elementBox(g);
    const shown = project(cur, p);
    const raw = projectRaw(cur, p);
    const dx = changed(target.x, shown.x), dy = changed(target.y, shown.y);
    const dw = changed(target.w, shown.w), dh = changed(target.h, shown.h);
    const minW = Math.max(ELEMENT_MIN_W, ELEMENT_MIN_PX / Math.max(g.frameW, EPS) * 100);
    let w = dw ? Math.max(target.w, minW) : cur.w;
    if (lockRatio && dh && !dw && cur.h > 0) w = Math.max(cur.w * target.h / cur.h, minW);
    const fw = cur.w > 0 ? w / cur.w : 1;
    const naturalH = g.heightTracksWidth ? cur.h * fw : cur.h;
    const h = dh ? Math.max(target.h, 0.1) : (lockRatio && dw ? cur.h * fw : naturalH);
    const placeW = changed(fw, 1) ? r1(g.placeW * fw) : g.placeW;
    const scaleY = naturalH > 0 && changed(h, naturalH) ? r3(g.scaleY * h / naturalH) : g.scaleY;
    let x = dx || changed(w, cur.w) ? r1(axisUnproject(dx ? target.x : raw.x, w, sx(p.x)) + w / 2) : g.x;
    let y = dy || changed(h, cur.h)
      ? r1(anchorFromTop(axisUnproject(dy ? target.y : raw.y, h, sy(p.y)), h, g.valign)) : g.y;
    if (limits) {
      x = clamp(x, limits.x[0], limits.x[1]);
      y = clamp(y, limits.y[0], limits.y[1]);
    }
    return {x, y, w: placeW, scaleY};
  }

  /** 文本换纵向钉点（= 改 verticalAlign）时新的 place.y：画面不动。 */
  function retargetVerticalAlign(g0, next) {
    const g = norm(g0);
    if (next === g.valign) return g.y;
    const b = elementBox(g);
    return r1(anchorFromTop(b.t, b.h, next));
  }

  /* ---------- 面板文案 ---------- */
  const X_LABEL = {left: '距左', center: '横向偏移', right: '距右'};
  const Y_LABEL = {top: '距顶', middle: '纵向偏移', bottom: '距底'};
  const PIN_NAMES = {
    'left top': '左上角', 'center top': '顶边中点', 'right top': '右上角',
    'left middle': '左边中点', 'center middle': '正中', 'right middle': '右边中点',
    'left bottom': '左下角', 'center bottom': '底边中点', 'right bottom': '右下角',
  };
  const pinTip = (p) => PIN_NAMES[p.x + ' ' + p.y];

  Object.assign(window, {BC_GEOM: {
    EPS, ELEMENT_MIN_W, ELEMENT_MIN_PX, PIN_X, PIN_Y, X_LABEL, Y_LABEL,
    r1, r3, pin, grid, samePin, pinTip,
    project, projectRaw, unproject, defaultPin, quick, repin,
    layerBox, layerFrom, layerApply, layerSnapBox, snapLayerMove, layerGuides,
    pinYFromVerticalAlign, verticalAlignFor, elementBox, elementApply, retargetVerticalAlign,
  }});
})();
