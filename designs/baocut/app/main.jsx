/* 入口：装配 store、路由分发、全局宿主（向导 sheet / 确认框 / toast）。 */
(function () {
  const {useEffect} = React;
  const D = window.BC_DATA;

  function Screens() {
    const app = useApp();
    const r = app.route;
    /* Home 与会话共用一个工作区（product-design §2.5 / §3.3）：首页与项目里的新会话是草稿工作区，
       第一句话之前就能开标签页（BC_HOME_WORKSPACE.keyFor） */
    if (r.r === 'agent' || r.r === 'home') return <window.Shell><window.HomeWorkspace key={window.BC_HOME_WORKSPACE.keyFor(r) || 'new'} /></window.Shell>;
    const movieId = r.r === 'editor' ? r.id : null;
    if (movieId) {
      /* 视频不在了（删了 / 旧链接）：落到 Space（2026-10-01：「我的项目」并入 Space） */
      if (!app.projById(movieId)) return <window.Shell><window.SpacePage /></window.Shell>;
      /* 打开哪个项目就装哪个语言包（第 73 轮）：activate 幂等（同包直接返回）。
         key 让编辑器整屏重挂——轨集 / 样式态 / cue 改写都不许跨项目串。 */
      D.activateProject(movieId, app.projById(movieId));
      /* `t` 是可选的落点（第 118 轮）：项目搜索里点一条带时间的命中，
         就该落在那一刻，而不是把项目打开让人自己再找一遍。 */
      return <window.EditorPage key={movieId} projectId={movieId} startT={r.t} />;
    }
    const inner =
      /* 2026-10-01：`projects` 是 Space（§4，我的项目并入）；旧的 `sessions` 链接也落在这里 */
      r.r === 'projects' || r.r === 'sessions' ? <window.SpacePage />
      : r.r === 'tasks'  ? <window.TasksPage />
      : r.r === 'task'   ? <window.TaskDetailPage id={r.id} />
      : r.r === 'agent'  ? <window.AgentPage id={r.id} dir={r.dir} />
      /* 2026-09-17：远端算力从「工具」搬到「服务」（§17.6）；`remote` 与 `tools/remote` 两种旧链接都落到服务页 */
      : window.BC_SERVICES.resolve(r) ? <window.ServicesPage key={window.BC_SERVICES.resolve(r)} id={window.BC_SERVICES.resolve(r)} tab={r.tab} />
      : r.r === 'tools'  ? <window.ToolsPage key={r.id || 'gallery'} id={r.id} />
      /* 第 110 轮：`skill` 路由退役——Agent 设置并入 Settings › Agent。旧链接落到对应的新地方。 */
      : r.r === 'skill'  ? <window.SettingsPage sec="skills" />
      : r.r === 'models' ? <window.SettingsPage sec={r.sec || "local"} tab={r.tab} />
      : r.r === 'settings' ? <window.SettingsPage sec={r.sec} tab={r.tab} id={r.id} from={r.from} />
      : <window.HomePage />;
    return <window.Shell>{inner}</window.Shell>;
  }

  function Shortcuts() {
    const app = useApp();
    useEffect(() => {
      const onKey = (e) => {
        // 模态框开着时快捷键归它：本目录的 <dialog> / aria-modal 框，和 S2 的 Dialog（RAC 渲染，带 data-rac，
        // 自己不写 aria-modal——遮罩外的内容由它设 aria-hidden）。原型开关面板、任务药丸的浮层也是 role=dialog，不算
        if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="dialog"][data-rac], [role="alertdialog"]')) return;
        const inField = /^(INPUT|TEXTAREA)$/.test((e.target || {}).tagName || '');
        const meta = e.metaKey || e.ctrlKey;
        if (meta && e.key === '[') { e.preventDefault(); app.back(); }
        else if (meta && e.key === ']') { e.preventDefault(); app.fwd(); }
        else if (meta && e.key.toLowerCase() === 'n') { e.preventDefault(); app.newProject(); }
        // ⇧⌘H：Space（2026-10-01，原「我的项目」）
        else if (meta && e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); app.railGo('space'); }
        else if (meta && e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); app.go({r: 'tasks'}); }
        else if (meta && e.key === ',') { e.preventDefault(); app.go({r: 'settings'}); }
        else if (e.ctrlKey && e.metaKey && e.key.toLowerCase() === 's') { e.preventDefault(); app.toggleSidebar(); }
      };
      /* 捕获阶段：S2 的集合（SideNav / CardView / TableView）获焦时，react-aria 的键盘处理默认 stopPropagation，
         冒泡到 window 就收不到了——点完侧栏一行再按 ⌘[ 会没反应。这里只认带 ⌘ / ⌃ 的组合键，不跟它们的方向键抢。 */
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, [app]);
    return null;
  }

  /* 导出任务的推进器（第 120 轮）：导出一开就是一条任务记录，进度按 §17.1 的耗时模型
     推进。挂在根上而不是编辑器里——关掉弹层、离开编辑器去后台任务页，它都照走；
     顶栏「导出中 · 31%」、任务卡、任务详情读的都是同一条记录。hook 本体在 export.jsx。 */
  function ExportRunner() {
    window.useExportRunner(useApp());
    return null;
  }

  function App() {
    /* App rail 那一层（apprail-store.jsx）盖在共享 store 上：项目（目录）、打开 / 关闭视频、Space 的整理标记 */
    const base = useStore();
    const ia = {...base, ...window.useAppIA(base)};
    const store = {...ia, ...window.useHomeWorkspace(ia)};
    /* 全屏统一 S2 Provider：语言、主题与链接导航由 App 提供（product-design §2.6）。 */
    const RSP = window.RSP;
    const router = React.useMemo(() => ({navigate: (href) => base.go(window.BC_APP_IA.routeFromHref(href))}), [base.go]);
    return (
      <RSP.Provider locale="zh-CN" background="base" UNSAFE_className="bc-rsp-root" router={router}
        colorScheme={store.theme === 'system' ? undefined : store.theme}>
      <AppCtx.Provider value={store}>
        <Shortcuts />
        <ExportRunner />
        {/* 自动更新的宿主（§17.7）：后台下载与「已下载」toast 不跟着设置页卸载 */}
        <window.AppUpdateProvider>
          <Screens />
        </window.AppUpdateProvider>
        <window.ProjectInfoDialog />
        <ConfirmDialog ask={store.ask} onCancel={store.clearAsk}
          onConfirm={() => { const a = store.ask; store.clearAsk(); if (a && a.run) a.run(); }} />
        <ToastHost toasts={store.toasts} onDismiss={store.dismissToast} />
      </AppCtx.Provider>
      </RSP.Provider>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
