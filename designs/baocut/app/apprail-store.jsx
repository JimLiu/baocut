/* App rail 的跨屏状态（2026-10-01，product-design §2–§4）—— 只在 App 入口加载。
   main.jsx 把它盖在共享 store 上：`{...useStore(), ...useAppIA(store)}`。放这里而不进 store.jsx，
   是因为项目（目录）、Space 的整理标记、视频的打开 / 关闭只有 App 有，Web 一行都用不上。

   - 项目（目录）：data.js `agentProjects` 起步；置顶是用户的整理。
   - 打开视频（openMovie）：Home 与 Space 是同一个动作——Space 编辑器路由带 `via`，Home 会话路由带 `movie`，保留入口侧栏；Space 用右下角的悬浮会话（shell.jsx，状态在共享 store 的 movieChats），Home 保留左侧会话（§5.1）。
   - Space 的整理标记（收藏 / 回收站）与二次编辑另存出来的新版本：投影之外的那一层，投影本身在 model-space.js。 */
(function () {
  const {useState, useCallback, useMemo} = React;
  const D = window.BC_DATA;
  const AP = window.BC_AGENT_PROJECTS;
  const IA = window.BC_APP_IA;
  const SP = window.BC_SPACE;

  function useAppIA(base) {
    const {route, nav, go, projects, sessions, sessionById, patchSession, dock, setDock, archiveProject, tasks, projPct} = base;

    /* ---- 项目（目录） ---- */
    const [dirs, setDirs] = useState(() => (D.agentProjects || []).map((d) => ({...d})));
    const dirById = useCallback((id) => dirs.find((d) => d.id === id) || null, [dirs]);
    const toggleDirPin = useCallback((id) => setDirs((ds) => ds.map((d) => (d.id === id ? {...d, pinned: !d.pinned} : d))), []);
    const toggleSessionPin = useCallback((sid) => patchSession(sid, (s) => ({pinned: !s.pinned})), [patchSession]);
    const dirOfSession = useCallback((s) => AP.dirOf(s, projects), [projects]);
    const moviesOf = useCallback((dirId) => projects.filter((p) => p.dir === dirId && !p.archived), [projects]);
    /* Home 侧栏「项目」段头的菜单（§3.1）：新建一个空项目 / 接进一个已有目录（原型固定接演示目录）。
       都排到最前，返回那个目录；已经接过的同一路径不再加，返回 {dir, added: false}。 */
    const dirSeq = React.useRef(0);
    const nextDirId = () => 'dn' + (++dirSeq.current) + '-' + Date.now().toString(36);
    const createDir = useCallback((name, parent) => {
      const nd = AP.newDir(dirs, nextDirId(), name, parent);
      setDirs((ds) => [nd].concat(ds));
      return nd;
    }, [dirs]);
    const openDir = useCallback((pick) => {
      const r = AP.openDir(dirs, nextDirId(), pick || AP.DEMO_OPEN_DIR);
      if (r && r.added) setDirs((ds) => [r.dir].concat(ds));
      return r;
    }, [dirs]);

    /* ---- 打开 / 关闭视频 ----
       `sid` 给了 = 从这条会话打开一个预览标签：会话留在左侧，Agent 的写入目标保持不变。
       没给 = 从 Space 或别处打开：这部视频自己的最近一条会话 → 同项目里还没选视频的会话 → 空的新会话。 */
    const openMovie = useCallback((id, opts) => {
      const o = opts || {};
      const via = o.via || (IA.tabOf(route) === 'space' ? 'space' : 'home');
      let sid = o.sid || null;
      if (!sid) {
        const pick = AP.sessionForMovie(id, projects, sessions);
        sid = pick.sid;
        if (via === 'home' && pick.bind) patchSession(sid, {project: id});
      }
      if (via === 'home') {
        if (!sid) sid = base.newSession({project: id}).id;
        go({r: 'agent', id: sid, movie: id, ...(o.t != null ? {t: o.t} : {})});
      } else go({r: 'editor', id, via, ...(o.t != null ? {t: o.t} : {})});
      setDock({open: false, sid});
    }, [route, projects, sessions, sessionById, patchSession, go, setDock, base.toast, base.newSession]);

    /* 收尾话下面的「打开某某面板」：视频没开着就先按这条会话打开它，再给编辑器下单。 */
    const openTool = useCallback((movie, tool, sid) => {
      if (!movie) return;
      const showing = route.r === 'editor' ? route.id : route.movie;
      if (showing !== movie) openMovie(movie, route.r === 'agent' ? {sid, via: 'home'} : {});
      base.requestTool(movie, tool, sid);
    }, [route, openMovie, base.requestTool]);

    const closeMovie = useCallback(() => {
      if (route.r !== 'editor' && !route.movie) return;
      go(IA.closeMovieTarget(route, dock, nav));
    }, [route, dock, nav, go]);

    const railGo = useCallback((tab) => {
      const t = IA.railTarget(nav, tab);
      if (!t) return;
      if (['tasks', 'tools', 'services'].includes(tab) && IA.tabOf(route) !== tab && base.sidebar.ghost) base.toggleSidebar();
      go(t);
    }, [nav, go, route, base.sidebar.ghost, base.toggleSidebar]);

    /* ---- 新建视频落在哪个项目 ----
       视频是项目里的一个子目录（§2.3）。新建页本身不问项目：从某个项目里发起的（Space 筛着项目、会话的
       「新建视频…」）把项目记在预置上；没有的就给这部视频新开一个同名项目——不产出「不属于任何项目的视频」。 */
    const pendingDir = React.useRef(null);
    const newProject = useCallback((preset) => {
      pendingDir.current = (preset && preset.dir) || null;
      base.newProject(preset);
    }, [base.newProject]);
    const createProject = useCallback((file, options) => {
      const o = options || {};
      const proj = base.createProject(file, o);
      if (!proj || proj.dir) return proj;
      let dirId = o.dir || pendingDir.current;
      pendingDir.current = null;
      const name = String(proj.title || '未命名').replace(/\.[^.\s/]+$/, '');
      if (!dirId || !dirs.some((d) => d.id === dirId)) {
        dirId = nextDirId();
        const nd = {id: dirId, name, path: AP.dirPath(name), mtime: 0};
        setDirs((ds) => [nd].concat(ds));
      }
      proj.dir = dirId;
      proj.folder = proj.folder || name;
      base.patchProject(proj.id, {dir: dirId, folder: proj.folder});
      return proj;
    }, [base.createProject, base.patchProject, dirs]);

    /* 看过就不再「未读」；「有待审阅」要人明确点掉 */
    const markRead = useCallback((sid) => {
      const s = sessionById(sid);
      if (s && s.unread) patchSession(sid, {unread: false});
    }, [sessionById, patchSession]);

    /* ---- Space ---- */
    const [spaceMarks, setSpaceMarks] = useState({fav: {}, trash: {}});
    const [spaceExtra, setSpaceExtra] = useState([]);
    const outputs = useMemo(() => (D.spaceOutputs || []).concat(spaceExtra), [spaceExtra]);
    const pctOf = useCallback((it) => {
      if (it.kind === 'movie') { const p = projects.find((x) => x.id === it.id); return p ? projPct(p) : null; }
      const t = it.task ? tasks.find((x) => x.id === it.task) : null;
      return t ? t.pct : null;
    }, [projects, tasks, projPct]);
    /* 视频的状态与会话里的视频卡同一份算法（BC_AGENT_CARDS.badge）：视频记录是底，指向它的转录任务在跑 / 排队时以任务为准 */
    const movies = useMemo(() => projects.map((p) => {
      const b = window.BC_AGENT_CARDS.badge(p, tasks);
      if (b.k === p.status || (b.k !== 'transcribing' && b.k !== 'queued')) return p;
      const q = b.k === 'queued' ? tasks.find((t) => t.project === p.id && t.status === 'queued') : null;
      return {...p, status: b.k, queuePos: q ? q.queuePos || null : p.queuePos};
    }), [projects, tasks]);
    const spaceItems = useMemo(() => SP.items({movies, outputs, dirs, marks: spaceMarks, pctOf}),
      [movies, outputs, dirs, spaceMarks, pctOf]);
    const toggleFav = useCallback((it) => setSpaceMarks((m) => ({...m, fav: {...m.fav, [it.id]: !it.fav}})), []);
    /* 视频移入回收站 = 归档（可恢复的整理标记，model-project-library.js）；产物只记在整理层 */
    const setTrashed = useCallback((it, v) => {
      if (it.kind === 'movie') archiveProject(it.id, v);
      else setSpaceMarks((m) => ({...m, trash: {...m.trash, [it.id]: !!v}}));
    }, [archiveProject]);
    const seq = React.useRef(0);
    const saveVersion = useCallback((it, patch) => {
      const rec = SP.newVersion(it, spaceItems, 'ov' + (++seq.current) + '-' + Date.now().toString(36), patch);
      if (rec) setSpaceExtra((xs) => xs.concat([rec]));
      return rec;
    }, [spaceItems]);
    /* 导入素材：文件拷进项目的「素材/」，投影读出来（原型把记录直接加在产物层）；返回收下的条数 */
    const importAssets = useCallback((files, dirId) => {
      const recs = Array.from(files || []).map((f) => SP.assetRecord(f, dirId, 'oi' + (++seq.current) + '-' + Date.now().toString(36)))
        .filter(Boolean);
      if (recs.length) setSpaceExtra((xs) => xs.concat(recs));
      return recs;
    }, []);

    /* 新标签页起始页的「新建网页」（product-design §3.3）：在会话所属项目里放一份演示 HTML 文档 */
    const createHtmlPage = useCallback((dirId, sid) => {
      const rec = window.BC_HOME_BROWSER.newPage(spaceItems, {id: crypto.randomUUID(), dir: dirId || null, session: sid || null, now: Date.now()});
      setSpaceExtra((xs) => xs.concat([rec]));
      return rec;
    }, [spaceItems]);

    const registerToolOutput = useCallback((kind, record) => {
      const it = window.BC_HOME_TOOLS.output(kind, record);
      if (it) setSpaceExtra(xs => xs.some(x => x.id === it.id) ? xs : [it, ...xs]);
      return it;
    }, []);
    /* `media`：字幕产物没有来源媒体时配上的那份文件名（翻译字幕工具的「以此新建视频」） */
    const createMovieFromOutput = useCallback((it, media) => {
      const patch = window.BC_HOME_TOOLS.moviePatch(it, media);
      if (!patch) return null;
      const movie = createProject(null, {entry: 'blank', dir: it.dir, title: patch.title, ratio: '16:9'});
      base.patchProject(movie.id, patch);
      go({r: 'editor', id: movie.id, via: 'space'});
      return {...movie, ...patch};
    }, [createProject, base.patchProject, go]);

    /* ---- 在会话中继续 / 交给 Agent（product-design §4.7、§2.7「结果与下一步」） ----
       条目作为引用标签放进会话的输入框（`draftReference`：名字、种类、位置，不是文件内容），`intent` 是预填的那句草稿：
       字符串 = 用它；不给 = 按种类的缺省句（BC_HANDOVER）；`false` = 只带引用、不预填。不自动发送。
       落到哪条会话由 BC_SPACE_TOOLS.pickSession 决定；返回那条会话，回收站里的返回 null 并说明要先恢复。 */
    const handoverToAgent = useCallback((entry, intent) => {
      const pick = window.BC_SPACE_TOOLS.pickSession(entry, sessions);
      if (!pick) return null;
      if (pick.kind === 'blocked') { base.toast(`「${entry.name}」在回收站里，先恢复再带进会话`, 'negative'); return null; }
      const d = window.BC_HANDOVER.draft(entry, intent === false ? null : intent);
      if (!d) return null;
      const prompt = intent === false ? undefined : d.text;
      const sess = pick.kind === 'existing'
        ? base.openAgent({sid: pick.id, prompt})
        : base.openAgent({project: pick.project || undefined, dir: pick.dir || undefined, prompt});
      if (sess) patchSession(sess.id, {draftReference: d.reference});
      return sess;
    }, [sessions, base.openAgent, base.toast, patchSession]);

    /* ---- 旧版项目导入的启动询问（legacy-import.jsx）：开着没有、演示哪个平台的路径；原型开关要能再弹一次 ---- */
    const LI = window.BC_LEGACY_IMPORT;
    const [legacyAsk, setLegacyAsk] = useState(() => LI.demoLaunch(window.location.search) && LI.shouldAsk(LI.DEMO_FOUND.length, base.prefs.legacyImport));
    const [legacyHost, setLegacyHost] = useState(() => LI.hostFrom(window.location.search));

    /* 任务详情的「在 Space 中查看」：跳到 Space 并打开这个条目的查看框。和 toolPreset 一样只活到 Space 页读走，不进路由。 */
    const [spaceFocus, setSpaceFocus] = useState(null);
    const openSpaceEntry = useCallback((id) => {
      setSpaceFocus(id || null);
      go({r: 'projects'});
    }, [go]);
    const takeSpaceFocus = useCallback(() => {
      const id = spaceFocus;
      if (id) setSpaceFocus(null);
      return id;
    }, [spaceFocus]);

    return {
      handoverToAgent, spaceFocus, openSpaceEntry, takeSpaceFocus, legacyAsk, setLegacyAsk, legacyHost, setLegacyHost,
      dirs, dirById, toggleDirPin, toggleSessionPin, dirOfSession, moviesOf, createDir, openDir,
      openMovie, openTool, closeMovie, railGo, markRead, newProject, createProject,
      spaceItems, toggleFav, setTrashed, saveVersion, importAssets, createHtmlPage, registerToolOutput, createMovieFromOutput,
    };
  }

  Object.assign(window, {useAppIA});
})();
