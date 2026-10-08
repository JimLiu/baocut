/* 选中真相 —— 第 115 轮（§1）。
   ============================================================================
   从 [editor.jsx](editor.jsx) 抽出来的那一格 `sel`，改成数组 `sels`。
   对外仍然给一格 `sel`（= 最后一次点中的那件），所以三十多处只读 `ctx.sel.kind`
   的面板一行都不用动；新写的东西读 `sels` / `isSel(kind, id)`。

   `fx` 是宿主传进来的副作用：`onPick`（展开右面板、回到画廊栈顶）、`onPickSub`
   （只展开面板，不动面板栈——见 editor.jsx 里的原注释）、`stage()`（⌘A 要知道
   当下有哪些元素、播放头在哪）。用 ref 接住，是为了让 pick 的身份保持稳定：
   `useElementStore(pick)` 与 `useTemplateStore(app, pick, …)` 都把它当依赖。
   ============================================================================ */
(function () {
  const {useState, useCallback, useRef} = React;
  const SEL = window.BC_SELECT;
  const D = window.BC_DATA;

  function useSelectionStore(fx) {
    const fxRef = useRef(fx);
    fxRef.current = fx;
    const [sels, setSelsState] = useState([]);
    /* 就地文字编辑（§2，第 115 轮）：`editing = {id} | null`。它与选中同住一处，
       因为两者的清场时机是同一个——起播、点空白、Esc 三条路都要一起收。 */
    const [editing, setEditingState] = useState(null);
    /* 事件处理器与 render 期的 isSel 都读这一份：state 的闭包会过期，ref 不会。 */
    const selsRef = useRef(sels);
    selsRef.current = sels;

    const put = useCallback((next, notify) => {
      selsRef.current = next;
      setSelsState(next);
      const f = fxRef.current;
      if (notify && f && f.onPick) f.onPick(SEL.primary(next));
      return next;
    }, []);

    /* 一次点选。opts：{add} 追加、{toggle} 反选——shift 与 ⌘/ctrl 都映到 toggle。 */
    const pick = useCallback((s, opts) => put(SEL.apply(selsRef.current, s, opts), true), [put]);
    const pickMany = useCallback((list) => put(SEL.dedupe(list), true), [put]);
    const clearSel = useCallback(() => { setEditingState(null); return put([], false); }, [put]);
    /* 历史栈还原用：不触发任何面板副作用。 */
    const setSels = useCallback((list) => put(SEL.dedupe(list), false), [put]);

    const pickSub = useCallback((trackId) => {
      put([{kind: 'subs', trackId}], false);
      const f = fxRef.current;
      if (f && f.onPickSub) f.onPickSub();
    }, [put]);

    /* ⌘A：当前播放头下可见的元素全选。 */
    const selectAll = useCallback(() => {
      const st = (fxRef.current && fxRef.current.stage && fxRef.current.stage()) || {};
      const live = SEL.visibleAt(st.elements || [], st.playT || 0, D.DUR)
        .map((e) => ({kind: 'element', id: e.id, elKind: e.kind}));
      put(live, true);
      return live.length;
    }, [put]);

    const isSel = useCallback((kind, id) => SEL.has(selsRef.current, kind, id), []);

    /* 双击进入的那一件同时是选中的那一件，所以 `startEdit` 顺手把它选上。 */
    const editingRef = useRef(null);
    editingRef.current = editing;
    const startEdit = useCallback((id, elKind) => {
      put([{kind: 'element', id, elKind}], true);
      setEditingState({id: id});
    }, [put]);
    const stopEdit = useCallback(() => setEditingState(null), []);

    return {
      sels, sel: SEL.primary(sels), selKeys: SEL.keys(sels), selsRef,
      pick, pickMany, pickSub, clearSel, setSels, selectAll, isSel,
      editing, editingRef, startEdit, stopEdit,
    };
  }

  Object.assign(window, {useSelectionStore});
})();
