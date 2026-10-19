/* BaoCut 原型 — 项目的 git 桥（2026-10-18，版本记录设计 §5.3–§5.4、§6，架构设计 §5.12）
   window.BC_PROJECT_GIT。纯函数，无 React、无 DOM。

   状态的形状与协议的 `ProjectGitStatus` 一致（packages/protocol/src/project-git.ts）：
     ready 能提交 · paused 暂停（locked 仓库正被占用 / repo-state 合并、变基…或 HEAD 分离 / local-config 本地过滤器）
     · not-repo 不在仓库里（init 说明能不能初始化）· unavailable 没有能用的 git · error git 运行失败。
   这里算：状态灯与原因的文字、「提交到 git」「初始化 git」「允许」之后的新状态，以及给 Web 的投影（不给仓库路径与过滤器条目）。

   能不能改由表面决定（BC_SURFACE.localAdmin）：Web 能看状态、触发「提交到 git」；自动提交的开关、「初始化 git」与
   「允许本地过滤器」只在桌面界面与 CLI（§6）。自动提交是 Runtime 级的设置 `versions.git.autoCommit`，这台电脑上的项目共用。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /* 原型开关「项目 git」的场景（shell.jsx TweaksPanel）。每个场景决定演示项目的初始状态。 */
  const SCENARIOS = [
    {k: 'ready', label: '正常'},
    {k: 'locked', label: '仓库正被占用'},
    {k: 'rebase', label: '正在变基'},
    {k: 'detached', label: 'HEAD 分离'},
    {k: 'local-config', label: '有本地过滤器'},
    {k: 'local-config-changed', label: '过滤器允许后变了'},
    {k: 'not-repo', label: '不在仓库里'},
    {k: 'home', label: '项目是主目录'},
    {k: 'user-folder', label: '项目是「影片」文件夹'},
    {k: 'volume-root', label: '项目是磁盘根目录'},
    {k: 'unavailable', label: '没有找到 git'},
    {k: 'error', label: 'git 运行失败'},
  ];

  const REPO_STATE = {
    merge: {label: '正在合并', remedy: '在终端里完成或放弃合并（git merge --continue / --abort）后自动恢复。'},
    rebase: {label: '正在变基', remedy: '在终端里完成或放弃变基（git rebase --continue / --abort）后自动恢复。'},
    'cherry-pick': {label: '正在拣选', remedy: '在终端里完成或放弃拣选（git cherry-pick --continue / --abort）后自动恢复。'},
    revert: {label: '正在还原', remedy: '在终端里完成或放弃还原（git revert --continue / --abort）后自动恢复。'},
    bisect: {label: '正在二分查找', remedy: '在终端里结束二分查找（git bisect reset）后自动恢复。'},
    detached: {label: 'HEAD 分离', remedy: '切回一个分支（例如 git switch main）后自动恢复。'},
  };

  /* 不能「初始化 git」的原因（§5.3）：在那里建 .git 会让下面所有文件夹在别的工具看来都在一个仓库里。 */
  const INIT_REFUSAL = {
    home: '项目就是你的主目录。在这里建仓库，主目录下的所有文件夹在别的工具看来都会算进这个仓库。',
    'user-folder': '项目是系统的标准用户文件夹（桌面、文稿、下载、影片、音乐、图片）。在这里建仓库，里面所有文件夹都会算进这个仓库。',
    'volume-root': '项目是磁盘的根目录。在这里建仓库，整块磁盘都会算进这个仓库。',
    'inside-repo': '项目已经在一个 git 仓库里。',
  };

  /* 本地过滤器的演示条目（§5.4）：git-crypt 的 clean / smudge 与一个 include.path。Git LFS 的标准条目不算，不列。 */
  const DEMO_ENTRIES = [
    {key: 'filter.crypt.clean', value: '"$(git rev-parse --git-common-dir)"/git-crypt/git-crypt clean', file: '.git/config'},
    {key: 'filter.crypt.smudge', value: '"$(git rev-parse --git-common-dir)"/git-crypt/git-crypt smudge', file: '.git/config'},
    {key: 'include.path', value: '../team.gitconfig', file: '.git/config'},
  ];
  /* 项目外的素材（§2.5）：快照里记成 `~/` 开头（主目录下）或绝对路径 */
  const DEMO_OUTSIDE = [
    {path: '~/Movies/采访素材/机位A-0412.mov', video: 'p1'},
    {path: '/Volumes/Footage/2026-10/空镜-城市.mp4', video: 'p1'},
  ];

  const GIT_VERSION = '2.47.1';
  const shortHash = (seed) => (seed >>> 0).toString(16).padStart(7, '0').slice(-7);

  /** 场景 → 一个项目的初始状态。`dir` 是 data.js `agentProjects` 的一条，`videos` 是项目里的视频 `[{id, title, latest}]`。 */
  function seed(dir, videos, k) {
    const path = (dir && dir.path) || '~/BaoCut/项目/';
    const base = {
      projectId: dir ? dir.id : 'd0', state: 'ready', gitVersion: GIT_VERSION, repoRoot: path, branch: 'main',
      autoCommit: false, lastCommit: null, lastError: null,
      /* 原型的簿记：每部视频提交到哪一版、本地过滤器的摘要与这台电脑允许过的摘要 */
      committed: Object.fromEntries((videos || []).map((v) => [v.id, Math.max(0, (v.latest || 0) - 2)])),
      seq: 0, allowed: null, outside: DEMO_OUTSIDE.slice(),
    };
    base.lastCommit = {commit: shortHash(0x9c2e4a1), at: 42, trigger: 'manual',
      videos: (videos || []).slice(0, 1).map((v) => ({videoId: v.id, from: Math.max(1, (v.latest || 0) - 5), to: Math.max(0, (v.latest || 0) - 2)}))};
    const st = Object.assign({}, base);
    const pause = (p) => Object.assign(st, {state: 'paused', pause: p});
    if (k === 'locked') {
      pause({reason: 'locked'});
      st.lastError = {message: '仓库正被占用（.git/index.lock），重试 5 次后推迟到下一次', at: 3};
    } else if (k === 'rebase') pause({reason: 'repo-state', repoState: 'rebase'});
    else if (k === 'detached') { pause({reason: 'repo-state', repoState: 'detached'}); st.branch = null; }
    else if (k === 'local-config' || k === 'local-config-changed') {
      pause({reason: 'local-config', localConfig: {entries: DEMO_ENTRIES.map((e) => Object.assign({}, e)), digest: 'sha256:5f1d…e08a', changed: k === 'local-config-changed'}});
    } else if (k === 'not-repo' || k === 'home' || k === 'user-folder' || k === 'volume-root') {
      Object.assign(st, {state: 'not-repo', repoRoot: undefined, branch: null, lastCommit: null,
        init: k === 'not-repo' ? {allowed: true} : {allowed: false, refusal: k}});
    } else if (k === 'unavailable') {
      Object.assign(st, {state: 'unavailable', gitVersion: null, repoRoot: undefined, branch: null, lastCommit: null});
    } else if (k === 'error') {
      Object.assign(st, {state: 'error', lastError: {message: 'fatal: detected dubious ownership in repository', at: 1}});
    }
    return withText(st);
  }

  /** 状态不是 ready 时给人看的原因与下一步（协议的 reason / remedy）。 */
  function withText(st) {
    const s = Object.assign({}, st);
    delete s.reason; delete s.remedy;
    if (s.state === 'paused' && s.pause) {
      const p = s.pause;
      if (p.reason === 'locked') {
        s.reason = '另一个程序（终端、编辑器的 git 插件）正在用这个仓库。';
        s.remedy = '等它用完，BaoCut 下一次会自己再试。BaoCut 从不删锁文件。';
      } else if (p.reason === 'repo-state') {
        const r = REPO_STATE[p.repoState] || REPO_STATE.merge;
        s.reason = p.repoState === 'detached' ? 'HEAD 处于分离状态，不在任何分支上。' : `仓库${r.label}。`;
        s.remedy = r.remedy;
      } else if (p.reason === 'local-config') {
        s.reason = p.localConfig && p.localConfig.changed
          ? '允许之后，仓库的本地过滤器或它引入的文件变了，要再看一遍。'
          : '仓库的本地配置里有要执行程序或引入别的文件的条目。BaoCut 运行 git 时会执行它们，所以先停下来等你确认。';
        s.remedy = '在桌面应用的项目设置里看过这些条目后点「允许」，或用 baocut projects git-allow。';
      }
    } else if (s.state === 'not-repo') {
      s.reason = '项目文件夹不在 git 仓库里。';
      s.remedy = s.init && s.init.allowed ? '需要的话可以在这里初始化 git。' : (INIT_REFUSAL[s.init && s.init.refusal] || '');
    } else if (s.state === 'unavailable') {
      s.reason = '这台电脑上没有找到能用的 git。';
      s.remedy = '装上 git 后重新打开项目（macOS 可以装 Xcode 命令行工具或 Homebrew 的 git，Windows 装 Git for Windows）。版本记录不需要 git，照常可用。';
    } else if (s.state === 'error') {
      s.reason = 'git 在这个仓库里运行失败：仓库的所有者不是当前用户，git 拒绝在这里运行。';
      s.remedy = '在终端里确认仓库的所有者，按 git 的提示处理后重新检查。';
    }
    return s;
  }

  /** 状态灯：S2 StatusLight 的 variant 与文字。 */
  function light(st) {
    if (st.state === 'ready') return {tone: 'positive', label: '正常'};
    if (st.state === 'paused') return {tone: 'notice', label: `已暂停 · ${pauseLabel(st.pause)}`};
    if (st.state === 'not-repo') return {tone: 'neutral', label: '不在 git 仓库里'};
    if (st.state === 'unavailable') return {tone: 'neutral', label: '没有找到 git'};
    return {tone: 'negative', label: 'git 运行失败'};
  }
  function pauseLabel(p) {
    if (!p) return '';
    if (p.reason === 'locked') return '仓库正被占用';
    if (p.reason === 'repo-state') return (REPO_STATE[p.repoState] || REPO_STATE.merge).label;
    return p.localConfig && p.localConfig.changed ? '本地过滤器变了' : '有本地过滤器';
  }

  /** 给 Web 的投影（§6 多端表「不显示本机路径」）：去掉仓库路径、过滤器条目与它们所在的文件、项目外素材的路径。 */
  function forWeb(st) {
    const s = Object.assign({}, st);
    delete s.repoRoot;
    if (s.pause && s.pause.localConfig) {
      const lc = Object.assign({}, s.pause.localConfig);
      delete lc.entries;
      s.pause = Object.assign({}, s.pause, {localConfig: lc});
    }
    s.outside = (st.outside || []).map((o) => ({video: o.video}));
    return s;
  }

  const canCommit = (st) => st.state === 'ready';

  /** 这次会提交哪些视频的哪些版本：上次提交之后有新版本的。 */
  function pending(st, videos) {
    return (videos || []).filter((v) => (v.latest || 0) > (st.committed[v.id] || 0))
      .map((v) => ({videoId: v.id, from: (st.committed[v.id] || 0) + 1, to: v.latest}));
  }

  /** 「提交到 git」（`projects.git.commit`）：先写快照，只提交 BaoCut 的路径。没有改动时 committed=false。 */
  function commit(st, videos, trigger) {
    if (st.state === 'paused') {
      const code = 'GIT_PAUSED';
      return {state: st, error: {code, message: `提交已暂停：${pauseLabel(st.pause)}。${st.remedy || ''}`}};
    }
    if (st.state === 'not-repo') return {state: st, error: {code: 'GIT_UNAVAILABLE', reason: 'not-repo', message: '项目不在 git 仓库里'}};
    if (st.state === 'unavailable') return {state: st, error: {code: 'GIT_UNAVAILABLE', reason: 'missing', message: '这台电脑上没有找到能用的 git'}};
    if (st.state === 'error') return {state: st, error: {code: 'GIT_FAILED', message: st.reason}};
    const vids = pending(st, videos);
    if (!vids.length) return {state: st, result: {committed: false, commit: null, files: 0, videos: []}};
    const s = Object.assign({}, st, {committed: Object.assign({}, st.committed), seq: st.seq + 1, lastError: null});
    vids.forEach((v) => { s.committed[v.videoId] = v.to; });
    const hash = shortHash(0x3f9c2a1 + s.seq * 0x10f3b7);
    const files = vids.length * 2 + 1;   // 每部视频的 video.json 与改过的文稿，加一个新素材
    s.lastCommit = {commit: hash, at: 0, trigger: trigger || 'manual', videos: vids};
    return {state: s, result: {committed: true, commit: hash, files, videos: vids}};
  }

  /** 「初始化 git」（`projects.git.init`）：只在项目文件夹里建仓库，不提交。拒绝名单见 INIT_REFUSAL。 */
  function init(st, dir) {
    if (st.state !== 'not-repo') return {state: st, error: {code: 'GIT_INIT_REFUSED', refusal: 'inside-repo', message: INIT_REFUSAL['inside-repo']}};
    if (!st.init || !st.init.allowed) return {state: st, error: {code: 'GIT_INIT_REFUSED', refusal: st.init && st.init.refusal, message: INIT_REFUSAL[st.init && st.init.refusal] || ''}};
    const s = withText(Object.assign({}, st, {state: 'ready', repoRoot: (dir && dir.path) || st.repoRoot, branch: 'main', init: undefined, lastCommit: null,
      committed: Object.fromEntries(Object.keys(st.committed).map((k) => [k, 0]))}));
    return {state: s};
  }

  /** 「允许」（`projects.git.allowLocalConfig`）：交回用户看过的那组条目的摘要；和此刻的不同时以 GIT_PAUSED 拒绝。 */
  function allow(st, digest) {
    const lc = st.pause && st.pause.reason === 'local-config' && st.pause.localConfig;
    if (!lc) return {state: st, noop: true};
    if (digest !== lc.digest) return {state: st, error: {code: 'GIT_PAUSED', message: '条目在你看过之后又变了，再看一遍'}};
    const s = withText(Object.assign({}, st, {state: 'ready', pause: undefined, allowed: lc.digest}));
    return {state: s};
  }

  /** 重新检查（界面按需读状态）：占用锁的程序用完了就恢复；别的暂停要用户自己在终端里处理完。 */
  function recheck(st) {
    if (st.state === 'paused' && st.pause && st.pause.reason === 'locked') return {state: withText(Object.assign({}, st, {state: 'ready', pause: undefined, lastError: null}))};
    return {state: st, same: true};
  }

  /** 提交结果的一句话。`names` 把视频 ID 换成标题。 */
  function commitText(result, names) {
    if (!result.committed) return '没有要提交的改动：BaoCut 的文件和上次提交时一样。';
    const vids = result.videos.map((v) => `「${(names && names[v.videoId]) || v.videoId}」${rangeText(v)}`).join('、');
    return `已提交 ${result.commit}：${result.files} 个文件，${vids}。`;
  }
  const rangeText = (v) => (v.from == null ? '' : v.from === v.to ? `版本 ${v.to}` : `版本 ${v.from}–${v.to}`);

  /** 最后一次提交的那一行：「上次提交 9c2e4a1 · 手动 · 42 分钟前」。 */
  function lastCommitText(lc, agoText) {
    if (!lc) return null;
    return `上次提交 ${lc.commit} · ${lc.trigger === 'auto' ? '自动' : '手动'} · ${agoText(lc.at)}`;
  }

  root.BC_PROJECT_GIT = {
    SCENARIOS, REPO_STATE, INIT_REFUSAL, DEMO_ENTRIES, DEMO_OUTSIDE,
    seed, withText, light, pauseLabel, forWeb, canCommit, pending, commit, init, allow, recheck, commitText, rangeText, lastCommitText,
  };
})();
