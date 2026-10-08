/* 视频工具的运行器（product-design §2.7「进度与失败」「新建的视频放进项目」「写进已有视频是普通的编辑」）。
   模块级状态：离开工具页运行照样跑完。每次运行是任务中心里的一条任务（`app.addTask`），按步骤推进；
   步骤表、推进、失败与重试都在 model-tool-runs.js（BC_TOOL_RUNS），这里只接上计时器与写入：
   某一步完成时做那一步的写入（新建视频 / 写文稿 / 写译文 / 写配音 / 保存字幕文件 / 保存文稿和字幕）。
   产物：effects 用 `put(ctx, entry)` 记下注册进 Space 的条目，运行与任务记录都带 `outputs`（条目 id）与 `saveDir`
   （字段形状见 model-tool-runs.js 头注释）；写进视频的运行把那部视频的 id 记在最前。
   当场授权的同意记录也放在这里：原型只记在内存里，刷新就没了。 */
(function () {
  const {useState, useEffect} = React;
  const D = window.BC_DATA;
  const R = window.BC_TOOL_RUNS;
  const TT = window.BC_TOOL_TARGETS;

  const store = {runs: [], seq: 0, subs: new Set(), timers: new Map(), grants: new Set(), lastDir: null,
    demo: 'ok', app: null, patches: {}, view: {}};
  const emit = () => store.subs.forEach((fn) => fn());
  const runById = (id) => store.runs.find((r) => r.id === id) || null;
  const setRun = (id, change) => { store.runs = store.runs.map((r) => (r.id === id ? Object.assign({}, r, change) : r)); emit(); };

  /** 订阅运行器：返回运行列表、同意记录与最近一次用的项目；顺手记下最新的 app（写入时读当前的视频记录） */
  function useToolRuns() {
    const app = useApp();
    store.app = app;
    const [, bump] = useState(0);
    useEffect(() => {
      const fn = () => bump((n) => n + 1);
      store.subs.add(fn);
      return () => { store.subs.delete(fn); };
    }, []);
    return {runs: store.runs, runById, granted: (k) => store.grants.has(k), lastDir: store.lastDir, demo: store.demo,
      setDemo: (k) => { store.demo = k; emit(); },
      /* 工具页正在看哪一次运行（null = 表单）：离开再回来还停在那一页 */
      view: (tool) => store.view[tool] || null, setView: (tool, id) => { store.view[tool] = id || null; emit(); }};
  }
  function grant(keys) { (keys || []).forEach((k) => store.grants.add(k)); emit(); }

  /* 视频的当前记录：store 里的那份 ＋ 这里刚写过、store 还没传回来的补丁 */
  const movieNow = (id) => Object.assign({}, (store.app && store.app.projById(id)) || {}, store.patches[id] || {});
  function patchMovie(app, id, patch) {
    store.patches[id] = Object.assign({}, store.patches[id] || {}, patch);
    app.patchProject(id, patch);
  }
  function addDoc(app, id, kind, doc, opt) {
    const r = TT.withDoc(movieNow(id), kind, doc, opt);
    if (r) patchMovie(app, id, {docs: r.docs});
    return r ? r.doc : null;
  }

  /* 原型演示挡位：这次运行在第几步失败（不属于产品 UI） */
  const DEMOS = [{k: 'ok', label: '成功'}, {k: 'fail-2', label: '在第 2 步失败'}, {k: 'fail-3', label: '在第 3 步失败'}];
  const failStep = (k) => (/^fail-(\d)$/.test(k) ? Number(k.slice(5)) - 1 : null);

  /* 每一步的耗时：模型调用那几步慢一点 */
  const SLOW = {asr: 6, translate: 8, synth: 6};
  const TICK = 150;

  /**
   * 开始一次运行。
   * spec: {tool, input, translate?, opts?（交给步骤表，如转录的 target、下载的 transcribe）, title, sub, movie?（写进已有视频）, create?（{dir}：新建视频）,
   *        saveDir?（结果保存到的目录；写进已有视频时不给）, effects: {stepId: (ctx) => void}, result: (ctx) => {lines}}
   * ctx = {app, run, movie, outputs}：effects 里可以改 ctx.movie（新建视频那一步把 id 填进来），用 `put` 往 ctx.outputs 里记产物条目。
   */
  function start(app, spec) {
    const id = 'tr' + (++store.seq);
    const model = R.create(spec.tool, Object.assign({input: spec.input, translate: spec.translate, saveDir: spec.saveDir || null}, spec.opts));
    const taskId = app.addTask({kind: spec.tool, tool: spec.tool, toolId: spec.tool, runId: id, title: spec.title, project: spec.movie || null,
      sub: spec.sub, cancellable: false, params: spec.params || null, ...R.taskPatch(model)});
    if (spec.create) store.lastDir = spec.create.dir;
    const run = {id, spec, model, taskId, movie: spec.movie || null, outputs: [], fail: failStep(store.demo), result: null, started: Date.now()};
    store.runs = [run].concat(store.runs);
    store.view[spec.tool] = id;
    emit();
    tick(app, id);
    return id;
  }

  /* 计时器里用最新的 app（store 函数会随项目列表更新），没有就用开始时那份 */
  const live = (app) => store.app || app;
  /* 新建的视频在转写完成前失败：Space 上标失败，重试时回到转录中。按视频当前状态判断：
     只动「转录中 ↔ 失败」这两种，不转录的新建视频与已经写好文稿的（都是 complete）不碰 */
  const FROM = {error: 'transcribing', transcribing: 'error'};
  const markCreated = (app, run, status) => {
    if (run.spec.create && run.movie && movieNow(run.movie).status === FROM[status]) patchMovie(app, run.movie, {status});
  };

  function tick(app0, id) {
    clearInterval(store.timers.get(id));
    store.timers.set(id, setInterval(() => {
      const app = live(app0);
      const run = runById(id);
      if (!run || run.model.status !== 'running') { clearInterval(store.timers.get(id)); store.timers.delete(id); return; }
      const step = run.model.steps[run.model.cur];
      if (run.fail === run.model.cur && step.pct >= 50) {
        const failed = R.fail(run.model, run.spec.failMessage || `${step.label}没有完成：演示里的模拟失败`);
        setRun(id, {model: failed});
        app.patchTask(run.taskId, R.taskPatch(failed));
        markCreated(app, run, 'error');
        return;
      }
      const {run: next, finished} = R.advance(run.model, 100 / (SLOW[step.id] || 3));
      const ctx = {app, run: Object.assign({}, run, {model: next}), movie: run.movie, outputs: (run.outputs || []).slice()};
      if (finished && run.spec.effects && run.spec.effects[finished]) run.spec.effects[finished](ctx);
      const model = R.withOutputs(next, (ctx.movie ? [ctx.movie] : []).concat(ctx.outputs.map((e) => e.id)));
      const change = {model, movie: ctx.movie, outputs: ctx.outputs};
      if (next.status === 'done') {
        change.result = run.spec.result ? run.spec.result(ctx) : {lines: []};
        app.toast(`${run.spec.title} · 已完成`, 'positive');
      }
      setRun(id, change);
      app.patchTask(run.taskId, Object.assign(R.taskPatch(model), ctx.movie ? {project: ctx.movie} : {}));
    }, TICK));
  }

  /** 从失败的那一步重试：完成的步骤与已经建好的视频保留（§2.7） */
  function retry(app0, id) {
    const app = live(app0);
    const run = runById(id);
    if (!run || run.model.status !== 'failed') return;
    const model = R.retry(run.model);
    setRun(id, {model, fail: null});
    app.patchTask(run.taskId, R.taskPatch(model));
    markCreated(app, run, 'transcribing');
    tick(app, id);
  }

  /* ---------- 写入 ---------- */
  /** 记下一个注册进 Space 的产物（registerToolOutput 的返回）；null 不记 */
  function put(ctx, entry) {
    if (entry && !ctx.outputs.some((e) => e.id === entry.id)) ctx.outputs.push(entry);
    return entry;
  }
  /** 注册一个产物并记下：条目带 toolId、task（任务 id）与 params，查看器据此显示「查看任务」「再做一次」 */
  function reg(ctx, kind, record) {
    const sp = ctx.run.spec;
    return put(ctx, ctx.app.registerToolOutput(kind, Object.assign({toolId: sp.tool, tool: sp.tool, task: ctx.run.taskId, params: sp.params || null}, record)));
  }
  /** 从链接下载的媒体（演示）：标题取页面标题（BC_MEDIA.probeUrl 的示例），文件放进下载目录 */
  function linkMedia(url) {
    const info = window.BC_MEDIA.probeUrl(url);
    const name = `${String(info.title).replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 120) || 'download'}.mp4`;
    return {info, name, title: info.title, src: {name, path: `~/Downloads/${name}`, format: 'MP4', res: '1920×1080', state: 'ok', url: url.trim()}};
  }
  /** 以一份媒体为主素材的视频记录：编辑器按本机媒体打开（时间线上一段完整的片段），还没有文稿与字幕 */
  const mediaMovie = (src, duration) => ({origin: 'local', entry: 'media', src, duration, initialCues: [], config: {subs: false, wave: false, bg: null}});
  /** 新建视频（转录从文件或链接开始、从链接导入新建）：放进所选项目，素材在时间线上、以链接方式导入，来源记为这次运行。
   *  `busy`：后面还要转写（Space 上显示生成中）；不转写的就是一部普通的视频 */
  function createMovie(app, ctx, c, label, busy) {
    const mv = app.createProject(null, {entry: 'blank', dir: c.dir, title: c.name, ratio: '16:9'});
    /* 标题也记进补丁：新建是最后一步时，结果页在 store 传回新视频之前就要用到它 */
    patchMovie(app, mv.id, Object.assign(mediaMovie(c.src, D.DUR || 206), {title: mv.title, status: busy ? 'transcribing' : 'complete',
      toolRun: {tool: ctx.run.spec.tool, task: ctx.run.taskId, label}, docs: {transcripts: [], translations: [], dubs: [], layers: []}}));
    ctx.movie = mv.id;
  }
  /** 从链接导入加进已有的视频：没有素材的视频拿它当主素材，有素材的多一条链接素材（原型记在 `linkedMedia`） */
  function importToMovie(app, ctx, media) {
    const m = movieNow(ctx.movie);
    if (!m.src || !m.src.name) patchMovie(app, ctx.movie, {src: media.src, duration: m.duration || D.DUR || 206});
    else patchMovie(app, ctx.movie, {linkedMedia: (m.linkedMedia || []).concat([{name: media.name, url: media.src.url}])});
  }
  /** 只下载成文件：Space 里的一个视频文件产物 */
  function storeDownload(app, ctx, media, dir) {
    return reg(ctx, 'final', {id: ctx.run.id, name: media.name, dir: dir || null, dur: D.DUR || 206,
      sourceName: media.name, sourceUrl: media.src.path, file: media.src.path, url: media.src.url, note: '从链接下载的媒体 · 交互原型没有真的下载'});
  }
  /** 转录不建视频时的落点（§2.7 表二「转录」）：保存位置里的 `<源名>.txt` 与 `<源名>.srt`，两个 Space 条目。
   *  o: {name（源名，不带扩展名）, saveDir, dir?, lang, model, sourceName?, sourceUrl?, speakers?} */
  function publishTranscript(app, ctx, o) {
    const L = window.BC_LLM_TOOLS;
    const cues = D.cues.map((c) => ({id: c.id, start: c.start, end: c.end, text: c.text, speaker: o.speakers ? c.speaker : undefined}));
    const txt = window.BC_TOOL_FRAME.savedName(app, o.name, '.txt');
    const srt = window.BC_TOOL_FRAME.savedName(app, o.name, '.srt');
    const common = {dir: o.dir || null, model: o.model, lang: o.lang ? TT.langLabel(o.lang) : '自动检测', sourceName: o.sourceName || null, sourceUrl: o.sourceUrl || null,
      dur: D.DUR || 206, note: '转录结果 · 交互原型使用示例文稿'};
    reg(ctx, 'doc', Object.assign({}, common, {id: `${ctx.run.id}-txt`, name: txt, file: `${o.saveDir}/${txt}`,
      text: cues.map((c) => c.text).join('\n'), cues, lines: cues.length}));
    reg(ctx, 'subtitle', Object.assign({}, common, {id: `${ctx.run.id}-srt`, name: srt, file: `${o.saveDir}/${srt}`,
      cues, text: L ? L.srt(cues) : '', lines: cues.length}));
  }
  /** 转录的文稿写进视频：新建的视频同时带上演示文稿与字幕（编辑器读 initialCues）；没有文稿的已有视频记下文稿事实。
   *  新建视频的字段与「字幕产物 → 新建视频」同一份补丁（BC_HOME_TOOLS.moviePatch），编辑器按同一条路打开。 */
  function applyTranscript(app, ctx, o) {
    const created = !!ctx.run.spec.create;
    addDoc(app, ctx.movie, 'transcripts', {lang: o.lang, model: o.model});
    if (!created) return;
    const m = movieNow(ctx.movie);
    const p = window.BC_HOME_TOOLS.moviePatch({kind: 'subtitle', id: ctx.run.id, name: `${m.title || '视频'}.srt`, cues: D.cues,
      dur: m.duration, model: o.model, lang: o.lang ? TT.langLabel(o.lang) : '自动检测', sourceName: (m.src && m.src.name) || 'media'});
    delete p.title; delete p.src; delete p.sourceOutput;
    patchMovie(app, ctx.movie, p);
  }
  const layer = (app, ctx, o) => addDoc(app, ctx.movie, 'layers', o);
  /** 换用文稿（product-design §5.11）：同一份文稿的新版本取代当前文稿；手工修改的标记随之清掉（新版本就是识别结果） */
  function switchTranscript(app, ctx, o) {
    addDoc(app, ctx.movie, 'transcripts', {lang: o.lang, model: o.model}, {mode: 'replace'});
    patchMovie(app, ctx.movie, {transcriptEdited: false});
  }
  /** 撤销换用文稿：文稿、译文、字幕 pin 与配音的事实回到换之前那一份（`before` 是开跑时的视频记录） */
  function undoSwitch(app, id, before) {
    patchMovie(app, id, {docs: before.docs, transcriptEdited: !!before.transcriptEdited});
    app.toast(`已撤销 · 「${before.title || '视频'}」的文稿回到之前的版本`);
  }

  /** 导出字幕文件（结果页的下一步）：只写 SRT，不渲染视频（S01 通过标准），结果进 Space */
  function exportSrt(app, movieId, lang, saveDir) {
    const m = movieNow(movieId);
    const L = window.BC_LLM_TOOLS;
    /* 演示文稿逐句带英文（data.js 的 trans 列）；别的语言用明确标注的占位，与文件翻译的示例同一个写法 */
    const say = (c) => (!lang ? c.text : lang === 'en' ? c.trans || c.text : `[${lang} · 示例占位] ${c.text}`);
    const cues = D.cues.map((c) => ({id: c.id, start: c.start, end: c.end, text: say(c)}));
    const name = `${m.title || '视频'}${lang ? '.' + lang : ''}.srt`;
    const out = app.registerToolOutput('subtitle', {id: `export-${movieId}-${lang || 'src'}-${Date.now().toString(36)}`, name, dir: m.dir || null,
      file: saveDir ? `${saveDir}/${name}` : undefined,
      movie: movieId, cues, text: L.srt(cues), lines: cues.length, dur: m.duration || D.DUR, sourceName: m.src && m.src.name});
    app.toast(`已导出 ${name} · 保存在 Space`, 'positive');
    return out;
  }

  Object.assign(window, {BC_TOOL_RUNNER: {DEMOS, start, retry, grant, exportSrt, linkMedia, createMovie, importToMovie, storeDownload, publishTranscript, put, reg,
    applyTranscript, layer, switchTranscript, undoSwitch,
    addDoc, mediaMovie, movieNow, patchMovie},
    useToolRuns});
})();
