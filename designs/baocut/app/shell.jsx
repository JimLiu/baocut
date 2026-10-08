/* BaoCut 原型 — 外壳：标题栏 + 侧边栏 + 内容容器
   §10（标题栏 58 / 侧边栏三档与 ghost）、§17.3（六页）、§8.4（顶栏任务胶囊）。 */
(function () {
  const {useState, useCallback, useRef, useEffect, useLayoutEffect} = React;
  const D = window.BC_DATA;
  const L = window.BC_LAYOUT;
  const T = window.BC_TIME;
  /* 外壳两份原型共用（§22.3）：Web 表面（BaoCutWeb.html）收掉红绿灯 / 前进后退 / 任务 / 帮助 / Agent，
     侧栏换成只有项目列表的 WebSidebar（web-shell.jsx）。能力位在 model-surface.js。 */
  const SURF = window.BC_SURFACE;

  /* ---------- 页面侧栏的展开 / 收起动画 ----------
     切换侧栏时外层宽度从 0 逐步拉开、收起时逐步收回 0；侧栏本身宽度不变（收起后各侧栏按
     sidebar.last 保持原宽），只被外层裁切，内容不会跟着挤压换行。只在开合时用 Web Animations 动一次宽度，拖缝改宽时不带过渡。
     时长与曲线取 --ease；系统要求减少动效时直接开合。收起期间继续渲染最后一次的内容，
     动画结束才卸载。缝（edge）放在裁切层外面紧跟着它：缝左右各 -4px 骑在交界上，放进去会被裁掉一半，
     放在外面就跟着裁切层的右缘一起移动。 */
  function SideSlide({open, edge, children}) {
    const ref = useRef(null);
    const last = useRef(children);
    if (open) last.current = children;
    const [mounted, setMounted] = useState(open);
    if (open && !mounted) setMounted(true);
    const was = useRef(open);
    useLayoutEffect(() => {
      if (was.current === open) return;
      was.current = open;
      const el = ref.current;
      if (!el) return;
      const running = el.getAnimations().length > 0;
      const now = el.getBoundingClientRect().width;
      el.getAnimations().forEach(a => a.cancel());
      const full = el.getBoundingClientRect().width;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        if (!open) setMounted(false);
        return;
      }
      // --ease 经压缩后可能写成「.15s cubic-bezier(.45,0,.4,1)」，秒和毫秒都要认
      const [time, ...curve] = getComputedStyle(el).getPropertyValue('--ease').trim().split(' ');
      const duration = parseFloat(time) * (/ms$/.test(time) ? 1 : 1000) || 0;
      const anim = el.animate([{width: `${open ? (running ? now : 0) : now}px`}, {width: `${open ? full : 0}px`}],
        {duration, easing: curve.join(' ') || 'ease', fill: open ? 'none' : 'forwards'});
      if (!open) anim.onfinish = () => setMounted(false);
    }, [open]);
    return mounted ? <><div ref={ref} className="sideslide">{open ? children : last.current}</div>{edge}</> : null;
  }

  /* ---------- 可拖的缝 ----------
     真拖拽（整条缝都能抓），不是画板时代 CSS resize 的角落把手（§20 #1）。 */
  function Seam({dir, onDrag, onEnd, className}) {
    const [drag, setDrag] = useState(false);
    const start = useRef(0);
    const onDown = (e) => {
      e.preventDefault();
      setDrag(true);
      start.current = dir === 'v' ? e.clientX : e.clientY;
      const move = (ev) => onDrag(dir === 'v' ? ev.clientX : ev.clientY);
      const up = () => {
        setDrag(false);
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
        if (onEnd) onEnd();
      };
      document.body.style.cursor = dir === 'v' ? 'col-resize' : 'row-resize';
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    return (
      <div className={cx('seam', 'seam--' + dir, drag && 'is-drag', className)} onMouseDown={onDown}>
        <div className="seam__bar" />
      </div>
    );
  }

  /* 窗口导航与视频栏分开（product-design §5.1）；Space 快捷聊天提交后转入 Home 会话。 */
  function MovieTitle({editor}) {
    const app = useApp();
    return <div className="moviebar__title">
      <BCAction type="button" className="ttitle" title="视频详情"
        onClick={() => app.openProjectInfo(editor.projectId, editor.infoExtras || [])}>
        <span className="t-truncate">{editor.title}</span><Ic n="info" className="ic--16" />
      </BCAction>
      <div className="tmeta">{editor.meta}</div>
    </div>;
  }

  function MovieActions({editor}) {
    const app = useApp();
    const projectId = editor.projectId;
    const exporting = app.tasks.find(t => t.project === projectId && t.kind === 'export' && t.status === 'running');
    const tasks = window.BC_TASKPILL.pillList(app.tasks, {projectId, mineOnly: true});
    return <>
      <window.TaskPill list={tasks} projectId={projectId} />
      <div className="moviebar__export">
        {exporting
          ? <Btn variant="accent" className="btn--busy" onClick={editor.onExport} title="正在导出 · 点开看进度或取消">
              <span className="btn__sp" />{window.BC_EXPORT.preparationView(exporting).active ? '正在准备导出' : <>导出中 · <span className="t-mono">{exporting.pct || 0}%</span></>}
            </Btn>
          : <Btn variant="accent" icon="export" onClick={editor.onExport}>导出</Btn>}
        {editor.exportOpen ? <window.ExportPopover ctx={editor.ctx} onClose={editor.closeExport} /> : null}
      </div>
    </>;
  }

  function Moviebar({editor}) {
    const app = useApp();
    return <header className="moviebar" aria-label="视频导航">
      <MovieTitle editor={editor} />
      <div className="moviebar__actions">
        <MovieActions editor={editor} />
        <IconBtn icon="close" tip={app.route.via === 'space' ? '关闭视频 · 回到 Space' : '关闭当前视频标签页'} onClick={app.closeMovie} />
      </div>
    </header>;
  }

  /* 悬浮会话（product-design §5.1）：从 Space 打开的视频没有左侧会话栏，会话浮在编辑器右下角。
     默认展开成输入框——收成图标是用户自己点的，记在偏好里；发送后进入 Home 新会话。
     不抢焦点：编辑器的快捷键（空格播放）不能因为输入框默认在场就失效。 */
  function MovieQuickChat({editor}) {
    const app = useApp();
    const min = !!app.prefs.movieChatMin;
    const sid = app.movieChats[editor.projectId] || null;
    const sess = sid ? app.sessionById(sid) : null;
    const trigger = useRef(null);
    const restored = useRef(false);
    const setMin = v => { restored.current = !v; app.setPref('movieChatMin', v); if (v) requestAnimationFrame(() => trigger.current?.focus()); };
    const live = sess && (sess.status === 'running' || sess.status === 'waiting');
    if (min) return <aside className="movie-quickchat" aria-label="视频会话">
      <BCAction ref={trigger} className="movie-quickchat__trigger" aria-label={live ? '展开会话 · Agent 正在处理' : '展开会话'} onClick={() => setMin(false)}>
        <window.RSP.Icons.Comment />
        {live ? <i className={cx('movie-quickchat__dot', sess.status === 'waiting' && 'is-waiting')} /> : null}
      </BCAction>
    </aside>;
    return <aside className="movie-quickchat is-open" aria-label="视频会话">
      <div className="movie-quickchat__head">
        <span className="t-truncate grow">{sess ? sess.title || '新会话' : '新会话'}</span>
        {sess ? <IconBtn icon="plus" size="s" tip="新会话" onClick={() => app.setMovieChat(editor.projectId, null)} /> : null}
        {sess ? <IconBtn icon="sidebar" size="s" tip="在左侧展开会话" onClick={() => app.go(window.BC_APP_IA.movieChatRoute(app.route, sid))} /> : null}
        <IconBtn icon="minus" size="s" tip="最小化" onClick={() => setMin(true)} />
      </div>
      <window.AgentThread key={sid || editor.projectId} sid={sid} project={editor.projectId} compact videoCard autoFocus={restored.current}
        onSent={s => { app.setMovieChat(editor.projectId, null); app.go({r: 'agent', id: s.id}); }} />
    </aside>;
  }

  function Titlebar({editor, onHelp}) {
    const app = useApp();
    const {sidebar, toggleSidebar, canBack, canFwd, back, fwd} = app;
    const pageSide = SURF.appRail ? window.BC_APP_IA.sideOf(app.route) : 'legacy';
    const bar = useRef(null);
    const [dividers, setDividers] = useState([]);
    const [homeBounds, setHomeBounds] = useState(null);
    // Home 的会话与草稿工作区（#/home、#/agent?dir=…、#/agent/<id>）都用工作区标题栏。
    const home = SURF.appRail && !!window.BC_HOME_WORKSPACE && window.BC_HOME_WORKSPACE.keyFor(app.route) != null;
    const bare = home && !app.route.id && !app.route.dir;
    const hasPane = home && app.workspaceVisible;
    /* 单条页签（product-design §2.5 / §3.3）：窄工作区与完整视图里会话是页签条的第一格，标题栏只放页签。
       窄的判定只在 BC_HOME_WORKSPACE.isNarrow（store 量 .home-workspace 的宽度），这里只读结果。 */
    const single = home && !!app.workspaceSingle;
    const tabCount = home ? app.workspace.tabs.length : 0;
    // 分屏可见时摘要跟着会话列，挂在会话头 ··· 之后、列分隔竖线左侧（home-shell-chrome.jsx）
    const headSummary = home && !!window.summaryInHead && window.summaryInHead(app);
    // product-design §2.5 用户修订：标题栏的分界与下方实际栏宽对齐，包括拖宽与窄屏折叠；
    // 页签条与会话头的右端让开右侧视图按钮组（按钮数随页签、会话变化，所以量它的实际左缘）；
    // 没有分屏时会话头的 ··· 与按钮组只隔 4px，读作一组（··· | 摘要 | 完整视图 | 标签页）；
    // 分屏时摘要随会话列，右侧组只剩 完整视图 | 标签页。
    useLayoutEffect(() => {
      if (!SURF.appRail) return;
      const root = bar.current.closest('.app');
      const seams = [...root.querySelectorAll('.seam--side, .seam--dock')];
      const sync = () => {
        const box = bar.current.getBoundingClientRect();
        const origin = box.left;
        const positions = seams.map(el => el.getBoundingClientRect()).filter(r => r.width && r.height)
          .map(r => r.left + r.width / 2 - origin);
        if (home) {
          const content = root.querySelector('.content')?.getBoundingClientRect();
          const conversation = root.querySelector('.home-workspace__conversation')?.getBoundingClientRect();
          const controls = bar.current.querySelector('.home-workspace-controls')?.getBoundingClientRect();
          const navRight = root.querySelector('.tbar__nav')?.getBoundingClientRect().right || 0;
          if (content) {
            const left = Math.max(content.left - origin, navRight - origin + 12);
            const end = Math.min(content.right - origin, (controls && controls.width ? controls.left - origin : box.width) - 4);
            const split = single ? left : hasPane && conversation ? conversation.right - origin : end;
            const next = {left, split, width: Math.max(0, split - left), right: Math.max(8, box.width - end)};
            setHomeBounds(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
          }
        }
        setDividers(old => old.length === positions.length && old.every((x, i) => x === positions[i]) ? old : positions);
      };
      sync();
      const observer = new ResizeObserver(sync);
      [root, ...seams, ...root.querySelectorAll('.hside, .movie-conversation, .home-workspace__conversation, .content, .tbar .home-workspace-controls')].forEach(el => observer.observe(el));
      return () => observer.disconnect();
    }, [pageSide, sidebar.ghost, !!editor, app.route.r, app.route.id, home, hasPane, single, tabCount, headSummary]);
    const sideTip = SURF.isWeb ? (sidebar.ghost ? '显示视频列表' : '隐藏视频列表') : (sidebar.ghost ? '显示侧边栏' : '隐藏侧边栏');
    return <div ref={bar} className={cx('tbar', !SURF.windowChrome && 'tbar--web', home && 'tbar--home')}>
      {dividers.map((x, i) => <span key={i} className="tbar__divider" style={{left: x}} aria-hidden="true" />)}
      {SURF.windowChrome ? <div className="tlights">
        <span className="tlight tlight--r" /><span className="tlight tlight--y" /><span className="tlight tlight--g" />
      </div> : null}
      <div className="tbar__nav">
        {SURF.windowChrome ? <IconBtn icon="back" tip="后退 ⌘[" disabled={!canBack} onClick={back} /> : null}
        {SURF.windowChrome ? <IconBtn icon="fwd" tip="前进 ⌘]" disabled={!canFwd} onClick={fwd} /> : null}
        {/* App：侧栏隐藏时悬停开关浮出当前页侧栏（home-shell-chrome.jsx）；Web 没有这层 */}
        {pageSide && window.ShellButton ? <span className="tbar__side" onPointerEnter={() => app.peekSidebar?.(pageSide)} onPointerLeave={() => app.leaveSidebar?.()}>
          <window.ShellButton name={sidebar.ghost ? 'sidebar-hidden' : 'sidebar'} label={sideTip} onPress={() => { app.closePeek?.(); toggleSidebar(); }} />
        </span> : pageSide ? <IconBtn icon={sidebar.ghost ? 'sidebar-closed' : 'sidebar'} tip={sideTip} onClick={toggleSidebar} /> : null}
      </div>
      {home ? <>
        {/* 空白 #/home 草稿：开了页签后左侧放「新会话」占位头，不留空 */}
        {!single && (!bare || tabCount > 0) && <div className={cx('tbar__conversation', !hasPane && 'is-joined', headSummary && 'has-summary')} style={homeBounds ? {left: homeBounds.left, width: homeBounds.width} : {left: 260, right: 88}}>
          <window.HomeSessionHead sess={app.sessionById(app.route.id)} dir={app.route.dir} />
          {/* 加页签的入口在右侧标签页按钮与页签条的「+」，会话头只留 ···（分屏时再跟一个摘要） */}
          {headSummary ? <window.ShellSummaryButton /> : null}
        </div>}
        {!single && bare && !tabCount ? <div className={cx('tbar__title tbar__title--mid', dividers.length && 'tbar__title--pane')}
          style={dividers.length ? {left: dividers[dividers.length - 1]} : undefined}><div className="ttitle">{SURF.name}</div></div> : null}
        {(hasPane || single) && homeBounds ? <div className="tbar__workspace" style={{left: homeBounds.split, right: homeBounds.right}}><window.WorkspaceTabs /></div> : null}
        <window.WorkspaceViewControls />
      </> : editor && !SURF.appRail ? <MovieTitle editor={editor} />
        : <div className={cx('tbar__title tbar__title--mid', dividers.length && 'tbar__title--pane')}
            style={dividers.length ? {left: dividers[dividers.length - 1]} : undefined}><div className="ttitle">{SURF.name}</div></div>}
      <div className="tbar__acts">
        {SURF.help && sidebar.ghost && !home ? <IconBtn icon="help" tip="帮助中心 · F1" onClick={onHelp} /> : null}
        {editor && !SURF.appRail ? <MovieActions editor={editor} /> : null}
      </div>
    </div>;
  }

  /* ---------- 侧边栏 ----------
     2026-10-01：App 的侧栏换成 rail + 页面侧栏（apprail.jsx / home-sidebar.jsx / page-space.jsx，只在 App 入口加载），
     原来的项目树侧栏（新建项目 · 我的项目 · 后台任务 · 工具 · 服务 · 项目树 · 设置）随之退场；
     Web 的侧栏在 web-shell.jsx。这里只留两份页面侧栏都要用的小件。 */
  /* 项目排序菜单的内容：段头「排序」+ 四档，勾在右侧。侧栏 ⋯ 与「我的项目」页的排序钮共用。 */
  function SortMenuList({sort, onPick}) {
    return (
      <Menu>
        <MenuHead>排序</MenuHead>
        {window.BC_AGENT.TREE_SORTS.map((s) => (
          <MenuItem key={s.key} label={s.label} check={sort === s.key} onClick={() => onPick(s.key)} />
        ))}
      </Menu>
    );
  }

  /* 服务的三颗信号灯，一项服务一颗（MCP / 远端算力 / Web），各亮各的颜色——
     绿 = 在跑、橙 = 出错、灰 = 关着，起停中的那颗呼吸。§17.6（2026-09-17 改成单行；起停在总览页）。
     原来挂在侧栏「服务」行尾；2026-10-02 服务搬上 App rail 后，rail 上只留「有服务出错」的角标（apprail.jsx），
     整排灯放在服务总览的标题旁（page-services.jsx）。 */
  function SvcLights() {
    const app = useApp();
    const L = window.BC_SERVICES.lights(app.svcStates);
    const text = L.map((l) => l.label).join('\n');
    return (
      <span className="svclights" role="img" aria-label={text.replace(/\n/g, '，')} title={text}>
        {L.map((l) => <span key={l.id} className={cx('svclight', 'is-' + l.tone, l.busy && 'is-busy')} />)}
      </span>
    );
  }

  /* ---------- 外壳容器 ---------- */
  function Shell({children, editor, sideForce}) {
    const app = useApp();
    const {sidebar, setSidebarW} = app;
    const [helpOpen, setHelpOpen] = useState(false);
    const helpOrigin = useRef(null);
    const showHelp = (event) => {
      helpOrigin.current = event?.currentTarget || document.activeElement;
      if (editor) { editor.ctx.setPlaying(false); editor.ctx.setPop(null); editor.closeExport(); }
      setHelpOpen(true);
    };
    useEffect(() => {
      const key = e => {
        if (!SURF.help) return;
        if (e.key !== 'F1' || document.querySelector('.scrim, .wz-scrim, dialog[open], [role="dialog"][data-rac], [role="alertdialog"]')) return;
        e.preventDefault(); showHelp();
      };
      window.addEventListener('keydown', key);
      return () => window.removeEventListener('keydown', key);
    }, [editor]);
    /* App rail（2026-10-01）：rail 常驻最左；页面侧栏按路由显示 Home 会话、Space 分类、工具、服务或后台任务目录，
       打开视频仍保留入口侧栏；视频栏与可选会话只属于内容区（本轮调整 §2.2 / §5.1）。 */
    const pageSide = SURF.appRail ? window.BC_APP_IA.sideOf(app.route) : null;
    const side = SURF.appRail ? (!!pageSide && (!sidebar.ghost || !!sideForce)) : (!sidebar.ghost || !!sideForce);
    const PageSide = !SURF.appRail ? null : pageSide === 'space' ? window.SpaceSidebar : pageSide === 'home' ? window.HomeSidebar : window.UtilitySidebar;
    /* 帮助中心的开合只活在外壳里；经 app 上下文给下面的页面一个 openHelp（设置左栏的「帮助」行用它，
       2026-10-01），不逐层传 prop。没有帮助中心的表面（Web）是 null。 */
    /* 侧栏浮出（App 专属，home-shell-chrome.jsx）：rail 与标题栏开关经上下文拿 peekSidebar / leaveSidebar */
    const peekState = window.useShellPeek ? window.useShellPeek(app) : null;
    const withHelp = {...app, ...peekState, openHelp: SURF.help ? showHelp : null};
    const Workspace = SURF.appRail ? 'div' : React.Fragment;
    return (
      <window.AppCtx.Provider value={withHelp}>
      <div className={cx('app', SURF.isWeb && 'app--web')}>
        <Titlebar editor={editor} onHelp={showHelp} />
        <div className="body">
          {/* Web 表面的侧栏只有项目列表（web-shell.jsx）；还没选项目时它是唯一的去处，强制展开（sideForce） */}
          {SURF.appRail ? <window.AppRail /> : null}
          <Workspace {...(SURF.appRail ? {className: 'appsheet'} : {})}>
          {/* 侧栏宽 = 鼠标位置减去侧栏左缘（有 rail 时左缘不在 0） */}
          <SideSlide open={side} edge={<Seam dir="v" className="seam--side" onDrag={(x) => {
            const el = SURF.appRail ? document.querySelector('.hside') : null;
            setSidebarW(el ? x - el.getBoundingClientRect().left : x);
          }} />}>
            {PageSide ? <PageSide kind={pageSide} /> : <window.WebSidebar />}
          </SideSlide>
          <div className={cx("content", SURF.appRail && editor && "content--movie", ['tools', 'services', 'tasks'].includes(pageSide) && "content--utility")}>
            {SURF.appRail && editor ? <>
              <div className="movie-workspace">
                {app.route.r === 'agent' ? <>
                  <div className="movie-conversation" style={{width: app.dockW}}><window.AgentPage id={app.route.id} /></div>
                  <Seam dir="v" className="seam--dock" onDrag={x => {
                    const el = document.querySelector('.movie-conversation');
                    if (el) app.setDockW(x - el.getBoundingClientRect().left);
                  }} />
                </> : null}
                <div className="movie-workspace__editor">
                  <Moviebar editor={editor} />
                  {children}
                  {app.route.via === 'space' ? <MovieQuickChat key={editor.projectId} editor={editor} /> : null}
                </div>
              </div>
            </> : children}
          </div>
          </Workspace>
          {peekState ? <window.ShellPeek state={peekState} /> : null}
        </div>
        <TweaksPanel editor={editor} />
        {SURF.help && helpOpen ? <window.HelpCenter editor={editor} returnFocus={helpOrigin.current} onClose={() => setHelpOpen(false)} /> : null}
      </div>
      </window.AppCtx.Provider>
    );
  }

  /* 各页共用的页面骨架。fluid：不设栏宽上限，给「列数跟着窗宽走」的项目库用。
     bar：页面主动作。给了它页顶就换成一条吸顶导航栏（2026-09-24，仿 iOS 大标题）：
     左边返回（crumb）、右边主动作，不随内容滚走；大标题照旧在正文第一行，卷到栏下面时
     栏正中淡出一行小标题，内容一压到栏底，栏下多一条细线。 */
  function Page({title, actions, children, wide, fluid, crumb, bar}) {
    const width = fluid ? {maxWidth: 'none'} : wide ? {maxWidth: 1240} : null;
    const scrollRef = useRef(null);
    const navRef = useRef(null);
    const hdRef = useRef(null);
    const hasBar = !!bar;
    useEffect(() => {
      const el = scrollRef.current;
      if (!hasBar || !el) return undefined;
      // 直接写 CSS 变量与 class，不走 React 状态：滚一下不重画整页
      const sync = () => {
        const top = el.scrollTop;
        const hd = hdRef.current;
        let t = 1;
        if (hd) {
          const navH = navRef.current ? navRef.current.offsetHeight : 0;
          const start = hd.offsetTop - navH;
          t = Math.min(1, Math.max(0, (top - start) / Math.max(1, hd.offsetHeight)));
        }
        el.style.setProperty('--pagenav-t', String(t));
        el.classList.toggle('is-scrolled', top > 0);
      };
      sync();
      el.addEventListener('scroll', sync, {passive: true});
      return () => el.removeEventListener('scroll', sync);
    }, [hasBar]);
    if (hasBar) {
      return (
        <div className={cx('page page--bar bc-scroll', !crumb && 'page--rootbar')} ref={scrollRef}>
          <div className="pagenav" ref={navRef}>
            <div className="pagenav__in" style={width}>
              {crumb ? <>
                <div className="pagenav__side pagenav__side--start">{crumb}</div>
                <div className="pagenav__title" aria-hidden="true">{title}</div>
              </> : <h1 className="t-heading pagenav__heading">{title}</h1>}
              <div className="pagenav__side pagenav__side--end">{bar}</div>
            </div>
          </div>
          <div className="page__in" style={width}>
            {(crumb && title) || actions ? (
              <div className="page__hd" ref={hdRef}>
                {crumb && title ? <div className="t-heading grow">{title}</div> : null}
                {actions}
              </div>
            ) : null}
            {children}
          </div>
        </div>
      );
    }
    return (
      <div className="page bc-scroll">
        <div className="page__in" style={width}>
          {crumb ? <div className="page__crumb">{crumb}</div> : null}
          {title ? (
            <div className="page__hd">
              <div className="t-heading grow">{title}</div>
              {actions}
            </div>
          ) : null}
          {children}
        </div>
      </div>
    );
  }

  /* ---------- 原型开关（Tweaks） ----------
     **这一块不属于产品 UI。** 入口演示原来是顶栏上的一个下拉，混在信号灯、前进后退、
     进度胶囊、导出中间——看起来就像 BaoCut 真有这么一个功能。凡是「只有原型才有」的
     开关都收进这里，并且用一个明显不同的外观（深色浮起小面板 + 「原型」标）把它和
     产品 chrome 分开：截图给别人看时，一眼能认出哪部分是演示脚手架。

     沿用 `designs/baocut-mac` 的 Tweaks 范式（变体/场景开关走一个面板，而不是
     fork 出一份新 HTML），但不搬那份 omelette 脚手架——它绑的是画布宿主的
     `__activate_edit_mode` 协议，而且整份 `@ds-adherence-ignore`，搬进来等于在
     设计系统闸门上开个洞。这里用本目录自己的组件层重画，闸门照常管得住。 */
  function TweaksPanel({editor}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const job = editor && editor.ctx ? editor.ctx.liveJob : null;
    const tjob = editor && editor.ctx ? editor.ctx.transJob : null;
    return (
      <>
        <BCAction className={cx('tweakb', open && 'is-on')} onClick={() => setOpen((v) => !v)}
          title="原型开关（不属于产品 UI）">
          <Ic n="speed" className="ic--14" />
          <span>原型</span>
        </BCAction>
        {open ? (
          <BCModal title="原型开关" size="S" onClose={() => setOpen(false)}><div className="tweaks bc-tweaks">
            <div className="tweaks__hd">
              <b className="grow">原型开关</b>
              <BCAction className="tweaks__x" onClick={() => setOpen(false)} aria-label="关闭">
                <Ic n="close" className="ic--14" />
              </BCAction>
            </div>
            <div className="tweaks__note">这些开关只在原型里存在，产品里没有对应入口。</div>
            <div className="tweaks__sec">
              <div className="tweaks__lb">核心覆盖记号<em>动画目录里标出哪几条内核今天已经认得</em></div>
              <div className="tweaks__rad">
                {[[false, '关'], [true, '开']].map(([v, l]) => (
                  <BCAction key={String(v)} className={cx('tweaks__opt', !!app.coreMarks === v && 'is-on')}
                    onClick={() => app.setCoreMarks(v)}>{l}</BCAction>
                ))}
              </div>
            </div>
            {SURF.pages ? (
              <div className="tweaks__sec">
                <div className="tweaks__lb">模型目录环境变量<em>设置 › 本地模型 › 模型目录；设了以后入口只读（architecture-design §6.3）</em></div>
                <div className="tweaks__rad">
                  {[[null, '未设置'], ['/Volumes/ExtremeSSD/BaoCut/models', 'BAOCUT_MODELS_DIR']].map(([v, l]) => (
                    <BCAction key={l} className={cx('tweaks__opt', (app.prefs.modelsDirEnv || null) === v && 'is-on')}
                      onClick={() => app.setPref('modelsDirEnv', v)}>{l}</BCAction>
                  ))}
                </div>
              </div>
            ) : null}
            {SURF.pages && window.BC_LOCALCHECK ? (
              <div className="tweaks__sec">
                <div className="tweaks__lb">本地模型检查<em>设置 › 本地模型；下次「检查」和下次「生成试听」的结果（修复后那次检查总是通过）</em></div>
                <div className="tweaks__rad">
                  {window.BC_LOCALCHECK.CHECK_DEMOS.map(({k, label}) => (
                    <BCAction key={k} className={cx('tweaks__opt', (app.prefs.modelCheckDemo || 'pass') === k && 'is-on')}
                      onClick={() => app.setPref('modelCheckDemo', k)}>检查 · {label}</BCAction>
                  ))}
                </div>
                <div className="tweaks__rad">
                  {window.BC_LOCALCHECK.TRY_DEMOS.map(({k, label}) => (
                    <BCAction key={k} className={cx('tweaks__opt', (app.prefs.modelTryDemo || 'ok') === k && 'is-on')}
                      onClick={() => app.setPref('modelTryDemo', k)}>试听 · {label}</BCAction>
                  ))}
                </div>
              </div>
            ) : null}
            {editor && editor.ctx && editor.ctx.setElDoc ? (
              <div className="tweaks__sec">
                <div className="tweaks__lb">素材导入态<em>时间轴上的图片 / 视频块在素材就绪前长什么样</em></div>
                <div className="tweaks__rad">
                  {[['ready', '已就绪'], ['import', '导入中 40%'], ['transcode', '转码中 20%']].map(([k, l]) => (
                    <BCAction key={k} className={cx('tweaks__opt', (app.mediaStage || 'ready') === k && 'is-on')}
                      onClick={() => {
                        app.setMediaStage(k);
                        const m = k === 'import' ? {imported: false, pct: 0.4}
                          : k === 'transcode' ? {imported: true, needTranscode: true, pct: 1, transcodePct: 0.2}
                          : null;
                        ['e-img', 'e-vid'].forEach((id) => editor.ctx.setElDoc(id, {media: m}));
                      }}>{l}</BCAction>
                  ))}
                </div>
              </div>
            ) : null}
            {editor ? (
              <div className="tweaks__sec">
                <div className="tweaks__lb">主媒体<em>源文件丢了 / 放不出时舞台正中那张卡；字幕照常走（§11.3）</em></div>
                <div className="tweaks__rad">
                  {[['auto', '跟视频'], ['ok', '正常'], ['missing', '找不到'], ['unplayable', '放不出']].map(([k, l]) => (
                    <BCAction key={k} className={cx('tweaks__opt', app.stageMediaDemo === k && 'is-on')}
                      onClick={() => app.setStageMediaDemo(k)}>{l}</BCAction>
                  ))}
                </div>
              </div>
            ) : null}
            {editor ? (
              <div className="tweaks__sec">
                <div className="tweaks__lb">预览载入<em>载入中满 10 秒还没出画面就说卡在哪一步，给「重试」；转换中进度在走就不算卡住，满 10 秒没动才算（§5.1）</em></div>
                <div className="tweaks__rad">
                  {window.BC_STAGE_LOAD.DEMOS.map(([k, l]) => (
                    <BCAction key={k} className={cx('tweaks__opt', app.stageLoadDemo.mode === k && 'is-on')}
                      onClick={() => app.setStageLoadDemo(window.BC_STAGE_LOAD.demo(k, Date.now()))}>{l}</BCAction>
                  ))}
                </div>
              </div>
            ) : null}
            {editor ? (() => {
              /* 播放优化（§11.2）：BCF 预览代理在后台烧 MP4 时舞台左下角那枚只读胶囊。
                 切到「生成中」只记下时刻，胶囊由舞台自己按「满 1 秒才露面」去等；
                 拖条改的是已生成帧数，百分比按 帧 / 总帧 向下取整、封顶 99。 */
              const px = app.proxyDemo;
              const PX = window.BC_PROXY;
              return (
                <div className="tweaks__sec">
                  <div className="tweaks__lb">播放优化<em>BCF 预览代理；切到生成中满 1 秒后舞台左下角出胶囊</em></div>
                  <div className="tweaks__rad">
                    {[['ready', '已就绪'], ['generating', '生成中'], ['failed', '生成失败']].map(([k, l]) => (
                      <BCAction key={k} className={cx('tweaks__opt', px.status === k && 'is-on')}
                        onClick={() => app.patchProxyDemo(k === 'generating'
                          ? {status: k, since: PX.since(px, Date.now())} : {status: k})}>{l}</BCAction>
                    ))}
                  </div>
                  {px.status === 'generating' ? (
                    <>
                      <BCSliderInput className="tweaks__rng" type="range" min="0" max={px.total} value={px.done}
                        onChange={(ev) => app.patchProxyDemo({done: +ev.target.value})} />
                      <div className="tweaks__val t-mono">{px.done} / {px.total} 帧 · {PX.pct(px.done, px.total)}%</div>
                    </>
                  ) : null}
                  <div className="tweaks__rad">
                    {[[false, '无上一版提示'], [true, '叠上一版提示']].map(([v, l]) => (
                      <BCAction key={String(v)} className={cx('tweaks__opt', (px.stale != null) === v && 'is-on')}
                        onClick={() => app.patchProxyDemo({stale: v ? '第 12 行缺少右括号' : null})}>{l}</BCAction>
                    ))}
                  </div>
                </div>
              );
            })() : null}
            {editor && editor.setEntry ? (
              <div className="tweaks__sec">
                <div className="tweaks__lb">入口演示<em>真实产品由向导路由决定（§9）</em></div>
                <div className="tweaks__rad">
                  {D.entries.map((e) => (
                    <BCAction key={e.k} className={cx('tweaks__opt', e.k === editor.entry && 'is-on')}
                      onClick={() => editor.setEntry(e.k)}>{e.name}</BCAction>
                  ))}
                </div>
              </div>
            ) : null}
            {job && job.status === 'running' ? (
              <div className="tweaks__sec">
                <div className="tweaks__lb">转录进度<em>拖着看 0% 解码态与收尾态</em></div>
                <BCSliderInput className="tweaks__rng" type="range" min="0" max="100" value={job.pct}
                  onChange={(ev) => app.patchTask(job.id, {pct: +ev.target.value})} />
                <div className="tweaks__val t-mono">{job.pct}%</div>
              </div>
            ) : null}
            {/* 智能体自己翻译没有百分比，没有可拖的进度 */}
            {tjob && !window.BC_TRUN.selfRun(tjob) ? (
              <div className="tweaks__sec">
                <div className="tweaks__lb">翻译进度<em>四段各不一样，拖着逐段看</em></div>
                <BCSliderInput className="tweaks__rng" type="range" min="0" max="100" value={tjob.pct}
                  onChange={(ev) => app.patchTask(tjob.id, {pct: +ev.target.value})} />
                <div className="tweaks__val t-mono">
                  {tjob.pct}% · {window.BC_TRUN.TRANS_STAGES[window.BC_TRUN.stage(tjob.pct, tjob.status === 'queued')]}
                </div>
                <div className="tweaks__rad">
                  {[['app', 'App 发起'], ['cli', '命令行发起'], ['agent', 'Agent 发起']].map(([k, l]) => (
                    <BCAction key={k} className={cx('tweaks__opt', (tjob.source || 'app') === k && 'is-on')}
                      onClick={() => app.patchTask(tjob.id, {source: k})}>{l}</BCAction>
                  ))}
                </div>
                <div className="tweaks__rad">
                  {[['running', '运行中'], ['queued', '排队中']].map(([k, l]) => (
                    <BCAction key={k} className={cx('tweaks__opt', tjob.status === k && 'is-on')}
                      onClick={() => app.patchTask(tjob.id, {status: k})}>{l}</BCAction>
                  ))}
                </div>
              </div>
            ) : null}
            {editor ? null : (
              <div className="tweaks__note">进编辑器后这里会多出播放优化、入口演示与转录进度等几组开关。</div>
            )}
          </div></BCModal>
        ) : null}
      </>
    );
  }

  Object.assign(window, {Shell, Page, Seam, Titlebar, Moviebar, TweaksPanel, SortMenuList, SvcLights});
})();
