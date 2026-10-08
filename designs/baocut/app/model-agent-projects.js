/* BaoCut 原型 — 项目（目录）、视频与会话的归属（2026-10-01）
   window.BC_AGENT_PROJECTS。纯函数，无 React、无 DOM；只在 App 入口加载（Web 没有会话）。

   三个词（product-design §2.3）：
     · 项目 —— 一个目录，也是 Agent 的工作目录（data.js `agentProjects`）。
     · 视频 —— 项目下的一个子目录，单个可编辑、可导出的视频（data.js `projects`，`dir` 指回项目）。
     · 会话 —— 挂在一个项目下，或不属于任何项目。会话的 `project` 是它眼下的写入目标视频，
       `dir` 只在还没有视频时才写；有视频的会话，项目从视频推出来（不存两份）。

   这里算 Home 侧栏要的一切：会话状态、项目树（目录 → 会话，按最近活动）、置顶、
   不属于项目的「最近」、项目行的状态汇总、通知里要你处理的那几条、搜索、新建项目与接进已有目录；
   以及打开视频时左侧该放哪条会话（§4.5）。 */
(function () {
  /* ---------- 会话状态（§3.1） ----------
     五种，永远带字：颜色只是第二信号（§2.6）。顺序就是「要你处理」的急迫度，汇总按它排。 */
  const STATUS = {
    waiting: {k: 'waiting', label: '等待批准', tone: 'notice'},
    failed:  {k: 'failed',  label: '失败',     tone: 'negative'},
    running: {k: 'running', label: '进行中',   tone: 'informative'},
    review:  {k: 'review',  label: '有待审阅结果', tone: 'accent'},
    unread:  {k: 'unread',  label: '已完成未读', tone: 'positive'},
  };
  const ORDER = ['waiting', 'failed', 'running', 'review', 'unread'];

  /** 最后一条不是用户说的话、且带 error —— 这一轮失败了（失败不另存字段）。 */
  function lastFailed(sess) {
    const ms = (sess && sess.messages) || [];
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      if (m.role === 'user') return false;
      if (m.role === 'assistant') return !!m.error;
    }
    return false;
  }

  /** 会话的状态键；没有需要标出的状态时是 null（侧栏只写多久前）。 */
  function sessionStatus(sess) {
    if (!sess) return null;
    if (sess.status === 'running') return 'running';
    if (sess.status === 'waiting') return 'waiting';
    if (lastFailed(sess)) return 'failed';
    if (sess.review) return 'review';
    if (sess.unread) return 'unread';
    return null;
  }
  const statusInfo = (k) => (k ? STATUS[k] || null : null);

  /* ---------- 归属 ---------- */
  const byId = (list) => { const m = {}; (list || []).forEach((x) => { m[x.id] = x; }); return m; };

  /** 会话属于哪个项目：写入目标视频所在的目录优先，其次会话自己记的 dir；都没有就是 null。 */
  function dirOf(sess, movies) {
    if (!sess) return null;
    if (sess.project) {
      const mv = (Array.isArray(movies) ? byId(movies) : movies)[sess.project];
      if (mv && mv.dir) return mv.dir;
    }
    return sess.dir || null;
  }

  /** 视频的完整路径：项目目录 + 视频子目录。 */
  function moviePath(dir, movie) {
    if (!dir || !movie) return '';
    const base = String(dir.path || '');
    return (base.endsWith('/') ? base : base + '/') + (movie.folder || movie.id) + '/';
  }

  /** 状态汇总：[{k, label, tone, n}]，按急迫度排；没有状态的会话不计。 */
  function summarize(sessions) {
    const n = {};
    (sessions || []).forEach((s) => { const k = sessionStatus(s); if (k) n[k] = (n[k] || 0) + 1; });
    return ORDER.filter((k) => n[k]).map((k) => Object.assign({}, STATUS[k], {n: n[k]}));
  }
  /** 汇总的一行字：「1 等待批准 · 1 进行中」；空就是空串。 */
  const summaryText = (sum) => (sum || []).map((x) => `${x.n} ${x.label}`).join(' · ');

  /** 按最近活动排会话：ago 小的在前，同分保持原序。 */
  function byRecent(list) {
    return (list || []).map((s, i) => ({s, i}))
      .sort((a, b) => ((a.s.ago || 0) - (b.s.ago || 0)) || (a.i - b.i)).map((x) => x.s);
  }

  /** 一个项目最近一次有动静是多少分钟前：目录自己、它的视频、它的会话，取最近的。 */
  function activity(dir, movies, sessions) {
    let best = dir && dir.mtime != null ? dir.mtime : Infinity;
    (movies || []).forEach((m) => { if (m.mtime != null && m.mtime < best) best = m.mtime; });
    (sessions || []).forEach((s) => { if (s.ago != null && s.ago < best) best = s.ago; });
    return best === Infinity ? null : best;
  }

  /**
   * Home 侧栏的整棵树。
   * @param {{dirs, movies, sessions}} d  movies 只放还在用的（归档的不进树）
   * @returns {{projects: [{dir, movies, sessions, ago, summary}], loose: [sess], pinned: [{kind, dir?|sess?}]}}
   *   projects 按最近活动排；每个项目下的会话也按最近活动排。
   */
  function tree(d) {
    const dirs = d.dirs || [];
    const movies = d.movies || [];
    const sessions = (d.sessions || []).filter((s) => !s.archived);
    const mv = byId(movies);
    const own = {};
    const loose = [];
    sessions.forEach((s) => {
      const k = dirOf(s, mv);
      if (k && dirs.some((x) => x.id === k)) (own[k] = own[k] || []).push(s);
      else loose.push(s);
    });
    const projects = dirs.map((dir) => {
      const ms = movies.filter((m) => m.dir === dir.id);
      const ss = byRecent(own[dir.id] || []);
      return {dir, movies: ms, sessions: ss, ago: activity(dir, ms, ss), summary: summarize(ss)};
    }).map((p, i) => ({p, i}))
      .sort((a, b) => ((a.p.ago == null ? Infinity : a.p.ago) - (b.p.ago == null ? Infinity : b.p.ago)) || (a.i - b.i))
      .map((x) => x.p);
    const pinned = []
      .concat(projects.filter((p) => p.dir.pinned).map((p) => ({kind: 'dir', id: p.dir.id, row: p})))
      .concat(byRecent(sessions.filter((s) => s.pinned)).map((s) => ({kind: 'session', id: s.id, sess: s})));
    return {projects, loose: byRecent(loose), pinned};
  }

  /** Sidebar organization is a projection: changing it never changes ownership. */
  function sidebarView(t, options = {}) {
    const order = (rows) => options.sort === 'name'
      ? [...rows].sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN'))
      : byRecent(rows);
    return {
      ...t,
      projects: t.projects.map((p) => ({...p, sessions: order(p.sessions)})),
      loose: order(t.loose),
      flat: order(t.projects.flatMap((p) => p.sessions).concat(t.loose)),
    };
  }

  /** 通知：需要你处理的会话（等待批准 / 失败 / 有待审阅 / 已完成未读），按急迫度、再按最近活动。 */
  function attention(sessions) {
    const need = (sessions || []).filter((s) => !s.archived).map((s) => ({s, k: sessionStatus(s)})).filter((x) => x.k && x.k !== 'running');
    return need.map((x, i) => ({x, i}))
      .sort((a, b) => (ORDER.indexOf(a.x.k) - ORDER.indexOf(b.x.k)) || ((a.x.s.ago || 0) - (b.x.s.ago || 0)) || (a.i - b.i))
      .map((y) => ({sess: y.x.s, status: STATUS[y.x.k]}));
  }

  /** 侧栏搜索：项目名 / 路径 / 视频名命中留下整个项目，否则只留标题命中的会话；「最近」同理。 */
  function search(t, q) {
    const s = String(q || '').trim().toLowerCase();
    if (!s) return t;
    const hit = (x) => String(x || '').toLowerCase().indexOf(s) >= 0;
    const projects = t.projects.map((p) => {
      if (hit(p.dir.name) || hit(p.dir.path) || p.movies.some((m) => hit(m.title))) return p;
      const ss = p.sessions.filter((x) => hit(x.title));
      return ss.length ? Object.assign({}, p, {sessions: ss}) : null;
    }).filter(Boolean);
    return {projects, loose: t.loose.filter((x) => hit(x.title)), pinned: t.pinned.filter((x) =>
      x.kind === 'dir' ? projects.some((p) => p.dir.id === x.id) : hit(x.sess.title))};
  }

  /**
   * 打开视频时左侧放哪条会话（§4.5）：这部视频自己的会话里最近的一条；没有就用同一个项目里
   * 还没选视频的那种会话（顺手把写入目标落到这部视频）；再没有就是 null —— 空的新会话。
   * 不去借同项目里正对着**另一部**视频的会话：那条的写入目标不是这部。
   * @returns {{sid: string|null, bind: boolean}}  bind = 要把那条会话的 project 写成这部视频
   */
  function sessionForMovie(movieId, movies, sessions) {
    const mv = (Array.isArray(movies) ? byId(movies) : movies)[movieId];
    const mine = byRecent((sessions || []).filter((s) => !s.archived && s.project === movieId));
    if (mine.length) return {sid: mine[0].id, bind: false};
    const dirOnly = mv && mv.dir ? byRecent((sessions || []).filter((s) => !s.archived && !s.project && s.dir === mv.dir)) : [];
    if (dirOnly.length) return {sid: dirOnly[0].id, bind: true};
    return {sid: null, bind: false};
  }

  /**
   * 一条会话能不能留在这部视频的左侧：写入目标就是它，或者同一个项目里还没选视频。
   * 编辑器左抽屉据此决定换不换成空会话。
   */
  function fitsMovie(sess, movieId, movies) {
    if (!sess || sess.archived || !movieId) return false;
    if (sess.project === movieId) return true;
    const mv = (Array.isArray(movies) ? byId(movies) : movies)[movieId];
    return !sess.project && !!mv && !!mv.dir && sess.dir === mv.dir;
  }

  /* ---------- 新建项目 / 打开已有目录（§3.1：项目段「可新建项目、打开已有目录」） ----------
     项目就是一个目录。新建的落在 ~/BaoCut/ 下；打开已有的是把别处的一个目录接进来，路径照原样。
     两种都是 mtime 0（刚有动静），所以排在项目树最上面。id 由调用方给（store 里带时间戳），这里不碰时钟。 */
  const DIR_ROOT = '~/BaoCut/';
  const NEW_DIR_NAME = '未命名项目';
  /** 原型没有系统的目录选择器：「打开已有目录…」固定接进这一个演示目录。 */
  const DEMO_OPEN_DIR = {name: '旅行素材', path: '~/Movies/旅行素材/'};

  /** 目录名 → ~/BaoCut/ 下的路径：空白、斜杠、间隔号换成 -，结尾带 /。 */
  const dirPath = (name, parent = DIR_ROOT) => withSlash(parent) + String(name || '').trim().replace(/[\s/·]+/g, '-') + '/';
  const withSlash = (p) => { const s = String(p || '').trim(); return s.endsWith('/') ? s : s + '/'; };

  /** 不和已有项目撞名、也不撞路径：未命名项目 → 未命名项目 2 → 未命名项目 3 … */
  function uniqueDirName(dirs, base, parent = DIR_ROOT) {
    const b = String(base || '').trim() || NEW_DIR_NAME;
    const names = new Set((dirs || []).map((d) => d.name));
    const paths = new Set((dirs || []).map((d) => withSlash(d.path)));
    const free = (n) => !names.has(n) && !paths.has(dirPath(n, parent));
    if (free(b)) return b;
    for (let i = 2; ; i++) if (free(`${b} ${i}`)) return `${b} ${i}`;
  }

  /** 新建一个空项目：{id, name, path, mtime: 0}。name 缺省是「未命名项目」，重名自动加序号。 */
  function newDir(dirs, id, name, parent = DIR_ROOT) {
    const n = uniqueDirName(dirs, name, parent);
    return {id, name: n, path: dirPath(n, parent), mtime: 0};
  }

  /** 创建表单先校验名称与父目录；浏览器原型只保存路径，不写入磁盘。 */
  function dirCreationError(name, parent) {
    const n = String(name || '').trim();
    const p = String(parent || '').trim();
    if (!n) return '请输入项目名称';
    if (n === '.' || n === '..' || /[/\\\x00-\x1f]/.test(String(name))) return '项目名称不能包含斜杠或控制字符';
    if (!p) return '请选择保存文件夹';
    if (!/^(~\/|\/)/.test(p) || /[\\\x00-\x1f]/.test(String(parent)) || p.split('/').some(x => x === '.' || x === '..')) return '请输入以 ~/ 或 / 开头的完整文件夹路径';
    return '';
  }

  /**
   * 把一个已有目录接成项目。同一路径已经是项目了就不再加一份，返回那一个。
   * @param {{name?, path}} pick  目录选择器选中的目录；name 缺省取路径最后一段
   * @returns {{dir, added: boolean}|null}  没给路径时是 null
   */
  function openDir(dirs, id, pick) {
    const path = pick && pick.path ? withSlash(pick.path) : '';
    if (!path || path === '/') return null;
    const had = (dirs || []).find((d) => withSlash(d.path) === path);
    if (had) return {dir: had, added: false};
    const name = (pick.name && String(pick.name).trim()) || path.replace(/\/+$/, '').split('/').pop();
    return {dir: {id, name, path, mtime: 0}, added: true};
  }

  /** 同一个项目的会话（编辑器抽屉的切换菜单）；视频不在任何项目里时退回只看这部视频的。 */
  function sessionsOfMovieProject(movieId, movies, sessions) {
    const map = Array.isArray(movies) ? byId(movies) : movies;
    const mv = map[movieId];
    if (!mv || !mv.dir) return byRecent((sessions || []).filter((s) => !s.archived && s.project === movieId));
    return byRecent((sessions || []).filter((s) => !s.archived && dirOf(s, map) === mv.dir));
  }

  // 对话产物按消息中的引用与产物来源收集，不把同项目的视频自动归入会话。
  // 视频卡一条会话一部视频一张（product-design §3.2.2 视频卡），挂在下面两处里靠后的那一处：
  // (a) 最后一条引用它的消息——工具消息的 `taskId` 指向的任务 `project` 是这部视频（转录开始、下载完成建出视频、
  //     导入开始），或收据、`artifactIds`；有新的引用，卡就挪过去，前面的回合不再有它。
  // (b) 卡上的活在后面的回合开始时还没结束（在跑 / 排队）：这件活结束之前开始的最后一轮，挂在那一轮最后一条消息后面；
  //     活结束后不再挪，也不挪回去。先后只比时间：用户消息的 `startedAt` 对任务的 `endedAt`；
  //     结束了却没有 `endedAt` 的（演示里的旧记录）不跟，用户消息没有 `startedAt` 的算很早以前。
  // 视频条目多带 `turn`（所在回合）与 `taskIds`（消息引用过的这部视频上的活，按第一次引用排）。
  // 视频以外的产物一条会话一张，挂在第一次引用它的消息上。
  function sessionArtifacts(sess, items = [], tasks = []) {
    if (!sess) return [];
    const messages = sess.messages || [];
    const known = new Map(items.filter(it => !it.trashed && it.purpose !== 'preview').map(it => [it.id, it]));
    const found = new Map();
    const taskTurn = new Map();   // 卡上每件活第一次被引用的回合
    let turn = 0;
    const turnStart = [];   // 每一轮那条用户消息的 startedAt
    const turnLast = [];    // 每一轮最后一条消息（跟着活挪过来的卡挂在它后面）
    const add = (id, messageId, taskId) => {
      const item = known.get(id);
      if (!item) return;
      const movie = item.kind === 'movie';
      if (!found.has(id)) found.set(id, movie ? {...item, messageId, turn, taskIds: []} : {...item, messageId});
      const e = found.get(id);
      if (!movie) return;
      if (messageId) { e.messageId = messageId; e.turn = turn; }   // 挪到最新一条引用
      if (taskId && !e.taskIds.includes(taskId)) { e.taskIds.push(taskId); taskTurn.set(taskId, turn); }
    };
    messages.forEach((m, i) => {
      if (m.role === 'user' && i > 0) turn += 1;
      if (m.role === 'user') turnStart[turn] = Number.isFinite(m.startedAt) ? m.startedAt : -Infinity;
      turnLast[turn] = m.id;
      const internal = m.role === 'tool' && tasks.some(t => t.id === m.taskId && t.kind === 'export' && t.purpose === 'preview');
      if (internal) return;
      for (const id of m.artifactIds || []) add(id, m.id);
      if (m.role === 'tool' && m.taskId) {
        const task = tasks.find(t => t.id === m.taskId);
        if (task && task.project && known.get(task.project)?.kind === 'movie') add(task.project, m.id, task.id);
      }
      if (m.role === 'receipt') {
        const task = tasks.find(t => t.id === m.taskId);
        // 旧消息缺少 movieId 时使用当次任务；新收据直接保存当次视频，避免换目标后串片。
        const movieId = m.movieId !== undefined ? m.movieId : task ? task.project : sess.project;
        if (known.get(movieId)?.kind === 'movie') add(movieId, m.id, task && task.project === movieId ? task.id : null);
      }
    });
    for (const item of items) {
      // 没有产物状态的引用素材不算交付；记的那条消息不在会话里时不知道该挂在哪，只在「产物」汇总里列出（messageId 为 null）。
      if (item.session === sess.id && item.status && item.purpose !== 'preview' && !found.has(item.id)) {
        add(item.id, messages.some(m => m.id === item.messageId) ? item.messageId : null);
      }
    }
    const byTask = new Map(tasks.map((t) => [t.id, t]));
    /* (b)：这件活结束之前开始的、比它被引用那一轮靠后的最后一轮；没有是 -1 */
    const reach = (id) => {
      const end = endOf(byTask.get(id));
      for (let u = turn; u > taskTurn.get(id); u--) if (turnStart[u] < end) return u;
      return -1;
    };
    return [...found.values()].map((e) => {
      if (!e.taskIds) return e;
      const to = Math.max(-1, ...e.taskIds.map(reach));
      return to >= e.turn ? {...e, turn: to, messageId: turnLast[to]} : e;
    });
  }

  const LIVE = ['running', 'queued'];
  /** 这件活什么时候结束：还在跑 / 排队是 Infinity；结束了却没记时间的是 -Infinity（不跟到后面的回合）。 */
  function endOf(t) {
    if (!t) return -Infinity;
    if (LIVE.indexOf(t.status) >= 0) return Infinity;
    return Number.isFinite(t.endedAt) ? t.endedAt : -Infinity;
  }

  /** 「产物」弹层的清单：每样产物一条（卡上是这条会话在它上面的全部活）。 */
  function artifactList(sess, items = [], tasks = []) {
    return sessionArtifacts(sess, items, tasks).map(({turn, taskIds, ...e}) => e);
  }

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.BC_AGENT_PROJECTS = {
    sessionArtifacts, artifactList, STATUS, ORDER, sessionStatus, statusInfo, dirOf, moviePath, summarize, summaryText, byRecent, activity,
    tree, sidebarView, attention, search, sessionForMovie, fitsMovie, sessionsOfMovieProject,
    DIR_ROOT, NEW_DIR_NAME, DEMO_OPEN_DIR, dirCreationError, dirPath, uniqueDirName, newDir, openDir,
  };
})();
