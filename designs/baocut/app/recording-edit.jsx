/* 编辑录制的那一份状态（屏幕录制设计 §5「录完之后怎么编辑」，视频格式规范 §3.18、§4.9；product-design §5.9）：
   取景文档的读写、选中的那一段缩放、联动组的解组与整组拆分、把一次新录制放到播放头处。App 与 Web 都加载。
   取景文档住在元素状态表 `elDocs` 的 `sv:<文档 id>` 一格（BC_SV.docKey），所以撤销 / 重做跟着元素状态走，不另开历史槽。
   选中的缩放是跨组件状态：时间线的「缩放」行、检查器的「屏幕取景」与舞台上的取景框读同一份 `zoomSel {view, id}`。 */
(function () {
  const {useState, useCallback, useEffect} = React;
  const SV = window.BC_SV;

  /** 一次录制带来的取景文档初值。 */
  const seedOf = (rec) => ({zooms: rec.zooms || [], follow: rec.follow || null, pointer: rec.cursor || null});

  function useScreenViewStore({proj, els, history, pick, app}) {
    /* 这部视频里有哪几次录制：项目自带的那一次，加上在编辑器里「录制」进来的（按录制 id） */
    const [recs, setRecs] = useState(() => (proj.recording ? {[proj.recording.id]: proj.recording} : {}));
    useEffect(() => { setRecs(proj.recording ? {[proj.recording.id]: proj.recording} : {}); }, [proj.id]);
    const [zoomSel, setZoomSelRaw] = useState(null);
    useEffect(() => { setZoomSelRaw(null); }, [proj.id]);

    const recordingOfView = useCallback((viewId) => Object.values(recs).find((r) => r.view === viewId) || null, [recs]);
    const recordingOf = useCallback((el) => (el && el.recording ? recs[el.recording] || null : null), [recs]);
    const screenView = useCallback((viewId) => {
      const rec = recordingOfView(viewId);
      return SV.viewOf(els.elDocs, viewId, rec ? seedOf(rec) : null);
    }, [els.elDocs, recordingOfView]);
    /** 写回一整份取景文档（一条历史；同一个 tag 连着写会并成一条，滑块拖动时就是这样）。 */
    const setScreenView = useCallback((viewId, next) => {
      els.setElDoc(SV.docKey(viewId), {zooms: next.zooms, follow: next.follow || null, pointer: next.pointer || null});
    }, [els.setElDoc]);

    const setZoomSel = useCallback((sel) => setZoomSelRaw(sel), []);

    /* Delete / Backspace 选着一段缩放时只删这一段，不连屏幕实例一起删：捕获阶段先接，挡住编辑器的全局删除 */
    useEffect(() => {
      if (!zoomSel) return undefined;
      const onKey = (e) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        e.preventDefault(); e.stopPropagation();
        removeZoom(zoomSel.view, zoomSel.id);
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    });

    const removeZoom = (viewId, id) => {
      const view = screenView(viewId);
      const name = SV.zoomName(view, id);
      setScreenView(viewId, SV.removeZoom(view, id));
      setZoomSelRaw(null);
      app.toast(`已删除${name}`, undefined, {label: '撤销', undo: true, run: () => history.undo()});
    };

    /** 解组（视频格式规范 §3.18）：这一组的成员各剪各的；一条历史。 */
    const ungroup = useCallback((id) => {
      const el = els.elements.find((e) => e.id === id);
      const link = SV.linkOf(el, els.elDocs);
      if (!link) return;
      const members = SV.groupMembers(els.elements, els.elDocs, link);
      history.begin();
      members.forEach((m) => els.setElDoc(m, {link: null}));
      history.commit('ungroup');
      app.toast(`已解组 · ${members.length} 件各剪各的`, 'positive', {label: '撤销', undo: true, run: () => history.undo()});
    }, [els.elements, els.elDocs, els.setElDoc, history, app]);

    /**
     * 整组拆分：播放头穿过的成员各切一刀，右边那一半与整段在右边的成员换进一个新组（同一次录制）。
     * 这一件不在联动组里、或播放头一件都没穿过时返回 false，由调用方按单件拆分处理。
     */
    const splitLinked = useCallback((target, t) => {
      const link = SV.linkOf(target, els.elDocs);
      if (!link) return false;
      const plan = SV.splitPlan(els.elements, els.elDocs, link, t);
      if (!plan) return false;
      const seq = els.nextSeq();
      const next = link + '-' + seq;
      let right = null;
      history.begin();
      plan.cut.forEach((id) => {
        const m = Object.assign({}, els.elements.find((e) => e.id === id), els.elDocs[id]);
        const piece = Object.assign({}, m, {id: id + '-s' + seq, start: t, end: m.end, link: next, added: true,
          srcStart: (m.srcStart || 0) + (t - m.start) * (m.rate || 1), place: m.pose || m.place});
        delete piece.endAnchor; delete piece.members;
        els.setElDoc(id, {end: t});
        els.addElement(piece, {quiet: true});
        if (id === target.id) right = piece;
      });
      plan.relink.forEach((id) => els.setElDoc(id, {link: next}));
      history.commit('split');
      if (right) pick({kind: 'element', id: right.id, elKind: right.kind});
      app.toast(`已在 ${window.BC_TIME.timecode(t)} 拆分整组（${plan.cut.length} 件）`, 'positive',
        {label: '撤销', undo: true, run: () => history.undo()});
      return true;
    }, [els, history, pick, app]);

    /** 把一次刚录完的录制放到播放头处的新轨道上（编辑器素材面板的「录制」）：四路同一个联动组。 */
    const addRecordingAt = useCallback((rec, at, canvasRatio) => {
      const seq = els.nextSeq();
      const list = SV.recordingElements(rec, {at, prefix: 'rec' + seq + '-', canvasRatio});
      setRecs((m) => Object.assign({}, m, {[rec.id]: rec}));
      history.begin();
      list.forEach((el) => els.addElement(el, {quiet: true}));
      history.commit('record');
      if (list[0]) pick({kind: 'element', id: list[0].id, elKind: list[0].kind});
      return list;
    }, [els, history, pick]);

    return {recordingOf, recordingOfView, screenView, setScreenView, zoomSel, setZoomSel, removeZoom,
      ungroup, splitLinked, addRecordingAt};
  }

  Object.assign(window, {useScreenViewStore});
})();
