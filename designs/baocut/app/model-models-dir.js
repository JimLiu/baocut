/* 设置 › 本地模型 › 模型目录的纯模型 —— architecture-design §6.3（本地模型管理）、§5.10（设置键）。
   目录由三个来源决定，优先级：环境变量 BAOCUT_MODELS_DIR（只读锁定）> 设置里选的文件夹 > 默认 `<BAOCUT_HOME>/models`。
   这里只放判断：生效目录、长路径的中间省略、选定文件夹的检查（不存在 / 不可写 / 里面已有的模型）、
   更改时有哪几个分支、移动是否放得下、哪些任务让更改暂时不可用，以及下载确认框里「存放位置」的判断（只为一次下载换文件夹）。
   体积一律 MB（与 BC_LOCALMODELS.mb 一致）。
   不碰 React、不碰 DOM。演示用的「系统文件夹选择器」里的几个文件夹也在这里（原型没有真文件系统）。 */
(function () {
  const DEFAULT_DIR = '~/Library/Application Support/BaoCut/models';
  const ENV_NAME = 'BAOCUT_MODELS_DIR';
  const GB = 1024;

  /* 原型里「选文件夹」的候选：每个文件夹的盘上状态都是演示数据。`models` 是里面带清单、能被认出的模型 id（按 data.js setModels）。
     `freeMB` 是所在磁盘的可用空间。 */
  const FOLDERS = [
    {path: '/Volumes/ExtremeSSD/BaoCut/models', note: '外置盘 ExtremeSSD', exists: true, writable: true, freeMB: 812 * GB,
     models: ['qwen3-asr-0.6b', 'qwen3-tts-0.6b-base', 'htdemucs-ft']},
    {path: '/Volumes/Backup/BaoCut/models', note: '外置盘 Backup · 空间很小', exists: true, writable: true, freeMB: 3.4 * GB, models: []},
    {path: '~/Models/Shared', note: '和别的程序共用', exists: true, writable: true, freeMB: 412 * GB,
     models: ['qwen3-asr-1.7b', 'whisper-turbo']},
    {path: '/Volumes/Archive/models', note: '只读的磁盘', exists: true, writable: false, freeMB: 96 * GB, models: []},
    {path: '/Volumes/OldDisk/models', note: '上次用的外置盘', exists: false, writable: false, freeMB: 0, models: []},
  ];
  /* 默认位置 <BAOCUT_HOME>/models：现在装着的就是演示数据里 installed 的那几只（不含随包附带的） */
  const HOME = {path: DEFAULT_DIR, note: '默认位置 · 本机硬盘', exists: true, writable: true, freeMB: 412 * GB,
    models: ['moss-transcribe', 'qwen3-asr-0.6b', 'whisper-large-v3', 'qwen3-tts-1.7b-customvoice', 'qwen3-tts-0.6b-base']};
  /** 某个路径所在磁盘的可用空间；不认识的路径按默认位置那块盘算 */
  const freeOf = (path) => (path === DEFAULT_DIR ? HOME : (FOLDERS.find((f) => f.path === path) || HOME)).freeMB;

  /* 随安装包附带的小模型（data.js 里「人物定位」）不在模型目录里，不计入已用空间与模型数 */
  const BUNDLED = ['vision-person'];
  /** 模型目录里已装的模型：`on` 是 BC_LOCALMODELS 的安装表；原地引用的本机文件（`inPlace`，settings-add-model.jsx）不在目录里 */
  const installedIn = (models, on) => (models || []).filter((m) => on[m.id] && BUNDLED.indexOf(m.id) < 0 && !m.inPlace);

  /** 去掉附带模型的安装表，给 BC_LOCALMODELS.disk 算目录里的已用空间 */
  const withoutBundled = (on) => { const t = Object.assign({}, on); BUNDLED.forEach((id) => { t[id] = false; }); return t; };

  /** 生效的目录：env > 设置 > 默认。`locked` 时界面只读 */
  function effective(env, pref) {
    if (env) return {path: env, source: 'env', locked: true};
    if (pref && pref !== DEFAULT_DIR) return {path: pref, source: 'custom', locked: false};
    return {path: DEFAULT_DIR, source: 'default', locked: false};
  }
  const isDefault = (path) => !path || path === DEFAULT_DIR;

  /** 长路径中间省略：保留开头 head 段与结尾 tail 段，装不下再减；永远不省掉最后一段 */
  function shorten(path, max) {
    const limit = max || 44;
    if (!path || path.length <= limit) return path || '';
    const parts = path.split('/');
    const lead = parts[0] === '' ? '/' : '';        // 绝对路径以 / 开头
    const segs = parts.filter((s) => s !== '');
    for (let head = Math.min(2, segs.length - 1); head >= 0; head -= 1) {
      for (let tail = Math.min(2, segs.length - head); tail >= 1; tail -= 1) {
        if (head + tail >= segs.length) continue;
        const s = lead + segs.slice(0, head).join('/') + (head ? '/' : '') + '…/' + segs.slice(segs.length - tail).join('/');
        if (s.length <= limit) return s;
      }
    }
    const last = segs[segs.length - 1];
    return '…/' + (last.length > limit - 2 ? last.slice(0, limit - 3) + '…' : last);
  }

  /* 体积文字（与 BC_LOCALMODELS.mb 同一写法；这里不依赖它，纯模型各自独立可测） */
  const size = (n) => (n >= GB ? (n / GB).toFixed(1) + ' GB' : (Math.ceil(n * 10) / 10) + ' MB');

  const findFolder =(path) => (path === DEFAULT_DIR ? HOME : FOLDERS.find((f) => f.path === path) || null);

  /** 选定文件夹的问题；null 表示可用。如实说明，不吞掉 */
  function problem(folder) {
    if (!folder) return {code: 'missing', text: '没有选择文件夹。'};
    if (!folder.exists) return {code: 'missing', text: '这个文件夹不存在。外置盘没有接上时也会这样，接好后再选一次。'};
    if (!folder.writable) return {code: 'readonly', text: 'BaoCut 没有这个文件夹的写入权限，模型下载不进去。换一个可写的位置，或先改它的权限。'};
    return null;
  }

  /** 被选文件夹里能认出的模型：id → models 条目，加上合计体积 */
  function found(folder, models) {
    const list = ((folder && folder.models) || []).map((id) => models.find((m) => m.id === id)).filter(Boolean);
    return {list, count: list.length, sizeMB: list.reduce((n, m) => n + m.size, 0)};
  }

  /** 目标盘放不放得下要移过去的模型：目标里已有的同名模型不重复计 */
  function moveCheck(moveMB, folder, alreadyMB) {
    const need = Math.max(0, moveMB - (alreadyMB || 0));
    const free = folder ? folder.freeMB : 0;
    return {need, free, ok: need <= free, short: Math.max(0, need - free)};
  }

  /**
   * 更改确认的分支。`current` 是当前目录里已装模型的合计（MB，0 表示没有）。
   * - 选定文件夹有问题 → kind 'error'，不能继续
   * - 当前目录没有已装模型 → 'direct'：只告诉发现了几个，直接切换
   * - 否则 'choose'：给「移过去」与「只切换位置」两个选择；放不下时 move.disabled
   */
  function plan(folder, models, currentMB, currentIds) {
    const bad = problem(folder);
    if (bad) return {kind: 'error', error: bad};
    const f = found(folder, models);
    const mine = (currentIds || []);
    // 目标里已经有的，移动时不用再搬
    const dupMB = f.list.filter((m) => mine.indexOf(m.id) >= 0).reduce((n, m) => n + m.size, 0);
    const moveMB = currentMB;
    const check = moveCheck(moveMB, folder, dupMB);
    if (!(currentMB > 0)) return {kind: 'direct', found: f, free: folder.freeMB};
    return {kind: 'choose', found: f, free: folder.freeMB, moveMB, check,
      move: {disabled: !check.ok, why: check.ok ? '' : `要移动 ${size(moveMB)}，目标盘只有 ${size(folder.freeMB)} 可用，还差 ${size(check.short)}，放不下。`}};
  }

  /**
   * 更改之后的已装模型集合（模型 id 列表）：
   * - move：现有的 + 目标里已有的（同名合并）
   * - switch / direct：只剩目标里认得出的；原位置的文件保留在原处，这里不动
   */
  function installedAfter(mode, currentIds, folder) {
    const there = (folder && folder.models) || [];
    if (mode === 'move') return Array.from(new Set((currentIds || []).concat(there)));
    return there.slice();
  }

  /** 哪些任务在用本地模型（排队或进行中）。`tasks` 是 app.tasks */
  const usesLocalModel = (t) => (t.status === 'running' || t.status === 'queued')
    && ['transcribe', 'tts', 'dub', 'separate'].indexOf(t.kind) >= 0 && /本机/.test(t.sub || '');

  /**
   * 现在能不能更改。返回 null 或 {text, taskIds}。
   * `busy` 是页面里的即时状态：{downloading: [模型名], testing: [模型名]}（下载 / 检查 / 修复都只在设置页内发生）。
   */
  function blocker(tasks, busy) {
    const b = busy || {};
    const running = (tasks || []).filter(usesLocalModel);
    const parts = [];
    if ((b.downloading || []).length) parts.push(`正在下载 ${b.downloading.join('、')}`);
    if ((b.testing || []).length) parts.push(`正在检查 ${b.testing.join('、')}`);
    if (running.length) parts.push(`${running.length} 个任务在用本地模型`);
    if (!parts.length) return null;
    return {text: parts.join('，') + '。等它们结束后再更改，否则文件会在使用中被搬走。', taskIds: running.map((t) => t.id), hasTasks: running.length > 0};
  }

  /** 卡片副题：已用 · 可用 · 已识别 N 个模型 */
  function stats({usedMB, freeMB, count, mb}) {
    return [`已用 ${mb(usedMB)}`, `所在磁盘可用 ${mb(freeMB)}`, `已识别 ${count} 个模型`];
  }

  /** 目录来源的一句话说明 */
  function sourceNote(source) {
    if (source === 'env') return `由环境变量 ${ENV_NAME} 指定，要改请改环境变量并重启 BaoCut。`;
    return '';
  }

  const SHARE_HINT = '多个程序共用同一个文件夹时，在这里删除模型会删掉文件夹里的文件，别的程序也会找不到它。';

  /* ---- 下载确认框的「存放位置」（2026-10-15 设计稿，待确认）：默认放进模型目录，也可以只为这一次下载换一个文件夹，
     模型目录本身不变。只管模型仓库下的部分；工具与运行库装在 Runtime Home 的工具目录，不随它变。
     `places` 是 id → 下载时选的别处文件夹（模型与组件都记；放进模型目录的不记）。 ---- */

  /** 某个路径的盘上状态：演示文件夹里没有的（环境变量给的、默认位置）按可写、默认那块盘算 */
  const folderAt = (path) => findFolder(path) || {path, exists: true, writable: true, freeMB: HOME.freeMB, models: []};

  /**
   * 这次下载放在哪。`current` 是生效的模型目录（effective().path），`pick` 是框里选的文件夹。
   * 环境变量锁住时只能放进它指定的目录；没选或选的就是模型目录时 source 'default'；否则 'picked'。
   */
  function downloadTarget(env, current, pick) {
    if (env) return {path: env, source: 'env', locked: true};
    const dir = current || DEFAULT_DIR;
    if (pick && pick !== dir) return {path: pick, source: 'picked', locked: false};
    return {path: dir, source: 'default', locked: false};
  }

  /** 原型里「更改…」的候选（产品里是系统的文件夹面板）：模型目录排第一，再是演示文件夹 */
  function targetChoices(current) {
    const dir = current || DEFAULT_DIR;
    const rest = FOLDERS.concat([HOME]).filter((f) => f.path !== dir);
    return [Object.assign({}, folderAt(dir), {note: '模型目录'})].concat(rest);
  }

  /** 这次能不能放进去：文件夹的问题，或这一次要下的（`needMB`，只算模型仓库的部分）放不下；null 表示可以 */
  function targetProblem(path, needMB) {
    const folder = folderAt(path);
    const bad = problem(folder);
    if (bad) return bad;
    if (needMB > folder.freeMB) {
      return {code: 'space', text: `这次要下载 ${size(needMB)}，这个磁盘只有 ${size(folder.freeMB)} 可用，还差 ${size(needMB - folder.freeMB)}，放不下。`};
    }
    return null;
  }

  /** 位置下面的说明：选了别处时说只管这一次；这次还要下工具与运行库时说它们不放这里；环境变量锁住时说怎么改 */
  function targetNotes(target, hasTools) {
    const notes = [];
    if (target.source === 'env') notes.push(sourceNote('env'));
    if (target.source === 'picked') notes.push('只用于这次下载，模型目录不变。');
    if (hasTools) notes.push('工具与运行库装在 BaoCut 的工具目录，不放在这里。');
    return notes;
  }

  /** 下载完后记下各部分在哪：选了别处的记路径，放进模型目录的抹掉旧记录 */
  function placeAfter(places, ids, target) {
    const next = Object.assign({}, places);
    (ids || []).forEach((id) => { if (target.source === 'picked') next[id] = target.path; else delete next[id]; });
    return next;
  }

  /** 装着、但不在模型目录 `dir` 里的 id（模型与组件） */
  const awayIds = (on, places, dir) => Object.keys(places || {}).filter((id) => on[id] && places[id] !== dir);

  /** 不在模型目录里的模型按文件夹分组（附带模型不算）：卡片上那一句与模型行上的位置都从这里来 */
  function elsewhere(models, on, places, dir) {
    const ids = awayIds(on, places, dir);
    const groups = [];
    (models || []).forEach((m) => {
      if (ids.indexOf(m.id) < 0 || BUNDLED.indexOf(m.id) >= 0) return;
      let g = groups.find((x) => x.path === places[m.id]);
      if (!g) { g = {path: places[m.id], list: []}; groups.push(g); }
      g.list.push(m);
    });
    return groups;
  }

  /** 卡片上那一句：另有几个模型在别处、各在哪；更改模型目录时它们不跟着动 */
  function elsewhereNote(groups) {
    const n = groups.reduce((k, g) => k + g.list.length, 0);
    if (!n) return '';
    const where = groups.map((g) => `${g.list.map((m) => m.name).join('、')}（${shorten(g.path, 36)}）`).join('；');
    return `另有 ${n} 个模型存放在其他位置：${where}。更改模型目录时${n === 1 ? '它' : '它们'}不跟着移动。`;
  }

  /** 卡片只管模型目录里的：先把别处的从安装表里拿掉，写回时再按原表放回 */
  const withoutIds = (on, ids) => { const t = Object.assign({}, on); ids.forEach((id) => { t[id] = false; }); return t; };
  const keepIds = (next, from, ids) => { const t = Object.assign({}, next); ids.forEach((id) => { t[id] = !!from[id]; }); return t; };

  const BC_MODELSDIR = {DEFAULT_DIR, ENV_NAME, BUNDLED, installedIn, withoutBundled, FOLDERS, HOME, freeOf, SHARE_HINT, effective, isDefault, shorten, findFolder,
    problem, found, moveCheck, plan, installedAfter, usesLocalModel, blocker, stats, sourceNote,
    folderAt, downloadTarget, targetChoices, targetProblem, targetNotes, placeAfter, awayIds, elsewhere, elsewhereNote, withoutIds, keepIds};
  if (typeof window !== 'undefined') Object.assign(window, {BC_MODELSDIR});
  if (typeof module !== 'undefined') module.exports = BC_MODELSDIR;
})();
