/* BaoCut 原型 — 智能体的待办清单（产品设计 §3.2.3「智能体的待办」）里「算出来的东西」：window.BC_AGENT_TODO。
   无 React、无 DOM，node --test 直接 require。只在 App 入口加载。

   智能体自己列的步骤清单（Claude Code 的待办、Codex 的计划步骤等），每次整份替换。只在会话还在跑时
   显示在输入框上方；收起时一行「已完成 / 总数 · 正在做的」，展开是整份清单。 */
(function () {
  /** 停靠条显示的条件：会话在跑，清单不空。 */
  function visible(sess) {
    return !!(sess && sess.status === 'running' && Array.isArray(sess.todo) && sess.todo.length);
  }

  /** 已完成数与总数。 */
  function progress(todo) {
    const items = todo || [];
    return {done: items.filter((t) => t.status === 'completed').length, total: items.length};
  }

  /** 正在做的那一条：进行中的说法 → 进行中的原话 → 下一条待做；都没有（全做完）时空串。 */
  function current(todo) {
    const items = todo || [];
    const doing = items.find((t) => t.status === 'inProgress');
    if (doing) return doing.activeForm || doing.text;
    const next = items.find((t) => t.status === 'pending');
    return next ? next.text : '';
  }

  /** 收起时的一行。 */
  function line(todo) {
    const {done, total} = progress(todo);
    const cur = current(todo);
    return cur ? `${done}/${total} · ${cur}` : `${done}/${total}`;
  }

  /** 每一项的状态词（读屏用）。 */
  const STATUS_LABELS = {completed: '已完成', inProgress: '进行中', pending: '待做'};

  window.BC_AGENT_TODO = {visible, progress, current, line, STATUS_LABELS};
})();
