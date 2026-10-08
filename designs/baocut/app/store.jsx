/* BaoCut 原型 — 应用 store
   ============================================================================
   只放**跨屏**状态与路由。一块屏自己的开合、hover、草稿一律用局部 useState——
   把它们塞进这里正是前身 baocut-mac 的 store.jsx 长到 166 KB 的原因。

   算出来的东西一律下沉到 app/model-*.js（纯模型，node --test 可测）；
   这一层只做「状态怎么变」，不做「值怎么算」。
   ============================================================================ */
(function () {
  const {useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect} = React;
  const D = window.BC_DATA;
  const NAV = window.BC_NAV;
  const LAYOUT = window.BC_LAYOUT;
  const AG = window.BC_AGENT;
  const SURF = window.BC_SURFACE;

  const AppCtx = React.createContext(null);
  const useApp = () => React.useContext(AppCtx);

  /* 两份原型同源（BaoCut.html / BaoCutWeb.html），布局偏好与路由栈按表面分键（model-surface.js） */
  const PREF_KEY = SURF.storageKey('bc-prefs-v1');
  const AGENT_SKILLS_KEY = SURF.storageKey('bc-agent-skills-v1');
  const NAV_STORE = {
    getItem: () => window.localStorage.getItem(SURF.storageKey(NAV.KEY)),
    setItem: (k, v) => window.localStorage.setItem(SURF.storageKey(NAV.KEY), v),
  };
  const NO_RUNNER_BY = {};
  /* Web 表面不加载智能裁剪 / 导入 / 新建项目那几份跨屏 hook（它们的入口 Web 都没有）；
     这里给同形状的空壳，编辑器读 `app.crop.sessions[id]` 之类不必处处判空。 */
  const NO_SHORTS_CUT = {sessions: {}, open: () => ({ok: false, error: SURF.aiElsewhere('剪成短视频')})};
  const NO_CROP = {sessions: {}, outputs: {}, open: () => ({ok: false, error: SURF.aiElsewhere('智能裁剪')})};
  const NO_FLOW = {};
  const NO_AGENT_SIM = {runWrite: () => {}, retryTask: () => {}, runWait: () => {}, planFor: (t, hasProject) => AG.planFor(t, hasProject)};
  const loadPrefs = () => {
    try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (e) { return {}; }
  };
  const savePrefs = (p) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {} };

  function useStore() {
    /* ---- 路由 ---- */
    const [browserNav] = useState(() => window.BC_BROWSER_NAV.create(window, NAV.load(NAV_STORE), SURF.id));
    const nav = React.useSyncExternalStore(browserNav.subscribe, browserNav.getSnapshot);
    useEffect(() => { NAV.save(nav, NAV_STORE); }, [nav]);
    const route = NAV.current(nav);
    const {go, replace, back, fwd} = browserNav;

    /* ---- 布局偏好（持久化：拖过的宽度刷新不丢） ---- */
    const [prefs, setPrefsRaw] = useState(loadPrefs);
    const theme = ['light', 'dark'].includes(prefs.theme) ? prefs.theme : 'system';
    useLayoutEffect(() => {
      document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme;
    }, [theme]);
    // MCP 原型运行态跨设置页保留；刷新回到关闭，不持久化一个虚假的监听进程。
    const [mcp, setMcp] = useState({running: false, projects: [], access: 'ask', off: [], requireToken: false});
    /* 2026-09-18：安装位置从「一串路径」改成一张表 path → {mode: 'link' | 'copy', ver, issue?}
       （issue：'broken' 链接失效 / 'foreign' 那里已有一个不是 BaoCut 建的 baocut）。判定在 model-skill-install.js。 */
    const [skillInstalls, setSkillInstalls] = useState(() => window.BC_SKILL_INSTALL.scenarioInstalls('default'));
    const [skillRoots, setSkillRoots] = useState([]);
    /* 内置 Agent 自己使用的 skills（model-agent-skills.js）：设置里添加、开关、移除，输入框的「+」读它，所以放在这里。
       只把用户动过的差量存进本地（按表面分键），演示数据本身不落盘。 */
    const [agentSkills, setAgentSkillsRaw] = useState(() => {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(AGENT_SKILLS_KEY)); } catch (e) {}
      return window.BC_AGENT_SKILLS.apply(window.BC_DATA.agentSkills, saved);
    });
    const setAgentSkills = useCallback((fn) => setAgentSkillsRaw((cur) => {
      const next = typeof fn === 'function' ? fn(cur) : fn;
      try { localStorage.setItem(AGENT_SKILLS_KEY, JSON.stringify(window.BC_AGENT_SKILLS.snapshot(window.BC_DATA.agentSkills, next))); } catch (e) {}
      return next;
    }), []);
    /* 术语库（§15.10，2026-09-20）：库本身是一份用户资产，活在 App 级而不是项目里——
       同一张「交易 · 量价方法」要在每个项目上生效。这里只存库与「哪个项目启用哪几张表」，
       项目内生效的真相仍是各自的 context 表（真产品里的 `ai/context.md`）。
       启用集合与识别提示开关进 prefs（刷新不丢），库内容活在本次会话（原型不落盘）。 */
    const [glossary, setGlossary] = useState(() => window.BC_DATA.glossary.packs.map((p) => ({...p})));
    /* 我的声音（2026-09-24，voice-library 设计稿 §3）：用户级音色档，跨项目、跨引擎；演示数据来自 BC_VOICES.DEMO，刷新重置。
       `voiceHandoff` 是「克隆新音色…」的回程：面板记下自己是谁（key）与当时的路由，设置页存好后带着 voiceId 回去，
       同一个 key 的选择器装载时认领这只音色并清掉。 */
    const [voices, setVoices] = useState(() => window.BC_VOICES.DEMO.map((v) => ({...v})));
    const addVoices = useCallback((list) => setVoices((cur) => [...list, ...cur]), []);
    const [voiceHandoff, setVoiceHandoff] = useState(null);
    const glossaryUse = prefs.glossaryUse || {};
    const setGlossaryUse = useCallback((projectId, ids) => {
      setPrefsRaw((p) => {
        const next = {...p, glossaryUse: {...(p.glossaryUse || {}), [projectId]: ids}};
        savePrefs(next);
        return next;
      });
    }, []);
    const setPref = useCallback((k, v) => {
      setPrefsRaw((p) => { const next = {...p, [k]: v}; savePrefs(next); return next; });
    }, []);

    /* 界面语言（设置 › 通用）：chrome 本身没有 i18n 层，跟着它走的是画进画面的内容——
       内置模板目录（`BC_TPL.builtins(tplLang)`，2026-09-14）。 */
    const uiLang = prefs.lang || '跟随系统';
    const tplLang = window.BC_TPL.langOf(uiLang);
    /* 侧栏默认开合跟表面走：App 默认展开；Web 默认收起（项目列表只在要换项目时才用得上，§22.3） */
    /* 有 App rail 时侧栏是页面侧栏（Home / Space），宽度走 LAYOUT.PAGE_SIDE（默认 240、最窄 200）；Web 仍是原来那组数 */
    const SIDE_LIM = SURF.appRail ? LAYOUT.PAGE_SIDE : null;
    const sideDef = SIDE_LIM ? SIDE_LIM.def : LAYOUT.SIDEBAR_DEFAULT;
    const sidebarW = prefs.sidebarW === undefined ? (SURF.sidebarDefaultOpen ? sideDef : 0) : prefs.sidebarW;
    const sidebarLast = prefs.sidebarLast || sideDef;
    const sidebar = LAYOUT.sidebar(sidebarW, sidebarLast, SIDE_LIM);
    const setSidebarW = useCallback((w) => {
      const s = LAYOUT.sidebar(w, sidebarLast, SIDE_LIM);
      setPref('sidebarW', s.ghost ? 0 : s.width);
      if (!s.ghost) setPref('sidebarLast', s.width);
    }, [setPref, sidebarLast]);
    const toggleSidebar = useCallback(() => {
      setPref('sidebarW', sidebar.ghost ? sidebarLast : 0);
    }, [sidebar.ghost, sidebarLast, setPref]);

    /* ---- 项目与任务（原型里是内存态；真产品读 projects.json / jobs.json） ---- */
    const [projects, setProjects] = useState(D.projects);
    const activeProjects = useMemo(() => window.BC_LIBRARY.visible(projects, false), [projects]);
    const [tasks, setTasks] = useState(D.tasks);
    const projById = useCallback((id) => projects.find((p) => p.id === id) || null, [projects]);
    const deleteProject = useCallback((id) => setProjects((ps) => ps.filter((p) => p.id !== id)), []);
    const archiveProject = useCallback((id, archived) =>
      setProjects((ps) => window.BC_LIBRARY.setArchived(ps, id, archived)), []);
    const runningTask = useMemo(() => tasks.find((t) => t.status === 'running') || null, [tasks]);
    /* 任务与项目状态是**一份真相**（真产品里是 jobs.json / projects.json）：
       编辑器里转录跑到哪一格，顶栏进度胶囊、侧栏迷你条、后台任务页读的是同一条记录。
       客户端不另存一份进度，也不自算阈值——这条纪律在 App v2 里同样成立。 */
    /* 状态从在跑 / 排队落到结束时记下 `endedAt`（会话里的视频卡按它判断活是不是在下一轮开始前就结束了，
       product-design §3.2.2）；回到在跑（重试）时清掉。 */
    const LIVE_ST = ['running', 'queued'];
    const endStamp = (t, patch) => {
      if (!('status' in patch) || 'endedAt' in patch) return null;
      if (LIVE_ST.includes(patch.status)) return {endedAt: null};
      return LIVE_ST.includes(t.status) ? {endedAt: Date.now()} : null;
    };
    /* `patch` 也可以是函数（拿到最新那条记录、返回要合并的字段）：toast 上的「撤销」这类晚到的操作用它，免得拿旧的一帧去覆盖 */
    const patchTask = useCallback((id, patch) =>
      setTasks((ts) => ts.map((t) => {
        if (t.id !== id) return t;
        const p = typeof patch === 'function' ? patch(t) : patch;
        return {...t, ...p, ...endStamp(t, p)};
      })), []);
    /* 每一次 AI run 都落一条任务记录——**跑完的收据与撤销都挂在它身上**。
       不落记录的后果是：关掉那条绿横幅，这一跑就再也找不到了，
       后台任务页也看不见它跑过。写作三工具不落（§15.3：它们不写文稿、没有撤销）。 */
    const aiSeq = useRef(0);
    const addTask = useCallback((spec) => {
      const id = 'a' + (++aiSeq.current);
      // seq：任务页按它倒序，刚起的排最上（演示数据没有 seq，按原顺序排在后面）
      setTasks((ts) => ts.concat([{id, seq: aiSeq.current, pct: 0, status: 'running', source: 'app', started: '刚刚', ...spec}]));
      return id;
    }, []);

    /* ---- 本机模型的安装状态（跨屏一份） ----
       它必须在 store 里，因为同一批模型出现在三处：新建向导的模型列、AI 工具
       「重新转录」的模型下拉、设置 · 本地模型。三处各存一份的后果是「设置里刚下完，
       下拉里还写着未安装」——同一类错误在第 33 轮的 cue 表上已经踩过一次。
       **模型下载不是任务**（§17.3），所以它不进 jobs 那张表，单独存在这里。 */
    const [modelOn, setModelOn] = useState(() => {
      const m = {}; D.setModels.forEach((x) => { m[x.id] = !!x.installed; }); return m;
    });
    const [modelDl, setModelDl] = useState({});      // id → 0..100，只装在下的
    const dlTimers = useRef({});
    /* API 提供方与账号（product-design §7.6）：已添加的 API 提供方的设置（启用、地区、端点改写、添加的模型 id、自建端点）与每家的账号表。
       账号只存掩码（BC_VENDORS.mask），密钥原文不进 store。写入口只有设置 › 模型 › API 提供方；工具页 / 面板 / 我的声音只读。
       cloudSaved（「连着密钥的提供方 id」）由它们推出：启用且有一个启用带密钥的账号，同一把密钥给文本 / 识别 / 合成 / 生图共用；
       `cloud:<provider>/<model>` 在 modelInstalled 眼里 = 那家连着（与本地「装没装」同一个门）。 */
    const [providerSeed] = useState(() => window.BC_VENDORS.seed(Date.now()));
    const [providerSettings, setProviderSettings] = useState(providerSeed.settings);
    const [providerAccounts, setProviderAccounts] = useState(providerSeed.accounts);
    const cloudSaved = useMemo(() => window.BC_VENDORS.connectedIds(providerSettings, providerAccounts), [providerSettings, providerAccounts]);
    /* 工具页（文本生成、翻译）读的旧目录形状 [{id, name, models: [{id, kind}]}]，由 API 提供方目录推出 */
    const cloudCatalog = useMemo(() => window.BC_VENDORS.legacyCatalog(providerSettings), [providerSettings]);
    /* 一家 API 提供方的设置合并写；patch 为 null 时移除这家（连同账号） */
    const patchProvider = useCallback((id, patch) => {
      setProviderSettings((s) => {
        const n = Object.assign({}, s);
        if (patch === null) delete n[id]; else n[id] = Object.assign({}, s[id] || {enabled: true}, patch);
        return n;
      });
      if (patch === null) setProviderAccounts((a) => { const n = Object.assign({}, a); delete n[id]; return n; });
    }, []);
    const setAccounts = useCallback((id, fn) => {
      setProviderAccounts((a) => Object.assign({}, a, {[id]: typeof fn === 'function' ? fn(a[id] || []) : fn}));
    }, []);
    /* 语音识别的默认 API 提供方模型（'cloud:<p>/<m>'，'' = 用本机默认）；文本生成 'provider/model'；合成与生图 'cloud:<p>/<m>' */
    const [cloudAsrDefault, setCloudAsrDefault] = useState('');
    const [cloudLlmDefault, setCloudLlmDefault] = useState('openai/gpt-6.1-sol');
    const [cloudCustom, setCloudCustom] = useState([]);
    const [cloudTtsDefault, setCloudTtsDefault] = useState('');
    /* 图像生成（2026-09-25 图像生成设计稿 §2）：默认云端 / 本地生图模型（'' = 每次选择；2026-09-27 起可以显式设成 Codex，隐式回落仍不落到它），
       设置 › Agent 的「用 Codex 画图」开关。已连上的 API 提供方沿用 cloudSaved（同一把密钥给 STT / LLM / TTS / 图像共用）。 */
    const [cloudImageDefault, setCloudImageDefault] = useState('');
    const [codexImageGen, setCodexImageGen] = useState(true);
    const modelInstalled = useCallback((id) => {
      const C = window.BC_CLOUD_TTS;
      if (C.isCloud(id)) return cloudSaved.indexOf(C.providerOf(id)) >= 0;
      return !!modelOn[id];
    }, [modelOn, cloudSaved]);
    /* 语速库（2026-09-11，配音设计稿 §10）：每个 TTS 模型 × 语言「一分钟念多少字 / 词」的分位数，
       产品里落在 `~/Library/Application Support/BaoCut/tts-pace.json`（`BC_TTS.PACE_PATH`），
       每次合成完按实测更新一次；原型从种子表起步，跑过配音 / 生成后就地更新。 */
    const [ttsPace, setTtsPace] = useState(() => JSON.parse(JSON.stringify(window.BC_TTS.PACE_SEED)));
    const bumpPace = useCallback((model, lang, sample) => {
      setTtsPace((lib) => window.BC_TTS.paceUpdate(lib, model, lang, sample, Date.now()));
    }, []);
    // 原型开关：素材导入态（产品里由真实的导入链驱动，这里只是个演示挡位）
    const [mediaStage, setMediaStage] = useState('ready');
    /* 原型开关：主媒体放不出来（§11.3）。'auto' 跟项目数据走（源文件标了 missing 的那个
       项目才出卡）；'missing' / 'unplayable' 在任何有主媒体的项目上强制演示，'ok' 强制关。 */
    const [stageMediaDemo, setStageMediaDemo] = useState('auto');
    /* 原型开关：预览载入与卡住（产品设计 §5.1，model-stage-load.js）。`since` 是切到这一挡的时刻。 */
    const [stageLoadDemo, setStageLoadDemo] = useState({mode: 'ready', since: 0});
    /* 「核心已有 / 建议扩展项」的记号（动画目录里那颗实心/空心蓝点）。**默认关**：
       它是给做实现的人看的，不是产品的一部分——一份样式目录里「哪几条内核今天认得」
       对选样式的人没有意义。收进原型开关，我们要看时打开（第 56 轮）。 */
    const [coreMarks, setCoreMarks] = useState(false);
    /* 原型开关：BCF 预览代理（§11.2）。产品里 App 进程内查代理状态、Web 轮询 serve 的
       状态端点，都是 1 秒一次；原型只是个静态演示挡位——`since` 记「切到生成中」的那一刻，
       舞台按它演「满 1 秒才露面」。帧数取 30 s × 30 fps = 900 帧，333 帧即 37%。
       `stale` 是同一列里「上一版画面」提示的演示开关（null = 不挂）。 */
    const [proxyDemo, setProxyDemo] = useState({status: 'ready', since: 0, done: 333, total: 900, stale: null});
    const patchProxyDemo = useCallback((patch) => setProxyDemo((s) => ({...s, ...patch})), []);
    const setModelInstalled = useCallback((id, on) =>
      setModelOn((s) => ({...s, [id]: !!on})), []);
    const downloadModel = useCallback((id) => {
      if (dlTimers.current[id]) return;
      setModelDl((s) => ({...s, [id]: 0}));
      dlTimers.current[id] = setInterval(() => {
        setModelDl((s) => (id in s ? {...s, [id]: Math.min(100, s[id] + 7)} : s));
      }, 150);
    }, []);
    /* 收口放在 effect 里而不是 updater 里：updater 必须是纯函数，
       把「装好了 + 弹一条 toast」塞进去在 StrictMode 的双调用下会跑两遍。 */
    useEffect(() => {
      Object.keys(modelDl).forEach((id) => {
        if (modelDl[id] < 100) return;
        clearInterval(dlTimers.current[id]);
        delete dlTimers.current[id];
        setModelDl((s) => { const n = {...s}; delete n[id]; return n; });
        setModelOn((s) => ({...s, [id]: true}));
      });
    }, [modelDl]);
    useEffect(() => () => Object.values(dlTimers.current).forEach(clearInterval), []);
    const patchProject = useCallback((id, patch) =>
      setProjects((ps) => ps.map((p) => (p.id === id ? {...p, ...patch} : p))), []);
    /* 进编辑器就记一次「打开」：侧栏项目段默认按 `otime` 排。原型没有真时钟，
       上一个「刚刚打开」的退到 1 分钟前，免得两项同为 0 分不出先后。 */
    const openedId = route.r === 'editor' ? route.id : null;
    useEffect(() => {
      if (!openedId) return;
      setProjects((ps) => (ps.some((p) => p.id === openedId && p.otime === 0) ? ps
        : ps.map((p) => (p.id === openedId ? {...p, otime: 0} : p.otime === 0 ? {...p, otime: 1} : p))));
    }, [openedId]);
    /** 项目卡上的百分比**派生自任务记录**，不读项目自己那份字段——
        两处各存一份，早晚出现「侧栏 45% / 任务页 78%」。 */
    const projPct = useCallback((project) => {
      const t = tasks.find((x) => x.project === project.id && x.status === 'running');
      return t ? t.pct : (project.progress == null ? 0 : project.progress);
    }, [tasks]);
    const taskFor = useCallback((projectId, kind) =>
      tasks.find((t) => t.project === projectId && t.kind === kind
        && (t.status === 'running' || t.status === 'queued')) || null, [tasks]);

    /* ---- Agent 会话（第 109 轮；跨屏一份；第 110 轮：一条会话只绑一个项目） ----
       会话列表出现在三处：侧栏项目树、首页「进行中」、编辑器左抽屉——所以它必须在
       store 里。这里只做「状态怎么变」：追加消息、放行、撤销、演示脚本的推进；
       「算什么」（排序 / 标题 / 提示词 / 脚本选择）全在 model-agent.js。

       演示脚本：真产品里 agent 的回答与计划来自本机 Claude Code / Codex 的 stdio，
       App 只转发；原型按关键词挑一份脚本，把「读项目 → 规划 → 问一次写入 →
       执行（落成一条后台任务）→ 收据」这一整条演出来。 */
    const [sessions, setSessions] = useState(D.agent.sessions);
    /* 回调里读会话一律走 ref：`openAgent` 建完会话紧接着就要 `sendAgent`，
       闭包里那份 `sessions` 还是建之前的。 */
    const sessionsRef = useRef(sessions);
    sessionsRef.current = sessions;
    const [dock, setDock] = useState({open: false, sid: null});   // 编辑器左抽屉
    /* 悬浮会话（product-design §5.1）：每部视频正挂着哪条会话；最小化是偏好（prefs.movieChatMin），跨视频记住 */
    const [movieChats, setMovieChats] = useState({});
    const setMovieChat = useCallback((movieId, sid) => setMovieChats((m) => ({...m, [movieId]: sid || null})), []);
    /* 会话把人带到工具面板（product-design §5.10）：Agent 跑完一件要在面板里看结果的活，编辑器按这张单打开对应面板。
       跑完时这部视频正开着就直接下单；没开着不下——收尾话下面的按钮连视频一起打开（apprail-store 的 openTool）。 */
    const [toolReq, setToolReq] = useState(null);
    const requestTool = useCallback((movie, tool, sid) => setToolReq({movie, tool, sid: sid || null, n: Date.now()}), []);
    const clearToolReq = useCallback(() => setToolReq(null), []);
    const routeRef = useRef(route);
    routeRef.current = route;
    const landTool = useCallback((sid, plan, sess) => {
      const r = routeRef.current;
      const showing = r.r === 'editor' ? r.id : r.movie;
      if (!(plan.open && sess.project && showing === sess.project)) return;
      requestTool(sess.project, plan.open.tool, sid);
      /* 悬浮会话压在右侧面板上：结果出来了就让位，收成图标（再点回来话都在） */
      if (r.r === 'editor') setPref('movieChatMin', true);
    }, [requestTool]);
    const [autoAllow, setAutoAllow] = useState([]);                 // 「总是允许」的命令前缀
    /* 设置 › Agent 的策略开关（第 121 轮从设置页上移到 store）：它们是命令级的自动放行，
       与 composer 的访问模式两层叠加——没有哪一条能反过来钳住访问模式。 */
    const [policyMap, setPolicyMap] = useState(() => { const m = {}; D.agent.policy.forEach((p) => { m[p.k] = p.on; }); return m; });
    const setPolicy = useCallback((k, v) => setPolicyMap((m) => ({...m, [k]: !!v})), []);
    const agTimers = useRef({});
    const agSeq = useRef(0);
    useEffect(() => () => Object.values(agTimers.current).forEach((arr) => arr.forEach(clearTimeout)), []);
    const harnessPref = prefs.harness || null;
    /* AI 工具页「谁来做」的全局记忆（第 111 轮）：上次在润色页选了 Agent，翻译页打开默认就是 Agent。
       存的是候选 key（`agent:claude`（Agent 默认模型）/ `agent:claude:sonnet` / `api:gpt-4o` / `local`），
       落到具体工具页时由 model-agent.js::resolveRunner 按种类回落。null = 还没选过，按就绪挑默认。 */
    const runner = prefs.runner || null;
    const setRunner = useCallback((k) => setPref('runner', k), [setPref]);
    /* 第 196 轮：工具页各自也记一份（`{cleanup: 'agent:claude', …}`）。找可剪的口默认走 Agent，
       用户在那一页改成直接调模型，下次打开那一页还是模型，但不把翻译页也拖成模型——
       全局记忆仍然更新（下一个没记过的页跟着最近一次选择）。 */
    const runnerBy = prefs.runnerBy || NO_RUNNER_BY;
    const setRunnerFor = useCallback((tool, k) => {
      setPref('runner', k);
      setPrefsRaw((p) => { const next = {...p, runner: k, runnerBy: {...(p.runnerBy || {}), [tool]: k}}; savePrefs(next); return next; });
    }, [setPref]);
    /* 2026-09-21：新会话默认用哪家 · 哪个模型只有这一份记忆（`prefs.harness` + `prefs.agentModels[id]`，
       对齐 App v2 `agent_chat_defaults`）。输入框底栏那枚 chip 与「用 / AI 由谁来做」下拉都读它、
       都写它——同一屏上两处不许各说各的。`model == null` = 交给 Agent 自己决定（存成 'auto'）。 */
    const setAgentDefault = useCallback((id, model) => {
      if (!id) return;
      setPrefsRaw((p) => {
        const next = {...p, harness: id, agentModels: {...(p.agentModels || {}), [id]: model == null ? 'auto' : model}};
        savePrefs(next); return next;
      });
    }, []);
    /* 设置 › Agent 里的启用开关（第 110 轮；对齐 App v2 `agent_provider_enabled`）：
       关掉的不参与默认挑选，也不出现在 composer 的下拉里。 */
    const [harnessOn, setHarnessOnMap] = useState(() => { const m = {}; D.agent.harnesses.forEach((h) => { m[h.id] = h.enabled !== false; }); return m; });
    const setHarnessOn = useCallback((id, v) => setHarnessOnMap((m) => ({...m, [id]: !!v})), []);
    /* 2026-09-18：探测结果上盖一层补丁（设置页的安装 / 升级 / 登录演示与演示场景写它），再由
       model-agent-setup.js::blocked 标出「装着却用不了」的——首页、composer、工具页都读这一份。 */
    const [harnessPatch, setHarnessPatch] = useState({});
    const patchHarness = useCallback((id, patch) => setHarnessPatch((m) => (id == null ? (patch || {}) : {...m, [id]: {...(m[id] || {}), ...patch}})), []);
    /* 用户添加的 provider（product-design §7.6；目录条目或自定义命令，形状见 model-agent-catalog.js）：接在内置的后面，
       同样盖探测补丁与启用开关。移除只对它们生效，连同它们的补丁、开关与默认模型偏好一起清掉。 */
    const [addedHarnesses, setAddedHarnesses] = useState([]);
    const addHarness = useCallback((h) => setAddedHarnesses((l) => (l.some((x) => x.id === h.id) ? l : l.concat([h]))), []);
    const removeHarness = useCallback((id) => {
      setAddedHarnesses((l) => l.filter((x) => x.id !== id));
      setHarnessPatch((m) => { const {[id]: _, ...rest} = m; return rest; });
      setHarnessOnMap((m) => { const {[id]: _, ...rest} = m; return rest; });
      setPrefsRaw((p) => {
        const {[id]: _, ...models} = p.agentModels || {};
        const next = {...p, agentModels: models, ...(p.harness === id ? {harness: null} : {})};
        savePrefs(next); return next;
      });
    }, []);
    const harnessList = useMemo(() => D.agent.harnesses.concat(addedHarnesses).map((h) => {
      const merged = {...h, ...(harnessPatch[h.id] || {})};
      const out = {...merged, enabled: harnessOn[h.id] !== false};
      return {...out, blocked: window.BC_AGENT_SETUP.blocked(out)};
    }), [harnessOn, harnessPatch, addedHarnesses]);
    const harness = useMemo(() => AG.pickHarness(harnessList, harnessPref), [harnessList, harnessPref]);
    /* 第 185 轮：「有没有可以交活的对象」与「没有是因为没装还是都停用了」一份算好，首页 / AI 工具 / composer 都读它 */
    const agentAvail = useMemo(() => AG.agentAvailability(harnessList, harnessPref), [harnessList, harnessPref]);
    const setHarnessPref = useCallback((id) => setPref('harness', id), [setPref]);

    const patchSession = useCallback((id, patch) =>
      setSessions((ss) => ss.map((x) => (x.id === id ? {...x, ...(typeof patch === 'function' ? patch(x) : patch)} : x))), []);
    const appendMsg = useCallback((id, msg) =>
      setSessions((ss) => ss.map((x) => (x.id === id
        ? {...x, ago: 0, messages: x.messages.concat([{id: 'm' + (x.messages.length + 1) + '-' + Date.now(), ...msg}])}
        : x))), []);
    const patchMsg = useCallback((id, mid, patch) =>
      setSessions((ss) => ss.map((x) => (x.id === id
        ? {...x, messages: x.messages.map((m) => (m.id === mid ? {...m, ...patch} : m))}
        : x))), []);
    const sessionById = useCallback((id) => sessions.find((x) => x.id === id) || null, [sessions]);

    /** 新会话：还没说话就不落标题；harness / 模型取当前偏好。 */
    const newSession = useCallback((opts) => {
      const o = opts || {};
      const h = AG.pickHarness(harnessList, o.harness || harnessPref);
      const id = 'sn' + (++agSeq.current) + '-' + Date.now().toString(36);
      const sess = {
        id, title: '', project: o.project || null,
        /* 2026-10-01：会话可以只挂在一个项目（目录）下、还没有视频（`dir`）；有视频时项目从视频推出来，不存两份 */
        ...(!o.project && o.dir ? {dir: o.dir} : {}),
        harness: h ? h.id : null,
        // 没点名模型就用设置 › Agent 里这一家的默认模型（没设过 = 推荐模型；'auto' = 交给 CLI 自己）
        // （composer 里明确选了「Agent 默认模型」传进来的是 null，照收）
        model: o.model !== undefined ? o.model : (h ? window.BC_AGENT_SETUP.defaultModel(h, prefs.agentModels) : null),
        effort: o.effort || 'mid', status: 'idle', ago: 0, messages: [],
        /* 访问模式：先继承你刚才那条会话的档，没有会话才用全局「上次用的」种子。
           会话自己的 mode 是真相——改这一条不会追改已经开着的其它会话。 */
        mode: o.mode ? AG.normalizeMode(o.mode) : AG.nextSessionMode(sessionsRef.current[0], prefs.agentMode),
        draft: o.prompt || '',
      };
      setSessions((ss) => [sess].concat(ss));
      return sess;
    }, [harnessPref, harnessList, prefs.agentMode, prefs.agentModels]);

    const later = (sid, ms, fn) => {
      const t = setTimeout(fn, ms);
      (agTimers.current[sid] = agTimers.current[sid] || []).push(t);
    };
    /* 改一条消息 / 收掉这一轮：都走同一个 setSessions，`fn` 拿整份消息列表 */
    const mapMsgs = (sid, fn) => setSessions((ss) => ss.map((x) => (x.id !== sid ? x : {...x, messages: fn(x.messages)})));
    const endTurn = (sid) => mapMsgs(sid, (ms) => window.BC_AGENT_TURN.endTurn(ms, Date.now()));
    /* 一条回复分块到达（模拟 CLI 按 60ms 一窗合并后的输出）：从 `at` 起逐块把已到达的前缀写进那条 streaming 消息，
       到齐后再翻成 false；停止时计时器被清掉，已到达的文字留着。返回到齐的时刻。 */
    const streamReply = (sid, text, at, extra) => {
      const chunks = window.BC_AGENT_STREAM.chunkArrivals(text);
      const mid = 'a' + (++agSeq.current) + '-' + Date.now().toString(36);
      let t = at;
      chunks.forEach((c, i) => {
        if (i === 0) later(sid, t, () => appendMsg(sid, {id: mid, role: 'assistant', text: text.slice(0, c.end), streaming: true, ...(extra || {})}));
        else later(sid, t, () => mapMsgs(sid, (ms) => ms.map((m) => (m.id === mid ? {...m, text: text.slice(0, c.end)} : m))));
        t += c.delay;
      });
      later(sid, t, () => mapMsgs(sid, (ms) => ms.map((m) => (m.id === mid ? {...m, text, streaming: false} : m))));
      return t;
    };

    /* 放行之后的执行段与会话脚本在 store-agent-sim.jsx（只在 App 入口）；表面在一次页面加载里不变，按表面取 hook 不违反 hook 顺序 */
    const agentSim = SURF.agent
      ? window.useAgentSim({projects, prefs, tasks, addTask, patchTask, patchSession, appendMsg, setSessions, setProjects, sessionsRef, route, landTool, later, streamReply, endTurn}) : NO_AGENT_SIM;
    const runWrite = agentSim.runWrite;

    /** 发一句话：写入 user 消息，按脚本推进。 */
    /* `reference`：输入框里的 Space 条目引用（product-design §4.7），随这条消息发出 */
    const sendAgent = useCallback((sid, text, fresh, attachments = [], reference = null, artifactIds = []) => {
      const t = String(text || '').trim();
      if (!t && !attachments.length && !reference) return;
      const sess = sessionsRef.current.find((x) => x.id === sid) || fresh;
      if (!sess) return;
      const title = sess.title || AG.sessionTitle(t || attachments[0]?.name || (reference && reference.name) || '图片');
      const plan = agentSim.planFor(t, !!sess.project, sess);
      appendMsg(sid, {role: 'user', text: t, attachments, ...(reference ? {reference} : {}),
        ...(artifactIds.length ? {artifactIds} : {}), startedAt: Date.now()});
      patchSession(sid, {title, status: 'running', draft: '', activeModel: null});
      // 原型用 fixture 模拟 CLI 握手：只在回报模型后展示具体名字，目录默认不冒充运行值。
      const h = harnessList.find((item) => item.id === sess.harness);
      later(sid, 180, () => patchSession(sid, {activeModel: sess.model || (h && h.runtimeModel) || null}));
      /* 回复正文分块到达；读的步骤等正文到齐再开始，逐条 run → done（或失败） */
      let at = streamReply(sid, plan.summary, 500) + 200;
      (plan.reads || []).forEach((read) => {
        const r = typeof read === 'string' ? {cmd: read} : read;
        const step = window.BC_AGENT_TURN.toolStep(r);
        const tid = 'rd' + (++agSeq.current);
        later(sid, at, () => appendMsg(sid, {id: tid, role: 'tool', cmd: r.cmd, kind: step.kind, summary: step.summary, status: 'run', ...(r.tool ? {tool: r.tool, args: r.args} : {})}));
        const failed = r.exitCode != null && r.exitCode !== 0;
        const done = failed ? {status: 'failed', exitCode: r.exitCode, error: r.error || null, took: '0.4s'}
          : {status: 'done', took: '0.2s', ...(r.out ? {out: r.out} : {})};
        later(sid, at + 650, () => mapMsgs(sid, (ms) => ms.map((m) => (m.id === tid
          ? {...m, ...done, status: window.BC_AGENT_TURN.nextToolStatus(m.status, done.status)} : m))));
        at += 900;
      });
      /* 边转边问：等那件还在跑的转录（store-agent-sim.jsx 的 runWait） */
      if (plan.wait) { later(sid, at, () => agentSim.runWait(sid, plan, sess)); return; }
      if (!plan.write) {
        const end = plan.close ? streamReply(sid, plan.close, at + 200, {open: plan.open || null, movieId: sess.project || null}) : at + 200;
        later(sid, end, () => {
          landTool(sid, plan, sess);
          endTurn(sid);
          patchSession(sid, {status: 'idle'});
        });
        return;
      }
      later(sid, at + 200, () => {
        const cur = {...sess, title};
        /* 两层叠加：先看「总是允许」的前缀规则，命不中才看会话的访问模式。
           gate.reason 决定卡片上那一行记的是谁放的行（规则 / 编辑 / 访问模式）。 */
        const gate = AG.modeGate(cur.mode, plan.write.cmd, autoAllow);
        if (gate.auto) {
          appendMsg(sid, {role: 'permission', cmd: plan.write.cmd, why: plan.write.why, state: 'auto',
            reason: gate.reason, rule: AG.rulePrefix(plan.write.cmd)});
          runWrite(sid, plan, cur);
        } else {
          appendMsg(sid, {role: 'permission', cmd: plan.write.cmd, why: plan.write.why, state: 'pending', plan});
          patchSession(sid, {status: 'waiting'});
        }
      });
    }, [appendMsg, patchSession, autoAllow, runWrite, harnessList, agentSim.planFor, agentSim.runWait]);

    /** 停止当前整轮：清掉演示计时器，并把仍在跑的消息 / 任务留成可读记录。 */
    const stopAgent = useCallback((sid) => {
      (agTimers.current[sid] || []).forEach(clearTimeout);
      agTimers.current[sid] = [];
      const sess = sessionsRef.current.find((x) => x.id === sid);
      if (!sess || (sess.status !== 'running' && sess.status !== 'waiting')) return;
      if (sess.taskId) {
        setTasks((ts) => ts.map((t) => (t.id === sess.taskId && t.status === 'running'
          ? {...t, status: 'error', outcome: 'canceled', phase: null, error: '已停止', canceled: true, endedAt: Date.now()}
          : t)));
      }
      setSessions((ss) => ss.map((x) => (x.id !== sid ? x : {
        ...x, status: 'idle', taskId: null,
        messages: window.BC_AGENT_TURN.endTurn(x.messages, Date.now()).map((m) => {
          if (m.streaming) return {...m, streaming: false};
          if (m.role === 'tool' && m.status === 'run') return {...m, status: 'failed', took: '已停止'};
          if (m.role === 'permission' && m.state === 'pending') return {...m, state: 'stopped', plan: null};
          return m;
        }),
      })));
    }, []);

    /** 放行卡的三个答案。`always` 记前缀规则，下一次同类写入不再问。 */
    const answerPermission = useCallback((sid, mid, mode, opts) => {
      const sess = sessionsRef.current.find((x) => x.id === sid);
      const msg = sess && sess.messages.find((m) => m.id === mid);
      if (!msg || msg.state !== 'pending') return;
      const o = opts || {};
      if (mode === 'deny') {
        patchMsg(sid, mid, {state: 'denied', plan: null});
        appendMsg(sid, {role: 'assistant', text: '好，没有改任何文件。要换个做法，或者缩小范围再试？'});
        endTurn(sid);
        patchSession(sid, {status: 'idle'});
        return;
      }
      const rule = AG.rulePrefix(msg.cmd);
      if (mode === 'always') setAutoAllow((r) => (r.indexOf(rule) >= 0 ? r : r.concat([rule])));
      /* 允许卡上改过的模型 / 范围记在这条消息上（收据和任务记录都读它） */
      patchMsg(sid, mid, {state: mode === 'always' ? 'always' : 'allowed', plan: null, rule, model: o.model || msg.model, scope: o.scope || msg.scope});
      runWrite(sid, msg.plan, sess, o);
    }, [patchMsg, appendMsg, patchSession, runWrite]);

    const dropAutoAllow = useCallback((rule) => setAutoAllow((r) => r.filter((x) => x !== rule)), []);

    /* 打开 Agent（第 110 轮：会话的家是它绑定的项目）：
       有项目的会话一律进那个项目的编辑器并开左抽屉——Agent 改了什么当场看得到；
       只有没绑项目的会话（首页起的那种）才去全屏 Agent 页。
       `prompt` 只落成草稿（composer 里可改），`send` 为 true 才直接发。 */
    const land = useCallback((sess) => {
      /* App rail（2026-10-01，§3）：会话的家是 Home。正开着的视频就是这条会话的写入目标
         （或会话在同一个项目里、还没选视频）时，转入 Home 会话并在右侧保留视频；否则去 Home 看这条会话——
         视频从会话顶部打开（store 扩展里的 openMovie）。 */
      if (SURF.appRail) {
        const movieId = route.r === 'editor' ? route.id : route.movie;
        const mv = projects.find((p) => p.id === movieId);
        const fits = mv && (sess.project === mv.id || (!sess.project && sess.dir && sess.dir === mv.dir));
        if (fits) {
          if (!sess.project) patchSession(sess.id, {project: mv.id});
          /* product-design §5.1：从 Space 打开的视频，会话在右下角的悬浮会话里进行，不离开编辑器 */
          if (route.r === 'editor') { setMovieChat(mv.id, sess.id); setPref('movieChatMin', false); return; }
          go({r: 'agent', id: sess.id, movie: mv.id, ...(route.tab ? {tab: route.tab} : {})});
        } else {
          go({r: 'agent', id: sess.id});
        }
        return;
      }
      if (sess.project) {
        if (!(route.r === 'editor' && route.id === sess.project)) go({r: 'editor', id: sess.project});
        setDock({open: true, sid: sess.id});
      } else {
        go({r: 'agent', id: sess.id});
      }
    }, [route, go, projects, patchSession]);
    const openAgent = useCallback((opts) => {
      const o = opts || {};
      const movieId = route.r === 'editor' ? route.id : route.movie;
      let sess = o.sid ? sessionsRef.current.find((x) => x.id === o.sid) : null;
      if (!sess) sess = newSession({project: o.project || movieId || null, dir: o.dir, prompt: o.send ? '' : o.prompt, harness: o.harness, model: o.model, effort: o.effort, mode: o.mode});
      else if (o.prompt) patchSession(sess.id, {draft: o.prompt});
      land(sess);
      if (o.send && (o.prompt || o.attachments?.length)) setTimeout(() => sendAgent(sess.id, o.prompt, sess, o.attachments), 0);
      return sess;
    }, [route, newSession, patchSession, land, sendAgent]);
    const openSession = useCallback((id) => {
      const sess = sessionsRef.current.find((x) => x.id === id);
      if (sess) land(sess);
    }, [land]);
    /** 首页复合框：拖了文件又说了话 → 先按文件建项目（转录在后台跑），再把话交给这个项目的会话。 */
    const projSeq = useRef(0);
    const cloneProject = useCallback((id) => {
      const copy = window.BC_LIBRARY.clone(projects, id, 'pc' + (++projSeq.current) + '-' + Date.now().toString(36));
      if (copy) setProjects((ps) => [copy, ...ps]);
      return copy;
    }, [projects]);
    const createProject = useCallback((file, options = {}) => {
      const name = String(file || '未命名.mp4');
      const id = 'pn' + (++projSeq.current) + '-' + Date.now().toString(36);
      /* 模板是建项时的一个选项（2026-09-17），不再是入口：哪种项目都能带一套。 */
      const withTpl = (proj) => {
        const tpl = options.tplId ? window.BC_TPL.builtins(tplLang).find((t) => t.id === options.tplId) : null;
        if (tpl) { proj.template = tpl; proj.ratio = window.BC_TPL.ratioTarget(tpl) || proj.ratio; }
        return proj;
      };
      if (options.entry === 'blank') {
        /* `delivery: 'shorts'`（契约 1，2026-09-27）：新建页按 Shorts 做时才写，缺席 = 常规——与 `ptype`
           同一条规矩，不给就不写。编辑器据此默认打开舞台的平台安全区，导出弹层据此露出发布前检查。 */
        const proj = withTpl({id, title: options.title || '未命名视频', status: 'ready', entry: 'blank', ratio: options.ratio || '16:9',
          ...(options.delivery === 'shorts' ? {delivery: 'shorts'} : {}),
          src: {name: '', path: '', format: '', res: '', state: 'ok'},
          duration: 0, lang: '', model: '', modified: '刚刚', ctime: 0, hue: 32, meta: {}});
        setProjects(ps => [proj].concat(ps));
        return proj;
      }
      const {project: proj, task} = window.BC_MEDIA.localProject(id, name, options, D.projects);
      proj.lang = (D.sttLangs.find(l => l.code === proj.config.lang) || {name: proj.lang}).name;
      if (D.models.cloud.some(m => m.id === proj.model)) task.sub = proj.model + ' · 云端';
      withTpl(proj);
      setProjects((ps) => [proj].concat(ps));
      addTask(task);
      return proj;
    }, [addTask, tplLang]);
    /* 本地建项的演示任务属于应用，离开编辑器仍继续；不再借用样例 j1。 */
    useEffect(() => {
      const running = tasks.filter(t => t.origin === 'local' && t.kind === 'transcribe' && t.status === 'running');
      if (!running.length) return;
      const timer = setTimeout(() => {
        const patches = new Map(running.map(t => {
          const pct = Math.min(100, t.pct + (t.pct < 10 ? 1 : 2));
          return [t.id, pct >= 100 ? {pct, status: 'done', outcome: 'done', phase: null}
            : {pct, phase: window.BC_TX.LIVE_STAGES[window.BC_TX.liveStage(pct)] + '中'}];
        }));
        setTasks(ts => ts.map(t => t.status === 'running' && patches.has(t.id) ? {...t, ...patches.get(t.id)} : t));
        const done = new Set(running.filter(t => patches.get(t.id).status === 'done').map(t => t.project));
        if (done.size) setProjects(ps => ps.map(p => done.has(p.id) ? {...p, status: 'complete', progress: null} : p));
      }, 260);
      return () => clearTimeout(timer);
    }, [tasks]);
    const closeDock = useCallback(() => setDock((d) => ({...d, open: false})), []);
    const toggleDock = useCallback((projectId) => {
      setDock((d) => {
        if (d.open) return {...d, open: false};
        const own = sessionsRef.current.filter((x) => x.project === projectId);
        const cur = d.sid && own.find((x) => x.id === d.sid);
        if (cur) return {open: true, sid: cur.id};
        if (own.length) return {open: true, sid: AG.sortSessions(own)[0].id};
        return {open: true, sid: null};   // 空抽屉：composer 上第一句话才建会话
      });
    }, []);
    const dockW = prefs.dockW == null ? 380 : prefs.dockW;
    const setDockW = useCallback((w) => setPref('dockW', Math.min(560, Math.max(320, Math.round(w)))), [setPref]);

    /* ---- 确认框：唯一执行器，动作是闭集（对齐 App v2 的 ConfirmAction 无兜底臂） ---- */
    const [ask, setAsk] = useState(null);
    const confirm = useCallback((a) => setAsk(a), []);

    /* ---- 项目详情框（第 233 轮）：两个入口一个框 ----
       `extras`（内容 / 译文两行）由**调用方**给，不在这里从项目对象里猜——只有编辑器
       那条路手上有已加载的文稿，项目卡那条路给不出，这两行就该在那边缺席。 */
    const [pinfo, setPinfo] = useState(null);   // null | {id, extras}
    const openProjectInfo = useCallback((id, extras) => setPinfo({id, extras: extras || []}), []);
    const closeProjectInfo = useCallback(() => setPinfo(null), []);

    /* ---- toast ---- */
    const [toasts, setToasts] = useState([]);
    const nid = useRef(1);
    const toast = useCallback((text, tone, action) => {
      const id = nid.current++;
      setToasts((t) => [...t, {id, text, tone, action}]);
      // Spectrum owns dismissal timing; actionable notices remain until acted on or closed.
    }, []);
    /** 引导卡上的「启用 X」：装了但停用的那家一键启用并设为默认——不用再进设置页翻一遍（第 185 轮）。 */
    const enableAgent = useCallback((id) => {
      const h = harnessList.find((x) => x.id === id);
      if (!h) return;
      setHarnessOn(id, true);
      setPref('harness', id);
      toast(`已启用 ${h.name} · 新会话默认用它`, 'positive');
    }, [harnessList, setHarnessOn, setPref, toast]);
    /* 取消一个还在跑的任务（第 120 轮）。三处入口——导出弹层、顶栏胶囊、任务页——
       走的是这一个口子，确认框的话按任务种类取自 `BC_EXPORT.cancelCopy`：导出丢的是
       半个文件，AI run 丢的是没落盘的结果，不能三处三句话。取消后的记录留在任务页
       「已完成」一节里（`outcome: 'canceled'`），不是凭空消失——用户回头能看见自己
       取消过什么。 */
    const cancelTask = useCallback((t, opts) => {
      const task = typeof t === 'string' ? tasks.find((x) => x.id === t) : t;
      if (!task || (task.status !== 'running' && task.status !== 'queued')) return;
      const copy = window.BC_EXPORT.cancelCopy(task.kind);
      const done = () => {
        setTasks((ts) => ts.map((x) => (x.id === task.id
          ? {...x, status: 'error', outcome: 'canceled', phase: null, error: '已取消', canceled: true, endedAt: Date.now()} : x)));
        toast(copy.confirmLabel === '取消导出' ? '已取消导出 · 半成品文件已删掉' : '已取消任务', 'notice');
        if (opts && opts.after) opts.after();
      };
      if (opts && opts.silent) { done(); return; }
      confirm({title: copy.title, body: copy.body, tone: 'negative', confirmLabel: copy.confirmLabel, run: done});
    }, [tasks, toast, confirm]);
    const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

    /* 切档不拦确认框。运行 / 等待审批中的一轮保留发送时的档位，新的选择用于下一轮；
       toast 说明生效时机。写回 prefs 的只是新会话种子，其他会话不追改。 */
    const setSessionMode = useCallback((sid, k) => {
      patchSession(sid, {mode: k});
      setPref('agentMode', k);
      const cur = sessionsRef.current.find((s) => s.id === sid);
      toast(AG.modeToast(D.agent.modes, k, cur && cur.status), k === 'fullAccess' ? 'notice' : null);
    }, [patchSession, setPref, toast]);

    /* 远端算力 › 共享这台 Mac 的开关（§17.3）。侧栏圆点也读它，所以放在 store。
       勾了「打开 BaoCut 时自动开始共享」，每次加载就从「正在共享」起步——那正是 App 启动后的样子。 */
    const [shareOn, setShareOn] = useState(() => !!prefs.shareAutoStart);

    /* 服务（§17.6，2026-09-17）：MCP / 远端算力 / Web 三项共用一套起停。侧栏状态点、悬停快捷按钮
       与各服务页读写同一份，所以起停的那一两秒（phase）也放在这里。Web 服务的端口与自动启动进 prefs；
       运行态不持久化（刷新 = App 重启，只有勾了自动启动的才从「运行中」起步）。
       演示失败路径：Web 服务起在 8080 上会报端口被占用。 */
    const [web, setWeb] = useState(() => ({running: !!prefs.webAutoStart, error: ''}));
    const webPort = prefs.webPort || window.BC_SERVICES.WEB_DEFAULT_PORT;
    /* 端口框失焦提交与点「启动服务」会落在同一拍：起停那一刻读 ref，不读闭包里的旧端口。 */
    const webPortRef = useRef(webPort);
    webPortRef.current = webPort;
    /* 换了端口，上一次「端口被占用」就不再成立：清掉旧错误，状态点回灰。 */
    useEffect(() => { setWeb((w) => (w.error ? {...w, error: ''} : w)); }, [webPort]);
    const [svcPhase, setSvcPhase] = useState({});
    const svcStates = useMemo(() => ({
      mcp: {on: mcp.running, phase: svcPhase.mcp || null},
      remote: {on: shareOn, phase: svcPhase.remote || null},
      web: {on: web.running, phase: svcPhase.web || null, error: web.error},
    }), [mcp.running, shareOn, web, svcPhase]);
    const flipService = useCallback((id, next) => {
      const SV = window.BC_SERVICES;
      if (next && SV.startBlock(id)) return;
      setSvcPhase((p) => ({...p, [id]: next ? 'starting' : 'stopping'}));
      if (id === 'web') setWeb((w) => ({...w, error: ''}));
      setTimeout(() => {
        setSvcPhase((p) => ({...p, [id]: null}));
        if (id === 'mcp') {
          setMcp((s) => ({...s, running: next}));
          toast(next ? 'MCP 服务已启动（演示）' : 'MCP 服务已停止 · 令牌与连接已失效（演示）', next ? 'positive' : null);
        } else if (id === 'remote') {
          setShareOn(next);
          toast(next ? '已开始共享 · 局域网里的其它设备现在能看到这台 Mac' : '已停止共享', next ? 'positive' : null);
        } else if (next && webPortRef.current === 8080) {
          setWeb({running: false, error: '端口 8080 已被其他程序占用。'});
          toast('Web 服务启动失败：端口 8080 已被占用');
        } else {
          setWeb({running: next, error: ''});
          toast(next ? 'Web 服务已启动（演示）' : 'Web 服务已停止', next ? 'positive' : null);
        }
      }, 900);
    }, [toast]);

    /* 表面在一次页面加载里不变，所以这三处按表面取 hook 不违反 hook 顺序 */
    const imports = SURF.pages ? window.useImportFlow({tasks, setTasks, setProjects, go, route, toast, confirm}) : NO_FLOW;
    const crop = SURF.ai ? window.useCropStore({addTask, patchTask, tasks, go, toast}) : NO_CROP;
    const shortsCut = SURF.ai
      ? window.useShortsCutStore({addTask, patchTask, tasks, sessions, stopAgent, projects, setProjects, go, toast}) : NO_SHORTS_CUT;
    /* 新建项目页的跨屏那一半：预置、记忆、转录后的后续链（newproject-flow.jsx） */
    const newFlow = SURF.pages ? window.useNewProjectFlow({tasks, setTasks, addTask, prefs, setPref, go, toast}) : NO_FLOW;
    /* 工具页的预设（product-design §2.7、§4.5）：从 Space 查看器「用工具处理…」或结果页「接着用工具」进工具页时，
       输入已经选好。`toolPreset` 只活到工具页读走（`takeToolPreset`），不进路由、不落盘。 */
    const [toolPreset, setToolPreset] = useState(null);
    const openToolWith = useCallback((toolId, preset) => {
      setToolPreset(preset ? {tool: toolId, ...preset} : null);
      go({r: 'tools', id: toolId});
    }, [go]);
    const takeToolPreset = useCallback((toolId) => {
      if (!toolPreset || toolPreset.tool !== toolId) return null;
      setToolPreset(null);
      return toolPreset;
    }, [toolPreset]);

    return {
      ...imports,
      ...newFlow,
      crop, shortsCut,
      nav, route, go, replace, back, fwd,
      toolPreset, openToolWith, takeToolPreset,
      canBack: NAV.canBack(nav), canFwd: NAV.canFwd(nav),
      prefs, setPref, theme, uiLang, tplLang,
      shareOn, setShareOn,
      mcp, setMcp,
      web, webPort, svcStates, flipService,
      skillInstalls, setSkillInstalls, skillRoots, setSkillRoots,
      agentSkills, setAgentSkills,
      glossary, setGlossary, glossaryUse, setGlossaryUse,
      voices, setVoices, addVoices, voiceHandoff, setVoiceHandoff,
      sidebar, setSidebarW, toggleSidebar,
      projects, activeProjects, projById, deleteProject, archiveProject, cloneProject,
      tasks, runningTask, patchTask, patchProject, taskFor, projPct,
      addTask, cancelTask, retryAgentTask: agentSim.retryTask,
      modelDl, modelInstalled, setModelInstalled, downloadModel,
      providerSettings, providerAccounts, patchProvider, setAccounts, cloudAsrDefault, setCloudAsrDefault,
      cloudCatalog, cloudLlmDefault, setCloudLlmDefault,
      cloudSaved, cloudCustom, setCloudCustom, cloudTtsDefault, setCloudTtsDefault,
      cloudImageDefault, setCloudImageDefault, codexImageGen, setCodexImageGen,
      ttsPace, bumpPace,
      mediaStage, setMediaStage, stageMediaDemo, setStageMediaDemo, stageLoadDemo, setStageLoadDemo, coreMarks, setCoreMarks, proxyDemo, patchProxyDemo,
      sessions, sessionById, newSession, patchSession, sendAgent, stopAgent, answerPermission,
      autoAllow, dropAutoAllow, harness, harnessPref, setHarnessPref, harnessOn, setHarnessOn, harnessList, patchHarness, addedHarnesses, addHarness, removeHarness, agentAvail, enableAgent, runner, setRunner, runnerBy, setRunnerFor, setAgentDefault,
      policy: policyMap, setPolicy, setSessionMode,
      dock, movieChats, setMovieChat, toolReq, requestTool, clearToolReq, openAgent, openSession, createProject, closeDock, toggleDock, setDock, dockW, setDockW,
      ask, confirm, clearAsk: () => setAsk(null),
      pinfo, openProjectInfo, closeProjectInfo,
      toasts, toast, dismissToast,
    };
  }

  Object.assign(window, {AppCtx, useApp, useStore});
})();
