/* BaoCut Web 原型入口（BaoCutWeb.html）：装配 store、两种路由、全局宿主。
   与 main.jsx 的差别就是 Web 的范围（§22）：
     · 路由只有「某个项目的编辑器」与「还没选项目」——没有首页 / 我的项目 / 任务 / 工具 / 服务 / 设置 / Agent 页；
     · 没有 ⌘N、⇧⌘A、⇧⌘H、⇧⌘B、⌘, 这些去往 App 页面的快捷键，只留侧栏开合；
     · 导出任务推进器照挂（导出是 Web 保留的能力）。 */
(function () {
  const {useEffect} = React;
  const D = window.BC_DATA;
  const SURF = window.BC_SURFACE;

  function Screens() {
    const app = useApp();
    const r = SURF.normalizeRoute(app.route, (id) => !!app.projById(id));
    if (r.r === 'editor') {
      D.activateProject(r.id, app.projById(r.id));
      return <window.EditorPage key={r.id} projectId={r.id} startT={r.t} />;
    }
    return <window.Shell sideForce><window.WebNoProject /></window.Shell>;
  }

  /* 首次打开（路由栈还是初始的 home）直接落到最近打开的那个项目：真产品里 Web 由 Agent 带着项目地址打开 */
  function Landing() {
    const app = useApp();
    useEffect(() => {
      if (app.route.r !== 'home') return;
      const first = window.BC_AGENT.sortProjects(app.activeProjects, 'opened')
        .find((p) => p.status !== 'transcribing' && p.status !== 'queued' && p.status !== 'error');
      if (first) app.replace({r: 'editor', id: first.id});
    }, []);
    return null;
  }

  function Shortcuts() {
    const app = useApp();
    useEffect(() => {
      const onKey = (e) => {
        if (document.querySelector('dialog[open], [role="dialog"][data-rac], [role="alertdialog"]')) return;
        if (e.ctrlKey && e.metaKey && e.key.toLowerCase() === 's') { e.preventDefault(); app.toggleSidebar(); }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [app]);
    return null;
  }

  function ExportRunner() {
    window.useExportRunner(useApp());
    return null;
  }

  function App() {
    const store = useStore();
    return (
      <window.RSP.Provider locale="zh-CN" background="base" colorScheme={store.theme === 'system' ? undefined : store.theme} UNSAFE_className="bc-rsp-root">
      <AppCtx.Provider value={store}>
        <Landing />
        <Shortcuts />
        <ExportRunner />
        <Screens />
        <window.ProjectInfoDialog />
        <ConfirmDialog ask={store.ask} onCancel={store.clearAsk}
          onConfirm={() => { const a = store.ask; store.clearAsk(); if (a && a.run) a.run(); }} />
        <ToastHost toasts={store.toasts} onDismiss={store.dismissToast} />
      </AppCtx.Provider>
      </window.RSP.Provider>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
