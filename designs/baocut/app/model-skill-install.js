/* 给终端或其他应用里的 Agent 装 baocut skill 的纯层（2026-10-18 按 CLI 重排）。
   宿主与默认方式对齐 `baocut skill install`（Agent 能力面设计 §8.2）：Claude Code、Codex、Cursor、Gemini CLI 四个宿主，
   全局装在 `~/<宿主目录>/baocut`，按项目装在 `<项目根>/<宿主目录>/baocut`；默认复制一份，也可以用链接
   （渲染结果放在 BaoCut 的数据目录，宿主里放指向它的链接，再装或更新一次所有链接一起更新）。
   每个位置都有版本：复制的是装的那一刻的版本，链接的是共享那份最后一次渲染的版本——两种都要「更新」才会跟上 App。
   安装位置是一张表 path → {mode, ver, issue?}；状态判定与写操作都是纯函数，视图不碰磁盘。 */
(function () {
  const HOSTS = [
    {k: 'claude-code', name: 'Claude Code', folder: '.claude/skills'},
    {k: 'codex', name: 'Codex', folder: '.codex/skills'},
    {k: 'cursor', name: 'Cursor', folder: '.cursor/skills'},
    {k: 'gemini', name: 'Gemini CLI', folder: '.gemini/skills'},
  ];
  const folders = HOSTS.map((h) => h.folder);
  const linkSource = '~/.baocut/agent-skills/baocut';
  const GLOBAL = '~';

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
      if (/(?:^|\/)\.(?:claude|codex|cursor|gemini|agents)(?:\/skills(?:\/baocut)?)?$/.test(root)) {
        return {roots: [], error: '请选择项目根目录，不是 Agent 的配置目录或 skills 目录。'};
      }
      if (!roots.includes(root)) roots.push(root);
    }
    return {roots, error: roots.length ? '' : '请至少输入一个项目文件夹。'};
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
  /** 按项目装过的根目录，按出现顺序 */
  function projectRoots(installs) {
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
    {k: 'copy', label: '复制一份', tag: '默认',
     desc: '把 skill 文件复制到 Agent 的 skills 目录。不依赖 BaoCut 的位置，可以同步到别的电脑或放进仓库；BaoCut 更新后在这里点「更新」。'},
    {k: 'link', label: '链接',
     desc: `渲染结果放在 BaoCut 的数据目录（${linkSource}），Agent 那里放一个指向它的链接。更新一次，所有链接一起更新。`},
  ];
  const modeLabel = (k) => (MODES.find((m) => m.k === k) || MODES[0]).label;

  /* ---------- 一处位置的状态 ----------
     none 未安装 / current 与 App 同版本 / stale 比 App 旧，可更新 /
     broken 链接指向的那份不在了 / foreign 那里已有一个不是 BaoCut 装的 baocut。 */
  function locationState(entry, appVer) {
    if (!entry) return 'none';
    if (entry.issue === 'foreign') return 'foreign';
    if (entry.issue === 'broken') return 'broken';
    return cmpVer(entry.ver, appVer) < 0 ? 'stale' : 'current';
  }
  const WORKING = {current: true, stale: true};
  /** 行上的一句状态 + 色调 + 主动作 */
  function stateCopy(kind, entry, appVer) {
    const how = entry && entry.mode === 'link' ? ' · 链接' : '';
    return {
      none: {tone: undefined, text: '未安装', action: 'install', cta: '安装'},
      current: {tone: 'positive', text: `v${entry && entry.ver} · 最新${how}`, action: null, cta: null},
      stale: {tone: 'notice', text: `v${entry && entry.ver} · 可更新到 v${appVer}${how}`, action: 'update', cta: '更新'},
      broken: {tone: 'negative', text: '链接已失效 · 它指向的那份不在了', action: 'repair', cta: '修复'},
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
    const projects = projectRoots(Object.fromEntries(working.map((p) => [p, map[p]])));
    const oldest = stale.map((p) => map[p].ver).sort(cmpVer)[0] || null;
    const fixable = [...stale, ...broken];
    const kind = fixable.length ? 'update' : foreign.length ? 'attention' : working.length ? 'ok' : 'none';
    return {kind, count: working.length, globalHosts, projects, stale, broken, foreign, fixable, oldest};
  }
  /** 折叠行上的「装在哪」：全局：Claude Code、Codex · 2 个项目 */
  function whereLine(ov) {
    const parts = [];
    if (ov.globalHosts.length) parts.push('全局：' + ov.globalHosts.join('、'));
    if (ov.projects.length) parts.push(`${ov.projects.length} 个项目`);
    return parts.join(' · ');
  }

  /* ---------- 写操作（纯 reducer，视图把结果交回 store） ----------
     链接都指向同一份渲染结果：装或更新任何一个链接，所有链接的版本一起跟上。 */
  function put(installs, path, mode, appVer) {
    const m = mode === 'link' ? 'link' : 'copy';
    const out = {...(installs || {}), [path]: {mode: m, ver: appVer}};
    if (m === 'link') Object.keys(out).forEach((p) => { if (out[p].mode === 'link' && !out[p].issue) out[p] = {...out[p], ver: appVer}; });
    return out;
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
  /** 装到一个或几个项目的几个宿主；已经装着的位置不动 */
  function installProjects(installs, roots, hostFolders, mode, appVer) {
    return roots.reduce((acc, r) => hostFolders.reduce((a2, f) => {
      const p = destination(r, f);
      return a2[p] ? a2 : put(a2, p, mode, appVer);
    }, acc), installs || {});
  }
  const removeRoot = (installs, root) => remove(installs, folders.map((f) => destination(root, f)));

  /* ---------- 原型演示场景 ---------- */
  const SCENARIOS = [
    {k: 'default', label: '有可更新'},
    {k: 'fresh', label: '全新'},
    {k: 'all', label: '都是最新'},
    {k: 'broken', label: '链接失效'},
    {k: 'foreign', label: '位置被占用'},
  ];
  function scenarioInstalls(k, appVer) {
    const v = appVer || '1.4.2';
    const [claude, codex] = globalPaths();
    const proj = destination('~/BaoCut/科浪访谈-42', '.claude/skills');
    if (k === 'fresh') return {};
    if (k === 'all') return {[claude]: {mode: 'copy', ver: v}, [codex]: {mode: 'copy', ver: v}, [proj]: {mode: 'copy', ver: v}};
    if (k === 'broken') return {[claude]: {mode: 'link', ver: v, issue: 'broken'}, [codex]: {mode: 'copy', ver: v}};
    if (k === 'foreign') return {[claude]: {mode: 'copy', ver: v}, [codex]: {mode: 'copy', ver: null, issue: 'foreign'}};
    return {[claude]: {mode: 'copy', ver: v}, [codex]: {mode: 'copy', ver: '1.3.0'}, [proj]: {mode: 'copy', ver: '1.3.0'}};
  }

  window.BC_SKILL_INSTALL = {
    HOSTS, folders, linkSource, GLOBAL, parseRoots, destination, host, reader, globalPaths, parsePath, projectRoots, cmpVer,
    MODES, modeLabel, locationState, stateCopy, removalDeletesFiles, installedPaths, overview, whereLine,
    put, remove, repair, repairAll, installProjects, removeRoot, SCENARIOS, scenarioInstalls,
  };
})();
