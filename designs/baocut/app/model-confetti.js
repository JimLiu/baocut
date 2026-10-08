/* model-confetti.js —— 彩纸算法粒子元素的纯模型（第 231 轮，
   设计稿 docs/design/elements/bcut-confetti-element-design.md）。

   十款效果此前是十张固定 3 秒的 SVG（第 223 轮，改编自 react-confetti / party-js /
   js-confetti 三个 MIT 来源）；本轮起它们是**十份配方**（`STYLES`），画面由
   `confetti-v1` 运动核按播放头逐帧求值：任意时长、参数可调、逐帧确定（同一份
   props ＋ 同一个 t 恒得同一帧，与核心 `bcut-motion` 的确定性契约同口径）。

   两条硬约束：
   1. **闭式运动**。每个粒子的位置 / 旋转 / 大小 / 透明度都是 τ（它自己的年龄）的
      显式函数，不积分、不存上一帧——这样拖播放头、倒放、导出抽帧都不会漂。
   2. **随机数只来自 splitmix64(seed, i·16 + c)**。粒子 i 的第 c 个通道是一个纯函数，
      没有 `Math.random`；`randomSeed()` 只在新建元素那一刻用一次。

   这一层不碰 DOM：`sample()` 给出一帧的粒子表，`paint()` 只是把这张表画到一个
   2D 上下文上（canvas 由视图层给）。 */
(function () {
  /* ---------- 常量与上限（设计稿 §3.2，用户 2026-09-09 裁决） ---------- */
  const LIMITS = {colors: 8, rate: 400, count: 500, interval: 60, maxAlive: 600};
  const SHAPES = ['rect', 'strip', 'circle', 'ellipse', 'triangle', 'diamond',
    'star', 'starlet', 'sparkle', 'heart', 'petal', 'ribbon'];
  const SHAPE_NAMES = {rect: '纸片', strip: '纸条', circle: '圆点', ellipse: '椭圆',
    triangle: '三角', diamond: '菱形', star: '五角星', starlet: '四角星',
    sparkle: '闪光', heart: '爱心', petal: '花瓣', ribbon: '彩带'};
  /** 配方的参考短边：所有像素量都按 `min(w, h) / 540` 缩放 */
  const REF_SHORT = 540;
  const CH = 16;          // 每个粒子的随机通道数
  const LIFE_JITTER = 0.85;

  /* ---------- 十款配方（设计稿 §4.6） ----------
     像素量（speedPx / gravityPx / sizePx / driftPx / windPx）都是 540 短边下的值；
     用户面板上的倍率（size / speed / gravity / drift / spin）乘在它们上面。
     `emitters` 是画面百分比里的矩形（中心 x/y ＋ 宽高 w/h）；`angle` 以屏幕坐标
     计（90 = 向下，−90 = 向上）。 */
  /* @ds-allow: 下面十份色板是画进视频画面的彩纸颜色（改编自 react-confetti /
     party-js / js-confetti 三个 MIT 来源的默认色），不是 S2 表面 */
  const RECIPE = {
    emitters: [{x: 50, y: -6, w: 100, h: 0}], angle: 90, spread: 30,
    speedPx: [90, 150], drag: {x: 0.3, y: 0.3}, gravityPx: 320, windPx: 0,
    sizePx: [5, 13], driftPx: 0, driftHz: 0.3, spinDps: [90, 360], flipHz: [0.6, 1.6],
    lifeSec: 4.5, fadeIn: 0, fadeOut: 0.6, sizeRamp: false, pulse: null,
    emit: {mode: 'continuous', rate: 40, count: 80, interval: 2.0, settle: false},
  };
  const recipe = (over) => Object.assign({}, RECIPE, over,
    {emit: Object.assign({}, RECIPE.emit, over.emit || {})});
  const STYLES = [
    {k: 'rainbow-paper', name: '缤纷纸片雨', from: 'react-confetti',
     colors: ['#F94144', '#F3722C', '#F9C74F', '#90BE6D', '#43AA8B', '#577590', '#9B5DE5'],
     shapes: ['rect', 'strip', 'circle'],
     recipe: recipe({})},
    {k: 'pastel-fall', name: '马卡龙飘落', from: 'react-confetti',
     colors: ['#FFB3C6', '#FFD6A5', '#FDFFB6', '#CAFFBF', '#9BF6FF', '#BDB2FF'],
     shapes: ['rect', 'circle', 'ellipse'],
     recipe: recipe({speedPx: [80, 130], gravityPx: 200, driftPx: 6, driftHz: 0.3,
       spinDps: [60, 240], lifeSec: 5.5, emit: {rate: 30}})},
    {k: 'neon-streamers', name: '霓虹彩带', from: 'party-js',
     colors: ['#FF2D95', '#00F0FF', '#B4FF00', '#FFE600', '#FF6A00'],
     shapes: ['strip', 'ribbon'],
     recipe: recipe({spread: 70, windPx: 45, sizePx: [8, 18], drag: {x: 0.25, y: 0.35},
       spinDps: [120, 420], flipHz: [1, 2.4], lifeSec: 4.2, emit: {rate: 32}})},
    {k: 'golden-starburst', name: '金色星芒', from: 'party-js',
     colors: ['#FFD700', '#FFC300', '#FFB000', '#FFF1A8', '#FFFFFF'],
     shapes: ['star', 'starlet', 'sparkle', 'circle'],
     recipe: recipe({emitters: [{x: 25, y: 80, w: 0, h: 0}, {x: 50, y: 80, w: 0, h: 0}, {x: 75, y: 80, w: 0, h: 0}],
       angle: -90, spread: 250, speedPx: [85, 225], drag: {x: 0, y: 0}, gravityPx: 190,
       sizePx: [6, 14], sizeRamp: true, fadeOut: 0.9, lifeSec: 2.6,
       emit: {mode: 'burst', count: 60, interval: 2.0}})},
    {k: 'festival-fireworks', name: '缤纷礼花', from: 'js-confetti',
     colors: ['#FF477E', '#FF8C42', '#FFD166', '#06D6A0', '#4CC9F0', '#B388FF'],
     shapes: ['circle', 'rect', 'sparkle', 'starlet'],
     recipe: recipe({emitters: [{x: 25, y: 80, w: 0, h: 0}, {x: 50, y: 80, w: 0, h: 0}, {x: 75, y: 80, w: 0, h: 0}],
       angle: -90, spread: 324, speedPx: [85, 225], drag: {x: 0, y: 0}, gravityPx: 190,
       sizePx: [5, 12], sizeRamp: true, fadeOut: 0.8, lifeSec: 2.4,
       emit: {mode: 'burst', count: 80, interval: 1.6}})},
    {k: 'hearts-petals', name: '爱心花瓣', from: 'js-confetti',
     colors: ['#FF6B9D', '#FF8FAB', '#FFB3C6', '#FFC2D1', '#FF4D6D'],
     shapes: ['heart', 'petal'],
     /* drag 必须是 0：`axis()` 在 a=0、k>0 时位移有硬渐近线 v0/k，
        0.4 的阻力让最大落程只有 250–340 参考 px（短边 540），粒子永远铺不过
        半幅——用户报的「有些款只铺满一半」就是这一条（第 234 轮修回设计稿 §4.6）。 */
     recipe: recipe({spread: 10, speedPx: [100, 136], drag: {x: 0, y: 0}, gravityPx: 0,
       driftPx: 21, driftHz: 0.32, sizePx: [8, 18], spinDps: [30, 120], flipHz: [0.4, 1],
       lifeSec: 6, emit: {rate: 16}})},
    {k: 'party-cannons', name: '双侧礼炮', from: 'react-confetti',
     colors: ['#FF595E', '#FFCA3A', '#8AC926', '#1982C4', '#6A4C93', '#FFFFFF'],
     shapes: ['rect', 'strip', 'circle', 'triangle'],
     recipe: recipe({emitters: [{x: 0, y: 83, w: 0, h: 0, angle: -65}, {x: 100, y: 83, w: 0, h: 0, angle: -115}],
       angle: -90, spread: 26, speedPx: [250, 420], drag: {x: 0.6, y: 0.35}, gravityPx: 250,
       sizePx: [6, 14], lifeSec: 3.4, fadeOut: 0.7,
       emit: {mode: 'burst', count: 70, interval: 2.4}})},
    {k: 'curling-ribbons', name: '卷曲彩带', from: 'party-js',
     colors: ['#FF6F91', '#FF9671', '#FFC75F', '#F9F871', '#845EC2', '#00C9A7'],
     shapes: ['ribbon', 'strip'],
     recipe: recipe({emitters: [{x: 0, y: 83, w: 0, h: 0, angle: -65}, {x: 100, y: 83, w: 0, h: 0, angle: -115}],
       angle: -90, spread: 26, speedPx: [250, 420], drag: {x: 0.6, y: 0.35}, gravityPx: 250,
       sizePx: [8, 18], spinDps: [200, 520], flipHz: [1.2, 2.6], lifeSec: 3.6, fadeOut: 0.7,
       emit: {mode: 'continuous', rate: 24}})},
    {k: 'geometric-pop', name: '几何喷射', from: 'js-confetti',
     colors: ['#0D3B66', '#FAF0CA', '#F4D35E', '#EE964B', '#F95738'],
     shapes: ['triangle', 'diamond', 'rect', 'circle'],
     recipe: recipe({emitters: [{x: 0, y: 97, w: 0, h: 0, angle: -60}, {x: 100, y: 97, w: 0, h: 0, angle: -120}],
       angle: -90, spread: 40, speedPx: [280, 460], drag: {x: 0.5, y: 0.3}, gravityPx: 300,
       sizePx: [7, 16], spinDps: [90, 300], flipHz: [0.5, 1.4], lifeSec: 3.2, fadeOut: 0.6,
       emit: {mode: 'burst', count: 90, interval: 1.8}})},
    {k: 'champagne-sparkle', name: '香槟闪耀', from: 'party-js',
     colors: ['#FFF3B0', '#FFE066', '#FFFFFF', '#FFD166'],
     shapes: ['sparkle', 'circle', 'starlet'],
     /* 发射带从 y 28.5–61.5% 的中带放开到整幅（第 234 轮）：上浮速度只有
        14–28 参考 px/s，中带撒出来在 4 秒里只够覆盖中间三成，看上去与
        `hearts-petals` 的半幅缺陷是同一种。这一档是取舍不是修 bug——原设计稿
        §4.6 写的就是中带。 */
     recipe: recipe({emitters: [{x: 50, y: 50, w: 100, h: 100}], angle: -90, spread: 0,
       speedPx: [14, 28], drag: {x: 0, y: 0}, gravityPx: 0, driftPx: 15, driftHz: 0.16,
       sizePx: [3, 9], spinDps: [0, 60], flipHz: [0, 0], fadeIn: 0.5, fadeOut: 0.8,
       pulse: {min: 0.1, max: 1.1, hz: 0.33}, lifeSec: 3.2, emit: {rate: 36}})},
  ];
  const byStyle = (k) => STYLES.filter((s) => s.k === k)[0] || STYLES[0];

  /* ---------- 属性的缺省与范围（设计稿 §3.2） ---------- */
  const RANGES = {
    size: [0.25, 4], speed: [0.25, 4], gravity: [-2, 4], drift: [0, 3], spin: [0, 3],
    wind: [-600, 600], opacity: [0, 1], rate: [1, LIMITS.rate], count: [1, LIMITS.count],
    interval: [0, LIMITS.interval], angle: [-180, 180], spread: [0, 360],
    originX: [-20, 120], originY: [-20, 120],
  };
  const clamp = (v, r) => Math.min(r[1], Math.max(r[0], v));

  /** 某一款的完整 props（`seed` 由调用方给：新建时 `randomSeed()`，换款时保留） */
  function defaults(styleK, seed) {
    const s = byStyle(styleK);
    return {
      style: s.k, seed: seed == null ? 0 : seed,
      colors: s.colors.slice(0, LIMITS.colors), shapes: s.shapes.slice(),
      size: 1, speed: 1, gravity: 1, drift: 1, spin: 1, wind: 0, opacity: 1,
      emit: Object.assign({}, s.recipe.emit),
      /* 发射起点 / 方向 / 扇面缺省是 `null` = 跟配方走；面板写过才落成值（设计稿 §3.2：
         schema 里 `origin` 缺省即配方发射器）。 */
      origin: null, angle: null, spread: null,
    };
  }

  /** 补齐一份可能残缺的 props（旧文档、手写 JSON），并把越界值夹回范围 */
  function normalize(p) {
    const base = defaults(p && p.style, p && p.seed);
    const out = Object.assign({}, base, p || {});
    out.colors = (Array.isArray(out.colors) && out.colors.length ? out.colors : base.colors).slice(0, LIMITS.colors);
    const shapes = (Array.isArray(out.shapes) ? out.shapes : []).filter((k) => SHAPES.indexOf(k) >= 0);
    out.shapes = shapes.length ? shapes : base.shapes;
    ['size', 'speed', 'gravity', 'drift', 'spin', 'wind', 'opacity'].forEach((k) => {
      out[k] = clamp(typeof out[k] === 'number' ? out[k] : base[k], RANGES[k]);
    });
    const e = Object.assign({}, base.emit, out.emit || {});
    e.mode = e.mode === 'burst' ? 'burst' : 'continuous';
    e.rate = Math.round(clamp(+e.rate || base.emit.rate, RANGES.rate));
    e.count = Math.round(clamp(+e.count || base.emit.count, RANGES.count));
    e.interval = clamp(typeof e.interval === 'number' ? e.interval : base.emit.interval, RANGES.interval);
    e.settle = !!e.settle;
    out.emit = e;
    if (out.angle != null) out.angle = clamp(+out.angle, RANGES.angle);
    if (out.spread != null) out.spread = clamp(+out.spread, RANGES.spread);
    if (out.origin) out.origin = {x: clamp(+out.origin.x, RANGES.originX), y: clamp(+out.origin.y, RANGES.originY)};
    return out;
  }

  /** 换款：props 回到那一款的缺省，只有 `seed` 跟着人走（设计稿 §6：换款＝重选，不是编辑） */
  function switchStyle(p, styleK) { return defaults(styleK, p && p.seed); }

  /* ---------- 随机源：splitmix64 ---------- */
  const M64 = (1n << 64n) - 1n;
  const GAMMA = 0x9E3779B97F4A7C15n;
  const MIX1 = 0xBF58476D1CE4E5B9n;
  const MIX2 = 0x94D049BB133111EBn;
  const TWO53 = 2 ** 53;
  function splitmix64Unit(seed, k) {
    let z = (BigInt(seed) + BigInt(k) * GAMMA) & M64;
    z = ((z ^ (z >> 30n)) * MIX1) & M64;
    z = ((z ^ (z >> 27n)) * MIX2) & M64;
    z = z ^ (z >> 31n);
    return Number(z >> 11n) / TWO53;
  }
  /* 每个粒子 16 个通道一次算齐并缓存：BigInt 乘法不便宜，同一个粒子在它活着的
     每一帧都会被问同一批数。缓存按 seed 分桶，换种子即清空。 */
  let cacheSeed = null;
  let cache = new Map();
  function channels(seed, i) {
    if (cacheSeed !== seed) { cacheSeed = seed; cache = new Map(); }
    let u = cache.get(i);
    if (u) return u;
    u = new Array(CH);
    for (let c = 0; c < CH; c++) u[c] = splitmix64Unit(seed, i * CH + c);
    if (cache.size > 4000) cache.clear();
    cache.set(i, u);
    return u;
  }
  /** 新建元素时写入的随机种子（u64 里取 53 位安全整数，两边 JSON 都能原样带） */
  function randomSeed() {
    const hi = Math.floor(Math.random() * 0x200000);       // 21 位
    const lo = Math.floor(Math.random() * 0x100000000);    // 32 位
    return hi * 0x100000000 + lo || 1;
  }

  /* ---------- 闭式运动核 ---------- */
  const lerp = (a, b, u) => a + (b - a) * u;
  const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
  /** 三角波：frac 0 → 1，frac 0.5 → −1 */
  const tri = (x) => 4 * Math.abs(x - Math.floor(x) - 0.5) - 1;
  /** 一轴的位移：阻力 k（1/s）＋ 加速度 a（px/s²） */
  function axis(p0, v0, a, k, tau) {
    if (k > 0) {
      const vt = a / k;
      return p0 + vt * tau + (v0 - vt) * (1 - Math.exp(-k * tau)) / k;
    }
    return p0 + v0 * tau + 0.5 * a * tau * tau;
  }

  /** 粒子 i 的出生时刻；`null` = 这一份 props 下它永远不会出生 */
  function spawnAt(p, i, dur, lifeMax) {
    const e = p.emit;
    let t0;
    if (e.mode === 'burst') {
      const b = Math.floor(i / e.count);
      if (e.interval <= 0 && b > 0) return null;
      t0 = b * e.interval;
    } else {
      const u = channels(p.seed, i);
      t0 = (i + u[0]) / e.rate;
    }
    if (e.settle && dur != null && t0 > dur - lifeMax) return null;
    return t0;
  }
  /** 此刻可能活着的粒子编号范围 [lo, hi]：出生时刻落在 (t − lifeMax, t] 里的那些 */
  function indexWindow(p, t, lifeMax) {
    const e = p.emit;
    if (e.mode === 'burst') {
      const bHi = e.interval <= 0 ? 0 : Math.floor(t / e.interval);
      const bLo = e.interval <= 0 ? 0 : Math.max(0, Math.ceil((t - lifeMax) / e.interval));
      return [bLo * e.count, (bHi + 1) * e.count - 1];
    }
    // 出生时刻带一档 [0,1)/rate 的抖动，两端各放宽一格
    return [Math.max(0, Math.floor((t - lifeMax) * e.rate) - 1), Math.floor(t * e.rate) + 1];
  }

  /** 求一帧。`box` = {w, h} 像素；`dur` = 元素时长（settle 用）。返回粒子表（画面像素坐标）。 */
  function sample(props, t, box, dur) {
    const p = normalize(props);
    const s = byStyle(p.style);
    const r = s.recipe;
    const W = box && box.w > 0 ? box.w : 960;
    const H = box && box.h > 0 ? box.h : REF_SHORT;
    const px = Math.min(W, H) / REF_SHORT;
    const lifeMax = r.lifeSec;
    const out = [];
    if (!(t >= 0)) return out;
    const emitters = p.origin ? [{x: p.origin.x, y: p.origin.y, w: 0, h: 0}] : r.emitters;
    const [lo, hi] = indexWindow(p, t, lifeMax);
    for (let i = lo; i <= hi && out.length < LIMITS.maxAlive; i++) {
      const t0 = spawnAt(p, i, dur, lifeMax);
      if (t0 == null) continue;
      const u = channels(p.seed, i);
      const life = lifeMax * lerp(LIFE_JITTER, 1, u[13]);
      const tau = t - t0;
      if (tau < 0 || tau >= life) continue;
      const em = emitters[i % emitters.length];
      const x0 = (em.x + (u[1] - 0.5) * (em.w || 0)) / 100 * W;
      const y0 = (em.y + (u[2] - 0.5) * (em.h || 0)) / 100 * H;
      const baseAngle = p.angle != null ? p.angle : (em.angle != null ? em.angle : r.angle);
      const spread = p.spread != null ? p.spread : r.spread;
      const ang = (baseAngle + (u[3] - 0.5) * spread) * Math.PI / 180;
      const v0 = lerp(r.speedPx[0], r.speedPx[1], u[4]) * p.speed * px;
      const ax = (r.windPx + p.wind) * px;
      const ay = r.gravityPx * p.gravity * px;
      let x = axis(x0, v0 * Math.cos(ang), ax, r.drag.x, tau);
      const y = axis(y0, v0 * Math.sin(ang), ay, r.drag.y, tau);
      if (r.driftPx > 0 && p.drift > 0) {
        x += p.drift * r.driftPx * px * Math.sin(2 * Math.PI * r.driftHz * tau + 2 * Math.PI * u[12]);
      }
      const dir = u[9] < 0.5 ? -1 : 1;
      const rot = u[9] * 360 + dir * p.spin * lerp(r.spinDps[0], r.spinDps[1], u[8]) * tau;
      const sy = tri(u[10] + p.spin * lerp(r.flipHz[0], r.flipHz[1], u[11]) * tau);
      let size = p.size * lerp(r.sizePx[0], r.sizePx[1], u[5]) * px;
      if (r.sizeRamp) size *= Math.min(1, 3 * tau);
      if (r.pulse) {
        size *= lerp(r.pulse.min, r.pulse.max,
          0.5 + 0.5 * Math.sin(2 * Math.PI * r.pulse.hz * tau + 2 * Math.PI * u[14]));
      }
      let alpha = p.opacity;
      if (r.fadeIn > 0) alpha *= smooth(tau / r.fadeIn);
      if (r.fadeOut > 0) alpha *= smooth((life - tau) / r.fadeOut);
      if (alpha <= 0.002 || size <= 0.05) continue;
      out.push({i, x, y, size, rot, sy, alpha,
        shape: p.shapes[Math.floor(u[6] * p.shapes.length) % p.shapes.length],
        color: p.colors[Math.floor(u[7] * p.colors.length) % p.colors.length]});
    }
    return out;
  }

  /* ---------- 形状：单位尺寸（size = 1）的路径 ---------- */
  function tracePath(c, shape) {
    const h = 0.5;
    switch (shape) {
      case 'strip': c.rect(-0.2, -0.8, 0.4, 1.6); break;
      case 'circle': c.arc(0, 0, h, 0, Math.PI * 2); break;
      case 'ellipse': c.ellipse(0, 0, h, 0.3, 0, 0, Math.PI * 2); break;
      case 'triangle': c.moveTo(0, -0.55); c.lineTo(0.5, 0.4); c.lineTo(-0.5, 0.4); c.closePath(); break;
      case 'diamond': c.moveTo(0, -0.6); c.lineTo(0.4, 0); c.lineTo(0, 0.6); c.lineTo(-0.4, 0); c.closePath(); break;
      case 'star': starPath(c, 5, 0.55, 0.24); break;
      case 'starlet': starPath(c, 4, 0.6, 0.2); break;
      case 'sparkle': starPath(c, 4, 0.7, 0.08); break;
      case 'heart':
        c.moveTo(0, 0.45);
        c.bezierCurveTo(-0.7, -0.05, -0.45, -0.6, 0, -0.25);
        c.bezierCurveTo(0.45, -0.6, 0.7, -0.05, 0, 0.45);
        c.closePath(); break;
      case 'petal':
        c.moveTo(0, -0.6);
        c.bezierCurveTo(0.45, -0.3, 0.45, 0.3, 0, 0.6);
        c.bezierCurveTo(-0.45, 0.3, -0.45, -0.3, 0, -0.6);
        c.closePath(); break;
      case 'ribbon':
        c.moveTo(-0.22, -0.9);
        c.bezierCurveTo(0.45, -0.5, -0.45, 0.1, 0.22, 0.9);
        c.lineTo(0.02, 0.9);
        c.bezierCurveTo(-0.62, 0.1, 0.28, -0.5, -0.4, -0.9);
        c.closePath(); break;
      default: c.rect(-0.5, -0.3, 1, 0.6);    // rect
    }
  }
  function starPath(c, n, ro, ri) {
    for (let k = 0; k < n * 2; k++) {
      const a = -Math.PI / 2 + k * Math.PI / n;
      const rr = k % 2 === 0 ? ro : ri;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
  }

  /** 把一帧画到 2D 上下文上（调用方负责清屏与 DPR）。`scale` 是画布像素 / 画面像素。 */
  function paint(c, frame, scale) {
    const k = scale || 1;
    for (let n = 0; n < frame.length; n++) {
      const q = frame[n];
      c.save();
      c.translate(q.x * k, q.y * k);
      c.rotate(q.rot * Math.PI / 180);
      c.scale(q.size * k, q.size * k * q.sy);
      c.globalAlpha = q.alpha;
      c.fillStyle = q.color;
      c.beginPath();
      tracePath(c, q.shape);
      c.fill();
      c.restore();
    }
  }

  /** 有效的发射参数（面板显示用：null 时回落到配方的第一枚发射器） */
  function effectiveEmit(p) {
    const s = byStyle(p.style);
    const em = s.recipe.emitters[0];
    return {
      x: p.origin ? p.origin.x : em.x, y: p.origin ? p.origin.y : em.y,
      angle: p.angle != null ? p.angle : (em.angle != null ? em.angle : s.recipe.angle),
      spread: p.spread != null ? p.spread : s.recipe.spread,
      multi: !p.origin && s.recipe.emitters.length > 1,
    };
  }

  Object.assign(window, {BC_CONFETTI: {
    LIMITS, SHAPES, SHAPE_NAMES, RANGES, STYLES, REF_SHORT,
    byStyle, defaults, normalize, switchStyle, randomSeed, splitmix64Unit, channels,
    spawnAt, indexWindow, sample, paint, tracePath, effectiveEmit,
  }});
})();
