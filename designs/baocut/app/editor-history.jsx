/* 撤销 / 重做 —— 第 115 轮（§3）。
   ============================================================================
   在这一轮之前，transport 的撤销按钮 toast「本轮为骨架」、重做按钮永远灰着，
   各处 toast 里的「撤销」只是再弹一条「已撤销」。这一份把它们接到真栈上。

   快照 = `{el: {added, dropped, shown, elDocs}, clips, sels, sub}`。第 148 轮将字幕
   文档也纳入快照，第 180 轮加入原文 cue 与按语言保存的翻译卡/覆盖层。
   预览与导航不记历史；还原字幕时清除临时预览。各样状态分住几处
   （元素状态层、编辑器的 clips、选中层），所以组装与还原写在这里，`editor.jsx`
   只留一行调用。

   **提交时机**是这一份唯一有讲究的地方：
     · `liveRef` 在每次 layout 后记下「当前已渲染的状态」——事件处理器里同步调用
       `setState` 之后它仍是**改动之前**那一份，正好就是要入栈的东西；
     · 手势（拖手柄）每帧都在写 pose，所以 mousedown 先 `begin()` 把当时那份扣下，
       中途所有离散写入的 `mark()` 一律让路，mouseup 才 `commit()` 记一条；
     · 滑杆与连按方向键会连着写很多次，`tag` 相同且间隔 < 900ms 的合并成一条。
   ============================================================================ */
(function () {
  const {useState, useRef, useLayoutEffect, useCallback} = React;
  const H = window.BC_HIST;
  /* 同一 tag 的连续写入合并窗口（滑杆、连按方向键）。 */
  const COALESCE_MS = 900;

  function useHistoryStore(els, clips, setClips, selection, subtitle, media, transcript, canvas) {
    const [h, setHState] = useState(H.EMPTY);
    const [revision, setRevision] = useState(0);
    const hRef = useRef(h);
    const put = useCallback((next) => { hRef.current = next; setHState(next); }, []);

    /* 已渲染状态的镜子。用 layout effect：paint 之后才更新的话，紧跟着的那一次
       键盘/鼠标事件读到的会是上上次的状态。 */
    const liveRef = useRef(null);
    useLayoutEffect(() => {
      liveRef.current = {el: els.elSnapshot(), clips, sels: selection.sels, sub: subtitle && subtitle.doc,
        sources: media && media.sources, transcript: transcript && transcript.doc, canvas: canvas && canvas.doc};
    });

    const pendingRef = useRef(null);
    const tagRef = useRef({tag: null, at: 0});

    const record = useCallback((snap, tag) => {
      if (!snap) return;
      const now = Date.now();
      if (tag && tagRef.current.tag === tag && now - tagRef.current.at < COALESCE_MS) {
        tagRef.current.at = now;
        return;
      }
      tagRef.current = {tag: tag || null, at: now};
      put(H.push(hRef.current, snap));
    }, [put]);

    /** 手势起手：把当下这一份扣住，中途的离散写入都不入栈。 */
    const begin = useCallback(() => {
      if (!pendingRef.current) pendingRef.current = liveRef.current;
    }, []);
    /** 手势收手 / 一次批量动作收口：记一条。 */
    const commit = useCallback((tag) => {
      const snap = pendingRef.current;
      pendingRef.current = null;
      record(snap, tag);
    }, [record]);
    /** 手势没动过就作废，别记空账。 */
    const cancel = useCallback(() => { pendingRef.current = null; }, []);
    /** 离散写入前记一条（元素状态层通过 `elCommitRef` 调它）。 */
    const mark = useCallback((tag) => {
      if (pendingRef.current) return;
      record(liveRef.current, tag);
    }, [record]);

    useLayoutEffect(() => {
      els.elCommitRef.current = mark;
      if (subtitle) subtitle.commitRef.current = mark;
      if (media) media.commitRef.current = mark;
    });

    const restore = (snap) => {
      if (!snap) return;
      els.elRestore(snap.el);
      setClips(snap.clips);
      selection.setSels(snap.sels);
      if (subtitle && snap.sub) subtitle.restore(snap.sub);
      if (media && snap.sources) media.restore(snap.sources);
      if (transcript && snap.transcript) transcript.restore(snap.transcript);
      if (canvas && snap.canvas) canvas.restore(snap.canvas);
      setRevision(n => n + 1);
      liveRef.current = snap;
      tagRef.current = {tag: null, at: 0};
    };

    const step = (dir) => {
      const r = dir < 0 ? H.undo(hRef.current, liveRef.current) : H.redo(hRef.current, liveRef.current);
      if (!r) return false;
      pendingRef.current = null;
      put(r.h);
      restore(r.snap);
      return true;
    };

    return {
      begin, commit, cancel, mark, revision,
      clear: () => { pendingRef.current = null; tagRef.current = {tag: null, at: 0}; put(H.EMPTY); },
      undo: () => step(-1),
      redo: () => step(1),
      canUndo: H.canUndo(h), canRedo: H.canRedo(h), depth: H.depth(h),
    };
  }

  Object.assign(window, {useHistoryStore});
})();
