/* 剪口带 —— 第 192 轮立、第 196 轮改行内、第 197 轮改贯穿、第 200 轮跟全局开关（§12.6）；
   2026-10-01 从 `timeline.jsx` 拆出来，加拖两缘改剪切范围。

   剪口是全局的，所以像播放头一样**贯穿所有轨**，不再逐行画：
     · 建议 = 橙虚线带，标尺以下贯穿到底，点一下接受；建议还没剪，所以不折叠、原位画。
     · 已剪 = 空槽带：斜纹从标尺穿到底（标尺那截成阴影，刻度数字不落进去），
       宽到能放字时标 `−0.8s`，点一下恢复。
   它不参与元素选择与拖拽（mousedown 截停），也不是块——`cuts` 表是 clip 之上的稀疏覆盖。

   **拖两缘改范围（2026-10-01，内核 op `retimeCut`，spec 1.303.0）**：空槽带左右各一条命中区
   （6px，压在带内侧；带宽不足 18px 时每侧缩到带宽的三分之一，中间留给点击恢复），悬停
   `col-resize` 并把那条边描成蓝色。按下后移动超过 3px 才算拖；拖动中只动被拖的那条边，
   预览跟手、吸附时跳到吸附点，带上方浮一枚 `−1.2s`。缺省吸词边界，按住 Alt / Option 自由落点
   （每次 pointermove 读 `altKey`）；夹取与吸附口径全在 `BC_CUT.dragSlotEdge`（有单测）。
   松手 = `cutOps.retime` 一次原子写、一步撤销，区间没变不写；拖动中 Esc 取消。边缘区不触发恢复。 */
(function () {
  const {useState, useRef, useMemo, useEffect} = React;
  const TL = window.BC_TL;
  const DRAG_PX = 3;   // 按下后移动超过它才进入拖动
  const EDGE_PX = 6;   // 边缘命中区宽

  /** 松手 / 取消后紧跟的那一下 click 吞掉：不让它落到带本体（= 恢复）或时间轴空白（= 清选中）。 */
  function swallowNextClick() {
    const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); window.removeEventListener('click', eat, true); };
    window.addEventListener('click', eat, true);
    setTimeout(() => window.removeEventListener('click', eat, true), 0);
  }

  function CutBands({M, rowsH, ctx, X, W}) {
    const CUT = window.BC_CUT;
    const [drag, setDrag] = useState(null);   // dragSlotEdge 的结果 + {free}
    const words = useMemo(() => CUT.wordTimes(ctx.cues || []), [ctx.cues]);
    const live = useRef(null);                 // 进行中的拖动：卸载时拆监听
    useEffect(() => () => { if (live.current) live.current(); }, []);
    // 开关关着 = 成片视图：已剪的内容不存在，建议也收起来（数在开关旁）
    if (!ctx.cutMode) return null;

    const beginEdge = (e, slot, edge) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const pressX = e.clientX;
      const cuts = ctx.cuts, pxps = ctx.pxps;
      const opts = {duration: ctx.duration, fps: CUT.CUT_FPS};
      let started = false, last = null;
      const root = document.documentElement;
      const move = (ev) => {
        if (!started && Math.abs(ev.clientX - pressX) <= DRAG_PX) return;
        if (!started) { started = true; root.classList.add('is-col-resize'); }
        last = CUT.dragSlotEdge(slot, cuts, words, edge, pressX, ev.clientX, pxps, !!ev.altKey, opts);
        if (last) setDrag(Object.assign({free: !!ev.altKey}, last));
      };
      const detach = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('keydown', key, true);
        root.classList.remove('is-col-resize');
      };
      const end = () => { detach(); window.removeEventListener('pointerup', up); live.current = null; setDrag(null); };
      const up = () => {
        const done = started ? last : null;
        if (started) swallowNextClick();
        end();
        if (done && done.changed) ctx.cutOps.retime(done.id, done.t0, done.t1);
      };
      // Esc 取消：先于编辑器自己的 Esc（清选中等）截停；指针还按着，留着 up 吞掉随后那一下 click
      const key = (ev) => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        detach();
        started = true; last = null;
        setDrag(null);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('keydown', key, true);
      live.current = end;
    };

    const sug = M.slots.filter((x) => x.sug).map((x) => (
      <div key={'sug:' + x.id} className="tcut tcut--sug"
        style={{left: TL.HEADS_W + X(x.start), width: W(x.start, x.end), top: TL.RULER_H, height: rowsH}}
        title={`${CUT.kindLabel(x.cut.kind)} · ${CUT.label(x.cut.end - x.cut.start)} · 建议，点一下接受`}
        onMouseDown={(e) => { if (e.button === 0) e.stopPropagation(); }}
        onClick={(e) => { e.stopPropagation(); ctx.cutOps.accept(x.id); }}>
        {W(x.start, x.end) >= 36 ? <span className="tcut__l">{CUT.label(x.cut.end - x.cut.start)}</span> : null}
      </div>
    ));

    let tag = null;
    const cut = M.slots.filter((x) => !x.sug).map((x) => {
      const d = drag && drag.id === x.id ? drag : null;
      const s = d ? d.start : x.start, e = d ? d.end : x.end;
      const w = W(s, e);
      const ew = Math.max(2, Math.min(EDGE_PX, Math.floor(w / 3)));
      const secs = d ? d.t1 - d.t0 : x.cut.end - x.cut.start;
      if (d) {
        tag = <span key="tag" className="tcut__tag t-mono" style={{left: TL.HEADS_W + X(s) + w / 2}}>−{CUT.label(secs)}</span>;
      }
      const edgeEl = (edge) => (
        <div className={'tcut__edge tcut__edge--' + (edge === 'start' ? 'l' : 'r') + (d && d.edge === edge ? ' is-on' : '')}
          style={{width: ew}}
          onPointerDown={(ev) => beginEdge(ev, x, edge)}
          onMouseDown={(ev) => ev.stopPropagation()}
          onClick={(ev) => ev.stopPropagation()} />
      );
      return (
        <div key={'cut:' + x.id} className={'tcut tcut--band' + (d ? ' is-drag' : '')}
          style={{left: TL.HEADS_W + X(s), width: w, top: 0, height: TL.RULER_H + rowsH}}
          title={`${CUT.kindLabel(x.cut.kind)} · ${CUT.label(secs)} · 已剪，点一下恢复 · 拖两缘改范围（按住 Alt 不吸附）`}
          onMouseDown={(ev) => { if (ev.button === 0) ev.stopPropagation(); }}
          onClick={(ev) => { ev.stopPropagation(); ctx.cutOps.restore(x.id); }}>
          {!d && w >= 36 ? <span className="tcut__l">−{CUT.label(secs)}</span> : null}
          {edgeEl('start')}
          {edgeEl('end')}
        </div>
      );
    });
    return <>{sug}{cut}{tag}</>;
  }

  Object.assign(window, {CutBands});
})();
