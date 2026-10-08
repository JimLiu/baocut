/* Skill 安装的纯层。2026-09-18 重设计：安装位置是一张表 path → {mode, ver, issue?}，
   默认软链接到 App 内置的那一份，也可以复制一份过去；链接失效、副本过期、位置被占用各有自己的状态与修法。 */
(function () {
  const source = '/Applications/BaoCut.app/Contents/Resources/skills/baocut';
  const folders = ['.agents/skills', '.claude/skills'];
  function parseRoots(text) {
    const roots = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const input = line.trim();
      if (!input) continue;
      const root = input.replace(/\/+$/, '');
      if (!root || root === '~') return {roots: [], error: '请选择项目根目录，不是文件系统根目录或用户主目录。'};
      if (!(root.startsWith('/') || root.startsWith('~/')) || root.split('/').some((p) => p === '..' || p === '.') || /[\x00-\x1f]/.test(root)) {
        return {roots: [], error: '请输入完整项目路径（以 / 或 ~/ 开头），不要使用 . 或 .. 路径段。'};
      }
      if (/(?:^|\/)\.(?:agents|claude)(?:\/skills(?:\/baocut)?)?$/.test(root)) {
        return {roots: [], error: '请选择项目根目录，不是用户主目录或 skills 目录。'};
      }
      if (!roots.includes(root)) roots.push(root);
    }
    return {roots, error: roots.length ? '' : '请至少输入一个项目文件夹。'};
  }
  const destination = (root, folder) => `${root}/${folder}/baocut`;
  /* 2026-09-17：安装位置按「谁会读它」标名，路径退到第二行——用户认的是自己用的 Agent，不是目录名。 */
  const READERS = {'.claude/skills': 'Claude Code', '.agents/skills': 'Codex 与其他 Agent'};
  const reader = (folder) => READERS[folder] || folder;
  const globalPaths = () => folders.map((f) => destination('~', f));
  /** 全局两处装了几处。none = 一处没装，partial = 装了一部分，all = 都装了。 */
  function globalStatus(links) {
    const all = globalPaths();
    const n = all.filter((p) => (links || []).indexOf(p) >= 0).length;
    return {n, total: all.length, kind: n === 0 ? 'none' : n === all.length ? 'all' : 'partial',
      missing: all.filter((p) => (links || []).indexOf(p) < 0)};
  }

  /* ---------- 安装方式 ---------- */
  const MODES = [
    {k: 'link', label: '软链接', tag: '推荐',
     desc: '安装位置只放一个指向 App 内置 skill 的链接。BaoCut 更新后 skill 自动跟着更新，不占空间，也不会出现两份内容不一致。'},
    {k: 'copy', label: '复制一份',
     desc: '把 skill 文件复制过去，之后不再依赖 App 的位置，你也可以自己改。BaoCut 更新后需要回到这里手动更新副本。适合要同步到其他电脑、容器，或所在磁盘不支持软链接的情况。'},
  ];
  const modeLabel = (k) => (MODES.find((m) => m.k === k) || MODES[0]).label;

  /* ---------- 一处位置的状态 ----------
     none 未安装 / linked 软链接正常 / copied 副本与 App 一致 / stale 副本比 App 旧 /
     broken 链接指向的 App 位置不存在了 / foreign 那里已有一个不是 BaoCut 建的 baocut。 */
  function locationState(entry, appVer) {
    if (!entry) return 'none';
    if (entry.issue === 'foreign') return 'foreign';
    if (entry.issue === 'broken') return 'broken';
    if (entry.mode === 'copy') return entry.ver === appVer ? 'copied' : 'stale';
    return 'linked';
  }
  const WORKING = {linked: true, copied: true, stale: true};
  const NEEDS_FIX = {stale: true, broken: true, foreign: true};
  /** 行上的一句状态 + 色调 + 主动作。path 只用来拼 aria-label，不进文案。 */
  function stateCopy(kind, entry, appVer) {
    return {
      none: {tone: undefined, text: '未安装', action: 'install', cta: '安装'},
      linked: {tone: 'positive', text: '软链接 → App 内置 skill · 随 App 自动更新', action: null, cta: null},
      copied: {tone: 'positive', text: `副本 v${appVer} · 与 App 内置一致`, action: null, cta: null},
      stale: {tone: 'notice', text: `副本 v${entry && entry.ver} · App 内置已是 v${appVer}`, action: 'update', cta: '更新副本'},
      broken: {tone: 'negative', text: '链接已失效 · 它指向的 BaoCut 位置不存在了（App 被移动或重装过）', action: 'repair', cta: '修复链接'},
      /* 不是 BaoCut 放的东西永不覆盖（App 内核的红线）：没有「替换」，只说明，让用户自己移走。 */
      foreign: {tone: 'notice', text: '这里已有一个不是 BaoCut 创建的 baocut。BaoCut 不会替换它；请自己把它移走或改名，再回来安装。', action: null, cta: null},
    }[kind];
  }
  /** 移除它会不会删掉真实文件：副本里可能有用户改过的内容，视图要先在行内确认一次。 */
  const removalDeletesFiles = (kind) => kind === 'copied' || kind === 'stale';
  const installedPaths = (installs, appVer) => Object.keys(installs || {}).filter((p) => WORKING[locationState(installs[p], appVer)]);

  /** 页顶状态卡：全局两处的安装情况 + 所有位置里待处理的问题数（问题优先于「没装齐」）。 */
  function overview(installs, appVer) {
    const map = installs || {};
    const g = globalStatus(installedPaths(map, appVer));
    const issues = Object.keys(map).filter((p) => NEEDS_FIX[locationState(map[p], appVer)]);
    const fixable = issues.filter((p) => locationState(map[p], appVer) !== 'foreign');   // 别人的文件夹 BaoCut 不碰，不进「全部修复」
    const kind = issues.length ? 'attention' : g.kind;
    return {kind, n: g.n, total: g.total, missing: g.missing, issues, fixable, count: installedPaths(map, appVer).length};
  }

  /* ---------- 写操作（纯 reducer，视图把结果交回 store） ---------- */
  const put = (installs, path, mode, appVer) => ({...(installs || {}), [path]: {mode: mode === 'copy' ? 'copy' : 'link', ver: appVer}});
  function remove(installs, paths) {
    const out = {...(installs || {})};
    [].concat(paths).forEach((p) => { delete out[p]; });
    return out;
  }
  /** 修一处：副本过期 = 重新复制；链接失效 = 重建链接；保持原来的方式。 */
  function repair(installs, path, appVer) {
    const e = (installs || {})[path];
    if (!e) return installs;
    return put(installs, path, e.mode, appVer);
  }
  const repairAll = (installs, paths, appVer) => paths.reduce((m, p) => repair(m, p, appVer), installs);

  /** App 不在「应用程序」里运行时，软链接指向的是一个随时会被挪走的位置——先提醒，再让用户选。 */
  function sourceWarning(appPath) {
    const p = String(appPath || source);
    if (p.startsWith('/Applications/')) return null;
    return {title: 'BaoCut 现在不是从「应用程序」文件夹运行的',
      body: '软链接会指向 App 当前的位置；之后移动或删除这份 App，链接就会失效。建议先把 BaoCut 拖进「应用程序」再安装，或者改用「复制一份」。'};
  }

  /* ---------- 原型演示场景 ---------- */
  const SCENARIOS = [
    {k: 'default', label: '装了一处'},
    {k: 'fresh', label: '全新'},
    {k: 'all', label: '全部就绪'},
    {k: 'stale', label: '副本过期'},
    {k: 'broken', label: '链接失效'},
    {k: 'foreign', label: '位置被占用'},
    {k: 'moved', label: 'App 不在应用程序'},
  ];
  function scenarioInstalls(k) {
    const [agents, claude] = globalPaths();
    const link = {mode: 'link', ver: null};
    if (k === 'fresh' || k === 'moved') return {};
    if (k === 'all') return {[claude]: link, [agents]: link};
    if (k === 'stale') return {[claude]: link, [agents]: {mode: 'copy', ver: '1.3.0'}};
    if (k === 'broken') return {[claude]: {mode: 'link', ver: null, issue: 'broken'}, [agents]: link};
    if (k === 'foreign') return {[claude]: link, [agents]: {mode: 'copy', ver: null, issue: 'foreign'}};
    return {[claude]: link};
  }
  const scenarioAppPath = (k) => (k === 'moved' ? '/Users/me/Downloads/BaoCut.app/Contents/Resources/skills/baocut' : source);

  window.BC_SKILL_INSTALL = {
    source, folders, parseRoots, destination, reader, globalPaths, globalStatus,
    MODES, modeLabel, locationState, stateCopy, removalDeletesFiles, installedPaths, overview, put, remove, repair, repairAll,
    sourceWarning, SCENARIOS, scenarioInstalls, scenarioAppPath,
  };
})();
