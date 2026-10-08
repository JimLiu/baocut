/* Space 条目与工具、会话之间的路（product-design §4.5、§4.7、§2.7「结果与下一步」）—— window.BC_SPACE_TOOLS。
   纯函数，无 React、无 DOM；只在 App 入口加载。其他 `window.BC_*` 一律在调用时读，不在加载时读。

   这里算：
   - 「用工具处理…」列哪些工具（`toolsFor`）：以工具页的输入模型（BC_TOOL_SPACE_INPUT）为准，没有时按条目种类给一份最简映射；
   - 工具生成的条目由哪个工具、哪条任务做出来（`origin`），「再做一次」带回哪些参数；
   - 「在会话中继续 / 交给 Agent」落到哪条会话（`pickSession`，§4.7 的三种情况）。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /* 工具页的输入模型还没给出时的退路：按条目种类，列收它的工具（§2.7「输入与落点」表）。
     视频 = 可编辑的视频；成片 = 视频文件；图片目前没有收它的工具。 */
  const BY_KIND = {
    movie: ['transcribe', 'translate', 'dub'],
    final: ['transcribe', 'compress', 'merge', 'extract'],
    audio: ['transcribe'],
    subtitle: ['translate', 'tts', 'text'],
    doc: ['tts', 'text'],
    image: [],
    template: [],
  };

  const catalog = () => (root.BC_TOOLS && root.BC_TOOLS.TOOLS) || [];
  const byId = (id) => catalog().find((t) => t.id === id) || null;

  /** 按种类的最简映射：只留目录里有、不是「即将推出」的工具。 */
  function fallbackTools(entry, tools) {
    if (!entry) return [];
    const list = tools || catalog();
    return (BY_KIND[entry.kind] || []).map((id) => list.find((t) => t.id === id)).filter((t) => t && !t.planned);
  }

  /** 「用工具处理…」的菜单项。回收站里的条目不列（要先恢复）。 */
  function toolsFor(entry) {
    if (!entry || entry.trashed) return [];
    const input = root.BC_TOOL_SPACE_INPUT;
    if (input && typeof input.toolsFor === 'function') return input.toolsFor(entry) || [];
    return fallbackTools(entry);
  }

  /** 生成它的工具 id：条目自己记的 `toolId`（或字符串形的 `tool`），否则看它的任务记录。 */
  function toolIdOf(entry, tasks) {
    if (!entry) return null;
    if (entry.toolId) return entry.toolId;
    if (typeof entry.tool === 'string') return entry.tool;
    const t = entry.task ? (tasks || []).find((x) => x.id === entry.task) : null;
    if (t && (t.toolId || typeof t.tool === 'string')) return t.toolId || t.tool;
    return null;
  }

  /** 是不是工具生成的条目（§2.7：工具的结果是 Space 条目）。 */
  const isToolEntry = (entry, tasks) => !!entry && (entry.tool === true || !!toolIdOf(entry, tasks));

  /**
   * 来源那一行（§4.5「查看来源会话或任务」）：生成它的工具与任务，以及「再做一次」的预设。
   * 返回 null = 不是工具生成的。`rerun` 为 null 时没有可回去的工具页（只知道是工具做的，不知道是哪一个）。
   */
  function origin(entry, tasks) {
    if (!isToolEntry(entry, tasks)) return null;
    const id = toolIdOf(entry, tasks);
    const tool = id ? byId(id) : null;
    const task = entry.task ? (tasks || []).find((x) => x.id === entry.task) || null : null;
    const params = entry.params || (task && task.params) || null;
    return {
      toolId: tool ? tool.id : null,
      toolName: tool ? tool.name : null,
      taskId: task ? task.id : null,
      rerun: tool && !entry.trashed ? {entry, rerun: true, params} : null,
    };
  }

  /**
   * 「在会话中继续 / 交给 Agent」落到哪条会话（§4.7「不指定会话时」）：
   * - 回收站里的条目先恢复：`{kind: 'blocked', reason: 'trashed'}`；
   * - 属于项目：在那个项目里新建一条会话，不猜该接哪一条：`{kind: 'new', dir}`（视频条目另带 `project` = 视频本身）；
   * - 不属于项目、产生它的会话还在：回到那条：`{kind: 'existing', id}`；
   * - 都没有：新建一条无项目的会话：`{kind: 'new', dir: null}`。
   */
  function pickSession(entry, sessions) {
    if (!entry) return null;
    if (entry.trashed) return {kind: 'blocked', reason: 'trashed'};
    if (entry.dir) return {kind: 'new', dir: entry.dir, project: entry.kind === 'movie' ? entry.id : null};
    const live = entry.session ? (sessions || []).find((s) => s.id === entry.session) : null;
    if (live) return {kind: 'existing', id: live.id};
    return {kind: 'new', dir: null, project: null};
  }

  /**
   * 工具结果在保存位置里时的「位置」（§2.7「页面」第 4 条）：文件所在目录、显示名、是不是设置里的默认保存位置。
   * 只认绝对路径（`/…`、`~/…`）；项目里的相对路径返回 null。
   */
  function location(entry, prefs) {
    const SAVE = root.BC_SAVE_DIR;
    const file = entry && typeof entry.file === 'string' ? entry.file : '';
    if (!SAVE || !/^[/~]/.test(file) || entry.kind === 'movie') return null;
    const fold = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~').replace(/\/+$/, '');
    const dir = fold(file.replace(/\/[^/]*\/?$/, '')) || '/';
    return {dir, label: SAVE.label(dir), isSaveDir: dir === fold(SAVE.setting(prefs))};
  }

  const api = {BY_KIND, fallbackTools, toolsFor, toolIdOf, isToolEntry, origin, pickSession, location};
  root.BC_SPACE_TOOLS = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
