/* 给终端或其他应用里的 Agent 装 baocut skill 的纯层（2026-10-18 重排）。
   - 两个目录就够：`.agents/skills`（Codex 等遵循 Agent Skills 约定的 Agent）与 `.claude/skills`（Claude Code）；
     全局装在 `~/<宿主目录>/baocut`，按目录装在 `<任意文件夹>/<宿主目录>/baocut`——外部 Agent 不一定在 BaoCut 项目里工作，
     所以装到的是「目录」：BaoCut 的项目只是可选的一种，最近在用的那个默认勾上（currentDir）。
   - skill 跟 App 一起打包发布，就在 App 目录里（source）。默认安装是指向它的软链接（symlink；Windows 用目录联接），不复制文件：
     App 更新，skill 跟着更新，永远是 App 自带的版本；也可以复制一份，副本停在复制那一刻的版本，比 App 旧时提示更新。
   - 命令行 `baocut` 同样随 App 发布：PATH 里放一个指向 App 内 bin/baocut 的软链接（cliState）。
   安装位置是一张表 path → {mode, ver, issue?}；状态判定与写操作都是纯函数，视图不碰磁盘。 */
(function () {
  /* 按「谁会读它」标名：用户认的是自己用的 Agent，不是目录名 */
  const HOSTS = [
    {k: 'agents', name: 'Codex 与其他 Agent', folder: '.agents/skills'},
    {k: 'claude', name: 'Claude Code', folder: '.claude/skills'},
  ];
  const folders = HOSTS.map((h) => h.folder);
  const source = '/Applications/BaoCut.app/Contents/Resources/skills/baocut';
  const cliSource = '/Applications/BaoCut.app/Contents/Resources/bin/baocut';
  const cliPath = '/usr/local/bin/baocut';
  const GLOBAL = '~';

  function parseRoots(text) {
    const roots = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const input = line.trim();
      if (!input) continue;
      const root = input.replace(/\/+$/, '');
      if (!root || root === '~') return {roots: [], error: '请选择一个具体的文件夹，不是文件系统根目录或用户主目录。'};
      if (!(root.startsWith('/') || root.startsWith('~/')) || root.split('/').some((p) => p === '..' || p === '.') || /[\x00-\x1f]/.test(root)) {
        return {roots: [], error: '请输入完整路径（以 / 或 ~/ 开头），不要使用 . 或 .. 路径段。'};
      }
      if (/(?:^|\/)\.(?:claude|agents)(?:\/skills(?:\/baocut)?)?$/.test(root)) {
        return {roots: [], error: '请选择要用 BaoCut 的那个文件夹本身，不是 Agent 的配置目录或 skills 目录。'};
      }
      if (!roots.includes(root)) roots.push(root);
    }
    return {roots, error: roots.length ? '' : '请至少输入一个文件夹。'};
  }
  const normRoot = (root) => String(root || '').replace(/\/+$/, '');
  const destination = (root, folder) => `${normRoot(root)}/${folder}/baocut`;
  const host = (folder) => HOSTS.find((h) => h.folder === folder) || null;
  /* 安装位置按「谁会读它」标名，路径退到第二行——用户认的是自己用的 Agent，不是目录名。 */
  const reader = (folder) => (host(folder) || {name: folder}).name;
  const globalPaths = () => folders.map((f) => destination(GLOBAL, f));
  /** 一个安装位置属于哪个根（'~' 是全局）和哪个宿主目录；不是 baocut 安装位置的给 null */
  function parsePath(path) {
    for (const f of folders) {
      const tail = `/${f}/baocut`;
      if (String(path).endsWith(tail)) return {root: String(path).slice(0, -tail.length), folder: f};
    }
    return null;
  }
  /** 按目录装过的根目录（全局之外），按出现顺序 */
  function dirRoots(installs) {
    const out = [];
    Object.keys(installs || {}).forEach((p) => { const x = parsePath(p); if (x && x.root !== GLOBAL && !out.includes(x.root)) out.push(x.root); });
    return out;
  }

  /* ---------- 版本 ---------- */
  function cmpVer(a, b) {
    const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  /* ---------- 安装方式 ---------- */
  const MODES = [
    {k: 'link', label: '软链接到 App', tag: '默认',
     desc: '安装位置只放一个指向 App 里那份 skill 的软链接（symlink），不复制文件。skill 和 App 一起发布，App 更新它就跟着更新，不占空间，版本永远一致。'},
    {k: 'copy', label: '复制一份',
     desc: '把 skill 文件复制过去，之后不依赖 App 的位置，也可以自己改。App 更新后要回到这里更新副本。适合同步到其他电脑、容器，或随仓库提交。'},
  ];
  const modeLabel = (k) => (MODES.find((m) => m.k === k) || MODES[0]).label;

  /* ---------- 一处位置的状态 ----------
     none 未安装 / current 软链接到 App，或副本与 App 同版本 / stale 副本比 App 旧，可更新 /
     broken 链接指向的 App 位置不在了（App 被移动或重装过）/ foreign 那里已有一个不是 BaoCut 装的 baocut。 */
  function locationState(entry, appVer) {
    if (!entry) return 'none';
    if (entry.issue === 'foreign') return 'foreign';
    if (entry.issue === 'broken') return 'broken';
    if (entry.mode === 'link') return 'current';
    return cmpVer(entry.ver, appVer) < 0 ? 'stale' : 'current';
  }
  const WORKING = {current: true, stale: true};
  /** 行上的一句状态 + 色调 + 主动作 */
  function stateCopy(kind, entry, appVer) {
    const link = !!entry && entry.mode === 'link';
    return {
      none: {tone: undefined, text: '未安装', action: 'install', cta: '安装'},
      current: {tone: 'positive', text: link ? `v${appVer} · 软链接到 App，随 App 更新` : `v${entry && entry.ver} · 副本 · 最新`, action: null, cta: null},
      stale: {tone: 'notice', text: `v${entry && entry.ver} · 副本 · 可更新到 v${appVer}`, action: 'update', cta: '更新'},
      broken: {tone: 'negative', text: '软链接已失效 · 它指向的 BaoCut 位置不在了（App 被移动或重装过）', action: 'repair', cta: '修复软链接'},
      /* 不是 BaoCut 放的东西永不覆盖（App 内核的红线）：没有「替换」，只说明，让用户自己移走。 */
      foreign: {tone: 'notice', text: '这里已有一个不是 BaoCut 装的 baocut，BaoCut 不会替换它。移走或改名后再装。', action: null, cta: null},
    }[kind];
  }
  /** 移除它会不会删掉真实文件：副本里可能有用户改过的内容，视图要先在行内确认一次。 */
  const removalDeletesFiles = (kind, entry) => (kind === 'current' || kind === 'stale') && !!entry && entry.mode !== 'link';
  const installedPaths = (installs, appVer) => Object.keys(installs || {}).filter((p) => WORKING[locationState(installs[p], appVer)]);

  /** 折叠起来也要看得见的一行：装在哪、版本是不是最新、要不要处理。
      kind：none 一处没装 / ok 都是最新 / update 有可更新或可修的 / attention 只剩 BaoCut 不碰的占用。 */
  function overview(installs, appVer) {
    const map = installs || {};
    const paths = Object.keys(map);
    const stale = paths.filter((p) => locationState(map[p], appVer) === 'stale');
    const broken = paths.filter((p) => locationState(map[p], appVer) === 'broken');
    const foreign = paths.filter((p) => locationState(map[p], appVer) === 'foreign');
    const working = installedPaths(map, appVer);
    const globalHosts = HOSTS.filter((h) => working.includes(destination(GLOBAL, h.folder))).map((h) => h.name);
    const dirs = dirRoots(Object.fromEntries(working.map((p) => [p, map[p]])));
    const oldest = stale.map((p) => map[p].ver).sort(cmpVer)[0] || null;
    const fixable = [...stale, ...broken];
    const kind = fixable.length ? 'update' : foreign.length ? 'attention' : working.length ? 'ok' : 'none';
    return {kind, count: working.length, globalHosts, dirs, stale, broken, foreign, fixable, oldest};
  }
  /** 折叠行上的「装在哪」：全局：Claude Code、Codex · 2 个目录 */
  function whereLine(ov) {
    const parts = [];
    if (ov.globalHosts.length) parts.push('全局：' + ov.globalHosts.join('、'));
    if (ov.dirs.length) parts.push(`${ov.dirs.length} 个目录`);
    return parts.join(' · ');
  }

  /* ---------- 写操作（纯 reducer，视图把结果交回 store） ---------- */
  function put(installs, path, mode, appVer) {
    const m = mode === 'copy' ? 'copy' : 'link';
    return {...(installs || {}), [path]: m === 'link' ? {mode: m} : {mode: m, ver: appVer}};
  }
  function remove(installs, paths) {
    const out = {...(installs || {})};
    [].concat(paths).forEach((p) => { delete out[p]; });
    return out;
  }
  /** 更新或修复一处：保持原来的方式，装成 App 当前的版本 */
  function repair(installs, path, appVer) {
    const e = (installs || {})[path];
    if (!e || e.issue === 'foreign') return installs;
    return put(remove(installs, path), path, e.mode, appVer);
  }
  const repairAll = (installs, paths, appVer) => paths.reduce((m, p) => repair(m, p, appVer), installs);
  /** 装到一个或几个目录的几个宿主；已经装着的位置不动 */
  function installDirs(installs, roots, hostFolders, mode, appVer) {
    return roots.reduce((acc, r) => hostFolders.reduce((a2, f) => {
      const p = destination(r, f);
      return a2[p] ? a2 : put(a2, p, mode, appVer);
    }, acc), installs || {});
  }
  const removeRoot = (installs, root) => remove(installs, folders.map((f) => destination(root, f)));
  /** 「安装到目录」默认勾上的那个：最近在用的 BaoCut 项目（mtime 最小，同分取靠前的）；没有项目给 null */
  function currentDir(dirs) {
    return (dirs || []).reduce((best, d) => (!best || (d.mtime || 0) < (best.mtime || 0) ? d : best), null);
  }

  /** App 不在「应用程序」里运行时，软链接指向的是一个随时会被挪走的位置——先提醒，再让用户选。 */
  function sourceWarning(appPath) {
    const p = String(appPath || source);
    if (p.startsWith('/Applications/')) return null;
    return {title: 'BaoCut 现在不是从「应用程序」文件夹运行的',
      body: '软链接会指向 App 当前的位置；之后移动或删除这份 App，软链接就会失效。建议先把 BaoCut 拖进「应用程序」再安装，或者改用「复制一份」。'};
  }

  /* ---------- 命令行 baocut ----------
     cli = {path, target?, ver?} | null：PATH 里找到的 baocut、它软链接到哪里、报的版本。
     none 没找到 / app 指向这个 App（版本永远一致）/ other 是别处装的 baocut（版本可能不同，BaoCut 不替换它）。 */
  function cliState(cli, appVer) {
    if (!cli) return {kind: 'none', tone: undefined, text: '没有在 PATH 里找到 baocut', cta: '安装命令行'};
    if (cli.target === cliSource) return {kind: 'app', tone: 'positive', text: `v${appVer} · 软链接到 App，随 App 更新`, cta: null};
    const old = cli.ver && cmpVer(cli.ver, appVer) < 0;
    return {kind: 'other', tone: 'notice', text: `v${cli.ver || '?'} · 不是这个 App 装的${old ? `，比 App 的 v${appVer} 旧` : ''}`, cta: null};
  }

  /* ---------- 原型演示场景 ---------- */
  const SCENARIOS = [
    {k: 'default', label: '都是软链接'},
    {k: 'fresh', label: '全新'},
    {k: 'stale', label: '有旧副本'},
    {k: 'broken', label: '链接失效'},
    {k: 'foreign', label: '位置被占用'},
    {k: 'moved', label: 'App 不在应用程序'},
    {k: 'cli-other', label: '另有一个 baocut'},
  ];
  function scenarioInstalls(k) {
    const [agents, claude] = globalPaths();
    const proj = destination('~/BaoCut/科浪访谈-42', '.claude/skills');
    const repo = destination('~/Projects/video-workflows', '.agents/skills');
    const link = {mode: 'link'};
    if (k === 'fresh' || k === 'moved') return {};
    if (k === 'stale') return {[claude]: link, [agents]: {mode: 'copy', ver: '1.3.0'}, [repo]: {mode: 'copy', ver: '1.3.0'}};
    if (k === 'broken') return {[claude]: {mode: 'link', issue: 'broken'}, [agents]: link};
    if (k === 'foreign') return {[claude]: link, [agents]: {mode: 'copy', ver: null, issue: 'foreign'}};
    /* 默认：都是软链接，全局两处 + 一个 BaoCut 项目 */
    return {[agents]: link, [claude]: link, [proj]: link};
  }
  function scenarioCli(k) {
    if (k === 'fresh' || k === 'moved') return null;
    if (k === 'cli-other') return {path: '/opt/homebrew/bin/baocut', target: '/opt/homebrew/Cellar/baocut/2.0.4/bin/baocut', ver: '2.0.4'};
    return {path: cliPath, target: cliSource};
  }
  const scenarioAppPath = (k) => (k === 'moved' ? '/Users/me/Downloads/BaoCut.app/Contents/Resources/skills/baocut' : source);

  window.BC_SKILL_INSTALL = {
    HOSTS, folders, source, cliSource, cliPath, GLOBAL, parseRoots, destination, host, reader, globalPaths, parsePath, dirRoots, cmpVer,
    MODES, modeLabel, locationState, stateCopy, removalDeletesFiles, installedPaths, overview, whereLine,
    put, remove, repair, repairAll, installDirs, removeRoot, currentDir, sourceWarning, cliState,
    SCENARIOS, scenarioInstalls, scenarioCli, scenarioAppPath,
  };
})();
