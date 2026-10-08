/* 文字动画的逐帧求值 —— §13.5（第 59 轮）。

   原型此前的「动画」只有两处：目录卡上的一枚星号角标，和鼠标停在目录格上时画布放的
   那一下预览（第 58.2 轮）。**播放头走过去时画面是不动的**——预设带着入场/出场，
   时间轴上也画了动画带，但那两段只是标注，没人消费。这一层就是消费者。

   做法是**按 playT 逐帧求值**，不是挂 CSS keyframes：
     · 拖动播放头（scrub）时动画要跟着走，keyframes 做不到——它只认自己的时钟；
     · 求值是纯函数（`at(anim, t, span)`），node --test 能直接钉住每一段的边界；
     · 位移一律用**元素自身宽高的百分比**，与舞台缩放无关，所以这一层不需要知道 k。

   配方对着核心 `bcut-motion` 的 enter/exit 表（`preset_registry/mod.rs` 那 14 + 11 条）
   的语义写，但**数值是原型自己的**：核心那份是给渲染器的曲线规格（`from.dy` 之类的
   画幅比例 + 缓动 id），这里只要在浏览器里看着对。目录里核心没有的那几条
   （compress / bounce / wave / skid / flipboard / dragonfly / billboard / roll 以及整个
   loop 组）是原型先行，登记在分歧台账。 */
(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  /* 入场用 easeOutCubic、出场用 easeInCubic——与核心 enter/exit 的缓动方向一致 */
  const outCubic = (p) => 1 - Math.pow(1 - p, 3);
  const inCubic = (p) => p * p * p;
  const backOut = (p) => 1 + 2.7 * Math.pow(p - 1, 3) + 1.7 * Math.pow(p - 1, 2);
  const ID = {op: 1, tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, rotX: 0, rotY: 0,
              skew: 0, blur: 0, reveal: 1, clip: null};

  /** 入场配方：p = 0 → 刚出现，p = 1 → 到位 */
  function enter(k, dir, p) {
    const e = outCubic(p);
    const q = 1 - e;
    const d = dir || 'right';
    switch (k) {
      case 'fade': return {op: p};
      case 'ascent': return {ty: q * 45, op: clamp(p * 1.6, 0, 1)};
      case 'fall': return {ty: -q * 90, op: clamp(p * 1.6, 0, 1), rot: -q * 8};
      case 'stomp': return {ty: -q * 60, sx: 1 + q * 0.35, sy: 1 + q * 0.35, op: clamp(p * 2, 0, 1)};
      case 'slide': {
        // 方向 = 从哪一侧来（与出场「往哪一侧去」、核心 slideL/R/Up/Down 同一套词）
        const s = d === 'left' ? {tx: -q * 130} : d === 'right' ? {tx: q * 130}
          : d === 'up' ? {ty: -q * 130} : {ty: q * 130};
        return Object.assign({op: clamp(p * 3, 0, 1)}, s);
      }
      case 'skid': return {tx: -q * 90, skew: q * 22, op: clamp(p * 2, 0, 1)};
      case 'block': return {clip: wipeClip(d, e), op: 1};
      case 'zoom': return {sx: 0.55 + e * 0.45, sy: 0.55 + e * 0.45, op: p};
      case 'burst': return {sx: backOut(p) * 0.98, sy: backOut(p) * 0.98, op: clamp(p * 2.5, 0, 1)};
      case 'compress': return {sx: 0.05 + e * 0.95, op: clamp(p * 2, 0, 1)};
      case 'bounce': return {ty: -Math.abs(Math.cos(p * Math.PI * 2.5)) * q * 60, op: clamp(p * 3, 0, 1)};
      case 'wave': return {ty: Math.sin(p * Math.PI * 3) * q * 30, op: clamp(p * 2, 0, 1)};
      case 'scale': return {rot: -q * 200, sx: e, sy: e, op: p};
      case 'flipboard': return {rotX: -q * 90, op: clamp(p * 2, 0, 1)};
      case 'billboard': return {rotY: q * 90, op: clamp(p * 2, 0, 1)};
      case 'roll': return {rot: -q * 180, tx: -q * 80, op: p};
      case 'dragonfly': return {tx: Math.sin(p * Math.PI * 2) * q * 40, ty: -q * 25, op: p};
      case 'typewriter': return {reveal: e};
      default: return {};
    }
  }

  /** 出场配方：p = 0 → 还在位，p = 1 → 走干净 */
  function exit(k, dir, p) {
    const e = inCubic(p);
    const d = dir || 'left';
    switch (k) {
      case 'fade': return {op: 1 - p};
      case 'ascent': return {ty: e * 45, op: 1 - p};            // Sink
      case 'fall': return {ty: e * 90, op: 1 - p, rot: e * 8};
      case 'stomp': return {ty: e * 60, sx: 1 + e * 0.3, sy: 1 + e * 0.3, op: 1 - p};
      case 'slide': {
        const s = d === 'left' ? {tx: -e * 130} : d === 'right' ? {tx: e * 130}
          : d === 'up' ? {ty: -e * 130} : {ty: e * 130};
        return Object.assign({op: clamp(1.6 - p * 1.6, 0, 1)}, s);
      }
      case 'skid': return {tx: e * 90, skew: -e * 22, op: 1 - p};
      case 'block': return {clip: wipeClip(d, 1 - e), op: 1};
      case 'zoom': return {sx: 1 + e * 0.5, sy: 1 + e * 0.5, op: 1 - p};
      case 'burst': return {sx: 1 - e * 0.6, sy: 1 - e * 0.6, op: 1 - p};   // Shrink
      case 'compress': return {sx: 1 + e * 1.2, op: 1 - p};                 // Decompress
      case 'scale': return {rot: e * 200, sx: 1 - e, sy: 1 - e, op: 1 - p};
      case 'flipboard': return {rotX: e * 90, op: 1 - p};
      case 'billboard': return {rotY: -e * 90, op: 1 - p};
      case 'roll': return {rot: e * 180, tx: e * 80, op: 1 - p};
      case 'dragonfly': return {tx: Math.sin(p * Math.PI * 2) * e * 40, ty: e * 25, op: 1 - p};
      default: return {};
    }
  }

  /** 循环配方：u = 这一轮里的相位 0…1 */
  function loop(k, u) {
    const w = u * Math.PI * 2;
    switch (k) {
      case 'pulse': return {sx: 1 + Math.sin(w) * 0.012, sy: 1 + Math.sin(w) * 0.012};
      case 'sway': return {rot: Math.sin(w) * 0.6};
      case 'float': return {ty: Math.sin(w) * 2.3};
      case 'rotate': return {rot: u * 360};
      case 'wavey': return {ty: Math.sin(w) * 7};
      case 'scale': return {sx: 1 + Math.sin(w) * 0.07, sy: 1 + Math.sin(w) * 0.07};
      case 'heartBeat': {
        // 两下：0…0.15 与 0.2…0.35 各鼓一次，其余时间归位
        const b = u < 0.15 ? Math.sin(u / 0.15 * Math.PI)
          : u < 0.2 ? 0 : u < 0.35 ? Math.sin((u - 0.2) / 0.15 * Math.PI) * 0.7 : 0;
        return {sx: 1 + b * 0.12, sy: 1 + b * 0.12};
      }
      case 'vogue': return {rot: Math.sin(w) * 3, sx: 1 + Math.cos(w) * 0.03, sy: 1 + Math.cos(w) * 0.03};
      case 'dragonfly': return {tx: Math.sin(w) * 4, ty: Math.cos(w * 2) * 3};
      case 'billboard': return {rotY: u * 360};
      case 'roll': return {rot: Math.sin(w) * 10, tx: Math.sin(w) * 6};
      default: return {};
    }
  }

  /** 擦除的裁剪框：p = 露出的比例 */
  function wipeClip(dir, p) {
    const g = Math.round((1 - clamp(p, 0, 1)) * 10000) / 100;
    if (dir === 'left') return 'inset(0 0 0 ' + g + '%)';
    if (dir === 'up') return 'inset(0 0 ' + g + '% 0)';
    if (dir === 'down') return 'inset(' + g + '% 0 0 0)';
    return 'inset(0 ' + g + '% 0 0)';
  }

  /* 三段叠加的次序与核心一致：先按入/出定一个基态，再把 loop 乘上去。
     入场与出场**不重叠**——出场段一旦开始，入场早就结束了；两段真撞上时（成员太短）
     以出场为准，否则会看到「刚淡入又淡入一次」。 */
  function at(anim, t, span) {
    const a = anim || {};
    const IN = a.in || {}; const OUT = a.out || {}; const LP = a.loop || {};
    const dur = span == null ? Infinity : span;
    const s = Object.assign({}, ID);
    if (t < 0) return Object.assign(s, {op: 0, hidden: true});
    if (dur !== Infinity && t > dur) return Object.assign(s, {op: 0, hidden: true});
    const od = OUT.k && OUT.k !== 'none' ? (OUT.dur || 0.6) : 0;
    const id = IN.k && IN.k !== 'none' ? (IN.dur || 0.6) : 0;
    const outStart = dur === Infinity ? Infinity : dur - od;
    if (od && t >= outStart) {
      merge(s, exit(OUT.k, OUT.dir, clamp((t - outStart) / od, 0, 1)));
    } else if (id && t < id) {
      merge(s, enter(IN.k, IN.dir, clamp(t / id, 0, 1)));
    }
    if (LP.k && LP.k !== 'none') {
      const ld = LP.dur || 2;
      merge(s, loop(LP.k, (t % ld) / ld), true);
    }
    return s;
  }

  /** loop 是**叠**在基态上的：位移相加、缩放相乘、透明度不动 */
  function merge(s, p, mul) {
    Object.keys(p).forEach((k) => {
      if (!mul) { s[k] = p[k]; return; }
      if (k === 'sx' || k === 'sy') s[k] *= p[k];
      else if (k === 'op' || k === 'reveal' || k === 'clip') s[k] = p[k];
      else s[k] += p[k];
    });
  }

  /** 求值结果 → 行内样式。位移是元素自身的百分比，所以 translate 写 % 就够。 */
  function css(s, base) {
    const t = [];
    if (base) t.push(base);
    if (s.tx || s.ty) t.push('translate(' + (s.tx || 0) + '%, ' + (s.ty || 0) + '%)');
    if (s.rot) t.push('rotate(' + Math.round(s.rot * 100) / 100 + 'deg)');
    if (s.rotX) t.push('rotateX(' + Math.round(s.rotX * 100) / 100 + 'deg)');
    if (s.rotY) t.push('rotateY(' + Math.round(s.rotY * 100) / 100 + 'deg)');
    if (s.skew) t.push('skewX(' + Math.round(s.skew * 100) / 100 + 'deg)');
    if (s.sx !== 1 || s.sy !== 1) t.push('scale(' + r3(s.sx) + ', ' + r3(s.sy) + ')');
    const out = {};
    if (t.length) out.transform = t.join(' ');
    if (s.op !== 1) out.opacity = r3(s.op);
    if (s.blur) out.filter = 'blur(' + r3(s.blur) + 'px)';
    if (s.clip) out.clipPath = s.clip;
    return out;
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;

  /** 打字机只露出前一段——按**字符数**取整，与核心 `typewriter` 的 PartUnit::Char 同口径 */
  function revealText(text, reveal) {
    const s = String(text == null ? '' : text);
    if (reveal >= 1) return s;
    return s.slice(0, Math.ceil(s.length * clamp(reveal, 0, 1)));
  }

  /** 三个槽全是「无」= 这条根本不动。画布靠它决定「按时间收放」还是「一直画着」：
      带动画的元素在自己的时间段之外本来就该看不见，不带动画的（演示装置那十二条）
      一直画着——否则默认播放头一落在 12.4s，画面上就只剩底图了。 */
  function isStatic(anim) {
    const a = anim || {};
    return ['in', 'out', 'loop'].every((s) => !a[s] || !a[s].k || a[s].k === 'none');
  }

  window.BC_TA = {at, css, enter, exit, loop, revealText, wipeClip, isStatic, ID};
})();
