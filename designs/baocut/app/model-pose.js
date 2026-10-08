/* 画布元素的 pose 与手势 math —— §14.2。
   ============================================================================
   这一份是 `apps/baocut` 已落地那两支的纯层孪生，不另造数：
     · `src/adapters/stage_drag.rs` —— 百分比空间的移动、±1.5% 中线吸附、限位夹取、
       四角**对角锚定**等比缩放、竖胶囊宽度（投影到旋转后的 x 轴、双倍计入）；
     · `src/adapters/stage_snap.rs` —— 帧像素空间的 6px 多线吸附（画布中线/四边 ＋
       其它元素的边与中线）、导引线、15° 旋转栅格。
   两支**并存不合并**（App v2 的模块头写明了理由：坐标系、阈值口径与输出形状都不同），
   移动时的顺序也照抄：先百分比中心吸附 ＋ 限位，再叠 6px 多线吸附。

   为什么要有这一份：原型此前四角与胶囊是**点一下走一档**（±10% / ±40px），旋转虽然
   是真拖拽却存在组件的 local state 里——重新选中就归零，属性页的「旋转（度）」也读不到；
   而元素根本不能移动。手柄的形状画对了，语义一个都没落地。

   pose 的字段名与核心 `bcut-timeline` 的 `place` 一致：`x` / `y`（中心百分比）、
   `w`（画幅宽百分比）、`scale`、`rot`。写进文档的百分比一律 `round1`。
   ============================================================================ */
(function () {
  /* §5：吸附阈值 6px（帧内像素）。*/
  const SNAP_PX = 6;
  /* Mac `StageDragGeometry.snapDistance`：百分比空间的中心吸附半径。*/
  const CENTER_SNAP = 1.5;
  /* §5：旋转把手的角度栅格（按住 ⇧ 自由）。*/
  const ROT_STEP = 15;
  /* 起手死区（Mac `SubtitleObjectView.mouseDragged`：|dx|、|dy| 均 < 2 不算）。*/
  const DEAD_ZONE = 2;
  /* 导引线的重合判据：写进文档的是 round1 之后的百分比，880px 宽的帧上 0.1%
     就是 0.88px——用 1e-6 会让刚吸上的线一根都画不出来。*/
  const GUIDE_TOL = 1;
  const SCALE_MIN = 0.1;
  const SCALE_MAX = 5;
  /* 宽度柄的下限（App v2 `render_element_handles` 的 `width_min_percent`）。*/
  const MIN_W = 2;
  /* 缩放的像素下限：宽高都不小于 10px。*/
  const MIN_PX = 10;
  /* 「小盒」判据：任一边小于这个数就换成退化把手集。BaoCut 的窄窗口舞台只有
     三四百像素宽，一条标题量出来只有三十来像素高，若按 40 会把四角圆钮与两侧胶囊
     一起收掉（第 190 轮，用户回报「选择框没有缩放框」）；三个表面统一收到 24
     （核心 `stage_objects::SMALL_SET` / Web 同名常量）。
     样式那一档的判据是**另一个数**（宽 < 50 或高 < 40）——两处本来就是不同口径，
     不要合成一个。*/
  const SMALL_SET = 24;
  const SMALL_STYLE_W = 50;
  const SMALL_STYLE_H = 40;
  /* 「填满画布」允许长出画面外（长边被裁掉才叫填满），所以它的上限不是 100。
     400 是个止损值：一条又窄又高的元素填满 16:9 也就到这一档。*/
  const FIT_MAX_W = 400;

  /* 没写过摆位的元素从这里起步（画面、工具条菜单、属性页读的都是这一份，
     第 85 轮收成一处——此前只有 `stage.jsx` 里那一行有，菜单里拿到的是个空袋子）。*/
  const POSE0 = {x: 50, y: 50, w: 20, scale: 1, rot: 0};
  /* `CLIP_POSE0` 已退役（2026-09-16）：没有主视频 clip，项目原片是普通 `video` 元素，
     它的整幅摆位写在元素自己的 `place` 上（`BC_VIDEO_EDIT.initial`）。 */
  const poseOf = (doc) => Object.assign({}, POSE0, doc && doc.pose);

  /* 限位（Mac `StageFrameObjects` 与 `BrollItemView.mouseDragged`）。*/
  const TEXT_LIMITS = {x: [3, 97], y: [4, 96]};
  const BROLL_LIMITS = {x: [6, 94], y: [6, 94]};
  /* 视频（项目原片 / B-roll，都是普通视频元素）靠舞台裁剪取景：限位跟着盒子走，允许大半出画，只留一条
     min(盒边, 10%) 的可见带（核心 `stage_drag::media_limits`）。9:16 视频铺满 16:9 舞台
     宽时盒高约 316%，底边对齐的中心在 y≈-58%，固定限位根本够不着。*/
  const KEEP_VISIBLE = 10;
  /** 盒尺寸（帧像素）→ 中心限位（帧百分比）。零尺寸画面回退整幅 0…100。 */
  function mediaLimits(size, frame) {
    const axis = (px, total) => {
      const s = total > 0 && px > 0 && Number.isFinite(px) ? (px / total) * 100 : 0;
      const keep = Math.min(s, KEEP_VISIBLE);
      return [keep - s / 2, 100 - keep + s / 2];
    };
    return {x: axis(size.w, frame.w), y: axis(size.h, frame.h)};
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const round1 = (v) => Math.round(v * 10) / 10;

  /* ---------- 逐类型的手势能力（§14.2 手柄词表）----------
     core 的 `element_transform` 对 progress / wave 与其它独立元素走同一份
     `place.rot`；整幅 overlay 没有自由旋转语义，tpl 的 chrome 由模板定义。

     **第 122 轮改成三档**。
     此前只有「四角 ＋ 左右竖胶囊」，纵向一个把手都没有——那是第 20 轮**画出来的**
     限制，不是核心的限制；逐类型分成这三档：

       `resize: 'free'`   八把手 `n w s e nw ne sw se`，宽高比**自由**（`aspectFor` 返回 null，
                          四角默认仍锁比例，按住 ⇧ 才解锁）。这一族是：
                          贴纸 / B-roll 视频 / 进度条 / 声波。
       `resize: 'text'`   `w e` ＋ 四角（文字与字幕）。左右改容器宽度
                          （字号不变、重新换行），四角**锁比例**连字号一起放大。
       `resize: 'corner'` 只有四角、恒锁比例。图片 / 形状 / 主视频片段。
       `resize: 'width'`  本原型独有的第四档：字幕栈只有左右两条（§16 的 wrapWidth），
                          它没有 `pose.scale` 也不自由旋转，给不出四角的语义。

     `scale` 从此只回答一件事：**四角写的是 `pose.scale` 还是 `w/h`**。'text' 与
     'corner' 两档写 `scale`（文字要连字号一起放大，图片/形状锁比例等价），'free' 档
     四角写 `w/h`（⇧ 解锁之后本来就不是一个倍率能表达的）。 */
  const CAPS = {
    text:      {move: true,  scale: true,  width: true,  rot: true, resize: 'text'},
    textgroup: {move: true,  scale: true,  width: true,  rot: true, resize: 'text'},
    sticker:   {move: true,  scale: false, width: true,  rot: true, resize: 'free'},
    /* 彩纸是一层粒子场：可挪、可改盒子（自由缩放），不旋转——旋转一个铺满画布的
       发射区没有语义，粒子的朝向由配方与 `angle` 管。 */
    confetti:  {move: true,  scale: false, width: true,  rot: false, resize: 'free'},
    whiteboard: {move: true, scale: false, width: true,  rot: false, resize: 'free'},
    shape:     {move: true,  scale: true,  width: false, rot: true, resize: 'corner'},
    image:     {move: true,  scale: true,  width: false, rot: true, resize: 'corner'},
    /* B-roll 画中画：Mac `BrollItemView` 一直可拖可缩，只是限位更紧（6…94）。*/
    video:     {move: true,  scale: false, width: true,  rot: true, resize: 'free'},
    /* 进度条与声波可挪、可改宽、可旋转；仍不做等比缩放，宽度柄覆盖主尺寸。*/
    progress:  {move: true,  scale: false, width: true,  rot: true, resize: 'free'},
    wave:      {move: true,  scale: false, width: true,  rot: true, resize: 'free'},
    /* 计时（第 88 轮立、89.1 轮补宽度柄）：它是一条文字元素，四个手势全给。
       宽度柄第 88 轮曾判为「改宽它什么也不会发生」——那是把容器当成恒等于内容宽的
       盒子看。用户裁决把容器变成可拉宽的（同轮补了三档对齐），拉宽出来的留白正是
       对齐要对的那段距离，两件事互为前提，缺一个另一个就是空控件。*/
    counter:   {move: true,  scale: true,  width: true,  rot: true, resize: 'text'},
    /* 字幕：§16 的 wrapWidth——只有左右两个竖胶囊；竖直可拖，写的是 stack.offset。*/
    subtitle:  {move: true,  scale: false, width: true,  rot: false, axis: 'y', resize: 'width'},
    overlay:   {},
    /* 取景框是有独立几何的 role=frame 元素；只补与 App 同源的旋转能力。*/
    vframe:    {rot: true},
    /* `clip` 一档已退役（2026-09-16）：项目原片就是上面的 `video`，八把手 / 等比角柄同一套。 */
    tpl:       {},
  };
  const caps = (kind) => CAPS[kind] || {};
  const limitsFor = (kind) => (kind === 'video' ? BROLL_LIMITS : TEXT_LIMITS);

  /* ---------- 移动：百分比空间（stage_drag::position）---------- */
  /** 指针位移 → 帧百分比中心；中心 ±1.5% 吸附并回报导引开关，最后按限位夹取。 */
  function dragPos(start, delta, size, lim) {
    if (!(size.w > 0) || !(size.h > 0)) return null;
    let x = start.x + (delta.dx / size.w) * 100;
    let y = start.y + (delta.dy / size.h) * 100;
    const vGuide = Math.abs(x - 50) < CENTER_SNAP;
    const hGuide = Math.abs(y - 50) < CENTER_SNAP;
    if (vGuide) x = 50;
    if (hGuide) y = 50;
    return {x: clamp(x, lim.x[0], lim.x[1]), y: clamp(y, lim.y[0], lim.y[1]), vGuide, hGuide};
  }

  /* ---------- 吸附盒（stage_snap::SnapBox）---------- */
  /** 舞台元素一律以中心定位（`place.x/y` 是中心百分比），所以这个构造子才是常用的那个 */
  const boxOf = (cx, cy, w, h) => ({x: cx - w / 2, y: cy - h / 2, w, h});
  const edgesX = (b) => [b.x, b.x + b.w / 2, b.x + b.w];
  const edgesY = (b) => [b.y, b.y + b.h / 2, b.y + b.h];

  /* 一根轴上的候选线。**顺序即优先级**：等距时先出现的赢，画布线排在其它元素之前
     ——两条线一样近时吸到画布中线比吸到某个邻居的边更稳（邻居会动，画布不会）。 */
  function axisLines(extent, others, pick) {
    const lines = [0, extent / 2, extent];
    others.forEach((b) => { pick(b).forEach((v) => lines.push(v)); });
    return lines;
  }
  function candidates(frame, others) {
    return {x: axisLines(frame.w, others, edgesX), y: axisLines(frame.h, others, edgesY)};
  }

  /* 一根轴求解：三条移动边逐一对全部候选线试，取**绝对值最小**的位移；位移定下来
     之后再回扫一遍，把「按这个位移正好落在候选线上」的边全部收成导引线——左边与
     中线同时对齐两条不同的线时，两条都该画出来。 */
  function snapAxis(moving, lines, threshold) {
    let best = null;
    moving.forEach((edge) => {
      lines.forEach((line) => {
        const d = line - edge;
        if (Math.abs(d) > threshold) return;
        if (best === null || Math.abs(d) < Math.abs(best) || (Math.abs(d) === Math.abs(best) && d < best)) best = d;
      });
    });
    if (best === null) return null;
    const hit = [];
    moving.forEach((edge) => {
      const landed = edge + best;
      const line = lines.filter((l) => Math.abs(l - landed) <= 1e-6)[0];
      if (line !== undefined && !hit.some((h) => Math.abs(h - line) <= 1e-6)) hit.push(line);
    });
    return {delta: best, lines: hit};
  }

  /** 移动吸附：`box` 是未吸附前的落位（帧内像素），返回还要再加的位移与要画的线。
      `on = false`（⌥）一律零位移、空线集——不是「阈值调大」，是整条规则不参与。 */
  function snapMove(box, frame, others, on) {
    const out = {dx: 0, dy: 0, guides: []};
    if (!on || !(frame.w > 0) || !(frame.h > 0)) return out;
    const c = candidates(frame, others);
    const sx = snapAxis(edgesX(box), c.x, SNAP_PX);
    if (sx) { out.dx = sx.delta; sx.lines.forEach((p) => out.guides.push({v: true, p})); }
    const sy = snapAxis(edgesY(box), c.y, SNAP_PX);
    if (sy) { out.dy = sy.delta; sy.lines.forEach((p) => out.guides.push({v: false, p})); }
    return out;
  }

  /** 「这个盒子**现在**贴着哪几条线」——渲染期用的导引线，不是求解器。
      它报的是「此刻确实对齐了」而不是「刚刚被吸住了」：按住 ⌥ 时盒子不再被拽，
      但如果它本来就压在某条线上，线照样画。 */
  function guidesFor(box, frame, others, tol) {
    if (!(frame.w > 0) || !(frame.h > 0)) return [];
    const c = candidates(frame, others);
    const out = [];
    [[edgesX(box), c.x, true], [edgesY(box), c.y, false]].forEach(([edges, lines, v]) => {
      edges.forEach((edge) => {
        const line = lines.filter((l) => Math.abs(l - edge) <= (tol === undefined ? GUIDE_TOL : tol))[0];
        if (line === undefined) return;
        if (!out.some((g) => g.v === v && Math.abs(g.p - line) <= 1e-6)) out.push({v, p: line});
      });
    });
    return out;
  }

  /** 宽度柄吸附：盒子**绕中心**对称生长（与 `widthPct` 的双倍计入同口径），所以
      吸的是左右两条边，中心不动。只作用于 `w`——高度是按素材比派生的，没有独立写路径。 */
  function snapWidth(cx, w, frame, others, on) {
    if (!on || !(frame.w > 0) || !(w > 0)) return {w, guides: []};
    const lines = candidates(frame, others).x;
    const half = w / 2;
    let best = null;
    [[cx - half, -1], [cx + half, 1]].forEach(([edge, sign]) => {
      lines.forEach((line) => {
        if (Math.abs(line - edge) > SNAP_PX) return;
        const nh = (line - cx) * sign;
        if (nh <= 0) return;
        if (best === null || Math.abs(nh - half) < Math.abs(best - half)) best = nh;
      });
    });
    if (best === null) return {w, guides: []};
    const guides = [];
    [cx - best, cx + best].forEach((edge) => {
      const line = lines.filter((l) => Math.abs(l - edge) <= 1e-6)[0];
      if (line !== undefined) guides.push({v: true, p: line});
    });
    return {w: best * 2, guides};
  }

  /* ---------- 四角：对角锚定的等比缩放（stage_drag::corner_scale_about）---------- */
  /** `s = clamp(s0 × d/d0, 0.1, 5)`，两位小数。 */
  function cornerScale(s0, d0, d) {
    const base = Math.max(d0, 1);
    return clamp(Math.round((s0 * d) / base * 100) / 100, SCALE_MIN, SCALE_MAX);
  }
  /** 倍率按 `指针↔对角锚点 / 起手↔对角锚点`，中心随之平移到
      `anchor + (c0 − anchor) × s/s0`——于是对角那个点纹丝不动。
      中心用的是**钳位之后**的倍率，所以缩到 0.1 / 5 的边界上锚点照样不动。 */
  function cornerScaleAbout(s0, c0, anchor, p0, p) {
    const d0 = Math.hypot(p0.x - anchor.x, p0.y - anchor.y);
    const d = Math.hypot(p.x - anchor.x, p.y - anchor.y);
    const scale = cornerScale(s0, d0, d);
    const ratio = Math.abs(s0) < Number.EPSILON ? 1 : scale / s0;
    return {scale,
      x: anchor.x + (c0.x - anchor.x) * ratio,
      y: anchor.y + (c0.y - anchor.y) * ratio};
  }
  /** 四角的对角点（未旋转盒的角，再绕中心转 rot） */
  function cornerAnchor(cx, cy, w, h, corner, rot) {
    const sx = corner === 'tl' || corner === 'bl' ? 1 : -1;
    const sy = corner === 'tl' || corner === 'tr' ? 1 : -1;
    const rad = (rot * Math.PI) / 180;
    const dx = (sx * w) / 2, dy = (sy * h) / 2;
    return {x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
            y: cy + dx * Math.sin(rad) + dy * Math.cos(rad)};
  }

  /* ---------- 竖胶囊：只改容器宽度（stage_drag::width_percent）---------- */
  /** 指针位移投影到盒子的旋转 x 轴，**双倍计入**（左右对称生长），换成帧宽百分比取整。 */
  function widthPct(w0px, p0, p, rot, dir, frameW, minPct) {
    const dx = p.x - p0.x;
    const dy = p0.y - p.y;
    const rad = (rot * Math.PI) / 180;
    const local = dx * Math.cos(rad) + dy * Math.sin(rad);
    const pct = ((w0px + 2 * local * dir) / Math.max(frameW, 1)) * 100;
    return Math.round(clamp(pct, minPct === undefined ? MIN_W : minPct, 100));
  }

  /* ---------- 四边缩放（第 122 轮）----------
     几何用中心式闭式解：「新中心 = 旧中心 ＋ R(θ)·((1−sx)·ax, (1−sy)·ay)」。它与
     多边形的做法（建盒子多边形、旋转、按锚点做
     `translate·rotate·scale·rotate⁻¹·translate⁻¹`、再转回来取 bbox）逐位相同，但不需要
     一个几何库。ax/ay 是**锚点相对中心的未旋转局部偏移**。

     词表：外圈用 `n w s e nw ne sw se`。 */
  const HANDLE_SETS = {
    free:   {big: ['n', 'w', 's', 'e', 'nw', 'ne', 'sw', 'se'], small: ['nw', 's', 'e']},
    text:   {big: ['w', 'e', 'nw', 'ne', 'sw', 'se'],           small: ['se', 'e']},
    corner: {big: ['nw', 'ne', 'sw', 'se'],                     small: ['nw']},
    width:  {big: ['w', 'e'],                                   small: ['e']},
  };
  /** 这一类此刻该出哪几个把手。`wPx`/`hPx` 是**未旋转**的盒尺寸（布局像素）；
      任一边 < 24 就退化——量不到尺寸（undefined）时按大盒处理，不要凭空退化。 */
  function handlesFor(kind, wPx, hPx) {
    const set = HANDLE_SETS[(CAPS[kind] || {}).resize];
    if (!set) return [];
    return (wPx < SMALL_SET || hPx < SMALL_SET) ? set.small : set.big;
  }
  /** 把手是不是要用小一档的样式（宽 < 50 或高 < 40，与上面**不同口径**）。 */
  const smallHandles = (wPx, hPx) => wPx < SMALL_STYLE_W || hPx < SMALL_STYLE_H;
  /** 锁定的宽高比：`free` 一族返回 null（自由），其余按起手时的盒子锁死。 */
  function aspectFor(kind, wPx, hPx) {
    if ((CAPS[kind] || {}).resize === 'free') return null;
    return wPx > 0 && hPx > 0 ? wPx / hPx : null;
  }
  const isCorner = (handle) => handle.length === 2;

  /** 一次缩放。输入是**帧内像素**：`dx/dy` 指针总位移、`rot` 元素角度、`w/h` 起手盒
      尺寸、`x/y` 起手中心（缺省 0，于是返回值就是中心位移）。返回新的 `{w, h, x, y}`。

        · 位移先投影到元素**旋转后**的自身轴：局部 dx 决定宽、局部 dy 决定高；
        · `w/nw/sw` 与 `n/nw/ne` 两侧取反（往左/往上拖是长大）；
        · 四角在 `alt || !shift || ratioLocked` 时锁比例——把 (dh, dw) 摊成同一个比例
          `g`（`r = (dh+dw)/(1+g)`，出 `[r, r·g]`）；
        · `alt` 以**中心**为锚、位移双倍计入（对称缩放），否则锚在对边中点 / 对角；
        · 最小 10×10 px（`min`）。 */
  function edgeResize(o) {
    const handle = String(o.handle || '');
    const w0 = Math.max(o.w || 0, 1e-6), h0 = Math.max(o.h || 0, 1e-6);
    const rad = ((o.rot || 0) * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const west = handle.indexOf('w') >= 0, east = handle.indexOf('e') >= 0;
    const north = handle.indexOf('n') >= 0, south = handle.indexOf('s') >= 0;
    let dw = (o.dx || 0) * cos + (o.dy || 0) * sin;
    let dh = (o.dy || 0) * cos - (o.dx || 0) * sin;
    if (west) dw = -dw;
    if (north) dh = -dh;
    if (isCorner(handle) && (o.alt || !o.shift || o.ratioLocked)) {
      const g = o.ratioLocked || w0 / h0;
      const r = (dh + dw) / (1 + g);
      dh = r; dw = r * g;
    }
    const min = o.min === undefined ? MIN_PX : o.min;
    const sx = (west || east) ? Math.max(w0 + (o.alt ? dw * 2 : dw), min) / w0 : 1;
    const sy = (north || south) ? Math.max(h0 + (o.alt ? dh * 2 : dh), min) / h0 : 1;
    /* 锚点：⌥ 是中心，否则是对边中点（边把手）或对角（四角）。 */
    const ax = o.alt ? 0 : east ? -w0 / 2 : west ? w0 / 2 : 0;
    const ay = o.alt ? 0 : south ? -h0 / 2 : north ? h0 / 2 : 0;
    const ux = (1 - sx) * ax, uy = (1 - sy) * ay;
    return {w: w0 * sx, h: h0 * sy,
      x: (o.x || 0) + ux * cos - uy * sin,
      y: (o.y || 0) + ux * sin + uy * cos};
  }

  /* 光标随旋转角走：把手在词表里的序号加上
     `floor(angle/30)` 查表得到的偏移，模 8 取回一个方向名。30° 一格但偏移表不是
     线性的——`CURSOR_STEP` 在 2/3 与 5/6、8/9 上重复，于是 45° 附近落在同一档。 */
  const CURSOR_ORDER = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const CURSOR_INDEX = {n: 0, ne: 1, e: 2, se: 3, s: 4, sw: 5, w: 6, nw: 7};
  const CURSOR_STEP = {0: 0, 1: 1, 2: 2, 3: 2, 4: 3, 5: 4, 6: 4, 7: 5, 8: 6, 9: 6, 10: 7, 11: 8, 12: 0};
  function resizeCursor(handle, rot) {
    if (CURSOR_INDEX[handle] === undefined) return 'default';
    const a = normDeg(rot || 0);
    const n = a < 0 ? a + 360 : a;
    const step = CURSOR_STEP[Math.floor(n / 30)] || 0;
    return CURSOR_ORDER[(CURSOR_INDEX[handle] + step) % 8] + '-resize';
  }

  /* ---------- 适应 / 填满画布（`fit-canvas` / `fill-canvas`）---------- */
  /** 量的是元素**此刻**在画面上的盒子与画面框，所以不需要一张逐类型的宽高比表——
      图片是 62% 高、贴纸看素材、形状看路径，那张表迟早对不上画面。
      `fit` 取两轴倍率的**较小**者（长边贴齐、短边留边），`fill` 取**较大**者
      （短边贴齐、长边裁出画面）；写回 `w` 并居中，`scale` 不动（手柄那一档的语义不变）。
      盒子按未旋转的布局尺寸算（`offsetWidth/Height`），不把旋转算进去。 */
  function fitPose(pose, box, frame, mode) {
    if (!(box && frame && box.w > 0 && box.h > 0 && frame.w > 0 && frame.h > 0)) return null;
    const s = (pose && pose.scale) || 1;
    const kx = frame.w / box.w, ky = frame.h / box.h;
    const k = mode === 'fill' ? Math.max(kx, ky) : Math.min(kx, ky);
    const pct = (((box.w * k) / frame.w) * 100) / s;
    return {x: 50, y: 50, w: round1(clamp(pct, MIN_W, FIT_MAX_W))};
  }

  /* ---------- 旋转 ---------- */
  const normDeg = (deg) => {
    const w = (((deg + 180) % 360) + 360) % 360 - 180;
    return w === -180 ? 180 : w;
  };
  /** 默认吸到 15° 栅格，`free = true`（⇧）时自由并保留一位小数。
      15° 栅格**包含** 0/±90/180，所以它是 Mac `snapDeg` 那套 ±3° 基本方位吸附的超集。 */
  function snapRot(deg, free) {
    const w = normDeg(deg);
    if (free) return Math.round(w * 10) / 10;
    const s = Math.round(w / ROT_STEP) * ROT_STEP;
    return s === -180 ? 180 : s;
  }
  /** 指针相对中心的角度（度，12 点方向为 0） */
  const pointerDeg = (cx, cy, px, py) => (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90;

  /** 旋转后的外包盒（§14.2 round20.4：工具条跟的是外包盒，中心不动） */
  function rotBounds(w, h, rot) {
    const rad = (rot * Math.PI) / 180;
    const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
    return {w: w * c + h * s, h: w * s + h * c};
  }

  /* ---------- 字幕的位置：`y` ＋ `verticalAlign`（第 49 轮改成与核心同一套）----------

     此前原型存的是「锚点 ＋ 到那条边的距离」（`anchor` ＋ `offset` 0–30%），核心存的
     是另一套，两边对不上：

       核心（`render_plan.rs::stack_layout` / `document.rs::line_vertical_align`）
         `y`             锚线在画面上的位置，**帧高百分比 0–100**，默认 86
         `verticalAlign` 这一块的哪条边钉在锚线上：`"top" | "center" | "bottom"`
                         （严格白名单，见 `vertical_align_from_str`）

     两件事在核心里是**独立**的：`y` 决定挂在哪儿，`verticalAlign` 决定折行往哪长。
     原型那一对把它们绑死了——`anchor` 既当「从哪条边量」又当「往哪长」，而且 offset
     的 0–30 与核心的 0–100 不是一个量纲。同名不同义比不同名更坏，所以这一轮直接换成
     核心那两个键，连名字也照抄。

     拖动因此简单了一截：直接写 `y`，不再有「拖过三分之一就自动换锚点、同时把 offset
     折算成等价值」那套折算——`y` 是绝对的，本来就不需要折算。 */
  const VALIGNS = ['top', 'center', 'bottom'];
  /* 「锚线位置」那一行的三格（第 89.3 轮，用户裁决从汉字换成图标）。图标是 S2 的
     `Align{Top,Middle,Bottom}` 原件——两根竖条对着一条横线，画的正是「哪条边钉在那条
     线上」。`tip` 仍按**锚线**说话，不写「垂直对齐」：对齐是结果不是设定，钉住哪条边、
     折行往哪长就跟着定了（那句 hint 就在这一行下面）。
     键序与 `VALIGNS` 同一份，有单测钉住——两处各写一份迟早差一格。 */
  const VALIGN_ITEMS = [{k: 'top', icon: 'align-top', tip: '顶边'},
                        {k: 'center', icon: 'align-middle', tip: '中线'},
                        {k: 'bottom', icon: 'align-bottom', tip: '底边'}];
  /** 这一块的哪条边钉在锚线上 → 相对自身高度要位移多少（%）。 */
  function subShift(valign) {
    return valign === 'top' ? 0 : valign === 'center' ? -50 : -100;
  }
  /** 锚线的帧百分比，夹在画面里。核心侧的尺是 `stylepane::clamp_position` 的 0–100。 */
  function subClampY(y) { return round1(clamp(y, 0, 100)); }

  window.BC_POSE = {
    SNAP_PX, CENTER_SNAP, ROT_STEP, DEAD_ZONE, GUIDE_TOL, SCALE_MIN, SCALE_MAX, MIN_W, FIT_MAX_W,
    TEXT_LIMITS, BROLL_LIMITS, VALIGNS, VALIGN_ITEMS, CAPS, POSE0,
    caps, limitsFor, clamp, round1, poseOf, KEEP_VISIBLE, mediaLimits,
    dragPos, boxOf, edgesX, edgesY, candidates, snapMove, guidesFor, snapWidth,
    cornerScale, cornerScaleAbout, cornerAnchor, widthPct, fitPose,
    MIN_PX, SMALL_SET, SMALL_STYLE_W, SMALL_STYLE_H, HANDLE_SETS,
    handlesFor, smallHandles, aspectFor, isCorner, edgeResize, resizeCursor,
    normDeg, snapRot, pointerDeg, rotBounds,
    subShift, subClampY,
  };
})();
