/* 选取覆盖层的几何：window.BC_REC_AREA（录屏界面重设计 §2：屏幕、窗口、区域三种选取与录制卡的位置；§3 控制条、§4 摄像头浮窗的位置）。
   只在 App 入口加载。原型把浏览器视口当作一块屏幕，单位是屏幕的点（= CSS 像素），读数也按点写。
   矩形一律 {x, y, w, h}，坐标相对所在的屏幕；bounds 是屏幕本身（{x: 0, y: 0, w, h}）。 */
(function () {
  const MIN = 150;          // 区域最小 150 × 150（§2）
  const EDGE_HANDLE_MIN = 80; // 边长不足 80 时不显示那条边中间的条形把手
  const CARD_GAP = 16;      // 录制卡在选区下方 16
  const RATIOS = [
    {id: 'free', label: '自由', v: 0},
    {id: '16:9', label: '16:9', v: 16 / 9},
    {id: '4:3', label: '4:3', v: 4 / 3},
    {id: '1:1', label: '1:1', v: 1},
    {id: '9:16', label: '9:16', v: 9 / 16},
  ];
  const ratioOf = (id) => (RATIOS.find((r) => r.id === id) || RATIOS[0]).v;

  const round = (r) => ({x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h)});
  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const contains = (r, p) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

  /** 把矩形整体挪回屏幕里（尺寸比屏幕大时先截到屏幕大小）。 */
  function clampRect(r, b) {
    const w = Math.min(r.w, b.w), h = Math.min(r.h, b.h);
    return {x: clampN(r.x, b.x, b.x + b.w - w), y: clampN(r.y, b.y, b.y + b.h - h), w, h};
  }

  /**
   * 从按下点 a 拖到 p 画出的选区：比例不是「自由」时高度跟着宽度走（拖的方向不变），并截在屏幕里。
   */
  function drawRect(a, p, ratioId, b) {
    const px = clampN(p.x, b.x, b.x + b.w), py = clampN(p.y, b.y, b.y + b.h);
    let w = Math.abs(px - a.x), h = Math.abs(py - a.y);
    const sx = px < a.x ? -1 : 1, sy = py < a.y ? -1 : 1;
    const k = ratioOf(ratioId);
    if (k) {
      /* 以拖得更远的一边为准，另一边按比例；超出屏幕时整体缩回来 */
      if (w / k >= h) h = w / k; else w = h * k;
      const maxW = sx > 0 ? b.x + b.w - a.x : a.x - b.x;
      const maxH = sy > 0 ? b.y + b.h - a.y : a.y - b.y;
      const f = Math.min(1, maxW / Math.max(w, 1e-6), maxH / Math.max(h, 1e-6));
      w *= f; h *= f;
    }
    return round({x: sx > 0 ? a.x : a.x - w, y: sy > 0 ? a.y : a.y - h, w, h});
  }

  /** 选区里拖动是移动：不出屏幕。 */
  const moveRect = (r, dx, dy, b) => round(clampRect({x: r.x + dx, y: r.y + dy, w: r.w, h: r.h}, b));

  /**
   * 拖把手改大小。handle 是 n / s / e / w / ne / nw / se / sw；对边（对角）固定不动。
   * 比例不是「自由」时：角把手按宽度定高，边把手改一边、另一边按比例并以中线为轴。不小于 1，不出屏幕。
   */
  function resizeRect(r, handle, dx, dy, ratioId, b) {
    let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
    if (handle.includes('w')) x0 = clampN(x0 + dx, b.x, x1 - 1);
    if (handle.includes('e')) x1 = clampN(x1 + dx, x0 + 1, b.x + b.w);
    if (handle.includes('n')) y0 = clampN(y0 + dy, b.y, y1 - 1);
    if (handle.includes('s')) y1 = clampN(y1 + dy, y0 + 1, b.y + b.h);
    const k = ratioOf(ratioId);
    if (!k) return round({x: x0, y: y0, w: x1 - x0, h: y1 - y0});
    let w = x1 - x0, h = y1 - y0;
    const horiz = handle === 'e' || handle === 'w';
    const vert = handle === 'n' || handle === 's';
    if (vert) w = h * k; else h = w / k;
    /* 锚点：对角或对边的中点 */
    const ax = handle.includes('w') ? x1 : handle.includes('e') ? x0 : r.x + r.w / 2;
    const ay = handle.includes('n') ? y1 : handle.includes('s') ? y0 : r.y + r.h / 2;
    const fit = (ww, hh) => {
      const maxW = horiz || handle.length === 2 ? (handle.includes('w') ? ax - b.x : b.x + b.w - ax) : 2 * Math.min(ax - b.x, b.x + b.w - ax);
      const maxH = vert || handle.length === 2 ? (handle.includes('n') ? ay - b.y : b.y + b.h - ay) : 2 * Math.min(ay - b.y, b.y + b.h - ay);
      const f = Math.min(1, maxW / ww, maxH / hh);
      return [ww * f, hh * f];
    };
    [w, h] = fit(w, h);
    const x = handle.includes('w') ? ax - w : handle.includes('e') ? ax : ax - w / 2;
    const y = handle.includes('n') ? ay - h : handle.includes('s') ? ay : ay - h / 2;
    return round({x, y, w, h});
  }

  /** 换比例：保持中心与宽度（放不下时缩），截在屏幕里。没有选区时什么也不做。 */
  function applyRatio(r, ratioId, b) {
    const k = ratioOf(ratioId);
    if (!r || !k) return r;
    let w = r.w, h = r.w / k;
    const f = Math.min(1, b.w / w, b.h / h);
    w *= f; h *= f;
    return round(clampRect({x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h}, b));
  }

  /** 方向键微移：一次 1，按住 Shift 一次 10。 */
  function nudge(r, key, shift, b) {
    const s = shift ? 10 : 1;
    const d = {ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s]}[key];
    return d ? moveRect(r, d[0], d[1], b) : r;
  }

  /** 太小：任一边不足 150，录制卡的开始不可用。 */
  const tooSmall = (r) => !!r && (r.w < MIN || r.h < MIN);
  /** 四边条形把手显示与否（边长不足 80 时不显示）：{n, s, e, w}。 */
  const edgeHandles = (r) => {
    const wide = r.w >= EDGE_HANDLE_MIN, tall = r.h >= EDGE_HANDLE_MIN;
    return {n: wide, s: wide, e: tall, w: tall};
  };
  /** 铺满屏幕。 */
  const fillScreen = (b) => ({x: b.x, y: b.y, w: b.w, h: b.h});
  /** 窗口贴合：把窗口的边界截在屏幕里。 */
  const fitWindow = (win, b) => {
    const x0 = Math.max(win.x, b.x), y0 = Math.max(win.y, b.y);
    const x1 = Math.min(win.x + win.w, b.x + b.w), y1 = Math.min(win.y + win.h, b.y + b.h);
    return round({x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0)});
  };

  /** 鼠标下最上面的那个窗口（windows 按从下到上的叠放次序排）。 */
  function windowAt(windows, p) {
    for (let i = windows.length - 1; i >= 0; i--) if (contains(windows[i], p)) return windows[i];
    return null;
  }

  /**
   * 区域模式录制卡的位置（§2）：选区下方 16；放不下放上方；都放不下放选区内靠上。水平方向与选区居中，不出屏幕。
   * 返回 {x, y, where: 'below' | 'above' | 'inside'}。
   */
  function cardPlacement(sel, b, card) {
    const x = clampN(sel.x + sel.w / 2 - card.w / 2, b.x + 8, b.x + b.w - card.w - 8);
    if (sel.y + sel.h + CARD_GAP + card.h <= b.y + b.h) return {x: Math.round(x), y: sel.y + sel.h + CARD_GAP, where: 'below'};
    if (sel.y - CARD_GAP - card.h >= b.y) return {x: Math.round(x), y: sel.y - CARD_GAP - card.h, where: 'above'};
    return {x: Math.round(x), y: Math.max(b.y, sel.y) + CARD_GAP, where: 'inside'};
  }

  /** 读数「宽 × 高」。 */
  const sizeText = (r) => `${Math.round(r.w)} × ${Math.round(r.h)}`;

  /* ---------- 控制条与摄像头浮窗的位置（§3、§4） ---------- */

  const BAR = {w: 320, h: 64, hAlert: 150};
  /**
   * 控制条小窗的缺省位置：录屏幕 / 区域时在那块屏幕底部居中、向上 120；录窗口时在窗口下边缘居中、向上 48。
   * 截在屏幕里。返回小窗左上角。
   */
  function barPlacement(kind, target, b, h) {
    const hh = h || BAR.h;
    const ref = kind === 'window' && target ? target : b;
    const up = kind === 'window' && target ? 48 : 120;
    const x = clampN(ref.x + ref.w / 2 - BAR.w / 2, b.x, b.x + b.w - BAR.w);
    const y = clampN(ref.y + ref.h - up - hh, b.y, b.y + b.h - hh);
    return {x: Math.round(x), y: Math.round(y)};
  }

  const CAMERA = {size: 230, big: 400, min: 150, max: 600, margin: 100};
  const SHAPES = ['round', 'square', 'wide'];
  const nextShape = (s) => SHAPES[(SHAPES.indexOf(s) + 1) % SHAPES.length];
  /** 摄像头浮窗的尺寸：圆与方是 size × size，宽屏 16:9 时宽是 size。 */
  const cameraBox = (size, shape) => (shape === 'wide' ? {w: size, h: Math.round(size * 9 / 16)} : {w: size, h: size});
  /** 大小按钮：230 ↔ 400（不在这两档时回到 230）。 */
  const toggleCameraSize = (size) => (size === CAMERA.size ? CAMERA.big : CAMERA.size);
  /** 拖角缩放：按拖得更远的方向改 size，限 150–600。corner 是 nw / ne / sw / se。 */
  function resizeCamera(size, corner, dx, dy) {
    const sx = corner.includes('w') ? -dx : dx, sy = corner.includes('n') ? -dy : dy;
    const d = Math.abs(sx) >= Math.abs(sy) ? sx : sy;
    return Math.round(clampN(size + d, CAMERA.min, CAMERA.max));
  }
  /** 缺省位置：屏幕右下、距两边 100；记住的位置截回屏幕里。 */
  function cameraPlacement(saved, box, b) {
    if (saved) return {x: clampN(saved.x, b.x, b.x + b.w - box.w), y: clampN(saved.y, b.y, b.y + b.h - box.h)};
    return {x: Math.max(b.x, b.x + b.w - CAMERA.margin - box.w), y: Math.max(b.y, b.y + b.h - CAMERA.margin - box.h)};
  }

  window.BC_REC_AREA = {
    MIN, EDGE_HANDLE_MIN, CARD_GAP, RATIOS, ratioOf, clampRect, drawRect, moveRect, resizeRect, applyRatio, nudge,
    tooSmall, edgeHandles, fillScreen, fitWindow, windowAt, cardPlacement, sizeText,
    BAR, barPlacement, CAMERA, SHAPES, nextShape, cameraBox, toggleCameraSize, resizeCamera, cameraPlacement,
  };
})();
