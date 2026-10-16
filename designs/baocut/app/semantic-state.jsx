/* 本机语义索引的演示状态（embedding-integration-design §2.11、§2.12）。App 与 Web 都加载。
   一份模块级的状态：装没装、这台电脑支不支持、索引是否跟上、是否暂停、翻译记忆与术语候选开关。
   设置 › 语义索引改它，各入口读它（每个入口自己说明状态，不弹全局警告）。
   演示开关：URL 上 `?semantic=none|stale|unsupported|ready|full`（写在 # 前面）优先；否则读本机存的那份。
   规则与文案在 model-semantic.js。 */
(function () {
  const {useState, useEffect} = React;
  const S = window.BC_SEMANTIC;
  const KEY = window.BC_SURFACE.storageKey('bc-semantic-v1');
  function init() {
    const url = S.fromSearch(window.location.search);
    if (url) return url;
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && typeof v === 'object') return S.normalize(v);
    } catch (e) { /* 无痕窗口等：用缺省 */ }
    return Object.assign({}, S.DEFAULT);
  }
  const store = {st: init(), subs: new Set()};
  function set(patch) {
    store.st = Object.assign({}, store.st, typeof patch === 'function' ? patch(store.st) : patch);
    try { localStorage.setItem(KEY, JSON.stringify(store.st)); } catch (e) { /* 存不了就只在这一页有效 */ }
    store.subs.forEach((f) => f());
  }
  /** [状态, 能不能用（S.status）, set] */
  function useSemantic() {
    const [, tick] = useState(0);
    useEffect(() => {
      const f = () => tick((n) => n + 1);
      store.subs.add(f);
      return () => { store.subs.delete(f); };
    }, []);
    return [store.st, S.status(store.st), set];
  }

  /* 装语义搜索包（设置 › 语义索引与首次启动引导共用，2026-10-16）：落一条后台任务（kind 'model-install'，带 `semPkg`；
     不叫 `pkg`——那是任务记录上的项目包路径，来源卡会读它）。进度在这里跑、不随页面卸载，设置页按这条任务画「正在安装」。
     opts.outcome 是下载确认框的结果：有一部分没下成时下好的留着（st.half），任务落成失败（`kept` 说有没有留下东西），
     设置页写哪一部分、连的哪里，「补齐」只下缺的。opts.notify：收口时弹 toast。 */
  function install(app, pkg, opts) {
    const o = opts || {};
    const failed = o.outcome && o.outcome.failed;
    const completing = !!(store.st.half && store.st.half.pkg === pkg.id);
    const tid = app.addTask({kind: 'model-install', title: `${completing ? '补齐' : '下载'}「${pkg.name}」`, sub: '本机模型',
      phase: '下载中', cancellable: false, semPkg: pkg.id});
    let pct = 0;
    const timer = setInterval(() => {
      pct = Math.min(100, pct + 9);
      if (pct < 100) { app.patchTask(tid, {pct}); return; }
      clearInterval(timer);
      const cur = store.st;
      if (!failed) {
        app.patchTask(tid, {pct: 100, status: 'done', phase: null});
        set({install: 'full', index: 'stale', half: cur.half && cur.half.pkg !== pkg.id ? cur.half : null});
        if (o.notify) app.toast(cur.visual ? `已安装「${pkg.name}」：正在建文字索引与画面索引（演示）` : `已安装「${pkg.name}」：正在给已有文稿建文字索引（演示）`, 'positive');
        return;
      }
      const before = cur.half && cur.half.pkg === pkg.id ? cur.half.have : [];
      const have = before.concat((o.outcome.done || []).filter((id) => before.indexOf(id) < 0));
      const names = have.map((id) => (pkg.parts.find((x) => x.id === id) || {}).name || id);
      set({half: {pkg: pkg.id, have, note: window.BC_DLSRC.failLine(failed, names)}});
      app.patchTask(tid, {status: 'error', pct: null, phase: null, kept: have.length > 0,
        error: `${failed.name}没下成：连不上 ${failed.host}，可以在 设置 › 语义索引 里${have.length ? '补齐' : '换个来源再下'}`});
      if (o.notify) app.toast(`「${pkg.name}」没装完：${failed.name}没下成`, 'negative');
    }, 200);
    return tid;
  }

  /** 一个入口的那一句（§2.11）：置灰 / 退回的原因 + 去设置；索引在更新时是不阻塞的提醒。能用且最新时不画。 */
  function SemNote({entry, className}) {
    const app = useApp();
    const [st] = useSemantic();
    const n = S.entryNote(entry, st);
    if (!n) return null;
    const canGo = n.link && window.BC_SURFACE.ai && app.go;
    return (
      <div className={cx('semnote', n.tone === 'notice' && 'semnote--notice', className)}>
        <Ic n={n.tone === 'notice' ? 'refresh' : 'info'} className="ic--14" />
        <span className="semnote__x">{n.text}</span>
        {canGo ? <BCAction className="tsetup__lnk" onClick={() => app.go({r: 'settings', sec: 'semantic'})}>{n.link}</BCAction> : null}
      </div>
    );
  }

  Object.assign(window, {BC_SEMSTATE: {useSemantic, set, get: () => store.st, install}, SemNote});
})();
