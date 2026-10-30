/* BaoCut 原型 — App 的信息架构：rail、页面侧栏、链接（2026-10-01，product-design §2）
   window.BC_APP_IA。纯函数，无 React、无 DOM；只在 App 入口加载（Web 没有 rail）。

   rail 按用户参考重排：Home / Space / Skills / 工具 → 分隔线 → 服务 / 后台任务；设置固定在底部。
   每条路由归到一格（亮哪一格），并决定页面侧栏放哪一张（Home 的会话树 / Space 的分类，或者没有）。
   打开的视频（{r:'editor', via}）保留入口侧栏，编辑器有自己的视频栏；Space 使用浮动快捷聊天；提交后成为 Home 会话，并在右侧显示同一个编辑器。 */
(function () {
  const TABS = [
    {k: 'home',  label: 'Home',  icon: 'Home',       root: {r: 'home'}},
    {k: 'space', label: 'Space', icon: 'Asset', root: {r: 'projects'}},
    /* 2026-10-16：Skills 从设置搬出来，排在 Space 下面——skill 和素材一样是用户自己攒的东西，常用、常改 */
    {k: 'skills', label: 'Skills', icon: 'Lightbulb', root: {r: 'skills'}},
    {k: 'tools', label: '工具', icon: 'Tools', root: {r: 'tools'}},
  ];
  const SECONDARY = [
    {k: 'services', label: '服务',     icon: 'GlobeGrid',       root: {r: 'services'}},
    {k: 'tasks', label: '后台任务', icon: 'Clock', root: {r: 'tasks'}},
  ];
  const END = [
    {k: 'settings', label: '设置',     icon: 'Settings',        root: {r: 'settings'}},
  ];
  const SECTIONS = [{k: 'primary', items: TABS}, {k: 'secondary', items: SECONDARY}, {k: 'end', items: END}];
  const ALL = TABS.concat(SECONDARY, END);

  /** 路由属于哪一格。旧的「会话列表」与「我的项目」都已并入 Space；
      远端算力的旧链接（{r:'remote'}、{r:'tools', id:'remote'}）落在服务页（BC_SERVICES.resolve），所以亮「服务」。 */
  function tabOf(route) {
    const r = route && route.r;
    if (r === 'editor') return route.via === 'space' ? 'space' : 'home';
    if (r === 'projects' || r === 'sessions') return 'space';
    if (r === 'services' || r === 'remote' || (r === 'tools' && route.id === 'remote')) return 'services';
    if (r === 'models') return 'settings';
    if (r === 'tools') return 'tools';
    if (r === 'tasks' || r === 'task' || r === 'schedule') return 'tasks';   // 定时任务的详情页挂在后台任务下
    if (r === 'skills' || r === 'skill' || (r === 'settings' && (route.sec === 'skills' || route.sec === 'integrations'))) return 'skills';
    if (r === 'settings') return 'settings';
    return 'home';   // home / agent / 未知
  }

  /** 每个主入口有自己的侧栏；视频继承入口，设置内置导航。 */
  function sideOf(route) {
    const r = route && route.r;
    if (r === 'home' || r === 'agent' || r === 'archived') return 'home';   // 已归档会话页挂在 Home 下（§3.1）
    if (r === 'projects' || r === 'sessions') return 'space';
    if (r === 'editor') return tabOf(route);
    if (r === 'settings' || r === 'models' || r === 'skill' || r === 'skills') return null;   // Skills 页单栏，没有页面侧栏
    const tab = tabOf(route);
    return ['tools', 'services', 'tasks'].includes(tab) ? tab : null;
  }

  /** 视频打开时，侧栏沿用入口的筛选与选中项；视频 id 不作为 Space 的项目筛选。 */
  function sidebarRoute(route, nav) {
    if (!route || route.r !== 'editor') return route;
    const tab = tabOf(route);
    return lastOf(nav, tab) || (tab === 'space' ? {r: 'projects'} : {r: 'home'});
  }

  /** 任务侧栏与总览共享分组和顺序，任务状态改变后自动移动到对应段。 */
  function taskGroups(tasks) {
    const sorted = [...(tasks || [])].sort((a, b) => (b.seq || 0) - (a.seq || 0));
    return [
      {id: 'active', label: '进行中', items: sorted.filter(t => t.status === 'running' || t.status === 'queued')},
      {id: 'history', label: '历史', items: sorted.filter(t => t.status === 'done' || t.status === 'error')},
    ];
  }

  /** 「已完成」一节默认列几条、列多久以内结束的，「显示更早的」每次多列几条（product-design §6.1）。 */
  const HISTORY_LIMIT = 20;
  const HISTORY_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
  const HISTORY_PAGE = 50;

  /** 要用户决定的：跑完但留了要处理的事（`attention`），不受上限、30 天与清空的限制。 */
  function needsDecision(t) {
    return t.status === 'done' && !t.canceled && !!t.attention;
  }

  /**
   * 历史里这次列哪些（product-design §6.1）：清空过的（`cleared` 是 id 的集合）与结束超过 30 天的不列，
   * 其余取最近 20 条；要用户决定的总是列出。展开时按同样的顺序再多列 `more` 条没列的（每次 50 条，上千条也只画点开的）。
   * `older` 是还没列的条数，`expanded` 是展开多列的条数；`clearIds` 是清空时要记下的 id。
   * 演示记录多数没有 `endedAt`，当作刚结束。
   */
  function historyView(items, {cleared = [], more = 0, now = Date.now()} = {}) {
    const gone = new Set(cleared);
    let kept = 0;
    const recent = new Set(items.filter((t) => {
      if (needsDecision(t)) return true;
      if (gone.has(t.id) || (t.endedAt && now - t.endedAt > HISTORY_MAX_AGE_MS)) return false;
      return kept++ < HISTORY_LIMIT;
    }));
    let extra = Math.max(0, more);
    const shown = items.filter((t) => recent.has(t) || extra-- > 0);
    /* 清空的是此刻已经结束的全部（不只列出的 20 条，免得更早的顶上来）；`clearable` 是默认列出的里能清的，给按钮与计数。 */
    return {items: shown, older: items.length - shown.length, expanded: shown.length - recent.size,
      clearable: [...recent].filter((t) => !needsDecision(t)).map((t) => t.id),
      clearIds: items.filter((t) => !needsDecision(t) && !gone.has(t.id)).map((t) => t.id)};
  }


  /**
   * 点 rail 上某一格去哪：已经在这一格里 → 回这一格的根；否则回到这一格上次停留的地方
   * （历史栈里当前位置往前、最后一条属于它的路由；打开的视频不算，回 Tab 是回列表）。
   * 「两个入口各自记住上次的位置」（§2.4）。
   */
  function railTarget(nav, tab) {
    const def = ALL.find((t) => t.k === tab);
    if (!def) return null;
    const stack = (nav && nav.stack) || [];
    const pos = nav && typeof nav.pos === 'number' ? nav.pos : stack.length - 1;
    const cur = stack[pos];
    if (cur && tabOf(cur) === tab) return def.root;
    return lastOf(nav, tab) || def.root;
  }

  /** 历史栈里当前位置之前、最后一条属于这个 Tab 的列表路由（打开的视频不算）；没有就是 null。 */
  function lastOf(nav, tab) {
    const stack = (nav && nav.stack) || [];
    const pos = nav && typeof nav.pos === 'number' ? nav.pos : stack.length - 1;
    for (let i = pos - 1; i >= 0; i--) {
      const r = stack[i];
      if (r && r.r !== 'editor' && tabOf(r) === tab) return r;
    }
    return null;
  }

  /**
   * 「关闭视频」回哪儿（§3.3：功能区可以关闭，回到只有会话的状态）：
   * 从 Home 打开的 → 左侧那条会话独占主区（没有会话就回 Home 起始页）；
   * 从 Space 打开的 → 回到 Space 上次停留的列表。
   */
  function closeMovieTarget(route, dock, nav) {
    if (route && route.r === 'agent') return {r: 'agent', id: route.id};
    if (route && route.via === 'space') return lastOf(nav, 'space') || {r: 'projects'};
    if (dock && dock.sid) return {r: 'agent', id: dock.sid};
    return {r: 'home'};
  }

  /** Space 快捷聊天提交后成为 Home 会话，保留当前视频和编辑 Tab。 */
  function movieChatRoute(route, sid) {
    if (!route || route.r !== 'editor' || !sid) return null;
    return {r: 'agent', id: sid, movie: route.id, ...(route.tab ? {tab: route.tab} : {})};
  }

  /** 打开一条会话时落在哪（store 的 land）。`fits`：会话写的就是正开着的视频。
      'chat'：只记成这部视频的悬浮会话、不改路由——从 Space 打开的视频（悬浮会话在场），
      或调用方要留在原地（`stay`：找可剪的口、刷新过期译文在工具页画进度卡，§5.10）；
      'movie'：转成 Home 会话、右侧保留视频，会话到眼前；'agent'：去 Home 看这条会话。 */
  function landTarget(route, fits, stay) {
    if (!fits) return 'agent';
    if (stay || (route && route.r === 'editor' && route.via === 'space')) return 'chat';
    return 'movie';
  }

  /* ---------- 侧栏链接 ----------
     S2 的 SideNav 用 href 表示「这一行去哪」，点击交给根 Provider 的 router.navigate。
     链接只在 App 内部流转（`#/…`），这里是两个方向的换算。 */
  const hrefFor = route => window.BC_NAV.hrefFor(route);
  const routeFromHref = href => window.BC_NAV.routeFromHref(href);

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.BC_APP_IA = {TABS, SECONDARY, END, SECTIONS, taskGroups, historyView, HISTORY_LIMIT, HISTORY_PAGE, tabOf, sideOf, sidebarRoute, movieChatRoute, landTarget, railTarget, lastOf, closeMovieTarget, hrefFor, routeFromHref};
})();
