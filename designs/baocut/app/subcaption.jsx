/* 动效字幕（emphasis 那 17 份）的**视图层** —— 第 71 轮起是 canvas 2D，不是 DOM。

   普通字幕样式（那 31 份 classic）仍走 `WordLine`：那一族只有涂装 ＋ 一个逐词动效枚举，
   一条 `paintCss` 加一张取帧表就画完了，CSS 装得下。**这一族装不下。** 一份 emphasis preset
   自带排版、自带逐词规则、自带四档时间通道（词 / 字形簇 / 行 / 整条），上一轮用
   `@keyframes` ＋ `--vc-box-*` 的 `@property` 伪元素硬凑，换来三处结构性近似：
   一格里各通道缓动不一致就切五份线性子采样、块只能走伪元素（于是有个 0.1em 的高度地板）、
   词前起跳靠负 `animation-delay` ＋ 拉长时长。用户的裁决是「按预设自带的算法在
   canvas 上画」，三处一起没了。

   模型层（[model-motioncaption.js](model-motioncaption.js)，`window.BC_VC`）出两样东西：
   `layoutOf()` 给排版、`plan(preset, layout, t)` 给**绘制指令表**（全数值，无 CSS 串）。
   **这里只做模型做不了的四件事**：

     1. **量宽**：`measureText`（模型注入用；node 测试注入等宽假量尺）；
     2. **拆字形簇**：`Intl.Segmenter`——emoji 与组合字符按码位切就是两个半个字；
     3. **时钟**：画廊 / 预览条走循环时间线（与节拍器同 epoch 同相位），画面走播放头真秒；
     4. **画**：一条共享 RAF 驱动全部挂载中的 canvas，按指令表 `fillText` / `roundRect`。

   ## 时间是求值，不是「挂动画」

   每一帧都 `plan(t)` 重算一遍。词的时间门控因此是模型的性质而不是视图的补丁：没到自己的
   窗口取首帧（多半 alpha 0，指令表里根本不发这一条）、窗口内按 t、过窗停末帧。上一轮
   CSS 路径在这一格上栽过——真轨只能挂在「当前词」上，于是 persistent 那 9 份要么全亮、
   要么静息拍重播一遍入场。现在没有「当前词」这个概念参与取帧，只有 t。

   ## 混合模式是合成，不是动画

   Slab 的 `exclusion` 与 Fusion 的 `difference` 要拿**画面本身**当底色，canvas 画不到自己
   底下的像素——所以那一格挂在 canvas 元素的 CSS `mix-blend-mode` 上，把字幕层交给合成器混合。
   这不违背「不用 CSS 做动画」那条裁决：它是一个静态的合成声明。
   代价记在这儿：一张 canvas 只有一个合成单元，Slab（全词 exclusion）是精确的，
   Fusion（只有强调词 difference）是整条一起混，属近似。

   ## 三条视图侧裁决（模型层给不出）

   1. **容器宽度是排版的输入**：`wrapWidth` / `computedScale` 都按它折算，所以量的是
      宿主的 `clientWidth`（`ResizeObserver` 跟着变）。
   2. **高度由排版决定**：canvas 的 CSS 高度每帧按 `layout.boxH` 写回去，行数变了行高跟着变。
      写的是 DOM 属性不是 React state——每帧 setState 会把整页拖垮。
   3. **字体是异步来的**：`document.fonts.ready` 之后清一次量宽缓存并整体重画，
      否则 17 张卡会停在回落字体的宽度上。 */
(function () {
  const V = window.BC_VC;
  const WA = window.BC_WA;

  /* ---------- 时钟源 ----------
     epoch 定在本模块加载的那一刻，节拍器（panel-substyle.jsx）读同一个——
     整页卡片因此同相位，不会各闪各的。 */
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const EPOCH = nowMs();

  /* ---------- 共享 RAF ----------
     一屏 17 张卡各起一条 RAF 就是 17 条回调链。照节拍器的写法：一条 RAF、一张订阅表、
     没人订阅就停（面板一关不再空转）。 */
  const raf = (() => {
    const subs = new Set();
    let id = null;
    const tick = () => {
      id = null;
      subs.forEach((f) => f());
      if (subs.size) id = requestAnimationFrame(tick);
    };
    return {
      sub(fn) {
        subs.add(fn);
        if (!id) id = requestAnimationFrame(tick);
        return () => {
          subs.delete(fn);
          if (!subs.size && id) { cancelAnimationFrame(id); id = null; }
        };
      },
      size: () => subs.size,
    };
  })();

  /* ---------- 量宽 ----------
     `measureText` 是这一层最贵的调用（一帧几百次），所以按 (字体, 字距, 文本) 缓存。
     缓存的是纯函数的结果；字体就位后整张作废重量（`FONTGEN` 让排版缓存也一起失效）。 */
  let MCTX = null;
  const mctx = () => (MCTX || (MCTX = document.createElement('canvas').getContext('2d')));
  const MC = new Map();
  let FONTGEN = 0;
  const fontStr = (f) => (f.italic ? 'italic ' : '') + (f.weight || 400) + ' '
    + (Math.round(f.sizePx * 100) / 100) + 'px ' + f.family;
  /** `letterSpacing` 是 Chromium/Safari 都有的 canvas 属性；没有的浏览器字距落回 0，
   *  排版会略紧——比逐字 advance 拼一遍便宜得多，且这一族的字距都在 ±0.1em 内。 */
  const HAS_TRACK = (() => { const c = mctx(); return 'letterSpacing' in c; })();
  function measure(text, face) {
    const font = fontStr(face);
    const tr = (face.trackEm || 0) * face.sizePx;
    const key = FONTGEN + '|' + font + '|' + tr.toFixed(2) + '|' + text;
    let m = MC.get(key);
    if (m === undefined) {
      const c = mctx();
      c.font = font;
      if (HAS_TRACK) c.letterSpacing = tr.toFixed(2) + 'px';
      const t = c.measureText(text);
      m = {w: t.width,
        ascent: t.fontBoundingBoxAscent || face.sizePx * 0.92,
        descent: t.fontBoundingBoxDescent || face.sizePx * 0.28};
      if (MC.size > 20000) MC.clear();
      MC.set(key, m);
    }
    return m;
  }

  /* 5 份带字符级动画（Linen / Hush / Quill / Terminal / Whisper）。按码位切会把 emoji 与
     组合字符切成两个半个字，所以走 `Intl.Segmenter`；老浏览器退化到 `Array.from`。 */
  const SEG = (typeof Intl !== 'undefined' && Intl.Segmenter)
    ? new Intl.Segmenter(undefined, {granularity: 'grapheme'}) : null;
  const graphemes = (s) => (SEG ? Array.from(SEG.segment(s), (g) => g.segment) : Array.from(String(s)));

  /* 字体一就位，宽度全变——清缓存并把代数往前推一格，所有 canvas 下一帧重量重排。 */
  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { MC.clear(); FONTGEN++; });
  }

  /* ---------- 涂装（配方接管整条） ----------
     一份配方落下去连**排版**一起换（§13.2 第 54 轮的语义），所以涂装取 `BC_VC.byKey(k).paint`，
     不读轨上的字体 / 色 / 描边。属性页那一条「动效字幕 · 来自样式」读的就是它。 */
  function captionPaint(k) {
    const p = V.byKey(k);
    if (!p) return null;
    return Object.assign({}, p.paint, {stack: V.fontOf(p.paint.font).stack});
  }
  const captionFz = (k, fz) => V.captionFontPx(k, fz);

  /* ---------- 画 ----------
     `ctx.filter` 在 Chromium / Safari 17+ 都有；没有的浏览器落 `shadowBlur` 近似
     （只糊得出一圈外发光，糊不出「整个字形散开」，Whisper 与 Hush 的聚焦会偏软）。 */
  const HAS_FILTER = (() => {
    const c = mctx();
    const was = c.filter;
    c.filter = 'blur(1px)';
    const ok = c.filter !== 'none';
    c.filter = was;
    return ok;
  })();

  function rrect(c, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    if (c.roundRect) { c.beginPath(); c.roundRect(x, y, w, h, rr); return; }
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  /** 一条绘制指令。`dpr` 要单独乘进模糊半径与阴影：`filter` / `shadowBlur` 走的是
   *  设备像素，不吃 `setTransform` 那一格缩放。 */
  function paintOp(c, o, dpr) {
    c.save();
    c.globalAlpha = Math.max(0, Math.min(1, o.alpha));
    if (o.blend) c.globalCompositeOperation = o.blend;
    if (o.kind === 'box') {
      if (o.blur > 0) {
        if (HAS_FILTER) c.filter = 'blur(' + (o.blur * dpr).toFixed(2) + 'px)';
        else { c.shadowColor = o.fill; c.shadowBlur = o.blur * dpr; }
      }
      c.fillStyle = o.fill || 'transparent';
      rrect(c, o.x, o.y, o.w, o.h, o.r);
      c.fill();
      c.restore();
      return;
    }
    const tf = o.tf;
    c.translate(tf.ox + tf.tx, tf.oy + tf.ty);
    if (tf.rot) c.rotate((tf.rot * Math.PI) / 180);
    if (tf.sx !== 1 || tf.sy !== 1) c.scale(tf.sx, tf.sy);
    c.translate(-tf.ox, -tf.oy);
    c.font = fontStr(o.face);
    if (HAS_TRACK) c.letterSpacing = (o.tracking || 0).toFixed(2) + 'px';
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    if (o.blur > 0 && HAS_FILTER) c.filter = 'blur(' + (o.blur * dpr).toFixed(2) + 'px)';
    if (o.shadow && o.shadow.color) {
      c.shadowColor = o.shadow.color;
      c.shadowBlur = o.shadow.blur * dpr;
      c.shadowOffsetX = o.shadow.dx;
      c.shadowOffsetY = o.shadow.dy;
    }
    /* `paint-order: stroke fill` 的语义：描边居中但朝内那一半被填充盖住，看得见的是
       朝外的那一半——所以笔宽给两倍，再用填充盖回来。描边就该是往外长的。 */
    if (o.stroke && o.stroke.w > 0) {
      c.lineWidth = o.stroke.w * 2;
      c.lineJoin = 'round';
      c.strokeStyle = o.stroke.color;
      c.strokeText(o.text, o.x, o.y);
    }
    c.fillStyle = o.fill;
    c.fillText(o.text, o.x, o.y);
    // 辉光（`shDist === 0`）在 CSS 里是叠两层阴影，canvas 里就是再落一遍
    if (o.shadow && o.shadow.glow) c.fillText(o.text, o.x, o.y);
    c.restore();
  }

  const BLEND = {multiply: 'multiply', difference: 'difference', exclusion: 'exclusion'};

  /* ---------- 一条动效字幕 ---------- */

  /** `presetK` 是预设的 preset id（卡片 id 与轨上的 `caption` 都是它）。
   *
   *  两种时钟，二选一：
   *    `loop`      画廊 / 预览条。循环时间线，与共享节拍器同 epoch：一个词一拍，
   *                末尾多一拍静息（没有它，循环回第一个词时看不出「重新开始」）。
   *    `t` + `dur` 画面。`t` 是**播放头减 cue 起点**的真秒，词窗按 cue 时长均分
   *                （演示口径，与 `BC_WA.at` 同一条）。暂停时不跑 RAF，画当前 t 的静帧。
   *
   *  `fz` 是**基准**字号，真字号由 `layout.size` 折算；`still` = 不许动（reduced-motion）。 */
  function CaptionCanvas({presetK, text, fz = 20, still, loop, t, dur}) {
    const host = React.useRef(null);
    const cvs = React.useRef(null);
    const cache = React.useRef({key: null, layout: null});
    const props = React.useRef(null);
    props.current = {presetK, text, fz, still, loop, t, dur};

    const draw = React.useCallback(() => {
      const el = host.current, cv = cvs.current;
      if (!el || !cv) return;
      const P = props.current;
      const p = V.byKey(P.presetK);
      if (!p) return;
      const bw = el.clientWidth;
      if (!bw) return;
      const words = WA.split(P.text);
      const n = Math.max(1, words.length);

      // ---- 时钟：算出 cue 相对秒 `tt`、cue 时长与词窗
      let tt, cueDur, wins;
      if (P.loop) {
        cueDur = (n + 1) * V.BEAT;
        wins = words.map((_, i) => [i * V.BEAT, (i + 1) * V.BEAT]);
        tt = P.still ? 0 : ((nowMs() - EPOCH) / 1000) % cueDur;
      } else {
        cueDur = Math.max(1e-3, P.dur || n * V.BEAT);
        const step = cueDur / n;
        wins = words.map((_, i) => [i * step, (i + 1) * step]);
        tt = P.t === undefined ? 0 : P.t;
      }
      let cur = Math.floor(tt / (wins[0][1] - wins[0][0]));
      if (P.still) cur = Math.min(1, n - 1);

      const key = P.presetK + '|' + P.text + '|' + P.fz + '|' + Math.round(bw) + '|'
        + Math.max(-1, Math.min(cur, n)) + '|' + Math.round(cueDur * 1e3) + '|' + FONTGEN;
      if (cache.current.key !== key) {
        cache.current = {key: key, layout: V.layoutOf(p, words, measure, {
          fz: P.fz, boxW: bw, cur: cur, cueDur: cueDur, wins: wins,
          joint: WA.joint, graphemes: graphemes,
        })};
      }
      const lay = cache.current.layout;
      // reduced-motion 画签名帧：当前词窗走到 35% 的那一刻，看得出是哪一种，只是不动
      if (P.still) tt = V.stillT(lay, cur);

      const h = Math.max(1, Math.ceil(lay.boxH));
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const pw = Math.round(bw * dpr), ph = Math.round(h * dpr);
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      if (cv.style.height !== h + 'px') cv.style.height = h + 'px';
      /* 宿主把画布**按墨迹带**对中，不按画布高对中（第 72 轮）。画布要装下入场轨迹——
         Backdrop+ 的强调词从 −3em 的画面外飞进来，于是 193px 的画布里有一百多 px 是空的。
         按画布高对中就等于把那截空档也算进中线，字被顶出格子。这一格是**视图的事**：
         排版报的是 `ink`（字落定之后占的那一段），这里把画布反向挪一挪让墨迹居中。 */
      const shift = Math.round(h / 2 - (lay.ink.top + lay.ink.bot) / 2);
      const top = shift ? shift + 'px' : '0px';
      if (cv.style.top !== top) cv.style.top = top;

      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, bw, h);
      const pl = V.plan(p, lay, tt, {});
      const bm = pl.blend ? BLEND[pl.blend] || '' : '';
      if (cv.style.mixBlendMode !== bm) cv.style.mixBlendMode = bm;
      pl.ops.forEach((o) => paintOp(c, o, dpr));
    }, []);

    React.useLayoutEffect(() => {
      const el = host.current;
      if (!el) return undefined;
      draw();
      if (typeof ResizeObserver === 'undefined') return undefined;
      const ro = new ResizeObserver(draw);
      ro.observe(el);
      return () => ro.disconnect();
    }, [draw]);

    // 画面那一路没有自己的 RAF：播放头一动整块屏就重渲染，重画跟着来
    React.useEffect(() => { draw(); });
    // 循环那一路才订阅共享 RAF；`still` 下不订阅（画一帧签名帧就停）
    React.useEffect(() => (loop && !still ? raf.sub(draw) : undefined), [loop, still, draw]);

    return (
      <div className="vccan" ref={host}>
        <canvas ref={cvs} aria-hidden="true" />
        <span className="vccan__a">{text}</span>
      </div>
    );
  }

  Object.assign(window, {CaptionCanvas, captionPaint, captionFz,
    captionEpoch: EPOCH, captionNow: nowMs, captionRaf: raf});
})();
