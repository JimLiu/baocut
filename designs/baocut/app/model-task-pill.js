/* 顶栏任务胶囊 ＋ 悬停详情卡（§8 顶栏任务胶囊）。纯模型：不碰 React、不碰 DOM。

   一条不变量：**胶囊上的「+N」与卡片里的行是同一张表**。胶囊念表头那一条，
   「+N」是表里其余的条数；卡片把整张表画出来（最多 CARD_MAX 行，余下一句「还有 N 个」）。
   三个表面（原型、App v2、Web）各有一份同形的挑选函数，规则逐条对齐：

   - 活着的任务 = 在跑（running）＋ 排队（queued）＋ 等人检查构图的智能裁剪（stage review）。
   - 编辑器里**这个项目的导出不进表**：顶栏「导出」按钮自己变成「导出中 · 31%」，胶囊再念一遍就重了。
   - 排序：正在看的那条任务详情（focusId）→ 这个项目的（后起的在前）→ 其余的（在跑的先于排队的，后起的在前）。
   - Web（`mineOnly`）只报这个项目的任务：跨项目的事 Web 不说（§22.4）。 */
(function () {
  const CARD_MAX = 5;

  function live(t) {
    if (!t) return false;
    if (t.status === 'running') return true;
    return t.status === 'queued';
  }
  const isReview = (t) => t.status === 'queued' && t.stage === 'review';
  const isQueued = (t) => t.status === 'queued' && !isReview(t);
  /* 演示数据没有 seq（按数组顺序），刚起的任务有 seq：后起的排前面 */
  const order = (t, i) => (t.seq == null ? i : 1e6 + t.seq);

  /** 胶囊与卡片共用的那张表。 */
  function pillList(tasks, opts) {
    const o = opts || {};
    const projectId = o.projectId || null;
    const rows = (tasks || []).map((t, i) => ({t, i})).filter(({t}) => live(t))
      .filter(({t}) => !(projectId && t.project === projectId && t.kind === 'export'))
      .filter(({t}) => !o.mineOnly || (projectId && t.project === projectId));
    const rank = ({t}) => {
      if (o.focusId && t.id === o.focusId) return 0;
      if (projectId && t.project === projectId) return 1;
      return isQueued(t) ? 3 : 2;
    };
    rows.sort((a, b) => rank(a) - rank(b) || order(b.t, b.i) - order(a.t, a.i));
    return rows.map(({t}) => t);
  }

  function kindLabel(t) {
    const L = (window.BC_EXPORT && window.BC_EXPORT.TASK_LABEL) || {};
    return L[t.kind] || '任务';
  }

  /** 右侧那一格：百分比 / 排队中 / 等你检查；不确定进度时为空。 */
  function stateText(t) {
    if (isReview(t)) return window.BC_EXPORT && window.BC_EXPORT.reviewLabel ? window.BC_EXPORT.reviewLabel(t.kind) : '等你检查';
    if (isQueued(t)) return '排队中';
    return t.pct == null ? '' : `${t.pct}%`;
  }

  /** 胶囊上的字：`导出 · 37%`。链接导入没有种类名，念它当前的阶段。 */
  function label(t) {
    if (!t) return '';
    const head = t.origin === 'url' ? (t.phase || '导入') : kindLabel(t);
    const tail = stateText(t);
    return tail ? `${head} · ${tail}` : head;
  }

  /** 胶囊的样子：表头那一条 ＋ 其余条数。 */
  function pill(list) {
    if (!list || !list.length) return null;
    return {head: list[0], label: label(list[0]), more: list.length - 1};
  }

  /** 卡片的一行。`progress`：数字 = 确定进度；'indet' = 转圈的进度条；null = 不画条（排队 / 等人检查）。 */
  function row(t, projectId) {
    const detail = [t.phase && t.origin !== 'url' ? t.phase : null, t.sub].filter(Boolean);
    const when = t.started ? (t.started === '刚刚' ? '刚开始' : `${t.started}开始`) : null;
    return {
      id: t.id,
      title: t.title || kindLabel(t),
      detail: detail.join(' · '),
      meta: [isQueued(t) ? null : when, projectId && t.project === projectId ? '这部视频' : null].filter(Boolean).join(' · '),
      state: stateText(t),
      progress: isQueued(t) || isReview(t) ? null : (t.pct == null ? 'indet' : t.pct),
      cancellable: !!t.cancellable,
    };
  }

  /** 整张卡：单条时是那一条的详情，多条时是计数头 ＋ 行表 ＋ 溢出一句。 */
  function card(list, projectId) {
    const all = list || [];
    const shown = all.slice(0, CARD_MAX).map((t) => row(t, projectId));
    return {
      multi: all.length > 1,
      title: all.length > 1 ? `${all.length} 个后台任务` : null,
      rows: shown,
      overflow: Math.max(0, all.length - CARD_MAX),
    };
  }

  Object.assign(window, {BC_TASKPILL: {CARD_MAX, pillList, label, pill, row, card, stateText}});
})();
