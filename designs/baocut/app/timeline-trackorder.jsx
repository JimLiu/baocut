/* BaoCut 原型 — 时间轴的轨道换序（2026-10-08，product-design §5.1）
   画布图层 = 时间线轨道。两个入口落到同一份次序上：
   · 按住行头上下拖（`useTrackDrag`）：只在同一叠里换（画面与字幕轨道一叠、声音一叠），拖动中这一行
     半透明跟着指针走，目标行上沿或下沿一根落点线；落点不改变次序时没有线、松手也不提交。
   · 画布元素 ⋯ 菜单的「层级」与 F / ⌘↑ / ⌘↓ / B（`arrangeElement`）。
   几何与次序都在 `BC_TL`（model-timeline.js 的「轨道换序」一节），这里只接指针与状态。 */
(function () {
  const {useState, useRef} = React;
  const D = window.BC_DATA;
  const TL = window.BC_TL;
  const DRAG_PX = 4;   // 按下后纵向挪过这么多像素才算拖起来，之前松手当点击

  /** 时间轴行：时间轴、层级命令与导出清单读同一份参数（导出的 `lanesOf` 另有一份同样的调用）。 */
  function timelineRows(ctx, hiddenEls) {
    return TL.rows(ctx.elements,
      {subTracks: ctx.subStyle.tracks, transcript: ctx.cues.length > 0 && ctx.liveAt == null, textMembers: D.textGroup.members,
        audio: ctx.hasAudio, music: ctx.hasMusic, mainAudio: ctx.audioProject,
        hiddenEls, audioMuted: ctx.muted, musicMuted: ctx.musicMuted,
        dubs: ctx.dubs, dubOff: ctx.dubOff, bedOff: ctx.bedOff, score: ctx.score, scoreOff: ctx.scoreOff,
        trackOrder: ctx.trackOrder});
  }

  /** 提交一次落点：两叠的次序写 `trackOrder`；字幕轨彼此的上下另以 `subStyle.tracks` 为准，
   *  这一下改了它们的相对次序时一并写回（没改就不写，免得多一步撤销）。 */
  function applyTrackDrop(ctx, rows, key, drop) {
    if (!TL.trackDropChanges(rows, key, drop)) return false;
    const next = TL.trackOrderAfterDrop(rows, ctx.trackOrder, key, drop);
    const {subs, ...rest} = next;
    ctx.setTrackOrder(rest);
    const byKey = {};
    ctx.subStyle.tracks.forEach((t) => { byKey['subs:' + t.id] = t; });
    const subKeys = TL.trackDisplay('picture', next.picture).filter((k) => byKey[k]);
    if (subKeys.length === ctx.subStyle.tracks.length
      && subKeys.join() !== ctx.subStyle.tracks.map((t) => 'subs:' + t.id).join()) {
      ctx.setSubStyle({tracks: subKeys.map((k) => byKey[k])});
    }
    return true;
  }

  /** 「层级」四项：能走就换轨并返回 true；走到边返回 false（菜单灰掉、快捷键让位）。
   *  与别的元素共一条轨时引擎会拆出新轨，本原型拆不出，只报一句。 */
  function arrangeElement(ctx, elId, dir, toast) {
    const plan = TL.arrangePlan(timelineRows(ctx).rows, elId, dir);
    if (!plan) return false;
    const label = ARRANGE_LABEL[dir];
    if (plan.split) { if (toast) toast(`已${label}`); return true; }
    applyTrackDrop(ctx, timelineRows(ctx).rows, plan.key, plan.drop);
    if (toast) toast(`已${label}`);
    return true;
  }
  const ARRANGE_LABEL = {front: '移到最前', forward: '前移一层', backward: '后移一层', back: '移到最后'};
  const canArrange = (ctx, elId, dir) => !!TL.arrangePlan(timelineRows(ctx).rows, elId, dir);

  /** 行头拖拽。`bodyRef` 是 `.tlbody` 滚动区；返回拖动中的状态与行头的 mousedown。 */
  function useTrackDrag(ctx, rows, bodyRef) {
    const [drag, setDrag] = useState(null);   // {key, offsetY, drop}，拖起来之后才有
    const live = useRef({ctx, rows});
    live.current = {ctx, rows};
    const canDrag = (row) => TL.canDragTrack(rows, row.key);
    const down = (e, row) => {
      if (e.button !== 0 || !canDrag(row)) return;
      if (e.target.closest && e.target.closest('button, [role="button"], input, [data-pop]')) return;
      const el = bodyRef.current;
      if (!el) return;
      e.preventDefault();
      const key = row.key;
      const originY = e.clientY;
      let state = null;
      const contentY = (clientY) => clientY - el.getBoundingClientRect().top + el.scrollTop - TL.RULER_H;
      const move = (ev) => {
        const dy = ev.clientY - originY;
        if (!state && Math.abs(dy) < DRAG_PX) return;
        state = {key, offsetY: dy, drop: TL.trackDropAt(live.current.rows, key, contentY(ev.clientY))};
        setDrag(state);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        setDrag(null);
        if (state && state.drop) applyTrackDrop(live.current.ctx, live.current.rows, key, state.drop);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    return {drag, down, canDrag};
  }

  Object.assign(window, {timelineRows, applyTrackDrop, arrangeElement, canArrange, useTrackDrag});
})();
