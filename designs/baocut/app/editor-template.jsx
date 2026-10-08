/* 模板那一份编辑器状态 —— §14.5（第 112 轮）。
   从 editor.jsx 拆出来，与 editor-elements.jsx 同一个套路：编辑器只把 `app` / `pick` 递进来，
   这里管**三样东西**：

     · `tplDoc`   项目里套着的那一份模板**实例**（定义的深拷贝；改它不动目录与品牌库）
     · `brandTpls` 品牌库里存的模板**定义**（跨项目；内置那五款不在这里，它们在 BC_TPL.BUILTINS）
     · `tplStudio` 版面编辑器的会话：{source, id, draft, sel}——改的是草稿，「完成」才写回

   定义 / 实例分开是这一轮的核心决定：套用 = 拷一份进项目，之后项目里怎么改都不会污染
   品牌库；「存到品牌库」是反向的一次拷贝（同名覆盖）。章节**不在**模板里——它是项目的，
   模板只是把它画出来。 */
(function () {
  const {useState, useCallback, useRef} = React;
  const D = window.BC_DATA;
  const TPL = window.BC_TPL;

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /* `canvas` = 编辑器的 {ratio, setRatio}：模板可选的「套用时画幅」（`ratio`）在套用时一并
     把项目画幅改过去，撤销一起回退——两个状态一步动。 */
  function useTemplateStore(app, pick, showPane, canvas) {
    const [tplDoc, setTplDocRaw] = useState(() => canvas && canvas.template ? TPL.instance(canvas.template) : null);
    const canvasRef = useRef(canvas);
    canvasRef.current = canvas;
    const [tplSel, setTplSel] = useState(null);
    const [brandTpls, setBrandTpls] = useState(D.brand.templates);
    const [tplStudio, setTplStudio] = useState(null);
    /* toast 的撤销闭包要拿到「改之前那一份」，而 setState 的 updater 必须是纯函数
       （StrictMode 双调用），所以当前值另存一份 ref 供动作读。 */
    const docRef = useRef(tplDoc);
    const setTplDoc = useCallback((doc) => { docRef.current = doc; setTplDocRaw(doc); }, []);

    const pickTpl = useCallback((layerId) => {
      setTplSel(layerId || null);
      pick({kind: 'element', id: 'e-tpl', elKind: 'tpl'});
    }, [pick]);

    /** 入口切换（§9）：模板入口带一套内置的进来，其余入口清空；版面编辑器一并关掉 */
    const resetTemplate = useCallback((on) => {
      setTplDoc(on ? TPL.instance(TPL.builtins(app.tplLang)[0]) : null);
      setTplSel(null);
      setTplStudio(null);
    }, [setTplDoc, app.tplLang]);

    /** 套用一套定义（内置或品牌库）。幂等：已经是这一套就只重新选中。 */
    const applyTemplate = useCallback((tpl) => {
      const prev = docRef.current;
      if (prev && prev.from === tpl.id) {
        pickTpl(null);
        app.toast(`「${tpl.name}」已经是当前模板 · 已选中`);
        return;
      }
      setTplDoc(TPL.instance(tpl));
      pickTpl(null);
      /* 可选的「套用时画幅」：声明了就一并改项目画幅，toast 说一句，撤销连画幅一起放回。
         第 218 轮：模板还可以把这一档**锁住**（`lockRatio`）——套上之后舞台画幅钮与项目设置
         都改不了画幅，toast 先把这件事说清楚，用户不必等到点画幅钮才发现。 */
      const cv = canvasRef.current;
      const plan = TPL.applyRatio(tpl, cv ? cv.ratio : null);
      const prevRatio = cv ? cv.ratio : null;
      const ratioChanged = !!(cv && plan.changed);
      if (ratioChanged) cv.setRatio(plan.ratio);
      const ratioNote = plan.locked
        ? ` · 画幅${ratioChanged ? '已改为并' : ''}锁定为 ${TPL.ratioLabel(plan.ratio)}`
        : ratioChanged ? ` · 画幅已改为 ${TPL.ratioLabel(plan.ratio)}` : '';
      app.toast((prev ? `已换成「${tpl.name}」` : `已套用「${tpl.name}」· 时间轴多了一行模板`) + ratioNote, 'positive',
        {label: '撤销', undo: true, run: () => {
          setTplDoc(prev);
          if (ratioChanged) cv.setRatio(prevRatio);
          pick(prev ? {kind: 'element', id: 'e-tpl', elKind: 'tpl'} : null);
          app.toast('已撤销');
        }});
    }, [app, pick, pickTpl, setTplDoc]);

    /* ---------- 画幅锁（第 218 轮） ----------
       判据是纯函数 `TPL.ratioLock(tplDoc)`：null = 自由；否则 {ratio, name, note}。
       编辑器把 ctx.setRatio 包一层：锁着时不改画幅，只 toast 那句 note ＋「去模板设置」。
       解锁只在模板属性页——它是模板的设置，不是画幅的，所以画幅钮上只给「去看」不给「解」。 */
    const ratioLock = TPL.ratioLock(tplDoc);
    /** 打开模板属性页（时间轴那一行、画幅钮上的「去模板设置」都走这里） */
    const openTplProps = useCallback(() => {
      pickTpl(null);
      if (showPane) showPane();
    }, [pickTpl, showPane]);
    const setRatioLock = useCallback((on) => {
      const prev = docRef.current;
      if (!prev) return;
      setTplDoc(Object.assign({}, prev, {lockRatio: !!on}));
      const r = TPL.ratioLabel(TPL.ratioTarget(prev));
      app.toast(on ? `画幅已锁定为 ${r} · 舞台与视频设置里改不了了` : `画幅已解锁 · 现在可以随意改，模板照旧叠在画面上`, 'positive',
        {label: '撤销', undo: true, run: () => { setTplDoc(prev); app.toast('已撤销'); }});
    }, [app, setTplDoc]);

    const removeTemplate = useCallback(() => {
      const prev = docRef.current;
      if (!prev) return;
      setTplDoc(null);
      setTplSel(null);
      pick(null);
      app.toast('已移除模板 · 章节还在，只是不画了' + (TPL.ratioLocked(prev) ? ' · 画幅已解锁' : ''), 'positive',
        {label: '撤销', undo: true, run: () => { setTplDoc(prev); pickTpl(null); app.toast('已放回模板'); }});
    }, [app, pick, pickTpl, setTplDoc]);

    /* 项目内的属性改动：不发 toast（滑一下就一条太吵），但走 ref 保证读到最新 */
    const patchTemplate = useCallback((patch) => setTplDoc(Object.assign({}, docRef.current, patch)), [setTplDoc]);
    const patchLayer = useCallback((id, patch) => setTplDoc(TPL.updateLayer(docRef.current, id, patch)), [setTplDoc]);

    /** 把项目里这一份存成品牌库定义（同名覆盖）。存过之后实例记住 brandId，属性页显示「已存」。 */
    const saveTplToBrand = useCallback((name, doc) => {
      const src = doc || docRef.current;
      if (!src) return null;
      const r = TPL.saveToBrand(brandTpls, src, name);
      setBrandTpls(r.list);
      if (!doc) setTplDoc(Object.assign({}, src, {name: r.doc.name, brandId: r.doc.id}));
      app.toast(r.updated ? `已更新品牌库里的「${r.doc.name}」` : `已存到品牌库：「${r.doc.name}」· 其它视频也能套`, 'positive');
      return r.doc;
    }, [app, brandTpls, setTplDoc]);

    const removeBrandTpl = useCallback((id) => {
      const was = brandTpls.find((t) => t.id === id);
      if (!was) return;
      setBrandTpls(brandTpls.filter((t) => t.id !== id));
      app.toast(`已从品牌库移出「${was.name}」· 已套用的视频不受影响`, 'positive',
        {label: '撤销', undo: true, run: () => { setBrandTpls(brandTpls); app.toast('已放回'); }});
    }, [app, brandTpls]);

    const dupBrandTpl = useCallback((id) => {
      const src = brandTpls.find((t) => t.id === id) || TPL.builtins(app.tplLang).find((t) => t.id === id);
      if (!src) return;
      const r = TPL.saveToBrand(brandTpls, src, src.name + ' 副本');
      setBrandTpls(r.list);
      app.toast(`已复制为「${r.doc.name}」`, 'positive');
    }, [app, brandTpls]);

    /* ---------- 版面编辑器 ----------
       source：project = 改项目里这一份；brand = 改品牌库里那一条定义；
               new-brand = 从空白做一条品牌库定义；new-project = 从空白做进项目。 */
    const openTplStudio = useCallback(({source, tpl, id}) => {
      const base = tpl || TPL.blank();
      const draft = JSON.parse(JSON.stringify(base));
      const first = draft.layers.find((l) => l.on);
      setTplStudio({source, id: id || null, base: draft, draft, sel: first ? first.id : null});
      pick(null);
      if (showPane) showPane();
    }, [pick, showPane]);
    const studioSet = useCallback((fn) => setTplStudio((s) => (s ? Object.assign({}, s,
      {draft: typeof fn === 'function' ? fn(s.draft) : Object.assign({}, s.draft, fn)}) : s)), []);
    const studioSel = useCallback((id) => setTplStudio((s) => (s ? Object.assign({}, s, {sel: id}) : s)), []);
    const studioLayer = useCallback((id, patch) => studioSet((d) => TPL.updateLayer(d, id, patch)), [studioSet]);
    const studioBox = useCallback((id, box) => studioSet((d) => TPL.updateLayer(d, id, {box})), [studioSet]);
    const studioAdd = useCallback((kind) => setTplStudio((s) => {
      if (!s) return s;
      const draft = TPL.addLayer(s.draft, kind, app.tplLang);
      return Object.assign({}, s, {draft, sel: draft.layers[draft.layers.length - 1].id});
    }), [app.tplLang]);
    const studioRemove = useCallback((id) => setTplStudio((s) => (s ? Object.assign({}, s,
      {draft: TPL.removeLayer(s.draft, id), sel: s.sel === id ? null : s.sel}) : s)), []);
    const studioReorder = useCallback((id, dir) => studioSet((d) => TPL.reorder(d, id, dir)), [studioSet]);

    const studioDone = useCallback(() => {
      const s = tplStudio;
      if (!s) return;
      const draft = s.draft;
      if (s.source === 'project') {
        const prev = docRef.current;
        setTplDoc(draft);
        if (!same(prev, draft)) {
          app.toast('版面已更新', 'positive',
            {label: '撤销', undo: true, run: () => { setTplDoc(prev); app.toast('已还原版面'); }});
        }
        pickTpl(null);
      } else if (s.source === 'new-project') {
        setTplDoc(Object.assign({}, draft, {id: 'tpl-own', from: null}));
        pickTpl(null);
        app.toast(`已把「${draft.name}」套到这部视频 · 想跨视频用就存到品牌库`, 'positive');
      } else if (s.source === 'brand') {
        setBrandTpls(brandTpls.map((t) => (t.id === s.id ? Object.assign({}, draft, {id: s.id, brand: true}) : t)));
        app.toast(`已更新品牌库里的「${draft.name}」· 已套用的视频不跟着变`, 'positive');
      } else {
        const r = TPL.saveToBrand(brandTpls, draft, draft.name);
        setBrandTpls(r.list);
        app.toast(`已存到品牌库：「${r.doc.name}」`, 'positive');
      }
      setTplStudio(null);
    }, [app, brandTpls, pickTpl, setTplDoc, tplStudio]);

    const studioCancel = useCallback(() => {
      const s = tplStudio;
      setTplStudio(null);
      if (s && !same(s.base, s.draft)) app.toast('已放弃这次版面改动');
      if (s && (s.source === 'project') && docRef.current) pickTpl(null);
    }, [app, pickTpl, tplStudio]);

    /** 版面编辑器里的「存到品牌库」：存草稿；从空白做的那条从此改成在编辑那条定义 */
    const studioSaveBrand = useCallback((name) => {
      const s = tplStudio;
      if (!s) return;
      const r = TPL.saveToBrand(brandTpls, s.draft, name);
      setBrandTpls(r.list);
      setTplStudio(Object.assign({}, s, s.source === 'new-brand' ? {source: 'brand', id: r.doc.id} : {},
        {draft: Object.assign({}, s.draft, {name: r.doc.name})}));
      app.toast(r.updated ? `已更新品牌库里的「${r.doc.name}」` : `已存到品牌库：「${r.doc.name}」`, 'positive');
    }, [app, brandTpls, tplStudio]);

    /* 时间轴上的模板行跟着 tplDoc 走：有就一行（名字带上模板名），没有就没有——
       不再由入口的 e-tpl 种子决定。元素投影的最后一步，第 115 轮从 editor.jsx 挪来。 */
    const withTemplateRow = (list, elDocs) => list.filter((e) => e.kind !== 'tpl').concat(tplDoc
      ? [Object.assign({}, window.BC_DATA.elements.find((e) => e.kind === 'tpl'), elDocs['e-tpl'] || {},
          {name: '模板 · ' + tplDoc.name, end: null})]
      : []);

    return {withTemplateRow, tplDoc, tplSel, setTplSel, pickTpl, brandTpls, tplStudio,
      ratioLock, openTplProps, setRatioLock,
      resetTemplate, applyTemplate, removeTemplate, patchTemplate, patchLayer,
      saveTplToBrand, removeBrandTpl, dupBrandTpl,
      openTplStudio, studioSet, studioSel, studioLayer, studioBox, studioAdd, studioRemove, studioReorder,
      studioDone, studioCancel, studioSaveBrand};
  }

  Object.assign(window, {useTemplateStore});
})();
