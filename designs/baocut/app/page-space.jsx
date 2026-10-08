/* Space（2026-10-01，product-design §4）—— 只在 App 入口加载，控件用 react-spectrum S2。
   取代原「我的项目」页：路由仍是 {r:'projects'}（sec = 分类，id = 项目筛选，from = 只看某部视频切出的短视频）。

   Space 是派生的视图，不是第二份存储（§4.1）：条目是所有项目里的视频、素材与产物的投影
   （BC_SPACE.items，apprail-store.jsx 的 spaceItems）。收藏 / 回收站是盖在投影上的整理标记。
   左边是分类侧栏，主区是 工具条（搜索 · 项目 · 状态 · 排序 · 网格 / 列表 · 新建）+ 列表区。
   视频点开保留分类侧栏，右下角快捷聊天提交后转入 Home；编辑器与 Home 共用（openMovie via 'space'）；
   其它条目点开是轻量的查看框（space-viewer.jsx）。 */
(function () {
  const {useState, useMemo, useEffect} = React;
  const SP = window.BC_SPACE;
  const IA = window.BC_APP_IA;

  const catOf = (route) => (route.sec && SP.isCat(route.sec) ? route.sec : 'all');
  const hrefCat = (route, k) => IA.hrefFor({r: 'projects', sec: k === 'all' ? undefined : k, id: route.id});

  /* ---------- 分类侧栏 ---------- */
  function SpaceSidebar() {
    const app = useApp();
    const R = window.RSP;
    const {sidebar} = app;
    const route = IA.sidebarRoute(app.route, app.nav);
    const n = useMemo(() => SP.counts(app.spaceItems), [app.spaceItems]);
    const cat = catOf(route);
    const item = (c) => {
      const Icon = R.Icons[c.icon];
      const href = hrefCat(route, c.k);
      return (
        <R.SideNavItem key={c.k} id={c.k} textValue={c.label} href={href}>
          <R.SideNavItemContent>
            <R.SideNavItemLink href={href}>
              <Icon />
              <R.Text><span className="hs-row"><span className="hs-row__t">{c.label}</span><span className="hs-ago">{n[c.k]}</span></span></R.Text>
            </R.SideNavItemLink>
          </R.SideNavItemContent>
        </R.SideNavItem>
      );
    };
    return (
      <div className="hside hside--space" style={{width: sidebar.width || sidebar.last}}>
        <h2 className="app-section-title">Space</h2>
        <div className="hside__nav bc-scroll">
          <R.SideNav aria-label="Space 分类" selectedRoute={hrefCat(route, cat)}>
            <R.SideNavSection id="kinds">
              <R.SideNavHeader>分类</R.SideNavHeader>
              {SP.CATS.map(item)}
            </R.SideNavSection>
            <R.SideNavSection id="mine">
              <R.SideNavHeader>整理</R.SideNavHeader>
              {SP.SPECIAL.map(item)}
            </R.SideNavSection>
          </R.SideNav>
        </div>
        <div className="hside__note">Space 是所有项目里视频、素材与产物的视图；文件仍在各自的项目目录里。</div>
      </div>
    );
  }

  /* ---------- 新建（§4.8）：复用新建页与导入流程 ---------- */
  function NewMenu({dir, onImport}) {
    const app = useApp();
    const R = window.RSP;
    const onAction = (k) => {
      if (k === 'blank') app.newProject({entry: 'blank', dir});
      else if (k === 'file') app.newProject({entry: 'media', dir});
      else if (k === 'import') onImport();
    };
    return (
      <R.MenuTrigger>
        <R.Button variant="accent" size="M"><R.Icons.Add /><R.Text>新建</R.Text></R.Button>
        <R.Menu aria-label="新建" onAction={onAction}>
          <R.MenuItem id="blank" textValue="新建空视频"><R.Icons.Filmstrip /><R.Text>新建空视频</R.Text><R.Text slot="description">不转录、不排队，立即可用</R.Text></R.MenuItem>
          <R.MenuItem id="file" textValue="从文件新建视频"><R.Icons.Video /><R.Text>从文件新建视频…</R.Text><R.Text slot="description">视频或音频，转录后进编辑器</R.Text></R.MenuItem>
          <R.MenuItem id="import" textValue="导入素材"><R.Icons.Import /><R.Text>导入素材…</R.Text><R.Text slot="description">图片、音频、字幕、文档，拷进项目的素材目录</R.Text></R.MenuItem>
        </R.Menu>
      </R.MenuTrigger>
    );
  }

  /* ---------- 页面 ---------- */
  function SpacePage() {
    const app = useApp();
    const R = window.RSP;
    const {route} = app;
    const cat = catOf(route);
    const [q, setQ] = useState('');
    const [status, setStatus] = useState('any');
    const [viewing, setViewing] = useState(null);   // 查看框里的条目 id
    const [importing, setImporting] = useState(false);
    /* 任务详情「在 Space 中查看」带过来的条目（apprail-store 的 openSpaceEntry）：到了就打开它的查看框 */
    useEffect(() => { if (app.spaceFocus) { const id = app.takeSpaceFocus(); if (id) setViewing(id); } }, [app.spaceFocus]);
    const sort = SP.SORTS.some((s) => s.k === app.prefs.spaceSort) ? app.prefs.spaceSort : 'recent';
    const mode = app.prefs.spaceView === 'list' ? 'list' : 'grid';
    const dirsById = useMemo(() => { const m = {}; app.dirs.forEach((d) => { m[d.id] = d; }); return m; }, [app.dirs]);
    const movies = useMemo(() => { const m = {}; app.projects.forEach((p) => { m[p.id] = p; }); return m; }, [app.projects]);
    const from = route.from ? movies[route.from] || null : null;
    const dir = route.id && (route.id === 'none' || dirsById[route.id]) ? route.id : null;
    const rows = useMemo(() => SP.view(app.spaceItems, {cat, q, sort, dir, status: status === 'any' ? null : status, from: from ? from.id : null}),
      [app.spaceItems, cat, q, sort, dir, status, from]);
    const dirOpts = useMemo(() => SP.dirOptions(app.spaceItems, app.dirs), [app.spaceItems, app.dirs]);
    const setDir = (k) => app.replace({r: 'projects', sec: route.sec, id: k === 'any' ? undefined : k, from: route.from});
    const catLabel = (SP.CATS.concat(SP.SPECIAL).find((c) => c.k === cat) || {}).label;

    const onAct = (k, it) => {
      if (k === 'open') app.openMovie(it.id, {via: 'space'});
      else if (k === 'view') setViewing(it.id);
      else if (k === 'fav') app.toggleFav(it);
      else if (k === 'trash') { app.setTrashed(it, true); app.toast(`已移入回收站 · ${it.name}`, null, {label: '撤销', run: () => app.setTrashed(it, false)}); }
      else if (k === 'restore') { app.setTrashed(it, false); app.toast(`已恢复 · ${it.name}`, 'positive'); }
      else if (k === 'reveal') app.toast('已在文件夹中显示（演示）');
      else if (k === 'transcribe' && window.BC_SURFACE.ai) {
        /* product-design §4.4：转录… / 重新转录… / 重试转录… 都打开转录工具页并预选这部视频（§2.7、§5.11），不进编辑器的面板。
           重试带上失败那次的任务：模型、语言、识别说话人预填，页面顶部说明上次为什么失败 */
        const failed = it.transcribe === 'retry'
          ? app.tasks.find((x) => x.project === it.id && (x.kind === 'transcribe' || x.kind === 'retranscribe') && x.status === 'error') : null;
        if (!failed) app.go({r: 'tools', id: 'transcribe', movie: it.id});
        else {
          const m = app.projById(it.id) || {};
          const p = failed.params || {};
          const TT = window.BC_TOOL_TARGETS;
          app.openToolWith('transcribe', {entry: it, retryOf: failed, params: {source: 'space',
            model: p.model || failed.model || m.model || 'moss-transcribe', lang: p.lang || TT.langCode(failed.lang || m.lang) || 'auto',
            speakers: p.speakers != null ? p.speakers : null}});
        }
      } else if (k === 'task' && window.BC_SURFACE.pages) {
        /* 生成中的条目：产物记着任务；视频找指向它的转录任务（在跑或排队的那条） */
        const live = app.tasks.filter((x) => x.project === it.id && (x.status === 'running' || x.status === 'queued'));
        const t = it.task ? {id: it.task} : live.find((x) => x.kind === 'transcribe' || x.kind === 'retranscribe') || live[0];
        app.go(t ? {r: 'task', id: t.id} : {r: 'tasks'});
      }
    };
    const filtered = !!(q.trim() || dir || status !== 'any' || from);
    const empty = () => (
      <R.IllustratedMessage size="S">
        <R.Heading>{filtered ? '没有符合条件的条目' : cat === 'trash' ? '回收站是空的' : cat === 'fav' ? '还没有收藏' : `还没有${catLabel}`}</R.Heading>
        <R.Content>{filtered ? '换个关键词，或清除筛选。' : cat === 'trash' ? '移入回收站的条目会在这里，可以恢复。' : '在会话里让 Agent 做，或从右上角「新建」开始。'}</R.Content>
      </R.IllustratedMessage>
    );

    return (
      <div className="space">
        <header className="space__bar">
          <h1 className="space__title">{catLabel}<span className="space__n">{rows.length}</span></h1>
          <div className="space__actions">
            <div className="space__search">
              <R.SearchField aria-label="搜索 Space" placeholder="搜索名称或文件" size="M" value={q} onChange={setQ} />
            </div>
            <NewMenu dir={dir && dir !== 'none' ? dir : null} onImport={() => setImporting(true)} />
          </div>
        </header>
        <div className="space__tools">
          <div className="space__filters">
            <R.Picker aria-label="项目" size="M" UNSAFE_className="space__pick" menuWidth={240}
              selectedKey={dir || 'any'} onSelectionChange={(k) => setDir(String(k))}>
              <R.PickerItem id="any" textValue="全部项目">全部项目</R.PickerItem>
              {dirOpts.map((o) => <R.PickerItem key={o.k} id={o.k} textValue={o.label}>{o.label}</R.PickerItem>)}
            </R.Picker>
            <R.Picker aria-label="状态" size="M" UNSAFE_className="space__pick" menuWidth={180}
              selectedKey={status} onSelectionChange={(k) => setStatus(String(k))}>
              <R.PickerItem id="any" textValue="全部状态">全部状态</R.PickerItem>
              {Object.values(SP.STATUS).map((s) => <R.PickerItem key={s.k} id={s.k} textValue={s.label}>{s.label}</R.PickerItem>)}
              <R.PickerItem id="none" textValue="无状态">无状态</R.PickerItem>
            </R.Picker>
            <R.Picker aria-label="排序" size="M" UNSAFE_className="space__pick" menuWidth={180}
              selectedKey={sort} onSelectionChange={(k) => app.setPref('spaceSort', String(k))}>
              {SP.SORTS.map((s) => <R.PickerItem key={s.k} id={s.k} textValue={s.label}>{s.label}</R.PickerItem>)}
            </R.Picker>
          </div>
          <R.SegmentedControl aria-label="视图" selectedKey={mode} onSelectionChange={(k) => app.setPref('spaceView', String(k))}>
            <R.SegmentedControlItem id="grid" aria-label="网格"><R.Icons.ViewGrid /></R.SegmentedControlItem>
            <R.SegmentedControlItem id="list" aria-label="列表"><R.Icons.ViewList /></R.SegmentedControlItem>
          </R.SegmentedControl>
        </div>
        {from ? (
          <div className="space__filter" role="status">
            <span className="space__filter-t">只看「{from.title}」切出的短视频</span>
            <R.ActionButton size="S" isQuiet onPress={() => app.openMovie(from.id, {via: 'space'})}>打开来源视频</R.ActionButton>
            <R.ActionButton size="S" isQuiet onPress={() => app.replace({r: 'projects', sec: route.sec, id: route.id})}>清除筛选</R.ActionButton>
          </div>
        ) : null}
        <div className="space__list">
          {mode === 'list'
            ? <window.SpaceTable rows={rows} movies={movies} dirs={dirsById} onAct={onAct} empty={empty} />
            : <window.SpaceGrid rows={rows} movies={movies} onAct={onAct} empty={empty} />}
        </div>
        <window.SpaceViewer id={viewing} onClose={() => setViewing(null)} onSwitch={setViewing} movies={movies} dirs={dirsById} />
        <window.SpaceImport open={importing} dir={dir && dir !== 'none' ? dir : null} onClose={() => setImporting(false)} />
      </div>
    );
  }

  Object.assign(window, {SpacePage, SpaceSidebar});
})();
