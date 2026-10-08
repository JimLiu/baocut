/* 字体库的状态（product-design §5.9「字体」、§7.6；architecture-design §9.1）。
   ============================================================================
   选字框、设置里的「字体」、打开视频时的字体条与导出面板共用这一份：下载缓存里有哪些、
   哪些在下载（字节进度）、哪些失败了、设置（自动下载、镜像）、最近用过、导出在用的。
   算的东西在 model-font-library.js（`BC_FONTLIB`）；这里只推进状态。

   演示口径（真实应用换成 Runtime 的调用，见交付说明）：
   - 下载按计时器推进，每 200ms 收 0.3 MB；中日韩字体一个字重 5–12 MB，看得见进度。
   - `BC_FONTLIB_DATA.flaky` 里的族第一次下载在 40% 处失败（连不上字体服务），重试就好。
   - 离线（`navigator.onLine === false`）时下载立即失败。
   - 自动下载失败的族不在打开视频时自动重试（Runtime 十分钟内不自动重试），手动下载就是重试。
   不进 store.jsx：那里只放跨屏的路由与编辑状态，字体库自成一块，订阅走 `useSyncExternalStore`。
   ============================================================================ */
(function () {
  const L = window.BC_FONTLIB;
  const DATA = window.BC_FONTLIB_DATA;
  const MB = 1024 * 1024;
  const TICK = 200;
  const STEP = 0.3 * MB;

  const metaOf = {};
  DATA.families.forEach((f) => { metaOf[f.family] = f; });

  const rt = {};
  Object.keys(DATA.initial).forEach((n) => { rt[n] = {faces: DATA.initial[n].faces.slice(), at: DATA.initial[n].at}; });
  const state = {
    rt, attempts: {}, auto: true, css: '', file: '',
    offline: typeof navigator !== 'undefined' && navigator.onLine === false,
    recent: DATA.recent.slice(), open: null, video: null,
  };
  const timers = {};
  const listeners = new Set();
  let snap = null;

  function compute() {
    const samples = ((window.BC_DATA && window.BC_DATA.fonts && window.BC_DATA.fonts.all) || []);
    const list = L.statuses({families: DATA.families, runtime: state.rt, samples});
    const byName = {};
    list.forEach((f) => { byName[f.family] = f; });
    return {list, byName, auto: state.auto, css: state.css, file: state.file, offline: state.offline,
      recent: state.recent.slice(),
      open: state.open ? Object.assign({}, state.open, {results: Object.assign({}, state.open.results)}) : null,
      video: state.video, total: DATA.catalogueTotal};
  }
  function emit() {
    snap = compute();
    listeners.forEach((l) => l());
  }
  /* 第一次读的时候才合表：`BC_DATA`（样张写法）可能比本模块晚加载 */
  const now = () => snap || (snap = compute());

  const patch = (family, p) => { state.rt[family] = Object.assign({}, state.rt[family] || {}, p); };

  /** 打开视频的那一批：某个族有了结果就记下，再开始下一个（一个一个下，条上念「第几个」）。 */
  function settleOpen(family, result) {
    const job = state.open;
    if (!job || job.mode !== 'auto' || !job.families.includes(family) || job.results[family]) return;
    job.results[family] = result;
    const next = job.families.find((n) => !job.results[n]);
    if (next) startDownload(next);
  }

  function startDownload(family) {
    const meta = metaOf[family];
    if (!meta || meta.source !== 'google-fonts') return false;
    const cur = state.rt[family] || {};
    if (cur.progress) return true;
    state.attempts[family] = (state.attempts[family] || 0) + 1;
    if (state.offline) {
      patch(family, {progress: null, error: {code: 'FONT_DOWNLOAD_NETWORK', message: '现在离线，连上网络后重试'}});
      settleOpen(family, 'failed');
      emit();
      return false;
    }
    const want = L.defaultFaces(meta).filter((w) => !(cur.faces || []).includes(w));
    const total = Math.max(1, want.length) * meta.faceBytes;
    const flaky = DATA.flaky.includes(family) && state.attempts[family] === 1;
    patch(family, {progress: {done: 0, total}, error: null});
    timers[family] = setInterval(() => {
      const r = state.rt[family];
      const done = Math.min(total, r.progress.done + STEP);
      if (flaky && done > total * 0.4) {
        stop(family);
        patch(family, {progress: null, error: {code: 'FONT_DOWNLOAD_NETWORK', message: '连不上字体服务（重试了 3 次）'}});
        settleOpen(family, 'failed');
      } else if (done >= total) {
        stop(family);
        patch(family, {progress: null, error: null, faces: Array.from(new Set([...(r.faces || []), ...(want.length ? want : [400])])), at: '刚刚'});
        settleOpen(family, 'ok');
      } else {
        patch(family, {progress: {done, total}});
      }
      emit();
    }, TICK);
    emit();
    return true;
  }
  function stop(family) {
    if (timers[family]) { clearInterval(timers[family]); delete timers[family]; }
  }

  const store = {
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    get: () => now(),

    /** 手动下载（选字框里点下载、选中一个可下载的族、重试）：不看自动下载的开关。 */
    download(family) {
      if (state.open && state.open.results[family] && state.open.results[family] !== 'ok') delete state.open.results[family];
      return startDownload(family);
    },
    cancel(family) {
      if (!state.rt[family] || !state.rt[family].progress) return;
      stop(family);
      patch(family, {progress: null, error: {code: 'CANCELLED', message: '已取消'}});
      settleOpen(family, 'cancelled');
      emit();
    },
    /** 删除一个族下载的字重。还没结束的导出在用时（`inUse`，由在跑的导出任务的 `fontPins` 算出）不删，
        返回 false（Runtime 的 FONT_IN_USE）。 */
    remove(family, inUse) {
      if ((inUse || []).includes(family)) return false;
      stop(family);
      patch(family, {faces: [], progress: null, error: null, at: null});
      emit();
      return true;
    },
    /** 清空：导出在用的留下。返回删了几个族、留下几个、释放多少。 */
    clear(inUse) {
      const {rows} = L.downloadedList(now().list, inUse);
      const removed = rows.filter((r) => !r.inUse);
      removed.forEach((r) => { patch(r.family, {faces: [], at: null}); });
      emit();
      return {removed: removed.length, kept: rows.length - removed.length, freedBytes: removed.reduce((s, r) => s + r.sizeBytes, 0)};
    },
    setAuto(on) { state.auto = !!on; emit(); },
    setMirror(key, value) { state[key] = value; emit(); },
    setOffline(on) { state.offline = !!on; emit(); },

    /** 选中一个族：记进最近用过；还没下载（或上次失败）的就开始下载，先用回退字体显示。 */
    use(family) {
      state.recent = [family, ...state.recent.filter((n) => n !== family)].slice(0, 8);
      const f = now().byName[family];
      const starts = !!f && (f.state === 'downloadable' || f.state === 'failed');
      if (starts) startDownload(family);
      else emit();
      return starts ? f : null;
    },

    /** 打开视频：用到的族里还没下载的，按设置开始下载（一批、一个一个下）；最近失败过的不自动重试，直接记为没取到。 */
    openVideo(projectId) {
      state.video = projectId;
      if (state.open && state.open.projectId === projectId) return;
      const used = DATA.inVideo[projectId] || [];
      const need = used.filter((n) => now().byName[n] && (now().byName[n].state === 'downloadable' || now().byName[n].state === 'failed'));
      if (!need.length) { state.open = null; emit(); return; }
      if (!state.auto) {
        state.open = {projectId, families: need, results: {}, mode: 'off'};
        emit();
        return;
      }
      const results = {};
      need.forEach((n) => { if (now().byName[n].state === 'failed') results[n] = 'failed'; });
      state.open = {projectId, families: need, results, mode: 'auto'};
      const first = need.find((n) => !results[n]);
      if (first) startDownload(first);
      else emit();
    },
    /** 自动下载关着时，字体条上的「下载」：改成自动那一批，照样一个一个下。 */
    downloadOpen() {
      const job = state.open;
      if (!job) return;
      job.mode = 'auto';
      job.results = {};
      startDownload(job.families[0]);
    },
    skipCurrent() {
      const job = state.open;
      const cur = job && job.families.find((n) => !job.results[n]);
      if (!cur) return;
      stop(cur);
      patch(cur, {progress: null, error: {code: 'CANCELLED', message: '已跳过'}});
      settleOpen(cur, 'skipped');
      emit();
    },
    cancelOpen() {
      const job = state.open;
      if (!job) return;
      job.families.filter((n) => !job.results[n]).forEach((n) => {
        stop(n);
        patch(n, {progress: null, error: {code: 'CANCELLED', message: '已取消'}});
        job.results[n] = 'cancelled';
      });
      emit();
    },
    dismissOpen() { if (state.open) { state.open.dismissed = true; emit(); } },
    leaveVideo(projectId) {
      if (state.video === projectId) state.video = null;
      if (state.open && state.open.projectId === projectId) state.open = null;
      emit();
    },

    /** 视频用到的族（导出面板读）。 */
    inVideo: (projectId) => (DATA.inVideo[projectId] || []).slice(),
    /** 导出开始：用到的族里在下载的，导出先等；自动下载开着时，还没下载的现在开始下（Runtime 在导出任务里下载）。
        返回要等的族与要钉住的族（任务记录的 `fontPins`：导出结束之前设置里删不掉）。 */
    beginExport(projectId) {
      const used = DATA.inVideo[projectId] || [];
      if (state.auto) used.filter((n) => now().byName[n] && now().byName[n].state === 'downloadable').forEach(startDownload);
      return {wait: used.filter((n) => state.rt[n] && state.rt[n].progress),
        pins: used.filter((n) => metaOf[n] && metaOf[n].source === 'google-fonts')};
    },
    /** 导出开画时还没取到的族：照回退字体画，结果里一条警告（FONT_NOT_DOWNLOADED）。 */
    exportFallbacks(projectId) {
      return (DATA.inVideo[projectId] || []).map((n) => now().byName[n])
        .filter((f) => f && (f.state === 'failed' || f.state === 'downloadable' || f.state === 'downloading'))
        .map((f) => ({family: f.family, fallback: L.fallbackFor(f),
          reason: f.state === 'failed' ? f.error.message : state.auto ? '没有下载' : '自动下载已关闭'}));
    },
  };

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('online', () => store.setOffline(false));
    window.addEventListener('offline', () => store.setOffline(true));
  }

  function useFontLibrary() {
    return React.useSyncExternalStore(store.subscribe, store.get);
  }

  Object.assign(window, {BC_FONTSTORE: store, useFontLibrary});
})();
