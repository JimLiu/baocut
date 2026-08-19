// BaoCut Subtitle Studio — 传输条/标尺的纯函数层。
// 与 designs/baocut-mac 的 app/playback-policy.js（倍速档位）、app/timeline.jsx
// （gotoSeg 上下句、replay 态、PAD 偏移与 tick 步长）同构；这里只做数学与文案，
// 不碰 DOM、不读 store，方便 node:test 直接覆盖。
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_TRANSPORT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  // 原型 app/playback-policy.js 的 VK_PLAYBACK.rates，顺序即菜单顺序。
  const RATES = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);

  // 标尺步长候选（秒）。原型 timeline.jsx tickStep 用同一张表 + 90px 目标间距。
  const RULER_STEPS = Object.freeze([1, 2, 5, 10, 15, 30, 60, 120, 300]);
  const RULER_TARGET_PX = 90;

  // 标尺/轨道左侧留白：播放头停在 0 秒时不贴容器边（原型 PAD = 24）。
  const PAD = 24;

  // 上一句要跨过"刚刚过去"的那条，否则播放中按上一句会原地不动；
  // 下一句留一点余量避免停在边界上时跳回自己。原型用同样的 0.3 / 0.05。
  const PREV_EPSILON = 0.3;
  const NEXT_EPSILON = 0.05;

  // 全屏播放的键位步长（Mac EditorPageInteraction.handleFullscreenKey:195-217、
  // 原型 editor.jsx:253-282 同值）。
  const FS_SEEK = 5;
  const FS_SEEK_FAR = 10;
  const FS_VOL_STEP = 0.05;

  // 方向键微调选中字幕的步长，单位是画面百分比（Mac
  // SubtitleLinePlacement.nudgeStep：0.5%，按住 Shift 4× = 2%）。
  const NUDGE_FINE = 0.5;
  const NUDGE_COARSE = 2;

  // 微调的边界：与画布拖拽的 dragBoundFunc（canvas-stage.jsx 的 boundCenter，
  // 3%–97% / 4%–96%）同一组限制 —— 键盘不该把字幕送到鼠标送不到的地方。
  const PLACE_X = Object.freeze([3, 97]);
  const PLACE_Y = Object.freeze([4, 96]);

  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  // 落到最近的合法档位；非法输入回到 1×。菜单之外的来源（持久化、URL）也走这里。
  function normalizeRate(rate) {
    if (!finite(rate) || rate <= 0) return 1;
    let best = RATES[0];
    for (const candidate of RATES) {
      if (Math.abs(candidate - rate) < Math.abs(best - rate)) best = candidate;
    }
    return best;
  }

  // 1× 不显示数字，只留 speed 图标（原型 timeline.jsx:1312 同规则）。
  function speedLabel(rate) {
    const value = normalizeRate(rate);
    return value === 1 ? null : value + '×';
  }

  // tab → 样式上下文。只有译文 tab styling 的是双语栈，其余都是独立原文。
  // 原型 style-model.js TAB_CTX = {transcript:'sub', subtitle:'sub', translate:'bi'}。
  function styleCtx(tab) {
    return tab === 'translate' ? 'bi' : 'sub';
  }

  function styleLabel(ctx) {
    return ctx === 'bi' ? '译文样式' : '字幕样式';
  }

  function styleTip(ctx) {
    return ctx === 'bi' ? '打开译文样式面板' : '打开字幕样式面板';
  }

  // 上一条字幕起点：跳过 PREV_EPSILON 内刚过去的那条，没有更早的就回到 0。
  function prevCueStart(cues, t) {
    const now = finite(t) ? t : 0;
    let best = 0;
    for (const cue of cues || []) {
      if (!cue || !finite(cue.start)) continue;
      if (cue.start < now - PREV_EPSILON && cue.start > best) best = cue.start;
    }
    return best;
  }

  // 下一条字幕起点：没有更晚的就走到片尾（原型 gotoSeg 的 END）。
  function nextCueStart(cues, t, end) {
    const now = finite(t) ? t : 0;
    const tail = finite(end) ? end : 0;
    let best = null;
    for (const cue of cues || []) {
      if (!cue || !finite(cue.start)) continue;
      if (cue.start > now + NEXT_EPSILON && (best == null || cue.start < best)) best = cue.start;
    }
    return best == null ? tail : best;
  }

  // 「播完重播」态：停在片尾的暂停不是普通暂停，按钮要换成 refresh。
  function isReplay(playing, t, end) {
    if (playing) return false;
    if (!finite(end) || end <= 0) return false;
    return finite(t) && t >= Math.max(0, end - 0.001);
  }

  // 目标间距 90px 下最合适的步长；再密就退到最大档（原型 fallback 300）。
  function rulerStep(pps, targetPx = RULER_TARGET_PX) {
    if (!finite(pps) || pps <= 0) return RULER_STEPS[RULER_STEPS.length - 1];
    return RULER_STEPS.find((step) => step * pps >= targetPx)
      || RULER_STEPS[RULER_STEPS.length - 1];
  }

  function rulerTicks(duration, step) {
    if (!finite(duration) || duration < 0 || !finite(step) || step <= 0) return [];
    const out = [];
    for (let t = 0; t <= duration + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
    return out;
  }

  // 时间 ↔ 像素：两端都带 PAD，seek 的反函数必须和 tick/块的正函数同源，
  // 否则点标尺会偏 PAD 个像素。
  function timeToX(t, pps) {
    return PAD + (finite(t) ? t : 0) * (finite(pps) ? pps : 0);
  }

  function xToTime(x, pps, duration) {
    if (!finite(pps) || pps <= 0) return 0;
    const high = finite(duration) ? duration : 0;
    return clamp(((finite(x) ? x : 0) - PAD) / pps, 0, high);
  }

  // 内容宽度含左右两侧 PAD，末尾也不贴边。
  function contentWidth(duration, pps) {
    const span = (finite(duration) ? duration : 0) * (finite(pps) ? pps : 0);
    return span + PAD * 2;
  }

  // 全屏播放的键位表（Mac handleFullscreenKey 的逐条孪生，顺序也照它）。
  // 只在「无 ⌘/Ctrl/Alt 修饰、焦点不在输入框、且正处于全屏」时查表 —— 这三条
  // 判据由调用方守卫，这里只做键 → 动作的映射。返回 null = 这个键不归全屏管。
  function fullscreenKeyAction(key, code) {
    const k = typeof key === 'string' ? key.toLowerCase() : '';
    if (code === 'Space' || k === 'k') return { type: 'togglePlay' };
    if (key === 'ArrowLeft') return { type: 'seek', delta: -FS_SEEK };
    if (key === 'ArrowRight') return { type: 'seek', delta: FS_SEEK };
    if (k === 'j') return { type: 'seek', delta: -FS_SEEK_FAR };
    if (k === 'l') return { type: 'seek', delta: FS_SEEK_FAR };
    if (key === 'ArrowUp') return { type: 'volume', delta: FS_VOL_STEP };
    if (key === 'ArrowDown') return { type: 'volume', delta: -FS_VOL_STEP };
    if (k === 'm') return { type: 'mute' };
    if (k === 'c') return { type: 'subs' };
    if (k === 'f') return { type: 'exit' };
    return null;
  }

  function nudgeStep(coarse) {
    return coarse ? NUDGE_COARSE : NUDGE_FINE;
  }

  // 方向键 → 画面百分比位移。百分比是 y-down 的，所以「上」是减。
  function nudgeDelta(key, coarse) {
    const step = nudgeStep(coarse);
    if (key === 'ArrowLeft') return { dx: -step, dy: 0 };
    if (key === 'ArrowRight') return { dx: step, dy: 0 };
    if (key === 'ArrowUp') return { dx: 0, dy: -step };
    if (key === 'ArrowDown') return { dx: 0, dy: step };
    return null;
  }

  // 落点钳制 + 一位小数（Mac SubtitleLinePlacement.clamp + round1）：写回的
  // 百分比要是人在样式面板 X/Y 里读得出来的数。
  function clampPlacement(x, y) {
    const round1 = (value) => Math.round(value * 10) / 10;
    return {
      x: round1(clamp(finite(x) ? x : 0, PLACE_X[0], PLACE_X[1])),
      y: round1(clamp(finite(y) ? y : 0, PLACE_Y[0], PLACE_Y[1])),
    };
  }

  return {
    RATES, RULER_STEPS, RULER_TARGET_PX, PAD, PREV_EPSILON, NEXT_EPSILON,
    FS_SEEK, FS_SEEK_FAR, FS_VOL_STEP, NUDGE_FINE, NUDGE_COARSE, PLACE_X, PLACE_Y,
    normalizeRate, speedLabel, styleCtx, styleLabel, styleTip,
    prevCueStart, nextCueStart, isReplay,
    rulerStep, rulerTicks, timeToX, xToTime, contentWidth,
    fullscreenKeyAction, nudgeStep, nudgeDelta, clampPlacement,
  };
});
