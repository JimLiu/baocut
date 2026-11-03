/* 工具 › 素材处理的模块级状态（规则在 model-footage.js）：离开这一页任务照样跑完，草稿还在。
   - 受管工具的现状与下载（下载也是一条后台任务；Real-ESRGAN 和放大图片是同一份，现状读写 tool-image-edit.jsx 的那张表）；
   - 任务队列：六个工具共用一条，本机一次跑一条。一次提交是一条任务（1–20 个输入，同流程的 `inputs`），交互演示几秒跑完，不落真文件；
   - 演示挡位：ffmpeg 带不带 vid.stab（缺省不带：BaoCut 不分发它，常见的 ffmpeg 也没有，退回 deshake 是常态）、下载校验过不过、下一条的结果、多装一只只能分两轨的模型。 */
(function () {
  const {useState, useEffect} = React;
  const F = window.BC_FOOTAGE;
  const imageStore = () => (window.BC_IMAGE_EDIT_QUEUE ? window.BC_IMAGE_EDIT_QUEUE.store : null);

  const store = {list: [], seq: 0, timer: null, subs: new Set(), drafts: {srcs: [], forms: {}},
    tools: {[F.RIFE]: 'missing', [F.MATTE]: 'missing', [F.MATTE_ISNET]: 'missing'}, installs: {},
    installFail: false, vidstab: false, outcome: 'ok', melBand: false};
  const emit = () => store.subs.forEach((fn) => fn());
  const patch = (id, p) => { store.list = store.list.map((r) => (r.id === id ? Object.assign({}, r, p) : r)); emit(); };
  function useStore() {
    const [, bump] = useState(0);
    useEffect(() => {
      const fn = () => bump((n) => n + 1);
      const ie = imageStore();
      store.subs.add(fn);
      if (ie) ie.subs.add(fn);
      return () => { store.subs.delete(fn); if (ie) ie.subs.delete(fn); };
    }, []);
    return store;
  }

  /* ---------- 受管工具 ---------- */
  function toolStates() {
    const ie = imageStore();
    return Object.assign({}, store.tools, {[F.REALESRGAN]: ie ? ie.tools[F.REALESRGAN] : 'missing'});
  }
  function setTool(name, value) {
    const ie = imageStore();
    if (name === F.REALESRGAN && ie) { ie.tools = Object.assign({}, ie.tools, {[name]: value}); ie.subs.forEach((fn) => fn()); }
    else store.tools = Object.assign({}, store.tools, {[name]: value});
    emit();
  }
  /** 下载进度；放大图片那一页起的下载，百分比记在它那边 */
  function installPct(name) {
    if (store.installs[name]) return store.installs[name].pct;
    const ie = imageStore();
    return ie && ie.installing === name ? ie.installPct : 0;
  }
  /** 用户在下载卡上点了才下；进度也在后台任务里，离开这一页不中断。演示挡位「校验不过」到六成时失败。 */
  function install(app, name) {
    const t = F.MANAGED[name];
    const task = app.addTask({kind: 'tool-install', flow: 'tools', project: null, title: `下载 ${t.name}`, sub: `${t.version} · ${t.short} · ${t.source}`, phase: '下载', cancellable: true});
    const rec = {pct: 0, task, timer: null};
    store.installs[name] = rec;
    setTool(name, 'installing');
    rec.timer = setInterval(() => {
      rec.pct = Math.min(100, rec.pct + 4);
      const ie = imageStore();
      if (name === F.REALESRGAN && ie) { ie.installing = name; ie.installPct = rec.pct; }
      const phase = rec.pct < 80 ? '下载' : rec.pct < 92 ? '校验' : t.unpack ? `解开，${t.unpack}` : '安装';
      if (store.installFail && rec.pct >= 60) {
        clearInterval(rec.timer);
        delete store.installs[name];
        store.installFail = false;
        setTool(name, 'failed');
        app.patchTask(task, {status: 'error', outcome: 'error', phase: null, error: `${t.name} 的校验值对不上`});
        return;
      }
      app.patchTask(task, {pct: rec.pct, phase});
      if (rec.pct >= 100) {
        clearInterval(rec.timer);
        delete store.installs[name];
        setTool(name, 'ready');
        app.patchTask(task, {status: 'done', outcome: 'done', pct: 100, phase: null});
        app.toast(`${t.name} 已就绪 · ${t.version}`, 'positive');
        return;
      }
      emit();
    }, 120);
  }
  function stopInstall(app, name) {
    const rec = store.installs[name];
    if (!rec) return;
    app.cancelTask(rec.task, {after: () => { clearInterval(rec.timer); delete store.installs[name]; setTool(name, 'missing'); }});
  }
  /** 「指定本机的程序…」：用户自己装好的那一份（externalTools.setPath）。交互原型模拟系统文件选择器 */
  function pickOwn(app, name) {
    setTool(name, 'ready');
    app.toast(`已指定你自己的 ${F.MANAGED[name].name} · 交互原型模拟系统文件选择器`, 'positive');
  }

  /* ---------- 队列 ---------- */
  function enqueue(app, f, srcs, saveDir, ctx) {
    store.seq += 1;
    const taken = store.list.reduce((all, r) => all.concat(r.outs.map((o) => o.name)), []).concat((app.spaceItems || []).map((x) => x.name));
    const form = Object.assign({}, f);
    const rec = {id: `fg-${store.seq}`, status: 'queued', pct: 0, form, srcs: srcs.slice(), outs: F.outputsOf(form, srcs, taken), work: F.workload(form, srcs, ctx), saveDir,
      vidstab: ctx.vidstab, executor: F.executorOf(form, ctx), title: srcs.length > 1 ? `${srcs[0].name} 等 ${srcs.length} 个` : srcs[0].name, entries: [], warnings: []};
    store.list = [rec].concat(store.list);
    emit();
    if (store.list.some((r) => r.status === 'running')) app.toast('已排队 · 本机一次跑一条');
    pump(app);
  }
  function pump(app) {
    if (store.list.some((r) => r.status === 'running')) return;
    const r = store.list.slice().reverse().find((x) => x.status === 'queued');
    if (!r) return;
    const o = F.opById(r.form.id);
    const task = app.addTask({kind: r.form.id, flow: 'tools', tool: r.form.id, toolId: r.form.id, project: null, title: `${o.name} · ${r.title}`, sub: F.jobMeta(r), phase: '读取输入',
      cancellable: true, params: {form: r.form, srcs: r.srcs}, ...window.BC_TOOL_RUNS.outputsPatch([], r.saveDir)});
    patch(r.id, {status: 'running', task, pct: 0, phase: '读取输入'});
    let p = 0;
    clearInterval(store.timer);
    store.timer = setInterval(() => {
      const cur = store.list.find((x) => x.id === r.id);
      if (!cur || cur.status !== 'running') { clearInterval(store.timer); return; }
      p = Math.min(100, p + 2);
      if (store.outcome === 'fail' && p >= 40) {
        clearInterval(store.timer);
        store.outcome = 'ok';
        const fail = F.failOf(r.form, r.srcs[0].name);
        patch(r.id, {status: 'error', fail});
        app.patchTask(task, {status: 'error', outcome: 'error', phase: null, error: fail.title, errorCode: fail.code});
        app.toast(fail.title, 'negative');
        pump(app);
        return;
      }
      const phase = F.phaseOf(r.form.id, p);
      patch(r.id, {pct: p, phase});
      app.patchTask(task, {pct: p, phase});
      if (p < 100) return;
      clearInterval(store.timer);
      finish(app, r, task);
      pump(app);
    }, 120);
  }
  function finish(app, r, task) {
    const dir = r.saveDir || window.BC_SAVE_DIR.DEFAULT;
    const noSubject = store.outcome === 'nosubject' ? [r.srcs[0].name] : [];
    store.outcome = 'ok';
    const entries = r.outs.map((o, i) => app.registerToolOutput(o.kind, {id: `${r.id}-${i}-${Date.now().toString(36)}`, name: o.name, file: `${dir}/${o.name}`,
      dur: o.seconds || undefined, bytes: o.bytes, res: o.width ? `${o.width}×${o.height}` : '', sourceName: o.source.name, toolId: r.form.id, tool: r.form.id, task,
      params: {form: r.form, srcs: r.srcs}, note: '交互原型不落真文件'})).filter(Boolean);
    patch(r.id, {status: 'done', pct: 100, entries, warnings: F.warningsOf(r.form, {vidstab: r.vidstab}, noSubject)});
    app.patchTask(task, Object.assign({status: 'done', outcome: 'done', pct: 100, phase: null}, window.BC_TOOL_RUNS.outputsPatch(entries, r.saveDir)));
    app.toast(`已生成 ${entries.length} 个文件 · 保存在 ${window.BC_SAVE_DIR.label(dir)}`, 'positive');
  }
  function cancel(app, r) {
    if (r.status === 'queued') { patch(r.id, {status: 'canceled'}); return; }
    app.cancelTask(r.task, {after: () => { clearInterval(store.timer); patch(r.id, {status: 'canceled', pct: 0}); pump(app); }});
  }
  function requeue(app, r) {
    patch(r.id, {status: 'queued', pct: 0, fail: null, entries: [], warnings: []});
    pump(app);
  }
  const drop = (id) => { store.list = store.list.filter((r) => r.id !== id); emit(); };

  Object.assign(window, {BC_FOOTAGE_QUEUE: {store, emit, useStore, toolStates, setTool, installPct, install, stopInstall, pickOwn, enqueue, cancel, requeue, drop}});
})();
