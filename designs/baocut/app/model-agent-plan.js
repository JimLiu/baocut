/* BaoCut 原型 — 批准方案（产品设计 §6.6「批准方案」）里「算出来的东西」：window.BC_AGENT_PLAN。
   无 React、无 DOM，node --test 直接 require。只在 App 入口加载。

   Agent 在「先给方案」里写完方案，停下来等你批准。卡片上选实施时的访问模式（默认「自动接受修改」），
   「按方案实施」把会话切过去接着做，「继续改方案」按未批准结束；直接在输入框发消息也算回复。
   决定之后卡片收成一行记录：已批准 · 按「<模式>」实施 / 未批准 / 已用消息回复 / 已停止。 */
(function () {
  /** 批准时默认切到的访问模式：修改自动接受，命令仍问。 */
  const DEFAULT_MODE = 'autoAcceptEdits';

  const STATE_LABELS = {declined: '未批准', byMessage: '已用消息回复', stopped: '已停止'};

  /** 方案的一行摘要：第一行非空文字，去掉标题的 #，过长截断。 */
  function summary(plan) {
    const line = String(plan || '').split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) || '';
    return line.length > 120 ? `${line.slice(0, 119)}…` : line;
  }

  /** 访问模式的名字（`modes` 是 data.js 的 agent.modes）。 */
  function modeName(modes, k) {
    const hit = (modes || []).find((m) => m.k === k);
    return hit ? hit.label : k;
  }

  /** 收起后那一行的状态词：批准的带上实施时切到的访问模式。 */
  function stateLabel(m, modes) {
    if (m && m.state === 'approved') return `已批准 · 按「${modeName(modes, m.mode || DEFAULT_MODE)}」实施`;
    return STATE_LABELS[m && m.state] || '';
  }

  /** 会话列表里最后一条是待批准的方案时的摘要。 */
  function pendingSummary(m) {
    return `等你批准 · ${summary(m && m.plan) || '方案'}`;
  }

  window.BC_AGENT_PLAN = {DEFAULT_MODE, summary, modeName, stateLabel, pendingSummary};
})();
