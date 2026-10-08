/* BaoCut 原型 — 编辑器三缝布局
   window.BC_LAYOUT。纯函数，无 React、无 DOM。

   §10（round14.2 定案）。前身画板用 CSS resize + container query 近似，那是
   .dc.html 格式下的权宜；本载体做真拖拽，因此这里是真正的求解层：
     缝 1  侧边栏｜内容    默认 232 · 88–400 · 拖窄 <100 → ghost（App 的页面侧栏走 PAGE_SIDE：默认 240 · 200–400）
     缝 2  内容｜右面板    默认 360 · 300–560 · 拖窄 <340 → ghost（收起态不渲染包裹层）
     缝 3  舞台｜时间轴    舞台 min 260（画面 220 + 工具条 40）；时间轴 min 60，无全隐态
   rail 恒 68 宽，永远在最右。
   常量与 apps/baocut/src/adapters/editor_layout.rs 同源。 */
(function () {
  const SIDEBAR_DEFAULT = 232, SIDEBAR_MIN = 88,  SIDEBAR_MAX = 400, SIDEBAR_GHOST = 100;
  /* App 的页面侧栏（Home 的项目与会话、Space 的分类，2026-10-02）：装的是用户自己的内容，
     可拖宽并记住宽度（Spectrum 2 app frame）；比 Web 的视频列表宽，最窄 200——再窄会话标题就只剩几个字。
     收起阈值不变（拖到 100 以下隐去）。Web 不传这一档，仍是上面那组数。 */
  const PAGE_SIDE = {def: 240, min: 200, max: SIDEBAR_MAX, ghost: SIDEBAR_GHOST};
  const PANE_DEFAULT = 360,    PANE_MIN = 300,    PANE_MAX = 560,    PANE_GHOST = 340;
  const STAGE_MIN_H = 260,     STAGE_MIN_W = 420;
  const TIMELINE_MIN_H = 60,   TIMELINE_DEFAULT_H = 246;
  // product-design §5.1：拖拽命中区覆盖分隔线，不额外占据编辑器宽度。
  const RAIL_W = 68,           SPLITTER_W = 0;
  const TITLEBAR_H = 58;
  const HANDLE = 6;            // 缝的命中带宽度
  const HIGHLIGHT = 3;         // hover 时浮现的 accent 胶囊

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /**
   * 侧边栏：拖到 ghost 阈值以下就整体隐去（内容不渲染，背景融入编辑器底色），
   * 拖回来恢复到上一次的宽度而不是默认宽——「收起再展回默认宽」是 §20 #2 记的
   * 已知限制，那是格式限制，本载体不该继承。
   */
  function sidebar(width, lastWidth, lim) {
    const L = lim || {def: SIDEBAR_DEFAULT, min: SIDEBAR_MIN, max: SIDEBAR_MAX, ghost: SIDEBAR_GHOST};
    if (width == null) return {width: 0, ghost: true, last: lastWidth || L.def};
    if (width <= L.ghost) return {width: 0, ghost: true, last: lastWidth || L.def};
    const w = clamp(width, L.min, L.max);
    return {width: w, ghost: false, last: w};
  }

  /** 右面板：ghost 带是 [PANE_MIN, PANE_GHOST)——300–340 之间仍可拖，收起后无把手 */
  function pane(width, hidden, lastWidth) {
    if (hidden) return {width: 0, ghost: true, last: lastWidth || PANE_DEFAULT};
    if (width == null) return {width: PANE_DEFAULT, ghost: false, last: PANE_DEFAULT};
    if (width < PANE_GHOST) return {width: 0, ghost: true, last: lastWidth || PANE_DEFAULT};
    const w = clamp(width, PANE_MIN, PANE_MAX);
    return {width: w, ghost: false, last: w};
  }

  /**
   * 编辑器内容区求解：rail 恒占 68，右面板按上限压缩以给舞台留 STAGE_MIN_W，
   * 时间轴钳在 [60, 内容高 − 舞台最小高]。全屏时舞台吃满、其余归零。
   */
  function solve(opts) {
    const o = opts || {};
    const cw = Math.max(0, o.contentWidth || 0);
    const ch = Math.max(0, o.contentHeight || 0);
    if (o.fullscreen) {
      return {railW: 0, paneW: 0, splitterW: 0, stageW: cw, stageH: ch, timelineH: 0, paneGhost: true};
    }
    const railW = Math.min(RAIL_W, cw);
    const splitW = cw - railW;
    const p = pane(o.paneWidth, o.paneHidden, o.paneLastWidth);
    let paneW = p.width;
    let paneOverlay = false;
    if (paneW > 0) {
      const room = splitW - SPLITTER_W - STAGE_MIN_W;
      paneW = clamp(paneW, PANE_MIN, Math.max(PANE_MIN, Math.min(PANE_MAX, room)));
      if (room < PANE_MIN) {
        paneOverlay = !!o.overlayNarrow;
        paneW = paneOverlay ? Math.min(p.width, splitW) : Math.max(0, room);
      }
    }
    const splitterW = paneW > 0 && !paneOverlay ? SPLITTER_W : 0;
    const stageW = Math.max(0, splitW - (paneOverlay ? 0 : paneW) - splitterW);
    const timelineH = clamp(o.timelineHeight != null ? o.timelineHeight : TIMELINE_DEFAULT_H,
                            TIMELINE_MIN_H, Math.max(TIMELINE_MIN_H, ch - STAGE_MIN_H));
    return {
      railW, paneW, splitterW, stageW,
      ...(paneOverlay ? {paneOverlay: true} : {}),
      stageH: Math.max(0, ch - timelineH),
      timelineH,
      paneGhost: paneW === 0,
    };
  }

  /** 舞台 aspect-fit：画面按比例塞进舞台盒。
   *  编辑时留 32 内边距（画面四周要有地方放选中框的把手与吸附导引线）；
   *  全屏播放传 `inset = 0`——观看面上那圈留白只是把画面变小，没有任何东西要放进去。
   *  与核心 `stage::letterbox(..., fullscreen)` 同一条分流。 */
  function fitStage(boxW, boxH, ratio, inset) {
    if (inset == null) inset = 32;
    const w = Math.max(0, boxW - inset * 2);
    const h = Math.max(0, boxH - inset * 2);
    if (w <= 0 || h <= 0) return {w: 0, h: 0};
    return w / h > ratio ? {w: Math.round(h * ratio), h: Math.round(h)}
                         : {w: Math.round(w), h: Math.round(w / ratio)};
  }

  /** '16:9' → 1.777…；'Original' 无实测尺寸时回落 16:9（Mac stageRatioValue 语义） */
  function ratioValue(name, natural) {
    if (name === 'Original') return natural || 16 / 9;
    const m = String(name).match(/^([0-9.]+):([0-9.]+)$/);
    if (!m) return 16 / 9;
    const a = parseFloat(m[1]), b = parseFloat(m[2]);
    return b > 0 ? a / b : 16 / 9;
  }

  window.BC_LAYOUT = {
    SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_GHOST, PAGE_SIDE,
    PANE_DEFAULT, PANE_MIN, PANE_MAX, PANE_GHOST,
    STAGE_MIN_H, STAGE_MIN_W, TIMELINE_MIN_H, TIMELINE_DEFAULT_H,
    RAIL_W, SPLITTER_W, TITLEBAR_H, HANDLE, HIGHLIGHT,
    sidebar, pane, solve, fitStage, ratioValue,
  };
})();
