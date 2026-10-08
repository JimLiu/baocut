/* 元素关键帧（整段运动）、音量 dB、闪避与画布背景色的纯层 —— window.BC_KF。纯函数，无 React、无 DOM。
   数据形状照 `bcutTimeline` 0.12（Agent 剪辑工具缺口方案 G6 的设计决定）：

     keyframes: {<属性>: [{t, v, ease?}, …]}   属性闭集 x y scale scaleY rot opacity radius volume
       t = 秒（从元素起点算）或 "0%"…"100%"（元素时长的比例）
       v = 与静态值同单位：x / y 画布 %（中心点，同 place.x / y）、scale 倍数、rot 度、
           opacity 0–1、radius 同 place.radius、volume 线性倍数
       ease 写在**目标帧**上（进入这一帧的那一段用它），缺省线性
     duck: {under: "speech" | <轨 id>, depth(dB), attack(s), release(s)}
     main.background: "blur" | "black" | "#RRGGBB"

   属性页只做「整段运动」：一行 = 起 → 止两帧（`0%` / `100%`），多于两帧或时刻不在两端的
   只读回显（有几个点、可清除）——逐点编辑归 Agent 经 `edit apply` 做。
   **范围与缺省值以 BCF 规范 §19 与 `bcut spec` 为准**；这里写着数字的地方（闪避缺省、
   音量滑杆上限）都是原型示意，注明了的。关键帧取样与露底判定也是示意：取样在画布上演，
   露底只在属性页给提示，真判据在内核（`element set --move` 拒绝 + `--allow-uncovered`）。 */
(function () {
  const PROPS = ['x', 'y', 'scale', 'scaleY', 'rot', 'opacity', 'radius', 'volume'];

  /* 属性页「运动」一组的五行。`ui` 是界面数与文档数的换算（不透明度界面 %、文档 0–1），
     范围跟静态输入框走（位置不夹、旋转 ±180、不透明度 0–100 %），缩放的下限是示意。 */
  const MOTION_ROWS = [
    {k: 'x', label: '位置 X', unit: '%', digits: 1, step: 1, tip: '元素中心点的横向位置（画布 %）'},
    {k: 'y', label: '位置 Y', unit: '%', digits: 1, step: 1, tip: '元素中心点的纵向位置（画布 %）'},
    {k: 'scale', label: '缩放', unit: '×', digits: 2, step: 0.05, min: 0.05, tip: '相对静态大小的倍数'},
    {k: 'rot', label: '旋转', unit: '°', digits: 0, step: 1, min: -180, max: 180, tip: '角度'},
    {k: 'opacity', label: '不透明度', unit: '%', digits: 0, step: 5, min: 0, max: 100, ui: 100, tip: '0 = 全透明'},
  ];
  /* 没有两帧编辑器、只读回显的那几项的名字 */
  const PROP_LABEL = {x: '位置 X', y: '位置 Y', scale: '缩放', scaleY: '纵向缩放', rot: '旋转',
    opacity: '不透明度', radius: '圆角', volume: '音量包络'};

  /* ---------- 缓动 ----------
     闭集与公式逐式抄 `core/crates/bcut-motion/src/curve.rs`（`EASE_NAMES` / `apply_ease_id`）；
     未知名字回落恒等，与内核一致。下拉只列常用五个，文档里别的合法名字原样显示、原样保留。 */
  const C1 = 1.70158;
  const EASE_FN = {
    linear: (t) => t,
    easeInQuad: (t) => t * t,
    easeOutQuad: (t) => t * (2 - t),
    easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    easeInCubic: (t) => t * t * t,
    easeOutCubic: (t) => { const u = t - 1; return u * u * u + 1; },
    easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
    easeInQuart: (t) => t * t * t * t,
    easeOutQuart: (t) => { const u = t - 1; return 1 - u * u * u * u; },
    easeInOutQuart: (t) => { if (t < 0.5) return 8 * t * t * t * t; const u = t - 1; return 1 - 8 * u * u * u * u; },
    easeInExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
    easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    easeInOutExpo: (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 0.5 * Math.pow(2, 20 * t - 10) : 1 - 0.5 * Math.pow(2, -20 * t + 10)),
    easeInSine: (t) => 1 - Math.cos(t * Math.PI / 2),
    easeOutSine: (t) => Math.sin(t * Math.PI / 2),
    easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    easeInBack: (t) => (C1 + 1) * t * t * t - C1 * t * t,
    easeOutBack: (t) => 1 + (C1 + 1) * Math.pow(t - 1, 3) + C1 * Math.pow(t - 1, 2),
    easeInOutBack: (t) => {
      const c = C1 * 1.525;
      return t < 0.5 ? (Math.pow(2 * t, 2) * ((c + 1) * 2 * t - c)) / 2
        : (Math.pow(2 * t - 2, 2) * ((c + 1) * (t * 2 - 2) + c) + 2) / 2;
    },
    easeOutElastic: (t) => {
      const c = (2 * Math.PI) / 3;
      return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c) + 1;
    },
  };
  const EASE_NAMES = Object.keys(EASE_FN);
  const EASE_MENU = [
    {k: 'linear', label: '线性'},
    {k: 'easeInOutSine', label: '缓入缓出'},
    {k: 'easeInCubic', label: '缓入'},
    {k: 'easeOutCubic', label: '缓出'},
    {k: 'easeOutBack', label: '回弹'},
  ];
  const ease = (name, t) => (EASE_FN[name] || EASE_FN.linear)(t);
  const easeLabel = (name) => {
    const hit = EASE_MENU.find((m) => m.k === (name || 'linear'));
    return hit ? hit.label : String(name);
  };

  /* ---------- 时刻 ---------- */
  const PCT = /^\s*(-?\d+(?:\.\d+)?)\s*%\s*$/;
  /** 帧时刻 → 从元素起点算的秒。百分比按元素时长换算；认不出的当 0。 */
  function tOf(t, dur) {
    if (typeof t === 'number' && isFinite(t)) return t;
    const m = PCT.exec(String(t));
    return m ? (parseFloat(m[1]) / 100) * Math.max(0, dur || 0) : 0;
  }
  const isPct = (t, n) => typeof t === 'string' && PCT.test(t) && parseFloat(PCT.exec(t)[1]) === n;

  /* ---------- 读 ---------- */
  const framesOf = (kf, prop) => (kf && Array.isArray(kf[prop]) ? kf[prop] : []);
  const count = (kf, prop) => framesOf(kf, prop).length;
  /** 有没有任何关键帧（时间轴运动标记的判据） */
  const any = (kf) => !!kf && PROPS.some((p) => count(kf, p) > 0);
  const total = (kf) => PROPS.reduce((n, p) => n + count(kf, p), 0);
  /** 整段运动 = 恰好两帧、时刻分别是字面的 "0%" 与 "100%"。秒写法的两帧也不算（只读）。 */
  function isSimple(frames) {
    return Array.isArray(frames) && frames.length === 2 && isPct(frames[0].t, 0) && isPct(frames[1].t, 100);
  }
  /** 一行的状态：`none` 没有帧 / `simple` 起止两帧可编辑 / `multi` 只读回显 */
  function rowState(kf, prop) {
    const f = framesOf(kf, prop);
    if (!f.length) return 'none';
    return isSimple(f) ? 'simple' : 'multi';
  }

  /* ---------- 写（都返回新对象，不改入参；没有剩下任何属性时返回 null = 字段缺席） ---------- */
  /** 两帧：ease 写在止帧上；线性是缺省，不写（与 `--move "x:50→70"` 不带缓动时同形） */
  function twoFrames(from, to, easeName) {
    const end = {t: '100%', v: to};
    if (easeName && easeName !== 'linear') end.ease = easeName;
    return [{t: '0%', v: from}, end];
  }
  function setProp(kf, prop, frames) {
    const out = Object.assign({}, kf || {});
    if (frames && frames.length) out[prop] = frames;
    else delete out[prop];
    return Object.keys(out).length ? out : null;
  }
  const clearProp = (kf, prop) => setProp(kf, prop, null);
  /** 改一端的值（`end` 0 = 起，1 = 止）；这一行原先没有帧时，另一端取静态值 */
  function editEnd(kf, prop, end, v, staticV) {
    const f = framesOf(kf, prop);
    const cur = isSimple(f) ? f : null;
    const from = end === 0 ? v : cur ? cur[0].v : staticV;
    const to = end === 1 ? v : cur ? cur[1].v : staticV;
    return setProp(kf, prop, twoFrames(from, to, cur ? cur[1].ease : null));
  }
  function editEase(kf, prop, easeName, staticV) {
    const f = framesOf(kf, prop);
    const cur = isSimple(f) ? f : null;
    return setProp(kf, prop, twoFrames(cur ? cur[0].v : staticV, cur ? cur[1].v : staticV, easeName));
  }

  /* ---------- 取样（示意；规范的取样在内核动画下沉里） ----------
     按时刻排序；第一帧之前取第一帧、最后一帧之后取最后一帧；段内用目标帧的 ease。 */
  function sample(frames, tLocal, dur) {
    if (!frames || !frames.length) return null;
    const pts = frames.map((f) => ({t: tOf(f.t, dur), v: +f.v, ease: f.ease}))
      .filter((p) => isFinite(p.v)).sort((a, b) => a.t - b.t);
    if (!pts.length) return null;
    if (tLocal <= pts[0].t) return pts[0].v;
    const last = pts[pts.length - 1];
    if (tLocal >= last.t) return last.v;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (tLocal <= b.t) {
        const span = b.t - a.t;
        const u = span > 0 ? (tLocal - a.t) / span : 1;
        return a.v + (b.v - a.v) * ease(b.ease, u);
      }
    }
    return last.v;
  }
  /** 画布用：静态姿态 + 关键帧 → 这一刻的 {x, y, scale, rot, opacity}（opacity 0–1）。
      有关键帧的属性**取代**静态值（G6 叠加顺序），入场 / 出场照旧叠在它之上。 */
  function poseAt(base, kf, tLocal, dur) {
    const out = Object.assign({}, base);
    ['x', 'y', 'scale', 'rot', 'opacity'].forEach((p) => {
      const v = sample(framesOf(kf, p), tLocal, dur);
      if (v != null) out[p] = v;
    });
    return out;
  }

  /* ---------- 露底（示意） ----------
     G6：图片 / 视频元素静态位置盖满画布，则运动全程也要盖满；露了内核拒绝并回报最早露底的
     时刻与差多少，`--allow-uncovered` 显式放行。原型在属性页先算一遍，给提示与「仍然保留」。
     盒子用像素：`box = {cx, cy, w, h, rot}`（cx / cy 画布像素中心，w / h 已含静态缩放），
     `frame = {w, h}`。旋转矩形盖满凸的画框 ⇔ 画框四角都在矩形内。差多少 = 四角里伸出去
     最远的那一段，折成画框短边的 %。 */
  function gapOf(box, frame) {
    const a = -(box.rot || 0) * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    let worst = 0;
    [[0, 0], [frame.w, 0], [0, frame.h], [frame.w, frame.h]].forEach(([px, py]) => {
      const dx = px - box.cx, dy = py - box.cy;
      const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
      const ox = Math.abs(lx) - box.w / 2, oy = Math.abs(ly) - box.h / 2;
      worst = Math.max(worst, ox, oy);
    });
    return worst;
  }
  const EPS_PX = 0.01;
  const covers = (box, frame) => gapOf(box, frame) <= EPS_PX;
  /** 最早露底的一刻：`{t（秒，元素内）, gap（那一刻差画框短边 %）, worst（全程最多差多少 %）}`；
      静态本来就没盖满、或全程盖满时 null。
      取样 = 每一帧的时刻 ∪ 全程均分 `steps` 份（示意；内核按极值点与关键帧时刻取）。 */
  function uncovered(stat, kf, dur, frame, steps = 40) {
    const boxAt = (p) => ({
      cx: p.x / 100 * frame.w, cy: p.y / 100 * frame.h,
      w: stat.w * (p.scale / stat.scale), h: stat.h * (p.scale / stat.scale), rot: p.rot});
    const base = {x: stat.x, y: stat.y, scale: stat.scale || 1, rot: stat.rot || 0};
    if (!covers(boxAt(base), frame)) return null;
    const ts = [];
    ['x', 'y', 'scale', 'rot'].forEach((p) => framesOf(kf, p).forEach((f) => ts.push(tOf(f.t, dur))));
    for (let i = 0; i <= steps; i++) ts.push((dur || 0) * i / steps);
    ts.sort((a, b) => a - b);
    const pct = (g) => Math.round(g / Math.min(frame.w, frame.h) * 1000) / 10;
    let hit = null, worst = 0;
    for (const t of ts) {
      const g = gapOf(boxAt(poseAt(base, kf, t, dur)), frame);
      if (g > EPS_PX && !hit) hit = {t, gap: pct(g)};
      worst = Math.max(worst, g);
    }
    return hit ? {...hit, worst: pct(worst)} : null;
  }

  /* ---------- 音量 dB（只读换算） ----------
     文档里的 `volume` 仍是线性倍数；原型样式袋里的 `vol` 是它 ×100 的百分数。0 → −∞。 */
  function toDb(lin) {
    if (!(lin > 0)) return -Infinity;
    return 20 * Math.log10(lin);
  }
  const fromDb = (db) => (db === -Infinity ? 0 : Math.pow(10, db / 20));
  function fmtDb(lin) {
    const db = toDb(lin);
    if (db === -Infinity) return '−∞ dB';
    const r = Math.round(db * 10) / 10;
    return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toFixed(1) + ' dB';
  }
  /* 音量滑杆的上限只是示意（+6 dB）：G1 参数表对元素 volume 只要求非负有限数，输入框不夹上限 */
  const VOL_SLIDER_MAX = 200;

  /* ---------- 闪避 ----------
     界面只写用户动过的字段：打开只写 `{under}`，其余缺席 = 内核缺省（以 `bcut spec` 为准）。
     `DUCK_SHOWN` 是缺席时框里显示的**示意**值，不落盘：取 BCF 规范 §4 `audio.duck` 示例里的
     `depthDb 10 / attack 0.02 / release 0.35`。depth 是正数 dB（「压低至多多少」）。滑杆范围也是示意。 */
  const DUCK_SHOWN = {depth: 10, attack: 0.02, release: 0.35};
  const DUCK_SLIDER = {depth: [0, 30], attack: [0, 1], release: [0, 2]};
  const duckOn = (duck) => !!(duck && duck.under && duck.under !== 'none');
  function duckField(duck, k) {
    return duck && duck[k] != null ? duck[k] : DUCK_SHOWN[k];
  }
  function duckSet(duck, patch) {
    if (patch === null) return null;
    const out = Object.assign({}, duck || {}, patch);
    Object.keys(out).forEach((k) => { if (out[k] == null) delete out[k]; });
    return out.under ? out : null;
  }
  /** 闪避不生效的原因（界面提示用）：压在人声之下却没有文稿 */
  const duckIdle = (duck, hasTranscript) => duckOn(duck) && duck.under === 'speech' && !hasTranscript;

  /* ---------- 画布背景色（main.background） ---------- */
  const HEX = /^#[0-9a-fA-F]{6}$/;
  /** 取值 → 三档 `{mode: 'blur'|'black'|'color', color}`；认不出的当 blur（缺省） */
  function bgMode(bg) {
    if (bg === 'black') return {mode: 'black', color: null};
    if (typeof bg === 'string' && HEX.test(bg)) return {mode: 'color', color: bg.toUpperCase()};
    return {mode: 'blur', color: null};
  }
  /** 三档 → 取值；选「颜色」没给色时沿用上一次的色，再没有就白 */
  function bgValue(mode, color) {
    if (mode === 'black') return 'black';
    if (mode === 'color') return HEX.test(color || '') ? String(color).toUpperCase() : '#FFFFFF';
    return 'blur';
  }
  /** 舞台铺底：黑与颜色铺一层实色；模糊不铺（让位给纯音频项目的底色或原样） */
  function bgFill(bg, fallback) {
    const m = bgMode(bg);
    if (m.mode === 'black') return '#000000';
    if (m.mode === 'color') return m.color;
    return fallback || null;
  }

  window.BC_KF = {
    PROPS, MOTION_ROWS, PROP_LABEL, EASE_NAMES, EASE_MENU, ease, easeLabel,
    tOf, framesOf, count, any, total, isSimple, rowState,
    twoFrames, setProp, clearProp, editEnd, editEase, sample, poseAt,
    gapOf, covers, uncovered,
    toDb, fromDb, fmtDb, VOL_SLIDER_MAX,
    DUCK_SHOWN, DUCK_SLIDER, duckOn, duckField, duckSet, duckIdle,
    bgMode, bgValue, bgFill,
  };
})();
