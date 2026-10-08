/* 画布选中系统 —— §14.2（第 4/5/20/23/40/122 轮）。
   ============================================================================
   **手柄词表**（第 122 轮重定；此前第 20 轮那一版「纵向一个手柄都没有」被本轮推翻
   ——那是原型自己画出来的限制，现在逐类型分三档）：

     贴纸 / B-roll / 进度条 / 声波 / 占位盒 → **八把手** `n w s e nw ne sw se`，
       宽高比自由（四角默认仍锁比例，⇧ 才解锁）；边把手只改一轴。
     文字 / 计时 / 字幕 → `w e` ＋ 四角：左右改容器宽度（字号不变、重新换行），
       四角锁比例并连字号一起放大（走 `place.scale`）。字幕只有 `w e`。
     图片 / 形状 / 标注 → **只有四角**，恒锁比例。
     主视频片段（第 144 轮）→ 八把手，四角等比 scale，边柄独立改片段盒宽高。
     小盒退化（任一边 < 40px）：八把手类留 `nw s e`、文字类留 `se e`、其余留 `nw`。

   几何：指针位移投影到元素**旋转后**的自身轴；锚在对边中点 / 对角，⌥ 改成锚在中心
   并双倍计入（对称缩放）；最小 10×10 px。math 全在
   [model-pose.js](model-pose.js) 的 `edgeResize` / `handlesFor` / `resizeCursor`。
   框正上方 20px 圆钮 = 自由旋转（`place.rot`），⇧ 自由 / 默认 15° 吸附，拖动中出
   角标，**双击归零**。光标随旋转角转（`resizeCursor`）。
   逐类型的能力表在 [model-pose.js](model-pose.js) 的 `CAPS`（`resize` 那一列）。

   **第 40 轮：手柄终于真的会动。** 此前四角与胶囊是「点一下走一档」（±10% / ±40px），
   旋转虽是真拖拽却存在这个组件的 local state 里（重新选中就归零），而元素**根本不能
   移动**。这一轮把三件手势与移动一起接到 `ctx.elDocs[id].pose` 上，math 全部下沉到
   `BC_POSE`——那一份是 `apps/baocut` 的 `stage_drag.rs` ＋ `stage_snap.rs` 的纯层孪生：
     · 移动：死区 2px → 百分比空间 ±1.5% 中心吸附 ＋ 限位夹取 → 再叠 6px 多线吸附；
     · 四角：**对角锚定**，倍率按到对角的距离比，中心随之平移，于是对角那个点不动；
     · 胶囊：位移投影到旋转后的 x 轴、双倍计入（左右对称生长）；
     · 旋转：15° 栅格，⇧/⌥ 自由；
     · ⌥ 关掉位置与宽度的吸附——整条规则不参与，不是阈值调大。

   把手占掉框上方，所以工具条改挂框下方（`.mtb--below`）；贴底元素保留在上方并抬高
   50px 跨过把手（`.mtb--rot`）。旋转拖动中整条让位，松手回来。**工具条跟的是旋转后的
   外包盒**（§14.2 round20.4）：它挂在不跟着转的外层 `.selwrap` 上，所以条子与它的弹层
   恒是水平的，落位再按外包盒往外让 `pad`——否则 45° 的框一转，条子就压进框里。
   工具条本体在 [stage-toolbar.jsx](stage-toolbar.jsx)。
   ============================================================================ */
(function () {
  const {useState, useRef, useLayoutEffect} = React;
  const P = window.BC_POSE;

  /* 兼容旧调用点的导出（第 39.7 轮之前这两张表在本文件里） */
  const FREE = Object.keys(P.CAPS).filter((k) => P.CAPS[k].rot);
  const WIDTH_ONLY = Object.keys(P.CAPS).filter((k) => P.CAPS[k].width && !P.CAPS[k].rot);

  /* 外圈词表（`nw`…）↔ `cornerAnchor` 收的那一套（`tl`…）。CSS 类名与 API 名从来
     不是同一族，所以要一张对照表——只留这一张，不要两边各写一半。 */
  const CORNER_CSS = {nw: 'tl', ne: 'tr', sw: 'bl', se: 'br'};
  const HANDLE_TIP = {
    n: '拖动改高度 · ⌥ 以中心对称', s: '拖动改高度 · ⌥ 以中心对称',
    w: '拖动改宽度 · ⌥ 以中心对称', e: '拖动改宽度 · ⌥ 以中心对称',
  };
  const CORNER_TIP = '等比缩放 · ⇧ 解锁比例、⌥ 以中心对称';

  /* 拖完那一下 `click` 要吞掉（第 122 轮）：`mousedown` 在把手上、`mouseup` 在别处，
     浏览器把随后的 `click` 派到两者的公共祖先——也就是 `.stage`，于是它的
     `onClick` 会把选中清掉，一松手框就没了。手柄上的 `stopPropagation` 拦不住它，
     因为那一下压根不经过手柄。所以照 `stage-marquee.jsx` 的老办法：真的动过（越过
     死区）就立一面旗，`.stage` 的 `onClick` 读一次即清。模块级而不是 ref，因为读的
     人（`stage.jsx`）与写的人（这一件的手势）不在同一棵组件树上。 */
  let DRAGGED = false;
  function swallowDrag() {
    if (!DRAGGED) return false;
    DRAGGED = false;
    return true;
  }
  function keepSelectionAfterDrag() {
    DRAGGED = true;
    // A portaled slider may replace its thumb on render; suppress only the trailing click.
    window.setTimeout(() => { DRAGGED = false; }, 0);
  }

  const rectOf = (el) => el.getBoundingClientRect();
  /** 元素的**未旋转**盒（帧内像素）：中心取 bbox 中心（绕中心转时它不变），
      尺寸取 offsetWidth/Height（布局尺寸不吃 transform）——与 App v2 的
      `static_box` 同口径，而不是拿旋转后的 bbox 去对齐。 */
  function frameBox(node, fr) {
    const r = rectOf(node);
    return P.boxOf(r.left + r.width / 2 - fr.left, r.top + r.height / 2 - fr.top,
      node.offsetWidth, node.offsetHeight);
  }
  /** 参与吸附的**其它**元素盒。算不出盒子的不收——硬塞一个默认盒会造出画面上不存在的线。 */
  function neighbours(frameEl, selfId) {
    if (!frameEl) return [];
    const fr = rectOf(frameEl);
    return Array.prototype.slice.call(frameEl.querySelectorAll('[data-el]'))
      /* 主视频（`clip:<id>`）不参与对齐吸附：它铺满整幅画面，它的边就是画布的边，
         而画布边线已经由 `guidesFor` 单独给了——收进来只会画两条重合的线。 */
      .filter((n) => n.dataset.el !== selfId && String(n.dataset.el).indexOf('clip:') !== 0
        && n.offsetWidth > 0)
      .map((n) => frameBox(n, fr));
  }

  /* ---------- 选中框 ---------- */
  function SelectionBox({kind, id, el, ctx, st, set, style, inner, children, onClick,
                         bottomAnchored, pose, setPose, frameRef, onGuides, onDoubleClick,
                         noToolbar}) {
    const cap = P.caps(kind);
    const videoSelection = kind === 'video';
    const [overlay, setOverlay] = useState(null);
    const boxRef = useRef(null);
    const [rotating, setRotating] = useState(false);
    const [dragging, setDragging] = useState(false);
    /* 盒的**未旋转**布局尺寸：算旋转后的外包盒（工具条让位）、决定把手集合与把手样式档。 */
    const [bh, setBh] = useState(0);
    const [bw, setBw] = useState(0);
    const rot = pose.rot || 0;

    useLayoutEffect(() => {
      if (!boxRef.current) return;
      const n = boxRef.current;
      if (n.offsetHeight !== bh) setBh(n.offsetHeight);
      if (n.offsetWidth !== bw) setBw(n.offsetWidth);
      if (videoSelection) {
        const stage = n.closest('.stage'), area = stage.getBoundingClientRect(), r = rectOf(n);
        const next = {root: stage, left: r.left + r.width / 2 - area.left - n.offsetWidth / 2,
          top: r.top + r.height / 2 - area.top - n.offsetHeight / 2,
          width: n.offsetWidth, height: n.offsetHeight};
        setOverlay(old => old && Object.keys(next).every(k => old[k] === next[k]) ? old : next);
      }
    });

    /* 一次手势的公共壳：死区、window 级监听、松手收线。`step` 拿到的是这一帧的
       指针位置与修饰键，返回要写进 pose 的补丁（返回 null = 这一帧不写）。 */
    const gesture = (e, begin, step, flag) => {
      e.preventDefault(); e.stopPropagation();
      const frameEl = frameRef && frameRef.current;
      if (!frameEl || !boxRef.current) return;
      const fr = rectOf(frameEl);
      const p0 = {x: e.clientX, y: e.clientY};
      const others = neighbours(frameEl, id);
      const ctxG = begin({fr, p0, others, node: boxRef.current});
      let moved = false;
      DRAGGED = false;
      if (flag) flag(true);
      /* 历史栈（第 115 轮）：起手先把「拖之前」那一份扣住，中途每帧写 pose 都不入栈，
         松手且**真的动过**才记一条——否则一次拖拽会在撤销栈里留下几十条。 */
      const hist = ctx && ctx.history;
      if (hist) hist.begin();
      const move = (ev) => {
        if (!moved && Math.abs(ev.clientX - p0.x) < P.DEAD_ZONE
                   && Math.abs(ev.clientY - p0.y) < P.DEAD_ZONE) return;
        moved = true;
        const patch = step(ctxG, {x: ev.clientX, y: ev.clientY},
          {free: ev.shiftKey || ev.altKey, snap: !ev.altKey,
           shift: ev.shiftKey, alt: ev.altKey});
        if (patch) setPose(patch);
        if (onGuides && boxRef.current) {
          onGuides(P.guidesFor(frameBox(boxRef.current, fr), {w: fr.width, h: fr.height},
            ctxG.others, P.GUIDE_TOL));
        }
      };
      const up = () => {
        if (flag) flag(false);
        DRAGGED = moved;                          // 动过 → 吞掉紧随其后的那一下 click
        if (hist) { if (moved) hist.commit(); else hist.cancel(); }
        if (onGuides) onGuides([]);
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };

    /* 移动：先百分比空间的中心吸附 ＋ 限位，再叠 §5 的 6px 多线吸附。两者同向，
       不会互相拽——中心已经吸住时后者算出来的位移就是 0。 */
    const startMove = (e) => {
      if (!cap.move || e.button !== 0) return;
      gesture(e,
        ({fr, p0, others, node}) => ({fr, p0, others,
          start: {x: pose.x, y: pose.y}, size: {w: node.offsetWidth, h: node.offsetHeight}}),
        (g, p, mod) => {
          /* 视频按盒子放宽限位：放大后可以把顶部 / 底部推出画面裁掉。 */
          const lim = videoSelection
            ? P.mediaLimits(g.size, {w: g.fr.width, h: g.fr.height}) : P.limitsFor(kind);
          const d = {dx: cap.axis === 'y' ? 0 : p.x - g.p0.x, dy: p.y - g.p0.y};
          const r = P.dragPos(g.start, d, {w: g.fr.width, h: g.fr.height}, lim);
          if (!r) return null;
          const frame = {w: g.fr.width, h: g.fr.height};
          const sn = P.snapMove(P.boxOf(r.x / 100 * frame.w, r.y / 100 * frame.h, g.size.w, g.size.h),
            frame, g.others, mod.snap);
          const x = P.round1(r.x + (sn.dx / frame.w) * 100);
          const y = P.round1(r.y + (sn.dy / frame.h) * 100);
          return cap.axis === 'y' ? {y} : {x, y};
        }, setDragging);
    };

    /* 四角：对角锚定。起手时把对角那个点（旋转之后的坐标）冻结成 anchor，全程不动。 */
    /* 四角（`resize: 'text' | 'corner'`）：对角锚定的**等比**缩放，写的是 `place.scale`
       ——文字要连字号一起放大，只改 w/h 表达不了。⌥ 把锚点换成中心，
       于是变成绕中心对称放大。 */
    const startCorner = (corner) => (e) => {
      if (!cap.scale) return;
      gesture(e, ({fr, p0, node}) => {
        const r = rectOf(node);
        const c0 = {x: r.left + r.width / 2, y: r.top + r.height / 2};
        return {fr, p0, c0, others: neighbours(frameRef.current, id), w0: node.offsetWidth,
          h0: node.offsetHeight};
      }, (g, p, mod) => {
        const anchor = mod.alt ? g.c0
          : P.cornerAnchor(g.c0.x, g.c0.y, g.w0, g.h0, CORNER_CSS[corner], rot);
        const s = P.cornerScaleAbout(pose.scale || 1, g.c0, anchor, g.p0, p);
        return {scale: s.scale,
          x: P.round1((s.x - g.fr.left) / g.fr.width * 100),
          y: P.round1((s.y - g.fr.top) / g.fr.height * 100)};
      });
    };

    /* 四边（＋自由比例一族的四角）：`edgeResize` 出的是**渲染**尺寸的像素，除回 scale
       才是 `place.w` / `place.h`——不除的话 scale≠1 的元素一碰把手就跳一下。
       文字一族的 `w e` 只写 `w`：写死 `h` 会把重新换行冻住，那正是这条把手的语义。 */
    const stretchy = cap.resize === 'free';
    const startResize = (hd) => (e) => {
      gesture(e, ({fr, p0, others, node}) => ({fr, p0, others,
        w0: node.offsetWidth, h0: node.offsetHeight,
        ratio: P.aspectFor(kind, node.offsetWidth, node.offsetHeight)}),
        (g, p, mod) => {
          const frame = {w: g.fr.width, h: g.fr.height};
          if (!(frame.w > 0) || !(frame.h > 0)) return null;
          const sc = pose.scale || 1;
          const r = P.edgeResize({handle: hd, dx: p.x - g.p0.x, dy: p.y - g.p0.y, rot,
            w: g.w0, h: g.h0, x: pose.x / 100 * frame.w, y: pose.y / 100 * frame.h,
            alt: mod.alt, shift: mod.shift, ratioLocked: g.ratio});
          const patch = {x: P.round1((r.x / frame.w) * 100), y: P.round1((r.y / frame.h) * 100)};
          if (hd.indexOf('w') >= 0 || hd.indexOf('e') >= 0) {
            patch.w = P.round1(P.clamp((r.w / frame.w) * 100 / sc, P.MIN_W, P.FIT_MAX_W));
          }
          if (stretchy) {
            patch.h = P.round1(P.clamp((r.h / frame.h) * 100 / sc, P.MIN_W, P.FIT_MAX_W));
          }
          return patch;
        });
    };

    /* 旋转：15° 栅格；⇧（App v2 的 `modifiers.shift`）或 ⌥（§5 原文那一把）自由。 */
    const startRot = (e) => {
      if (!cap.rot) return;
      gesture(e, ({fr, p0, node}) => {
        const r = rectOf(node);
        const c0 = {x: r.left + r.width / 2, y: r.top + r.height / 2};
        return {fr, p0, c0, others: [], a0: P.pointerDeg(c0.x, c0.y, p0.x, p0.y), rot0: rot};
      }, (g, p, mod) => ({
        rot: P.snapRot(g.rot0 + (P.pointerDeg(g.c0.x, g.c0.y, p.x, p.y) - g.a0), mod.free),
      }), setRotating);
    };

    /* 工具条挂在不跟着转的外层上，落位再按旋转后的外包盒往外让这么多 */
    const clear = rot && bh && bw ? Math.round((P.rotBounds(bw, bh, rot).h - bh) / 2) : 0;
    const handles = P.handlesFor(kind, bw || Infinity, bh || Infinity);
    const small = P.smallHandles(bw || Infinity, bh || Infinity);

    const controls = <>
          {/* 把手集合与样式档都按**此刻**的盒尺寸算（两个不同的
              阈值，分别在 `handlesFor` 与 `smallHandles` 里）；量不到尺寸时按大盒画。 */}
          {handles.map((hd) => (
            <div key={hd} className={cx('hnd', 'h' + hd, small && 'is-sm',
                P.isCorner(hd) ? 'hnd--dot' : 'hnd--bar')}
              style={{cursor: P.resizeCursor(hd, rot)}}
              title={P.isCorner(hd) && cap.scale ? CORNER_TIP
                : P.isCorner(hd) ? '拖动改大小 · ⇧ 解锁比例、⌥ 以中心对称' : HANDLE_TIP[hd]}
              onMouseDown={P.isCorner(hd) && cap.scale ? startCorner(hd) : startResize(hd)} />
          ))}

          {cap.rot ? (
            /* 双击归零：转歪了要摆正，比拖回 0° 稳。 */
            <div className="rot" title="拖动旋转 · 15° 吸附，⇧ 自由 · 双击归零"
              onMouseDown={startRot}
              onDoubleClick={(ev) => {
                ev.preventDefault(); ev.stopPropagation();
                if (!rot) return;
                const hist = ctx && ctx.history;
                if (hist) hist.begin();
                setPose({rot: 0});
                if (hist) hist.commit();
              }}>
              {/* 第 81 轮：这里此前借的是 `redo`（重做）——一枚「直段 ＋ 半圆」的回勾箭头，
                  在手柄这个位置读出来是「再来一次」。换成自己的 `rotate`：一整段 270° 环。 */}
              <Ic n="rotate" className="ic--14" />
            </div>
          ) : null}
          {rotating ? (
            /* 角度气泡：反向抵消宿主旋转，读数不跟着歪 */
            <div className="angchip" style={{transform: `translateX(-50%) rotate(${-rot}deg)`}}>{rot}°</div>
          ) : null}
        </>;

    return (
      <div className="selwrap" style={style} data-el={id}>
        <div ref={boxRef} className={cx('selbox', 'is-on', cap.move && 'selbox--move',
            videoSelection && 'selbox--video', dragging && 'is-drag')}
          style={Object.assign({}, inner, {transform: `rotate(${rot}deg)`})}
          onMouseDown={startMove} onClick={onClick} onDoubleClick={onDoubleClick}>
          {children}
          {videoSelection ? null : controls}
        </div>
        {videoSelection && overlay ? ReactDOM.createPortal(
          <div className="video-selection" data-video-selection={kind}
            style={{left: overlay.left, top: overlay.top, width: overlay.width, height: overlay.height,
              transform: `rotate(${rot}deg)`}}
            onClick={ev => ev.stopPropagation()}>{controls}</div>, overlay.root) : null}

        {/* 主视频与视频元素共用视频工具条，写入由编辑目标适配。 */}
        {noToolbar ? null : (
          <window.Toolbar kind={kind} el={el} ctx={ctx} st={st} set={set}
            below={videoSelection || (cap.rot && !bottomAnchored)} raised={!videoSelection && bottomAnchored}
            yielding={rotating || dragging} clear={clear} />
        )}
      </div>
    );
  }

  Object.assign(window, {SelectionBox, FREE, WIDTH_ONLY, swallowDrag, keepSelectionAfterDrag});
})();
