/* 框选与多选统一框 —— §6（第 115 轮）。
   ============================================================================
   两件事共用「舞台上的一次拖拽」这条输入，所以写在一起：

   **框选**（`useMarquee`）。在画面空白处按下并拖过 4px（`BC_SELECT.MARQUEE_MIN`）
   就画一个 `.marquee`，松手用 `BC_SELECT.hitRect` 收相交的元素。阈值不是装饰——
   点空白清选中和框选起手是同一个 mousedown，手一抖就会把「清选」变成「框选到 0 件」，
   于是画面看起来像卡住了。没过阈值的那一次全程不画框，也不吞后面的 click。
   过了阈值的那一次要**吞掉**紧随其后的 click（`swallow()`）：浏览器在 mouseup 之后
   还会补发一次 click，不吞的话刚框中的东西会立刻被清掉。

   主视频不参与框选（§6）：它铺满整幅画面，任何一个框都与它相交，框谁都等于连它一起选。
   它只能点选。2026-09-16 起项目原片是普通视频元素，没有 `clip:` 键可认，改按「盒子盖满整幅画面」认
   （与 App 的 `isMainVideo` 同一个用意）。字幕轨（2026-10-09 起）参与框选：框住双语两行就两行都选上，拖统一框一起挪；
   同一框里既有元素又有字幕轨时只留元素（`BC_SELECT.marqueePick`）。

   **统一框**（`MultiBox`）。选到 ≥2 件时，逐件的手柄全部收起（成员只留一条细描边
   `.selthin`），改画一个外包框 `.selbox.is-multi`：可整体拖动、四角等比缩放，**没有
   旋转钮**——绕组中心转要同时改每件的 rot 与位置，语义上更接近「成组」，这一轮不做。
   两种手势都只记一条历史（`history.begin()` → mouseup `commit()`）。

   **字幕轨的统一框**（`SubsMultiBox`，2026-10-09）。选到 ≥2 条字幕轨时画的外包框：只能整体拖动，
   没有四角（字幕的大小是字号，不是倍率）；按下不拖就松手，只留按在的那一条。
   ============================================================================ */
(function () {
  const {useState, useRef, useCallback, useEffect} = React;
  const S = window.BC_SELECT;
  const P = window.BC_POSE;

  const rectOf = (n) => n.getBoundingClientRect();

  /** 节点在框选里的键：字幕轨是 `subs:<轨 id>`（选中的那条挂在选中框的 `data-el` 上，其余挂 `data-subs`）。 */
  const pickKey = (n) => (n.dataset.subs ? 'subs:' + n.dataset.subs : String(n.dataset.el || ''));

  /** 盒子盖满整幅画面（各边容 1px 的取整差）：铺满画面的原片，任何一个框都与它相交。 */
  const coversFrame = (r, fr) => r.left <= fr.left + 1 && r.top <= fr.top + 1
    && r.right >= fr.right - 1 && r.bottom >= fr.bottom - 1;

  /** 帧内可框选的对象：`data-el` 上挂的普通元素与画面字幕轨，排除主视频与盖满画面的元素。 */
  const pickables = (frameEl) => {
    if (!frameEl) return [];
    const fr = rectOf(frameEl);
    return Array.prototype.slice.call(frameEl.querySelectorAll('[data-el], [data-subs]'))
      .filter((n) => {
        const k = pickKey(n);
        return k && k.indexOf('clip:') !== 0 && n.offsetWidth > 0 && !coversFrame(rectOf(n), fr);
      })
      .map((n) => {
        const r = rectOf(n);
        return {id: pickKey(n), x: r.left - fr.left, y: r.top - fr.top, w: r.width, h: r.height};
      });
  };

  /* ---------- 框选 ---------- */
  function useMarquee(ctx, frameRef) {
    const [box, setBox] = useState(null);
    const swallowRef = useRef(false);
    /* 拖拽中的 window 监听挂在这里：只有 mouseup 摘除的话，拖到一半组件被卸载
       （切页 / 关编辑器）就永久留了两个监听，还捏着已卸载组件的 setState。 */
    const liveRef = useRef(null);
    useEffect(() => () => {
      const h = liveRef.current;
      if (!h) return;
      liveRef.current = null;
      window.removeEventListener('mousemove', h.move);
      window.removeEventListener('mouseup', h.up);
    }, []);

    /** 上一次拖拽是否该吞掉尾随的 click。读一次就复位——它只挡那一次。 */
    const swallow = useCallback(() => {
      if (!swallowRef.current) return false;
      swallowRef.current = false;
      return true;
    }, []);

    const onMouseDown = useCallback((e) => {
      const frameEl = frameRef.current;
      if (e.button !== 0 || !frameEl) return;
      /* 落在某件对象上的按下交给那件自己（移动手势）；只有空白与主视频面起框选。 */
      const t = e.target;
      if (t.closest && t.closest('.selwrap, .mtb, .hnd, .rot')) return;
      const fr = rectOf(frameEl);
      const p0 = {x: e.clientX - fr.left, y: e.clientY - fr.top};
      const add = e.shiftKey || e.metaKey || e.ctrlKey;
      let live = null;
      const move = (ev) => {
        const r = S.marqueeRect(p0, {x: ev.clientX - fr.left, y: ev.clientY - fr.top});
        live = r.on ? r : null;
        setBox(live);
      };
      const up = () => {
        liveRef.current = null;
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        setBox(null);
        if (!live) return;                       // 没过阈值：这就是一次普通点击
        swallowRef.current = true;
        const ids = S.hitRect(pickables(frameEl), live);
        const hits = ids.map((id) => (id.indexOf('subs:') === 0 ? {kind: 'subs', trackId: id.slice(5)} : {kind: 'element', id,
          elKind: (((ctx.elements || []).filter((x) => x.id === id)[0]) || {}).kind}));
        ctx.pickMany(S.marqueePick(add ? ctx.sels : [], hits));
      };
      liveRef.current = {move, up};
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }, [ctx, frameRef]);

    return {box, onMouseDown, swallow};
  }

  function Marquee({box}) {
    if (!box) return null;
    return <div className="marquee" style={{left: box.x, top: box.y, width: box.w, height: box.h}} />;
  }

  /* ---------- 多选统一框 ---------- */
  /** 一件成员当前的摆位（百分比中心 ＋ 倍率）。主视频与元素两套存放处在这里合流。 */
  const poseOfSel = (ctx, s) => P.poseOf(ctx.elDocs[s.id]);
  const writePose = (ctx, s, patch) => ctx.setElPose(s.id, patch);

  /** 统一框的外包盒。**必须在 layout 阶段量**：render 里读 DOM 读到的是上一帧的位置，
      撤销或整体拖动之后框会慢一拍留在原地。每次渲染后重量一遍，值没变就不 setState。
      `query` 给出成员在帧里的节点选择器（元素按 `data-el`，字幕轨按 `data-subs`）。 */
  const elQuery = (s) => '[data-el="' + memberKey(s) + '"]';
  const useBounds = (members, frameRef, deps, query = elQuery) => {
    const [b, setB] = useState(null);
    React.useLayoutEffect(() => {
      const frameEl = frameRef.current;
      if (!frameEl || members.length < 2) { setB((p) => (p == null ? p : null)); return; }
      const fr = rectOf(frameEl);
      const rects = members.map((s) => {
        const n = frameEl.querySelector(query(s));
        if (!n) return null;
        const r = rectOf(n);
        return {id: memberKey(s), x: r.left - fr.left, y: r.top - fr.top, w: r.width, h: r.height};
      }).filter(Boolean);
      const nb = S.boundsOf(rects);
      setB((prev) => (prev && nb && prev.x === nb.x && prev.y === nb.y
        && prev.w === nb.w && prev.h === nb.h ? prev : nb));
    }, deps);
    return b;
  };

  const memberKey = (s) => s.id;

  /** 一次组手势：起手把每件的摆位冻住（`start`），全程按同一个 delta / 同一个 f 写回去。
      没动就松手时调 `still(p0)`（可省）。 */
  const runGesture = (ctx, setDrag, e, start, step, still) => {
    e.preventDefault(); e.stopPropagation();
    const p0 = {x: e.clientX, y: e.clientY};
    let moved = false;
    setDrag(true);
    if (ctx.history) ctx.history.begin();
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - p0.x) < P.DEAD_ZONE
                 && Math.abs(ev.clientY - p0.y) < P.DEAD_ZONE) return;
      moved = true;
      step(start, p0, {x: ev.clientX, y: ev.clientY});
    };
    const up = () => {
      setDrag(false);
      if (ctx.history) { if (moved) ctx.history.commit(); else ctx.history.cancel(); }
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (!moved && still) still(p0);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  function MultiBox({ctx, frameRef}) {
    const members = S.elMembers(ctx.sels);
    const [drag, setDrag] = useState(false);
    const b = useBounds(members, frameRef, [ctx.selKeys, ctx.elDocs, ctx.playing]);
    if (members.length < 2 || ctx.playing || !b) return null;
    const frameEl = frameRef.current;
    if (!frameEl) return null;
    const fr = rectOf(frameEl);

    const gesture = (e, step) => runGesture(ctx, setDrag, e,
      members.map((s) => Object.assign({sel: s}, poseOfSel(ctx, s))), step);

    const startMove = (e) => {
      if (e.button !== 0) return;
      gesture(e, (start, p0, p) => {
        /* 位移先按**全组**夹到限位里再逐件加，否则先撞边的那件会停下、其余继续走，
           一次拖动就把组拖变形了（`groupShift` 的注释里有这条）。 */
        const d = S.groupShift(start, (p.x - p0.x) / fr.width * 100,
          (p.y - p0.y) / fr.height * 100);
        start.forEach((it) => writePose(ctx, it.sel,
          {x: P.round1(it.x + d.dx), y: P.round1(it.y + d.dy)}));
      });
    };

    const startCorner = (corner) => (e) => {
      const anchor = {x: fr.left + b.x + (corner.indexOf('l') >= 0 ? b.w : 0),
                      y: fr.top + b.y + (corner.indexOf('t') >= 0 ? b.h : 0)};
      const c = {x: (b.x + b.w / 2) / fr.width * 100, y: (b.y + b.h / 2) / fr.height * 100};
      gesture(e, (start, p0, p) => {
        const d0 = Math.hypot(p0.x - anchor.x, p0.y - anchor.y);
        const f = d0 < 1 ? 1 : Math.hypot(p.x - anchor.x, p.y - anchor.y) / d0;
        S.groupScale(start, c, f).forEach((r, i) => writePose(ctx, start[i].sel,
          {x: r.x, y: r.y, scale: r.scale}));
      });
    };

    return (
      <div className={cx('selbox', 'is-multi', drag && 'is-drag')}
        style={{position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h}}
        onMouseDown={startMove} onClick={(ev) => ev.stopPropagation()}>
        {['tl', 'tr', 'bl', 'br'].map((c) => (
          <div key={c} className={cx('hnd', 'h' + c)} title="整体等比缩放"
            onMouseDown={startCorner(c)} />
        ))}
        <div className="multichip">已选 {members.length} 个</div>
      </div>
    );
  }

  /* ---------- 字幕轨的统一框 ---------- */
  /* 字幕轨的水平中心与锚线夹在整幅画面里（同单条拖动的 `BC_POSE.subClampY`）。 */
  const SUB_LIMITS = {x: [0, 100], y: [0, 100]};
  const subQuery = (s) => '[data-subs="' + s.trackId + '"]';

  function SubsMultiBox({ctx, frameRef}) {
    const members = S.subMembers(ctx.sels);
    const [drag, setDrag] = useState(false);
    /* 行框随这一刻的字幕文本变（播放头换句），也随样式变。 */
    const b = useBounds(members, frameRef, [ctx.selKeys, ctx.subStyle, ctx.playing, ctx.playT], subQuery);
    if (members.length < 2 || ctx.playing || !b) return null;
    const frameEl = frameRef.current;
    if (!frameEl) return null;
    const fr = rectOf(frameEl);

    /* 每条轨写回自己的水平中心 `x` 与锚线 `y`（与单条拖动同一对值，stage.jsx 的 SelectionBox）；
       位移先按全组夹进画面再逐条加，没动的那一轴不写。 */
    const startMove = (e) => {
      if (e.button !== 0) return;
      const start = members.map((s) => {
        const t = window.BC_SUB.byId(ctx.subStyle, s.trackId) || {};
        return {trackId: s.trackId, x: t.x == null ? 50 : t.x, y: t.y == null ? 86 : t.y};
      });
      runGesture(ctx, setDrag, e, start, (list, p0, p) => {
        const d = S.groupShift(list, (p.x - p0.x) / fr.width * 100, (p.y - p0.y) / fr.height * 100, SUB_LIMITS);
        list.forEach((it) => {
          const patch = {};
          if (d.dx) patch.x = P.subClampY(it.x + d.dx);
          if (d.dy) patch.y = P.subClampY(it.y + d.dy);
          ctx.setSubTrack(it.trackId, patch);
        });
      }, (p0) => {
        /* 按下不拖：只留按在的那一条（与 App 一致）；按在两行之间的空隙里就不动选中。 */
        const hit = members.find((s) => {
          const n = frameEl.querySelector(subQuery(s));
          const r = n && rectOf(n);
          return r && p0.x >= r.left && p0.x <= r.right && p0.y >= r.top && p0.y <= r.bottom;
        });
        if (!hit) return;
        ctx.pick({kind: 'subs', trackId: hit.trackId});
        ctx.setTab('subtitle');
        ctx.setPaneView('subprops');
      });
    };

    return (
      <div className={cx('selbox', 'is-multi', drag && 'is-drag')}
        style={{position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h}}
        onMouseDown={startMove} onClick={(ev) => ev.stopPropagation()}>
        <div className="multichip">已选 {members.length} 条字幕</div>
      </div>
    );
  }

  Object.assign(window, {useMarquee, Marquee, MultiBox, SubsMultiBox});
})();
