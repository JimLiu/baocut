/* Home 的页面侧栏（2026-10-01，product-design §3.1）—— 只在 App 入口加载，控件全用 react-spectrum S2。

   从上到下：新建会话；然后三段（按用户反馈暂时移除 §3.1 的搜索与通知入口）——
     置顶：你钉住的项目与会话；
     项目：一个项目 = 一个目录（Agent 的工作目录），展开是挂在它下面的会话，按最近活动排；
           项目行保持单行，状态汇总与路径在悬停提示里；
           段头的加号菜单：新建项目、打开已有目录；
     最近：不属于任何项目的会话。
   三处的会话行是同一个行组件（sessionItem）：单行标题省略，末尾显示状态图标；完整状态与时间放在悬停说明里。
   会话选中行按截图反馈用中性圆角底色；置顶会话带单气泡 Comment 图标。S2 SideNav 继续负责路由、树结构和键盘焦点。
   工具与服务在 App rail 的 end section 上（2026-10-02，apprail.jsx），这里不再放。
   没有缩略图、没有卡片——这里是对话的目录，不是素材库（素材在 Space）。
   树与汇总都在 model-agent-projects.js（BC_AGENT_PROJECTS）里算，这里只画。 */
(function () {
  const {useState, useMemo, useEffect} = React;
  const AP = window.BC_AGENT_PROJECTS;
  const IA = window.BC_APP_IA;
  const AG = window.BC_AGENT;

  /* 会话状态的色调 → S2 StatusLight 的 variant（「有待审阅结果」用紫，和进行中的蓝分开） */
  const LIGHT = {notice: 'notice', negative: 'negative', informative: 'informative', accent: 'purple', positive: 'positive'};

  /** 紧凑会话行：运行显示 S2 加载环，其余需关注状态使用不同形状的图标。 */
  function SessionTail({s}) {
    const R = window.RSP;
    const st = AP.statusInfo(AP.sessionStatus(s));
    if (!st) return null;
    const Icon = {waiting: R.Icons.ClockPending, failed: R.Icons.AlertTriangle}[st.k];
    return <span className={cx('hs-sess__status', `hs-sess__status--${st.k}`)} title={st.label} aria-hidden="true">
      {st.k === 'running' ? <R.ProgressCircle size="S" isIndeterminate aria-label="进行中" />
        : Icon ? <Icon /> : <R.StatusLight size="S" variant={LIGHT[st.tone]} role="img" aria-label={st.label} UNSAFE_className="hs-sess__light" />}
    </span>;
  }

  /** 会话行（置顶、项目下、最近三处同一个）：单行标题 + 行尾状态，完整内容与时间由链接说明保留。 */
  function sessionItem(R, app, s, key, pinned = false) {
    const href = IA.hrefFor({r: 'agent', id: s.id});
    const title = s.title || '新会话';
    const status = AP.statusInfo(AP.sessionStatus(s));
    const dir = app.dirById(AP.dirOf(s, app.projects));
    const detail = `${title} · ${dir ? dir.name : '不属于任何项目'} · ${status ? status.label + ' · ' : ''}${AG.agoLabel(s.ago)}`;
    const archive = () => {
      app.patchSession(s.id, {archived: true});
      if (app.route.r === 'agent' && app.route.id === s.id) app.go({r: 'home'});
      app.toast(`已归档「${title}」`, null, {label: '撤销', run: () => app.patchSession(s.id, {archived: false})});
    };
    return (
      <R.SideNavItem key={key} id={key} textValue={title} href={href} data-session-row="">
        <R.SideNavItemContent>
          <R.SideNavItemLink href={href} aria-label={detail}>
            {pinned && <R.Icons.Comment />}
            <R.Text>
              <span className="hs-sess" title={detail}>
                <span className="hs-sess__t">{title}</span>
                <SessionTail s={s} />
              </span>
            </R.Text>
          </R.SideNavItemLink>
          <R.ActionButtonGroup isQuiet UNSAFE_className="hs-sess__actions" aria-label={`「${title}」的操作`}>
            <R.TooltipTrigger>
              <R.ActionButton aria-label={`${s.pinned ? '取消置顶' : '置顶'}「${title}」`} onPress={() => app.toggleSessionPin(s.id)}><R.Icons.PinOn /></R.ActionButton>
              <R.Tooltip>{s.pinned ? '取消置顶' : '置顶'}</R.Tooltip>
            </R.TooltipTrigger>
            <R.TooltipTrigger>
              <R.ActionButton aria-label={`归档「${title}」`} onPress={archive}><R.Icons.Archive /></R.ActionButton>
              <R.Tooltip>归档会话</R.Tooltip>
            </R.TooltipTrigger>
          </R.ActionButtonGroup>
        </R.SideNavItemContent>
      </R.SideNavItem>
    );
  }

  /** 一个项目：文件夹行（名 + 状态汇总 / 路径）+ 它的会话；行尾 ⋯ 是项目菜单（§3.1）。 */
  function projectItem(R, app, p, key, open) {
    const d = p.dir;
    const sum = AP.summaryText(p.summary);
    const Icon = open ? R.Icons.FolderOpen : R.Icons.Folder;
    const newHref = IA.hrefFor({r: 'agent', dir: d.id});
    const onAction = (k) => {
      if (k === 'new') app.go({r: 'agent', dir: d.id});
      else if (k === 'pin') app.toggleDirPin(d.id);
      else if (k === 'space') app.go({r: 'projects', id: d.id});
      else if (k === 'reveal') app.toast(`已在文件夹中显示 ${d.path}（演示）`);
    };
    return (
      <R.SideNavItem key={key} id={key} textValue={d.name} hasChildItems data-project-row="">
        <R.SideNavItemContent>
          <Icon />
          <R.Text>
            <span className="hs-proj" title={`${d.name} · ${sum || ""} · ${d.path}`}>
              <span className="hs-proj__t">{d.name}</span>
              <span className="hs-proj__sub">{sum || `${p.movies.length ? p.movies.length + ' 部视频 · ' : ''}${d.path}`}</span>
            </span>
          </R.Text>
          <R.ActionMenu aria-label={`项目「${d.name}」的操作`} data-project-menu="" isQuiet size="S" onAction={onAction}>
            <R.MenuItem id="new" textValue="新建会话"><R.Icons.Add /><R.Text>在这个项目里新建会话</R.Text></R.MenuItem>
            <R.MenuItem id="pin" textValue={d.pinned ? '取消置顶' : '置顶'}><R.Icons.PinOn /><R.Text>{d.pinned ? '取消置顶' : '置顶'}</R.Text></R.MenuItem>
            <R.MenuItem id="space" textValue="在 Space 中显示"><R.Icons.Asset /><R.Text>在 Space 中显示</R.Text></R.MenuItem>
            <R.MenuItem id="reveal" textValue="在文件夹中显示"><R.Icons.OpenIn /><R.Text>在文件夹中显示</R.Text></R.MenuItem>
          </R.ActionMenu>
        </R.SideNavItemContent>
        {p.sessions.map((s) => sessionItem(R, app, s, `${key}/${s.id}`))}
        {p.sessions.length ? null : (
          <R.SideNavItem id={`${key}/new`} textValue="在这里新建会话" href={newHref}>
            <R.SideNavItemContent>
              <R.SideNavItemLink href={newHref}><R.Text><span className="hs-row__new">在这里新建会话</span></R.Text></R.SideNavItemLink>
            </R.SideNavItemContent>
          </R.SideNavItem>
        )}
      </R.SideNavItem>
    );
  }

  /** 「项目」段头：段名 + 加号菜单——新建项目 / 打开已有目录（§3.1）。
      加进来的目录排在最前、展开，并去它的「在这里新建会话」。原型没有系统的目录选择器，打开固定接一个演示目录。
      按钮是 S2 的 quiet ActionButton（S 号，与行尾的 ⋯ ActionMenu 同号），与段名同一行、右对齐到各行展开箭头那一列。 */
  function ProjectsHead({onAdded, collapsed, onToggle, grouping, sort}) {
    const app = useApp();
    const R = window.RSP;
    const [creating, setCreating] = React.useState(false);
    const onAction = (k) => {
      if (k === 'new') {
        setCreating(true);
      } else if (k === 'open') {
        const r = app.openDir();
        if (!r) return;
        onAdded(r.dir.id);
        app.toast(r.added ? `已接进 ${r.dir.path}（演示：这里会先让你选目录）`
          : `${r.dir.path} 已经是项目「${r.dir.name}」`);
      }
    };
    return (
      <span className="hs-head" onFocus={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {creating && <window.CreateProjectDialog onClose={() => setCreating(false)} onCreated={d => onAdded(d.id)} />}
        <SectionToggle label={grouping === 'flat' ? '会话' : '项目'} collapsed={collapsed} onToggle={onToggle} />
        <span className="hs-head__actions">
          <R.MenuTrigger>
            <R.ActionButton isQuiet size="S" aria-label="整理项目与会话"><R.Icons.More /></R.ActionButton>
            <R.Menu aria-label="侧栏设置">
              <R.SubmenuTrigger>
                <R.MenuItem id="organize" textValue="整理侧栏"><R.Text>整理侧栏</R.Text></R.MenuItem>
                <R.Menu aria-label="整理侧栏" selectionMode="single" selectedKeys={[grouping]} onSelectionChange={(keys) => app.setPref('sidebarGrouping', [...keys][0])}>
                  <R.MenuItem id="project" textValue="按项目分组"><R.Text>按项目分组</R.Text></R.MenuItem>
                  <R.MenuItem id="flat" textValue="在一个列表中"><R.Text>在一个列表中</R.Text></R.MenuItem>
                </R.Menu>
              </R.SubmenuTrigger>
              <R.SubmenuTrigger>
                <R.MenuItem id="sort" textValue="会话排序"><R.Text>会话排序</R.Text></R.MenuItem>
                <R.Menu aria-label="会话排序" selectionMode="single" selectedKeys={[sort]} onSelectionChange={(keys) => app.setPref('sidebarSort', [...keys][0])}>
                  <R.MenuItem id="recent" textValue="最近活动"><R.Text>最近活动</R.Text></R.MenuItem>
                  <R.MenuItem id="name" textValue="名称"><R.Text>名称</R.Text></R.MenuItem>
                </R.Menu>
              </R.SubmenuTrigger>
            </R.Menu>
          </R.MenuTrigger>
          <R.MenuTrigger>
            <R.ActionButton isQuiet size="S" UNSAFE_className="hs-head__btn" aria-label="新建或打开项目"><R.Icons.Add /></R.ActionButton>
            <R.Menu aria-label="新建或打开项目" onAction={onAction}>
              <R.MenuItem id="new" textValue="新建项目…"><R.Icons.Folder /><R.Text>新建项目…</R.Text></R.MenuItem>
              <R.MenuItem id="open" textValue="打开已有目录…"><R.Icons.FolderOpen /><R.Text>打开已有目录…</R.Text></R.MenuItem>
            </R.Menu>
          </R.MenuTrigger>
        </span>
      </span>
    );
  }

  function SectionToggle({label, collapsed, onToggle}) {
    const R = window.RSP;
    const Icon = collapsed ? R.Icons.ChevronRight : R.Icons.ChevronDown;
    return <R.ActionButton isQuiet size="S" UNSAFE_className="hs-head__toggle" aria-label={`${collapsed ? '展开' : '折叠'}${label}`} aria-expanded={!collapsed} onPress={onToggle}>
      <R.Text><span className="hs-head__label">{label}</span><span className="hs-head__chevron"><Icon /></span></R.Text>
    </R.ActionButton>;
  }

  // Header controls own focus/keys; do not let NavigationTree redirect them to a row.
  function SectionHead(props) {
    return <span className="hs-head" onFocus={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><SectionToggle {...props} /></span>;
  }

  function HomeSidebar() {
    const app = useApp();
    const R = window.RSP;
    const {sidebar} = app;
    const route = IA.sidebarRoute(app.route, app.nav);
    const [collapsed, setCollapsed] = useState(new Set());
    const toggleSection = (key) => setCollapsed((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
    const grouping = app.prefs.sidebarGrouping === 'flat' ? 'flat' : 'project';
    const sort = app.prefs.sidebarSort === 'name' ? 'name' : 'recent';
    const full = useMemo(() => AP.tree({dirs: app.dirs, movies: app.activeProjects, sessions: app.sessions}),
      [app.dirs, app.activeProjects, app.sessions]);
    const tree = useMemo(() => AP.sidebarView(full, {sort}), [full, sort]);
    const curSess = route.r === 'agent' && route.id ? app.sessionById(route.id) : null;
    const curDir = route.r === 'agent' ? (curSess ? AP.dirOf(curSess, app.projects) : route.dir || null) : null;
    /* 当前会话所在的项目默认展开。 */
    const [exp, setExp] = useState(() => new Set(['proj:' + curDir]));
    useEffect(() => { if (curDir) setExp((s) => (s.has('proj:' + curDir) ? s : new Set([...s, 'proj:' + curDir]))); }, [curDir]);
    /* 段头菜单加进来的目录：展开它，去它的「在这里新建会话」。 */
    const onDirAdded = (id) => {
      setCollapsed((prev) => { const next = new Set(prev); next.delete('proj'); return next; });
      setExp((s) => new Set([...s, 'proj:' + id]));
      app.go({r: 'agent', dir: id});
    };
    const expanded = exp;
    const sel = route.r === 'agent' ? IA.hrefFor(route) : null;
    return (
      <div className="hside hside--home" style={{width: sidebar.width || sidebar.last}}>
        <h2 className="app-section-title">BaoCut</h2>
        <div className="hside__top">
          <R.ActionButton isQuiet size="M" UNSAFE_className="hside__new"
            onPress={() => app.go({r: 'home'})}>
            <R.Icons.AddCircle /><R.Text>新建会话</R.Text>
          </R.ActionButton>
        </div>
        <div className="hside__nav bc-scroll">
          <R.SideNav aria-label="项目与会话" selectedRoute={sel} expandedKeys={expanded}
            onExpandedChange={(k) => setExp(new Set(k))}>
            {tree.pinned.length ? (
              <R.SideNavSection id="pin">
                <R.SideNavHeader><SectionHead label="置顶" collapsed={collapsed.has('pin')} onToggle={() => toggleSection('pin')} /></R.SideNavHeader>
                {(!collapsed.has('pin')) && tree.pinned.map((x) => (x.kind === 'dir'
                  ? projectItem(R, app, x.row, 'pin:' + x.id, expanded.has('pin:' + x.id))
                  : sessionItem(R, app, x.sess, 'pin:' + x.id, true)))}
              </R.SideNavSection>
            ) : null}
            <R.SideNavSection id="proj">
              <R.SideNavHeader><ProjectsHead onAdded={onDirAdded} grouping={grouping} sort={sort} collapsed={collapsed.has('proj')} onToggle={() => toggleSection('proj')} /></R.SideNavHeader>
              {(!collapsed.has('proj')) && (grouping === 'flat'
                ? tree.flat.map((s) => sessionItem(R, app, s, 'flat:' + s.id))
                : tree.projects.map((p) => projectItem(R, app, p, 'proj:' + p.dir.id, expanded.has('proj:' + p.dir.id))))}
            </R.SideNavSection>
            {grouping === 'project' && tree.loose.length ? (
              <R.SideNavSection id="recent">
                <R.SideNavHeader><SectionHead label="最近" collapsed={collapsed.has('recent')} onToggle={() => toggleSection('recent')} /></R.SideNavHeader>
                {(!collapsed.has('recent')) && tree.loose.map((s) => sessionItem(R, app, s, 'loose:' + s.id))}
              </R.SideNavSection>
            ) : null}
          </R.SideNav>
        </div>
      </div>
    );
  }

  Object.assign(window, {HomeSidebar, SessionTail, SESSION_LIGHT: LIGHT});
})();
