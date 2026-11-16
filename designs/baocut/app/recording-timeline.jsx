/* 屏幕的两条附属行（屏幕录制设计 §5，product-design §5.9）：「缩放」画取景文档里的缩放区间，「鼠标」画录制里的点击。
   两行都跟在屏幕那一道下面（BC_TL.rows 的 `svzoom` / `svmouse`），按这一道上的屏幕实例投到序列上：拆开、挪开之后
   各段只画自己源区间里的那一截。
     · 缩放行：空白处拖出一段加一段手动缩放；拖一段整段平移（撞到邻居就停），拖两端改起止（6px 的边）；
       点一段选中它（右栏是屏幕实例的「屏幕取景」），Delete 删掉。自动的紫、改过的深一档并带一枚标记、手动的靛蓝。
     · 鼠标行：每次点击一道刻线；点这一行选中屏幕，到右栏改光标样式。
   App 与 Web 都加载。 */
(function () {
  const {useState} = React;
  const TL = window.BC_TL;
  const SV = window.BC_SV;
  const EDGE = 6;

  const vx = (ctx, t, pxps) => TL.px(ctx && ctx.tmap ? ctx.tmap.view(t) : t, pxps);
  const tAt = (ctx, x, pxps) => {
    const v = Math.max(0, (x - TL.PAD) / pxps);
    return ctx && ctx.tmap ? ctx.tmap.unview(v) : v;
  };
  const screenAt = (screens, t) => (screens || []).find((s) => s.end != null && t >= s.start - 1e-6 && t <= s.end + 1e-6) || null;

  /** 选中屏幕实例并把右栏翻到视频（检查器里是「屏幕取景」） */
  function focusScreen(ctx, el) {
    if (!el) return;
    if (ctx.playing) ctx.setPlaying(false);
    ctx.pick({kind: 'element', id: el.id, elKind: 'video'});
    ctx.setTab('video');
    ctx.setPaneView(null);
    ctx.setPaneHidden(false);
  }

  function ScreenZoomRow({row, pxps, ctx}) {
    const app = useApp();
    const [draft, setDraft] = useState(null);     // 拖动中的那一份取景文档
    const [lasso, setLasso] = useState(null);     // 空白处拖出来的那一段（序列时间）
    const base = ctx.screenView(row.view);
    const view = draft || base;
    const placed = SV.placeZooms(view, row.screens);
    const sel = ctx.zoomSel && ctx.zoomSel.view === row.view ? ctx.zoomSel.id : null;

    const pick = (p) => {
      focusScreen(ctx, row.screens.find((s) => s.id === p.elId));
      ctx.setZoomSel({view: row.view, id: p.zoom.id});
    };

    /* 拖一段（或它的两端）：按屏幕实例的倍速把像素换成录制时间；松手写回一次（一条历史） */
    const beginBlock = (p) => (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      const off = e.clientX - r.left;
      const mode = r.width > EDGE * 3 && off <= EDGE ? 'left' : r.width > EDGE * 3 && off >= r.width - EDGE ? 'right' : 'move';
      const el = row.screens.find((s) => s.id === p.elId);
      const rate = el && el.rate > 0 ? el.rate : 1;
      const x0 = e.clientX;
      const z = p.zoom;
      let last = null;
      pick(p);
      const move = (ev) => {
        const dc = ((ev.clientX - x0) / pxps) * rate;
        if (Math.abs(ev.clientX - x0) < 2) return;
        const patch = mode === 'left' ? {t0: z.t0 + dc} : mode === 'right' ? {t1: z.t1 + dc} : {t0: z.t0 + dc, t1: z.t1 + dc};
        last = SV.patchZoom(base, z.id, patch, {move: mode === 'move'});
        setDraft(last);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        setDraft(null);
        if (last && last !== base) {
          ctx.setScreenView(row.view, last);
          const nz = last.zooms.find((x) => x.id === z.id);
          app.toast(`${SV.zoomName(last, z.id)} · ${SV.originLabel(nz)} · ${nz.t0.toFixed(1)}s → ${nz.t1.toFixed(1)}s`);
        }
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };

    /* 空白处拖出一段：起点所在的屏幕实例决定时钟，夹在这一段实例里；太短（单击）不加 */
    const beginLasso = (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const box = e.currentTarget.getBoundingClientRect();
      const t0 = tAt(ctx, e.clientX - box.left, pxps);
      const el = screenAt(row.screens, t0);
      if (!el) return;
      let t1 = t0;
      const move = (ev) => {
        t1 = Math.min(el.end, Math.max(el.start, tAt(ctx, ev.clientX - box.left, pxps)));
        setLasso({start: Math.min(t0, t1), end: Math.max(t0, t1)});
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        setLasso(null);
        if (Math.abs(t1 - t0) * pxps < 4) { ctx.setZoomSel(null); return; }
        const id = 'zoom-' + Date.now().toString(36);
        const r = SV.addZoom(base, SV.toContent(el, Math.min(t0, t1)), SV.toContent(el, Math.max(t0, t1)), id);
        if (!r) { app.toast('这里已经有一段缩放了，换个空档拖'); return; }
        ctx.setScreenView(row.view, r.view);
        focusScreen(ctx, el);
        ctx.setZoomSel({view: row.view, id});
        app.toast(`已加${SV.zoomName(r.view, id)} · 手动 · 2×`, 'positive', {label: '撤销', undo: true, run: () => ctx.history.undo()});
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };

    return <div className="scv-lane" onMouseDown={beginLasso} title="空白处拖出一段加缩放；拖动一段或它的两端来改">
      {lasso ? <span className="scv-lasso" style={{left: vx(ctx, lasso.start, pxps), width: Math.max(2, vx(ctx, lasso.end, pxps) - vx(ctx, lasso.start, pxps))}} /> : null}
      {placed.map((p) => {
        const left = vx(ctx, p.start, pxps);
        const w = Math.max(4, vx(ctx, p.end, pxps) - left);
        const tone = SV.originTone(p.zoom);
        return <span key={p.key} role="button" tabIndex={-1}
          className={cx('scv-zoom', 'scv-zoom--' + tone, sel === p.zoom.id && 'is-on', p.clipStart && 'is-clip-l', p.clipEnd && 'is-clip-r')}
          style={{left, width: w}}
          title={`${SV.zoomName(view, p.zoom.id)} · ${SV.originLabel(p.zoom)} · ${SV.scaleLabel(p.zoom.scale)}${p.zoom.focus.kind === 'point' ? ' · 固定一点' : ' · 跟随鼠标'}`}
          onMouseDown={beginBlock(p)} onClick={(e) => e.stopPropagation()}>
          {w > 28 ? <span className="scv-zoom__lb">{SV.scaleLabel(p.zoom.scale)}</span> : null}
          {tone === 'edited' ? <i className="scv-zoom__mark" aria-label="改过" /> : null}
        </span>;
      })}
    </div>;
  }

  function ScreenMouseRow({row, pxps, ctx}) {
    const rec = ctx.recordingOfView(row.view);
    const clicks = SV.placeClicks(rec ? rec.clicks : [], row.screens);
    const onDown = (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const box = e.currentTarget.getBoundingClientRect();
      const el = screenAt(row.screens, tAt(ctx, e.clientX - box.left, pxps)) || row.screens[0];
      focusScreen(ctx, el);
      ctx.setZoomSel(null);
    };
    return <div className="scv-lane scv-lane--mouse" onMouseDown={onDown} title="这次录制里的点击。点这一行改光标样式。">
      {clicks.map((c) => <i key={c.key} className="scv-click" style={{left: vx(ctx, c.t, pxps)}} title={'点击 · ' + window.BC_TIME.timecode(c.t)} />)}
    </div>;
  }

  /** 附属行的行头：图标 + 「缩放」/「鼠标」，没有开关（它们不是轨）。 */
  function ScreenRowHead({row}) {
    return <>
      <Ic n={row.kind === 'svzoom' ? 'zoomin' : 'edit'} className="ic--12" />
      <span className="thd__label" title={row.kind === 'svzoom' ? '空白处拖出一段加缩放；拖动一段或它的两端来改' : '这次录制里的点击。点这一行改光标样式。'}>
        {TL.headLabel(row)}</span>
    </>;
  }

  Object.assign(window, {ScreenZoomRow, ScreenMouseRow, ScreenRowHead});
})();
