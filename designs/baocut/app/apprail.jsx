/* App rail（2026-10-01，product-design §2.1–§2.2）—— 只在 App 入口加载。
   上组 Home / Space / 工具，分隔线下方服务 / 后台任务，底部设置（按用户截图调整 §2.1）。
   宽 56，**只有图标**：名字放进 tooltip（hover 或键盘聚焦时出现），读屏走按钮的 aria-label。
   选中 = 图标左侧一根短指示竖条 + 图标变深（gray-800），没有底色块；hover 才有一块浅圆角底。

   S2 没有图标导航 rail 的外框；布局与选中指示条遵守 app frame。
   交互使用 S2 ActionButton、Tooltip 与 NotificationBadge。
   点哪一格去哪一格上次停留的地方（BC_APP_IA.railTarget）。 */
(function () {
  const IA = window.BC_APP_IA;

  function RailBtn({tab, on, onPress, badge, label}) {
    const app = useApp();
    const Icon = window.RSP.Icons[tab.icon];
    /* 侧栏隐藏时悬停入口浮出该页侧栏（home-shell-chrome.jsx 的 useShellPeek；设置没有侧栏，在那边跳过） */
    return (
      <div className={cx('apprail__btn', on && 'is-on')}
        onPointerEnter={() => app.peekSidebar?.(tab.k)} onPointerLeave={() => app.leaveSidebar?.()}>
        <Tip label={label || tab.label} side="right">
          <window.RSP.ActionButton isQuiet size="M" UNSAFE_className="apprail__ic"
            aria-current={on ? 'page' : undefined} aria-label={label || tab.label} onPress={onPress}>
            <Icon />
          </window.RSP.ActionButton>
        </Tip>
        {badge}
      </div>
    );
  }

  function AppRail() {
    const app = useApp();
    const RSP = window.RSP;
    const cur = IA.tabOf(app.route);
    /* 任务中心的数沿用原侧栏「后台任务」那一行：在跑的 + 排队的 */
    const running = app.tasks.filter((t) => t.status === 'running' || t.status === 'queued').length;
    /* 服务：原来 Home 侧栏「服务」行尾的三颗状态灯，上 rail 后收成一个角标——有服务出错才亮（橙点）；
       每项服务各自的灯在服务页里（总览标题旁与每一行） */
    const svc = window.BC_SERVICES.summary(app.svcStates);
    const svcErr = !!svc && svc.tone === 'error';
    const extra = {
      tasks: {
        label: running ? `后台任务，${running} 个在跑或排队` : '后台任务',
        badge: running ? <span className="apprail__badge"><RSP.NotificationBadge value={running} size="S" /></span> : null,
      },
      services: {
        label: svcErr ? `服务，${svc.text}` : '服务',
        badge: svcErr ? <span className="apprail__badge apprail__badge--dot"><RSP.NotificationBadge size="S" aria-label={svc.text} UNSAFE_className="apprail__alert" /></span> : null,
      },
    };
    const btn = (t) => {
      const x = extra[t.k] || {};
      return <RailBtn key={t.k} tab={t} on={cur === t.k} onPress={() => app.railGo(t.k)} label={x.label} badge={x.badge} />;
    };
    return (
      <nav className="apprail" aria-label="主导航">
        <div className="apprail__top">
          <div className="apprail__group" aria-label="主要入口">{IA.TABS.map(btn)}</div>
          <hr className="apprail__divider" />
          <div className="apprail__group" aria-label="服务与后台任务">{IA.SECONDARY.map(btn)}</div>
        </div>
        <div className="apprail__end">
          {IA.END.map((t) => (t.k === 'settings' && window.AppUpdateSideButton
            /* 更新按钮（§17.7）原来挂在侧栏「设置」行右侧；rail 上放在设置格正上方，不显示时这一格不占位 */
            ? <React.Fragment key={t.k}><div className="apprail__upd"><window.AppUpdateSideButton /></div>{btn(t)}</React.Fragment>
            : btn(t)))}
        </div>
      </nav>
    );
  }

  /** §2 / §6：主入口的浏览目录。选条目只切右侧内容，正在执行的任务和服务继续运行。 */
  function UtilitySidebar({kind}) {
    const app = useApp();
    const R = window.RSP;
    const SV = window.BC_SERVICES;
    const title = {tasks: '后台任务', tools: '工具', services: '服务'}[kind];
    const service = SV.resolve(app.route);
    const selected = kind === 'services' ? {r: 'services', ...(service && service !== 'index' ? {id: service} : {})}
      : kind === 'tools' ? {r: 'tools', ...(window.BC_TOOLS.openable(app.route.id) ? {id: app.route.id} : {})} : app.route;
    const root = {r: kind};
    const row = (id, label, route, icon, tail, detail) => {
      const Icon = R.Icons[icon];
      const href = IA.hrefFor(route);
      return <R.SideNavItem key={`${kind}:${id}`} id={`${kind}:${id}`} textValue={label} href={href} data-utility-row="">
        <R.SideNavItemContent><R.SideNavItemLink href={href} aria-label={detail || label}>
          {icon === 'mcp' ? <Ic n="mcp" /> : <Icon />}<R.Text><span className={cx('utility-nav__row', kind === 'services' && 'utility-nav__row--service')} title={detail || label}><span className="utility-nav__label">{label}</span>{tail}</span></R.Text>
        </R.SideNavItemLink></R.SideNavItemContent>
      </R.SideNavItem>;
    };
    const groups = IA.taskGroups(app.tasks);
    return <div className="hside hside--utility" style={{width: app.sidebar.width || app.sidebar.last}}>
      <h2 className="app-section-title">{title}</h2>
      <div className="hside__nav bc-scroll">
        <R.SideNav aria-label={`${title}导航`} selectedRoute={IA.hrefFor(selected)}>
          {row('overview', kind === 'tasks' ? '全部任务' : kind === 'tools' ? '全部工具' : '服务总览', root, 'ViewGrid')}
          {kind === 'tools' && window.BC_TOOLS.GROUPS.map(g => <R.SideNavSection key={g.k} id={`group:${g.k}`}>
            <R.SideNavHeader>{g.label}</R.SideNavHeader>
            {g.tools.filter(t => !t.planned).map(t => row(t.id, t.name, {r: 'tools', id: t.id}, t.navIcon))}
          </R.SideNavSection>)}
          {kind === 'services' && <R.SideNavSection id="local"><R.SideNavHeader>本机服务</R.SideNavHeader>
            {SV.SERVICES.map(s => {
              const state = app.svcStates[s.id];
              const tone = SV.dotTone(state);
              const label = SV.stateLabel(s.id, state);
              return row(s.id, s.name, {r: 'services', id: s.id}, {mcp: 'mcp', remote: 'DeviceMultiscreen', web: 'GlobeGrid'}[s.id],
                <span className={`utility-nav__dot utility-nav__dot--${tone}`} aria-hidden="true" />, `${s.name} · ${label}`);
            })}
          </R.SideNavSection>}
          {kind === 'tasks' && groups.filter(g => g.items.length).map(g => <R.SideNavSection key={g.id} id={`group:${g.id}`}>
            <R.SideNavHeader>{g.label} · {g.items.length}</R.SideNavHeader>
            {g.items.map(t => {
              const label = window.BC_TASK_FACTS.taskTitle(t, (window.BC_TASK_KINDS[t.kind] || {}).label || '任务');
              const state = t.canceled ? '已取消' : t.status === 'running' ? '进行中' : t.status === 'queued' ? '排队中' : t.status === 'error' ? '失败' : '已完成';
              return row(t.id, label, {r: 'task', id: t.id}, t.status === 'error' && !t.canceled ? 'AlertTriangle' : g.id === 'active' ? 'Clock' : 'CheckmarkCircle',
                t.status === 'running' ? <span className="utility-nav__progress" aria-hidden="true"><R.ProgressCircle size="S" isIndeterminate aria-label="进行中" /></span> : null,
                `${label} · ${state}${t.pct == null ? '' : ` · ${t.pct}%`}`);
            })}
          </R.SideNavSection>)}
        </R.SideNav>
      </div>
      <p className="utility-nav__note">{kind === 'tasks' ? '任务在后台继续运行，可随时切换页面。' : kind === 'tools' ? '独立使用工具，结果可带回视频或会话。' : '管理本机提供给其他应用和设备的连接。'}</p>
    </div>;
  }

  Object.assign(window, {AppRail, UtilitySidebar});
})();
