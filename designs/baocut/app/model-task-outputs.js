/* 任务详情里工具运行的产物与操作（product-design §2.7「进度与失败」「结果与下一步」）—— window.BC_TASK_OUTPUTS。
   纯函数，无 React、无 DOM；只在 App 入口加载。

   任务记录读这几个字段（工具页写入）：
   - `outputs`：产物的 Space 条目 id 列表；`saveDir`：这次运行冻结的保存位置（architecture §7.9「保存位置」）；
   - `toolId`（或字符串形的 `tool`）：哪个工具；`params`：开始时的参数，「重试 / 再做一次」带回工具页；
   - `runId`：固定流程的运行（tool-runs.jsx）。这种任务的步骤与「从那一步重试」由工具页的任务面板（ToolTaskPanel）画，这里不再给重试；
     生成语音、生成图片、文本生成这类直接任务没有 `runId`，重试回到参数已填好的工具页。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /* 直接任务的 kind → 工具 id（早先的直接任务没记 `toolId`） */
  const DIRECT = {tts: 'tts', image: 'image', write: 'text'};

  /* 没记 `toolId` 时按 kind 推断只认工具页的直接任务：Agent、命令行发起的（「再做一次」属于会话），
     以及项目里编辑器面板发起的（带 `project`，如配音面板的生成语音）都不回工具页 */
  const NOT_TOOL_SOURCE = new Set(['agent', 'cli']);

  /** 这条任务是哪个工具跑的；不是工具的任务返回 null。 */
  function toolIdOf(task) {
    if (!task) return null;
    if (task.toolId) return task.toolId;
    if (typeof task.tool === 'string') return task.tool;
    if (NOT_TOOL_SOURCE.has(task.source) || task.project) return null;
    return DIRECT[task.kind] || null;
  }

  /* `outputs` 里只有字符串是 Space 条目 id；生成语音、生成图片的旧任务记的是候选对象（任务页另有画法），这里不认 */
  const outputIds = (task) => (task && Array.isArray(task.outputs) ? task.outputs.filter((id) => typeof id === 'string') : []);

  /** 产物块要不要出：记了 Space 产物或保存位置的才出。 */
  const hasBlock = (task) => !!task && (outputIds(task).length > 0 || !!task.saveDir);

  /**
   * 产物列表：`outputs` 里的 id → Space 条目。已经不在 Space 里的（任务修剪、被清掉）记为 `gone`，名字留空，
   * 视图说明它不在了，不给操作。
   */
  function resolve(task, spaceItems) {
    const ids = outputIds(task);
    const by = new Map((spaceItems || []).map((it) => [it.id, it]));
    return ids.map((id) => ({id, entry: by.get(id) || null, gone: !by.has(id)}));
  }

  /**
   * 一个产物能做的事（§2.7「结果与下一步」）：在 Space 中查看、在文件夹中显示、交给 Agent。
   * 回收站里的只能查看（交给 Agent 要先恢复，§4.7）；缺失的文件不能「在文件夹中显示」；生成中的都还不行。
   */
  function entryActions(entry) {
    if (!entry) return {view: false, reveal: false, handover: false};
    const pending = entry.status === 'generating';
    return {
      view: true,
      reveal: !pending && entry.status !== 'missing' && !entry.trashed,
      handover: !pending && !entry.trashed,
    };
  }

  /**
   * 任务级的「重试 / 再做一次」：直接任务回到参数已填好的工具页（`openToolWith(toolId, preset)`）。
   * 固定流程（有 `runId`）不给——它的重试在步骤面板里，从失败的那一步继续。还在跑、排队的不给。
   */
  function retry(task) {
    const id = toolIdOf(task);
    if (!id || task.runId) return null;
    if (task.status === 'running' || task.status === 'queued') return null;
    const T = root.BC_TOOLS;
    if (T && typeof T.toolById === 'function' && !T.toolById(id)) return null;
    return {
      toolId: id,
      label: task.status === 'error' ? '重试' : '再做一次',
      preset: {entry: null, rerun: true, params: task.params || null},
    };
  }

  const api = {DIRECT, toolIdOf, hasBlock, resolve, entryActions, retry};
  root.BC_TASK_OUTPUTS = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
