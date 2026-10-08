/* 撤销 / 重做栈 —— 第 115 轮。
   ============================================================================
   在这一轮之前 transport 的撤销按钮 toast「本轮为骨架」，重做按钮永远 disabled，
   而各处 toast 里的「撤销」action 只是再弹一条「已撤销」。这一份是那两个按钮
   背后真正的栈：纯数据、无 React，`{past, future}` 两条数组，快照对象由调用方
   决定形状（`editor-history.jsx` 存 `{added, dropped, shown, elDocs, clips, sels}`）。

   语义按最普通的那种：`push` 记一条并清空 future；`undo` 把「当前」推进 future、
   弹出 past 顶；`redo` 反过来。上限 100 条，超了从最老的一端丢。
   ============================================================================ */
(function () {
  const LIMIT = 100;
  const EMPTY = {past: [], future: []};

  const create = () => ({past: [], future: []});
  const canUndo = (h) => !!h && h.past.length > 0;
  const canRedo = (h) => !!h && h.future.length > 0;
  const depth = (h) => (h ? h.past.length : 0);

  /* 记一条：snap 是**改动之前**的快照。 */
  const push = (h, snap, limit) => {
    const lim = limit == null ? LIMIT : limit;
    const past = (h ? h.past : []).concat([snap]);
    return {past: past.slice(Math.max(0, past.length - lim)), future: []};
  };

  /* 返回 null 表示栈空、调用方不要动状态。cur 是当前状态的快照。 */
  const undo = (h, cur) => {
    if (!canUndo(h)) return null;
    const past = h.past.slice(0, -1);
    return {h: {past, future: [cur].concat(h.future)}, snap: h.past[h.past.length - 1]};
  };

  const redo = (h, cur) => {
    if (!canRedo(h)) return null;
    return {h: {past: h.past.concat([cur]), future: h.future.slice(1)}, snap: h.future[0]};
  };

  Object.assign(window, {BC_HIST: {LIMIT, EMPTY, create, canUndo, canRedo, depth, push, undo, redo}});
})();
