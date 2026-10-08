/* BaoCut Web 原型 — 外壳里 Web 独有的两件：视频列表侧栏 ＋「还没选视频」空页（§22.3）。
   其余一律是共享件：标题栏 / 缝 / 外壳容器在 shell.jsx（按 BC_SURFACE 收掉 App 专属件），
   编辑器、面板、时间轴、导出与 App 原型同一份文件。

   Web 的侧栏**只有视频列表**：没有新建视频、我的视频、后台任务、工具、服务、设置、帮助，
   视频行下也不挂 Agent 会话——这些入口都在 App 里，AI 操作从 Agent 或 App 发起。
   默认收起（`BC_SURFACE.sidebarDefaultOpen = false`），顶栏最左那颗按钮开合。 */
(function () {
  const {useState} = React;
  const AG = window.BC_AGENT;

  const STEP = 8;   // 首屏与每次「加载更多」的条数，同 App 侧栏的项目段

  function WebProjectRow({p}) {
    const app = useApp();
    const on = app.route.r === 'editor' && app.route.id === p.id;
    /* 行的形状与 App 侧栏的项目行同一套 class（siderow--proj），只是行尾没有「新会话」那颗 +。
       状态词是只读的：转录 / 排队是别处（Agent 或 App）起的，这里只报进度。 */
    return (
      <div className={cx('siderow siderow--proj', on && 'is-on')}>
        <BCAction className="siderow__main" aria-current={on ? 'page' : undefined}
          onClick={() => app.go({r: 'editor', id: p.id})}>
          <Ic n="film" className="ic--16" />
          <span className="siderow__t">
            <span className="t-truncate">{p.title}</span>
            {p.status === 'transcribing' ? <span className="siderow__sub">转录中 · {app.projPct(p)}%</span>
              : p.status === 'queued' ? <span className="siderow__sub">排队中 · 第 {p.queuePos} 位</span>
              : p.status === 'error' ? <span className="siderow__sub">转录失败</span>
              : window.shortsSideNote(app.projects, p) ? <span className="siderow__sub t-truncate">{window.shortsSideNote(app.projects, p)}</span> : null}
          </span>
        </BCAction>
      </div>
    );
  }

  function WebSidebar() {
    const app = useApp();
    const {activeProjects: projects, sidebar} = app;
    const [shown, setShown] = useState(STEP);
    /* 次序固定「最近打开」——排序菜单是一个功能入口，Web 的侧栏不放 */
    const sorted = AG.sortProjects(projects, 'opened');
    const rows = sorted.slice(0, shown);
    return (
      <div className="side side--web" style={{width: sidebar.width || sidebar.last}}>
        <div className="side__hd side__hd--web row">
          <span className="t-section grow">视频</span>
          <span className="siderow__tail">{projects.length}</span>
        </div>
        <div className="side__tree bc-scroll">
          {rows.map((p) => <WebProjectRow key={p.id} p={p} />)}
          {sorted.length > shown ? (
            <BCAction type="button" className="siderow siderow--loadmore"
              onClick={() => setShown((n) => AG.loadMore(n, STEP, sorted.length))}>
              <Ic n="more" className="ic--16" />
              <span className="siderow__t">加载更多</span>
            </BCAction>
          ) : null}
          {!sorted.length ? (
            <div className="t-detail-xs webside__none">还没有视频。在 Agent 或 BaoCut App 里新建，这里会跟着出现。</div>
          ) : null}
        </div>
      </div>
    );
  }

  /* 还没选项目：Web 没有首页，也不能新建——这一页只指路。侧栏此时强制展开（Shell 的 sideForce）。 */
  function WebNoProject() {
    const app = useApp();
    const n = app.activeProjects.length;
    return (
      <div className="webnone">
        <Empty icon="film" title={n ? '从左侧选一部视频' : '还没有视频'}>
          {n ? '在这里预览成片效果、改字幕与画面元素，再导出。' : '视频在 Agent 或 BaoCut App 里新建，建好后出现在左侧。'}
          <div className="webnone__note">转录、翻译、配音等 AI 操作从 Agent 或 BaoCut App 发起，结果会同步到这里。</div>
        </Empty>
      </div>
    );
  }

  Object.assign(window, {WebSidebar, WebNoProject, WebProjectRow});
})();
