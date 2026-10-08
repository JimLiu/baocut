/* 倒鸭子字幕的**视图层** —— 画面上那一张跨句 canvas，与画廊 / 预览条里的小样。

   普通字幕一条 cue 一行、动效字幕一条 cue 一张 canvas（subcaption.jsx）；这一族**跨句**：
   一段口播的若干条 cue 排成一个正交世界，镜头顺着念到的词推、拉、转，历史块留在原地
   淡下去。所以它不能挂在 stage.jsx 那条「按当前 cue 逐轨画一行」的循环里——那条循环在
   两条 cue 之间的空档里什么都不画，而这里的历史块与镜头在空档里必须还在。stage.jsx 在
   循环外单独挂它一次，源语言轨那一行在循环里跳过。

   模型（model-daoyazi.js，`BC_DZ`）给几何：`planFor` 编译整轨、`sample(plan, t)` 给这一
   帧的相机与词的透明度 / 弹入比例。这里只做模型做不了的三件事：

     1. **量宽**：`measureText`，按轨上的字体栈；缓存按「字号 | 文字」。
     2. **时钟**：画面走播放头真秒（`playT`）；悬停试穿（`loop`）没有播放头可读，那一格
        从播放头所在的动画段起循环放，与画廊小样同一只共享 RAF。
     3. **画**：每块一条 `setTransform`（相机矩阵 ∘ 块矩阵 × 设备缩放），词按弹入比例
        绕自身中心缩放；字幕区域之外裁掉；「纯色」背景铺在区域里。

   「调整布局」（`ctx.kineticEdit`，设计稿 §3.3 阶段 C）时镜头换成整段概览，块画描边，
   拖动一块就把它固定（写回 `kinetic.pins`），其余块下一次编译自动绕开。正常模式下这张
   canvas **不接指针**（`pointer-events: none`）——它铺满整幅画面，接了会把底下元素的
   拖动手势全吞掉；进属性页走 timeline 字幕行头或字幕 Tab。 */
(function () {
  const DZ = window.BC_DZ;
  const WA = window.BC_WA;
  const FALLBACK_STACK = '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Source Han Sans SC", system-ui, sans-serif';

  /* ---------- 共享 RAF 与时钟（与 subcaption.jsx 同一写法：一条 RAF、一张订阅表） ---------- */
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const EPOCH = nowMs();
  const raf = (() => {
    const subs = new Set();
    let id = null;
    const tick = () => { id = null; subs.forEach((f) => f()); if (subs.size) id = requestAnimationFrame(tick); };
    return {
      sub(fn) {
        subs.add(fn);
        if (!id) id = requestAnimationFrame(tick);
        return () => { subs.delete(fn); if (!subs.size && id) { cancelAnimationFrame(id); id = null; } };
      },
    };
  })();

  /* ---------- 量宽 ---------- */
  const measureCache = new Map();
  const measureCanvas = document.createElement('canvas');
  function measurer(stack) {
    const family = stack || FALLBACK_STACK;
    return (text, px) => {
      const key = family + '|' + px + '|' + text;
      if (measureCache.has(key)) return measureCache.get(key);
      const c = measureCanvas.getContext('2d');
      c.font = '700 ' + px + 'px ' + family;
      const w = c.measureText(text).width;
      measureCache.set(key, w);
      return w;
    };
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => measureCache.clear());

  /* 逐句换色：行的 `tone`（0 主色 / 1 强调 / 2 次强调）定底色；强调与「正在说」取另一档，
     撞色就让到剩下那一档（核心 `caption_sequence_word_color` 同口径）。 */
  function wordColor(word, fw, palette, tone) {
    const slots = [palette.primary, palette.accent, palette.secondary];
    const other = (slot) => slots[slot === tone ? 3 - slot : slot];
    if (fw.speaking) return other(1);
    if (word.role === 'hero') return other(2);
    if (word.role === 'emphasis') return other(1);
    return slots[tone];
  }

  /** 画一段：`blocks` 是 `sample` 给的可见块表（或编辑态的全亮表），`camera` 是相机姿态。 */
  function drawSequence(c, plan, seq, blocks, camera, alpha, s, palette, family, edit) {
    const camM = DZ.cameraMatrix(camera, plan.viewport);
    for (const fb of blocks) {
      const block = seq.blocks[fb.idx];
      let bm = DZ.blockMatrix(block);
      if (edit && edit.drag && edit.drag.key === block.key) bm = DZ.blockMatrix(Object.assign({}, block, {center: edit.drag.center}));
      const M = DZ.matMul(camM, bm);
      c.setTransform(M[0] * s, M[1] * s, M[2] * s, M[3] * s, M[4] * s, M[5] * s);
      c.textBaseline = 'middle'; c.textAlign = 'left';
      block.words.forEach((w, wi) => {
        const fw = fb.words[wi];
        if (!fw || fw.opacity <= 0) return;
        c.globalAlpha = Math.max(0, Math.min(1, alpha * fb.opacity * fw.opacity));
        c.font = '700 ' + w.font + 'px ' + family;
        c.fillStyle = wordColor(w, fw, palette, block.tone || 0);
        const cy = w.y + w.h / 2;
        // 叠在视频上（没铺底色）时描一圈深色边，画面再花也读得清；舞台模式铺了底就不描
        const outlined = plan.options.presentation.mode !== 'stage';
        if (outlined) { c.lineJoin = 'round'; c.lineWidth = w.font * 0.09; c.strokeStyle = 'rgb(18 18 20)'; }
        if (fw.scale !== 1) {
          // typeMonkey.js `zoomIn`：以左中为原点放大（逐词时是词的左边，整块时是行的左边）
          const ox = fw.ox == null ? w.x : fw.ox;
          c.save(); c.translate(ox, cy); c.scale(fw.scale, fw.scale); c.translate(-ox, -cy);
          if (outlined) c.strokeText(w.text, w.x, cy);
          c.fillText(w.text, w.x, cy); c.restore();
        } else { if (outlined) c.strokeText(w.text, w.x, cy); c.fillText(w.text, w.x, cy); }
      });
      if (edit) {
        const zoom = camera.zoom * s;
        const on = block.key === edit.selectedKey;
        c.globalAlpha = 1;
        c.lineWidth = (on ? 3 : 1.5) / zoom;
        c.setLineDash(block.placement === 'pinned' ? [] : [6 / zoom, 4 / zoom]);
        c.strokeStyle = on ? palette.primary : (block.placement === 'pinned' ? palette.secondary : palette.primary);
        if (!on && block.placement !== 'pinned') c.globalAlpha = 0.55;
        c.strokeRect(-6 / zoom, -6 / zoom, block.w + 12 / zoom, block.h + 12 / zoom);
        c.setLineDash([]);
        if (block.placement === 'pinned') {
          c.globalAlpha = 1; c.fillStyle = palette.secondary;
          c.beginPath(); c.arc(-6 / zoom, -6 / zoom, 5 / zoom, 0, Math.PI * 2); c.fill();
        }
      }
    }
    c.globalAlpha = 1;
  }

  function hitBlock(plan, seq, blocks, camera, pt) {
    const camM = DZ.cameraMatrix(camera, plan.viewport);
    for (let i = blocks.length - 1; i >= 0; i--) {
      const block = seq.blocks[blocks[i].idx];
      const p = DZ.apply(DZ.matInv(DZ.matMul(camM, DZ.blockMatrix(block))), pt);
      if (p[0] >= 0 && p[1] >= 0 && p[0] <= block.w && p[1] <= block.h) return block;
    }
    return null;
  }

  /** 编译一份计划（memo 在调用方）。`fit` 是画面框的像素尺寸，画幅从它来。 */
  function usePlan(cues, kin, env) {
    const key = JSON.stringify([kin, env.aspect, env.bilingual, env.highlight, env.fontPx, env.family]);
    return React.useMemo(() => kin ? DZ.planFor(cues, kin, {
      aspect: env.aspect, measure: measurer(env.family), fontPx: env.fontPx, bilingual: env.bilingual,
      highlight: env.highlight, split: WA.split, duration: env.duration,
    }) : null, [cues, key]);
  }

  /** 画一帧到 canvas。`edit` 给的时候画整段概览与描边。 */
  function paint(canvas, plan, t, palette, family, edit) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(rect.width * dpr)), H = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const c = canvas.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    if (!plan) return;
    const s = W / plan.ref.w;
    const vp = plan.viewport;
    c.setTransform(s, 0, 0, s, 0, 0);
    if (plan.options.presentation.mode === 'stage') { c.fillStyle = palette.bg; c.fillRect(vp.x, vp.y, vp.w, vp.h); }
    if (edit) {
      c.globalAlpha = 0.5; c.strokeStyle = palette.primary; c.setLineDash([6, 4]); c.lineWidth = 1;
      c.strokeRect(vp.x, vp.y, vp.w, vp.h); c.setLineDash([]); c.globalAlpha = 1;
    }
    c.save();
    c.beginPath(); c.rect(vp.x, vp.y, vp.w, vp.h); c.clip();
    if (edit && edit.seqIdx >= 0) {
      const seq = plan.sequences[edit.seqIdx];
      const cam = DZ.overviewFor(seq.world, 0, {viewport: plan.viewport});
      const all = seq.blocks.map((b, idx) => ({idx, opacity: 1, words: b.words.map(() => ({opacity: 1, scale: 1, speaking: false}))}));
      drawSequence(c, plan, seq, all, cam, 1, s, palette, family, edit);
    } else {
      const frame = DZ.sample(plan, t);
      if (frame.fading) {
        const prev = plan.sequences[frame.fading.seqIdx];
        const pf = DZ.sample(plan, plan.sequences[frame.seqIdx].cutAt - 1e-4);
        // 镜头飞往下一段的路上，上一段还留在同一张画布上——用当前相机画它（fading.camera 为 null）
        drawSequence(c, plan, prev, pf.blocks, frame.fading.camera || frame.camera, frame.fading.alpha, s, palette, family, null);
      }
      if (frame.seqIdx >= 0) drawSequence(c, plan, plan.sequences[frame.seqIdx], frame.blocks, frame.camera, 1, s, palette, family, null);
    }
    c.restore();
  }

  /** 试穿 / 小样的循环时钟：从 `from` 起放 `span` 秒，回到 `from`。 */
  const loopT = (from, span) => from + ((nowMs() - EPOCH) / 1000) % Math.max(0.5, span);

  /* ---------- 画面上那一张 ---------- */
  function DaoyaziStage({ctx, track, kin, cues, playT, loop, fit, bilingual, duration, editable}) {
    const ref = React.useRef(null);
    const dragRef = React.useRef(null);
    const [drag, setDrag] = React.useState(null);
    const family = track.stack || FALLBACK_STACK;
    const palette = DZ.PALETTES[kin.paletteIdx] || DZ.PALETTES[0];
    const plan = usePlan(cues, kin, {
      aspect: {w: fit.w, h: fit.h}, fontPx: 36, bilingual, highlight: track.highlight, family, duration,
    });
    const editing = editable && ctx.kineticEdit;
    const seqIdx = plan ? DZ.seqIndexAt(plan, playT) : -1;
    const edit = editing ? {seqIdx: Math.max(0, seqIdx), selectedKey: ctx.kineticEdit.selectedKey, drag} : null;

    const draw = React.useCallback((t) => {
      if (ref.current) paint(ref.current, plan, t, palette, family, edit);
    }, [plan, palette, family, edit]);

    React.useEffect(() => { if (!loop) draw(playT); }, [draw, playT, loop]);
    React.useEffect(() => {
      if (!loop || !plan) return undefined;
      const seq = plan.sequences[Math.max(0, seqIdx)];
      const from = seq ? seq.start - 0.2 : 0;
      const span = seq ? seq.visibleUntil - from + 0.4 : 4;
      return raf.sub(() => draw(loopT(from, span)));
    }, [draw, loop, plan, seqIdx]);
    const toRef = (e) => {
      const r = ref.current.getBoundingClientRect();
      const s = r.width / plan.ref.w;
      return [(e.clientX - r.left) / s, (e.clientY - r.top) / s];
    };
    const onDown = (e) => {
      if (!edit || !plan || e.button !== 0) return;
      e.stopPropagation();
      const seq = plan.sequences[edit.seqIdx];
      if (!seq) return;
      const cam = DZ.overviewFor(seq.world, 0, {viewport: plan.viewport});
      const all = seq.blocks.map((b, idx) => ({idx}));
      const hit = hitBlock(plan, seq, all, cam, toRef(e));
      ctx.setKineticEdit({selectedKey: hit ? hit.key : null});
      if (!hit) return;
      const inv = DZ.matInv(DZ.cameraMatrix(cam, plan.viewport));
      dragRef.current = {key: hit.key, start: DZ.apply(inv, toRef(e)), center0: hit.center.slice(), inv, moved: false};
      e.currentTarget.setPointerCapture(e.pointerId);
    };
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const p = DZ.apply(d.inv, toRef(e));
      d.moved = true;
      setDrag({key: d.key, center: [d.center0[0] + p[0] - d.start[0], d.center0[1] + p[1] - d.start[1]]});
    };
    const onUp = (e) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (d.moved) {
        const p = DZ.apply(d.inv, toRef(e));
        // pins 存的是本段局部坐标（块 center 是全局值 = localCenter + seq.origin）
        const seq = plan.sequences[edit.seqIdx];
        const origin = seq ? seq.origin : [0, 0];
        const center = [DZ.q(d.center0[0] + p[0] - d.start[0] - origin[0]), DZ.q(d.center0[1] + p[1] - d.start[1] - origin[1])];
        const block = plan.sequences.flatMap((s) => s.blocks).find((b) => b.key === d.key);
        const pins = Object.assign({}, kin.pins, {[d.key]: {center, rotDeg: (kin.pins[d.key] && kin.pins[d.key].rotDeg) || (block ? block.rotDeg : 0)}});
        ctx.setSubTrack(track.id, {kinetic: Object.assign({}, kin, {pins})});
      }
      setDrag(null);
    };

    return (
      <canvas ref={ref} className={cx('dzstage', editing && 'is-edit', drag && 'is-drag')}
        aria-label="倒鸭子字幕"
        onPointerDown={editing ? onDown : undefined} onPointerMove={editing ? onMove : undefined}
        onPointerUp={editing ? onUp : undefined} onPointerCancel={editing ? onUp : undefined}
        onClick={editing ? (e) => e.stopPropagation() : undefined} />
    );
  }

  /* ---------- 画廊 / 预览条里的小样 ----------
     三条短 cue 循环放 6 秒：看得见「铺开 → 镜头推过去 → 转向」三件事。文字给一句
     就切三段，不给就用样张。 */
  const SAMPLE = ['字幕铺在画面上，', '镜头跟着念到的词走，', '关键词放大，转个直角。'];
  function DaoyaziThumb({text, kin, fontPx = 22, highlight}) {
    const ref = React.useRef(null);
    const [box, setBox] = React.useState({w: 176, h: 96});
    const k = kin || DZ.defaults();
    const palette = DZ.PALETTES[k.paletteIdx] || DZ.PALETTES[0];
    const cues = React.useMemo(() => {
      const parts = text ? String(text).split(/(?<=[，。！？；,.!?;])/).filter((s) => s.trim()) : SAMPLE;
      const per = 6 / parts.length;
      return parts.map((p, i) => ({id: 's' + i, start: i * per, end: (i + 1) * per - 0.1, sp: 'a', text: p.trim()}));
    }, [text]);
    const plan = usePlan(cues, k, {aspect: {w: box.w, h: box.h}, fontPx, bilingual: false, highlight: null, family: FALLBACK_STACK, duration: 6.4});
    React.useLayoutEffect(() => {
      const el = ref.current; if (!el) return undefined;
      const ro = new ResizeObserver(([e]) => setBox({w: Math.max(1, e.contentRect.width), h: Math.max(1, e.contentRect.height)}));
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    React.useEffect(() => {
      if (!ref.current) return undefined;
      if (window.subReduced) { paint(ref.current, plan, 2.2, palette, FALLBACK_STACK, null); return undefined; }
      return raf.sub(() => paint(ref.current, plan, loopT(0, 6.4), palette, FALLBACK_STACK, null));
    }, [plan, palette]);
    return <canvas ref={ref} className="dzthumb" aria-hidden="true" />;
  }

  Object.assign(window, {DaoyaziStage, DaoyaziThumb});
})();
