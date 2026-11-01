/* BaoCut 原型 — Bot 模式：频道、任务与时间线的纯函数和演示数据（docs/design/bot-mode/bot-mode-requirements.md §11）
   window.BC_BOT。无 React、无 DOM；只在 App 入口加载（Web 没有 Bot）。

   分组、排序与状态对照照 packages/ui 的 model/bot.ts 与 work-item-status.ts 抄：原型和实现读同一份规则。
   任务的形状是 WorkItem 的简化：
     {id, channelId, title, status: 'suggested'|'upNext'|'scheduled'|'active'|'resolved', owner: 'user'|'agent',
      active?: {state, reason?}, resolution?: {kind: 'done'|'dismissed'|'merged', at}, priority, dueOn?, startAt?, updatedAt,
      description?, outcome?, question?: {text, options: [{label, description?}], pick?}, steps: [{text, state}],
      finishedSteps: [{text, result?, at}], outputs: [{kind, label}], updates: [{text, by, at}], suggestion?: {reason}, thread?}
   频道时间线的条目：{kind: 'message', role, text, at} / {kind: 'work-item-ref', workItemId} /
     {kind: 'relay', direction, text, workItemId?, cited: [{author, text}]}；最后一条智能体消息可以带 chips（输入框上方的提示芯片）。 */
(function () {
  /** 任务状态的唯一对照表（需求 §11.5）：图标、色调、文字；状态从不只靠颜色。working 画转圈，没有图标。 */
  const STATUS = {
    suggested:       {icon: 'Lightbulb',       tone: 'neutral',   label: '建议'},
    upNext:          {icon: 'Circle',          tone: 'neutral',   label: '接下来'},
    scheduled:       {icon: 'Calendar',        tone: 'neutral',   label: '定时'},
    working:         {icon: null,              tone: 'neutral',   label: '工作中'},
    needsReview:     {icon: 'Visibility',      tone: 'attention', label: '待你审阅', badge: true},
    needsInput:      {icon: 'HelpCircle',      tone: 'attention', label: '需要你输入', badge: true},
    blocked:         {icon: 'StopProcessing',  tone: 'negative',  label: '已停下'},
    waitingOnOthers: {icon: 'Clock',           tone: 'neutral',   label: '等别人'},
    done:            {icon: 'CheckmarkCircle', tone: 'positive',  label: '已完成'},
    dismissed:       {icon: 'RemoveCircle',    tone: 'neutral',   label: '已放弃', strike: true},
    merged:          {icon: 'RemoveCircle',    tone: 'neutral',   label: '已合并', strike: true},
  };

  /** 运行记录行的种类（技术方案 §4.3）。 */
  const RELAY = {report: '报告', brief: '简报', relay: '转交', refresh: '刷新', schedule: '定时运行', make: '建议', moved: '已移动'};

  /** 界面上的状态键：进行中按子状态，已解决按结局。 */
  function statusKey(item) {
    if (item.status === 'active') return (item.active && item.active.state) || 'working';
    if (item.status === 'resolved') return (item.resolution && item.resolution.kind) || 'done';
    return item.status;
  }
  const statusOf = item => ({key: statusKey(item), ...STATUS[statusKey(item)]});
  /** 等你：待你审阅或需要你输入。 */
  const needsUser = item => item.status === 'active' && !!item.active && (item.active.state === 'needsReview' || item.active.state === 'needsInput');

  /** 任务的「下一步」一行：问题 → 进行中的原因 → 当前步骤 → 结论 → 描述。 */
  function nextLine(item) {
    if (item.question) return item.question.text;
    if (item.status === 'active' && item.active && item.active.reason) return item.active.reason;
    const steps = item.steps || [];
    const step = steps.find(s => s.state === 'active') || steps[0];
    if (step) return step.text;
    if (item.status === 'resolved' && item.outcome) return item.outcome;
    return item.description || null;
  }

  // ---- 频道 ----

  /** 频道摘要：等你的任务数从任务算（需求 §11.2）。 */
  function channelSummaries(channels, items) {
    return channels.map(channel => ({
      channel,
      unread: !!channel.unread,
      counts: {needsYou: items.filter(i => i.channelId === channel.id && needsUser(i)).length},
    }));
  }
  /** Rail 上 Bot 的徽标：全部频道（含静音、归档）里等你的任务数。 */
  const needsYouTotal = rows => rows.reduce((sum, row) => sum + Math.max(0, row.counts.needsYou), 0);
  const byActivity = (a, b) => b.channel.lastActivityAt - a.channel.lastActivityAt;
  /** 频道侧栏：主频道、置顶、其余按最近活动；归档的收进底部的折叠组。 */
  function channelGroups(rows) {
    const live = rows.filter(r => !r.channel.archived);
    return {
      active: [
        ...live.filter(r => r.channel.kind === 'main'),
        ...live.filter(r => r.channel.kind !== 'main' && r.channel.pinned).sort(byActivity),
        ...live.filter(r => r.channel.kind !== 'main' && !r.channel.pinned).sort(byActivity),
      ],
      archived: rows.filter(r => r.channel.archived).sort(byActivity),
    };
  }

  // ---- 任务面板 ----

  const PRIORITY_RANK = {high: 0, medium: 1, low: 2};
  /** 进行中段内的顺序（需求 §11.5）：待你审阅 → 需要你输入 → 已停下 → 工作中 → 等别人。 */
  const ACTIVE_RANK = {needsReview: 0, needsInput: 1, blocked: 2, working: 3, waitingOnOthers: 4};
  const RESOLVED_DAYS = 30;
  const RESOLVED_TAIL = 20;
  const SUGGESTIONS_MAX = 3;

  /** 同组内按优先级、截止日（没有的在后）、最近更新排。 */
  function compareWorkItems(a, b) {
    const rank = PRIORITY_RANK[a.priority || 'medium'] - PRIORITY_RANK[b.priority || 'medium'];
    if (rank) return rank;
    if ((a.dueOn || null) !== (b.dueOn || null)) {
      if (!a.dueOn) return 1;
      if (!b.dueOn) return -1;
      return a.dueOn.localeCompare(b.dueOn);
    }
    return b.updatedAt - a.updatedAt;
  }
  const activeState = item => (item.active && item.active.state) || 'working';
  const compareActive = (a, b) => ACTIVE_RANK[activeState(a)] - ACTIVE_RANK[activeState(b)] || compareWorkItems(a, b);
  const resolvedAt = item => (item.resolution && item.resolution.at) || item.updatedAt;

  function matchesFilter(item, filter) {
    if (filter === 'mine') return item.owner === 'user';
    if (filter === 'agent') return item.owner === 'agent';
    return true;
  }

  /** 任务面板的四个页签（需求 §11.5）；建议不在页签里，另放在页签上方。 */
  const TASK_TABS = ['active', 'upNext', 'scheduled', 'resolved'];
  const TAB_LABEL = {active: '进行中', upNext: '接下来', scheduled: '定时', resolved: '已解决'};
  /** 一条任务落在哪个页签；建议不落在任何页签。 */
  const tabOf = item => (item.status === 'suggested' ? null : item.status);

  /**
   * 任务面板的四个页签（需求 §11.5）：进行中（按子状态分组：待你审阅 → 需要你输入 → 已停下 → 工作中 → 等别人，空组不列）、
   * 接下来、定时（按开始时刻）、已解决（最近 20 条、30 天内）；建议另放，最多 3 条。
   */
  function taskSections(items, filter, now, showAllDone) {
    const shown = items.filter(i => matchesFilter(i, filter));
    const active = [];
    for (const item of shown.filter(i => i.status === 'active').sort(compareActive)) {
      const state = activeState(item);
      const group = active[active.length - 1];
      if (group && group.state === state) group.items.push(item);
      else active.push({state, items: [item]});
    }
    const cutoff = now - RESOLVED_DAYS * 86400000;
    const resolved = shown.filter(i => i.status === 'resolved').sort((a, b) => resolvedAt(b) - resolvedAt(a));
    const recent = showAllDone ? resolved : resolved.filter(i => resolvedAt(i) >= cutoff).slice(0, RESOLVED_TAIL);
    return {
      suggested: shown.filter(i => i.status === 'suggested').sort(compareWorkItems).slice(0, SUGGESTIONS_MAX),
      active,
      upNext: shown.filter(i => i.status === 'upNext').sort(compareWorkItems),
      scheduled: shown.filter(i => i.status === 'scheduled').sort((a, b) => (a.startAt || 0) - (b.startAt || 0) || compareWorkItems(a, b)),
      done: recent,
      moreDone: resolved.length - recent.length,
    };
  }

  /** 页签上的条数；已解决只列一段，不计数。 */
  function tabCounts(sections) {
    return {
      active: sections.active.reduce((n, g) => n + g.items.length, 0),
      upNext: sections.upNext.length,
      scheduled: sections.scheduled.length,
      resolved: 0,
    };
  }

  /** 打开面板时选中的页签：第一个有任务的页签，都空时是进行中（需求 §11.5）。 */
  function defaultTab(sections) {
    const counts = tabCounts(sections);
    return TASK_TABS.find(k => (k === 'resolved' ? sections.done.length > 0 || sections.moreDone > 0 : counts[k] > 0)) || 'active';
  }

  /** 任务行「⋯」里的快捷操作（需求 §11.5）。 */
  function quickActions(item) {
    if (item.status === 'upNext' || item.status === 'scheduled') return item.owner === 'agent' ? ['start', 'markDone', 'dismiss'] : ['markDone', 'dismiss'];
    if (item.status === 'active') {
      if (item.owner === 'user') return ['markDone', 'dismiss'];
      return activeState(item) === 'blocked' ? ['refresh', 'markDone', 'dismiss'] : ['stop', 'refresh', 'markDone'];
    }
    if (item.status === 'resolved') return ['reopen'];
    return [];
  }
  const QUICK_LABEL = {start: '开始', markDone: '标为完成', dismiss: '放弃', stop: '停止', refresh: '刷新', reopen: '重新打开'};

  /** 快捷操作落到任务上（演示：只改状态，不跑智能体）。 */
  function applyAction(item, action, now) {
    const base = {...item, updatedAt: now};
    if (action === 'start') return {...base, status: 'active', active: {state: 'working'}};
    if (action === 'markDone') return {...base, status: 'resolved', active: undefined, question: undefined, resolution: {kind: 'done', at: now}};
    if (action === 'dismiss') return {...base, status: 'resolved', active: undefined, question: undefined, resolution: {kind: 'dismissed', at: now}};
    if (action === 'stop') return {...base, active: {state: 'blocked', reason: '你停下了这个任务'}};
    if (action === 'reopen') return {...base, status: 'upNext', resolution: undefined};
    if (action === 'refresh') return {...base, active: {state: 'working'}};
    return item;
  }

  /** 新建任务（需求 §4.4）：默认「我来做」、进「接下来」；交给智能体且勾了「现在开始」才直接开始。 */
  const NEW_TASK_DEFAULTS = {owner: 'user', start: false};
  function newTask({id, channelId, title, owner, start}, now) {
    const go = owner === 'agent' && !!start;
    return {id, channelId, title: String(title).trim(), owner, priority: 'medium', updatedAt: now,
      status: go ? 'active' : 'upNext', ...(go ? {active: {state: 'working'}} : {}),
      steps: [], finishedSteps: [], outputs: [], updates: []};
  }

  /** 最后一条智能体消息带的提示芯片；之后用户又说了话就不再显示（BOT-SG-01）。 */
  function openChips(timeline) {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const t = timeline[i];
      if (t.kind !== 'message') continue;
      return t.role === 'assistant' && t.chips && t.chips.length ? t.chips : null;
    }
    return null;
  }

  // ---- 演示数据 ----

  /** 一组能看全所有状态的演示频道与任务；时间相对 `now` 生成。演示文字不出现真实品牌名。 */
  function demo(now) {
    const m = n => now - n * 60000;
    const h = n => now - n * 3600000;
    const d = n => now - n * 86400000;
    const step = (text, state) => ({text, state});
    const channels = [
      {id: 'chan_main', kind: 'main', name: '综合', purpose: '', lastActivityAt: m(4), unread: false},
      {id: 'chan_weekly', kind: 'custom', name: '每周讲解', purpose: '每周一期产品讲解视频：粗剪、字幕和封面', pinned: true, lastActivityAt: m(12), unread: true},
      {id: 'chan_shorts', kind: 'custom', name: '短视频切条', purpose: '从长访谈里切竖版短视频', lastActivityAt: h(3), unread: false},
      {id: 'chan_dub', kind: 'custom', name: '英文配音', purpose: '给教程做英文配音版', muted: true, lastActivityAt: d(2), unread: false},
      {id: 'chan_old', kind: 'custom', name: '旧版教程', purpose: '', archived: true, lastActivityAt: d(40), unread: false},
    ];
    const W = 'chan_main';
    const items = [
      {id: 'wi_cut', channelId: W, title: '粗剪第 12 期讲解', status: 'active', owner: 'agent', active: {state: 'needsReview'}, priority: 'high', updatedAt: m(6),
        description: '把 42 分钟的录屏剪到 12 分钟以内，保留三段演示。', steps: [step('等你看粗剪', 'active')],
        finishedSteps: [{text: '转录全片', result: '42 分钟，2 位说话人', at: m(40)}, {text: '标出口误与停顿', result: '删掉 61 处', at: m(25)}, {text: '按章节重排', at: m(9)}],
        outputs: [{kind: 'video', label: '第 12 期 · 粗剪 v1'}], updates: [{text: '粗剪好了，11 分 40 秒，等你看', by: 'agent', at: m(6)}],
        thread: [
          {role: 'user', text: '把第 12 期粗剪一下，控制在 12 分钟内', at: m(48)},
          {role: 'assistant', text: '先转录全片、标出口误和长停顿，再按三段演示重排。剪好了我在这里叫你。', at: m(47)},
          {role: 'assistant', text: '粗剪好了：11 分 40 秒，删了 61 处口误和停顿。第二段演示里有一处画面跳切，你看看要不要补一个转场。', at: m(6), chips: [{label: '看起来不错', recommended: true}, {label: '补一个转场'}]},
        ]},
      {id: 'wi_cover', channelId: W, title: '选第 12 期的封面', status: 'active', owner: 'agent', active: {state: 'needsInput'}, priority: 'medium', updatedAt: m(15),
        question: {text: '三张封面里用哪一张？', options: [{label: '第一张', description: '人物特写，标题在左'}, {label: '第二张', description: '产品界面截图'}, {label: '第三张', description: '纯文字'}], pick: 0},
        steps: [step('等你选封面', 'active')], finishedSteps: [{text: '从粗剪里挑出 3 帧', at: m(18)}], outputs: [], updates: [],
        thread: [{role: 'assistant', text: '挑了三张候选封面，你选一张，我再把标题排上去。', at: m(15), chips: [{label: '第一张', recommended: true}, {label: '第二张'}, {label: '第三张'}]}]},
      {id: 'wi_sub', channelId: W, title: '给第 12 期配双语字幕', status: 'active', owner: 'agent', active: {state: 'working'}, priority: 'medium', updatedAt: m(3),
        steps: [step('翻译第 2 章', 'active'), step('校对术语', 'pending')], finishedSteps: [{text: '翻译第 1 章', at: m(8)}], outputs: [], updates: [],
        thread: [{role: 'assistant', text: '在翻第 2 章，术语按你的词表来。', at: m(3)}]},
      {id: 'wi_music', channelId: W, title: '找一段片头音乐', status: 'active', owner: 'agent', active: {state: 'blocked', reason: '音乐服务的登录过期了'}, priority: 'low', updatedAt: h(1),
        steps: [], finishedSteps: [], outputs: [], updates: [{text: '登录过期，停下了', by: 'agent', at: h(1)}], thread: []},
      {id: 'wi_review', channelId: W, title: '等同事确认第 11 期的数据', status: 'active', owner: 'user', active: {state: 'waitingOnOthers', reason: '同事周五回复'}, priority: 'medium', updatedAt: h(5),
        steps: [], finishedSteps: [], outputs: [], updates: []},
      {id: 'wi_thumb', channelId: W, title: '把旧封面统一成新模板', status: 'upNext', owner: 'agent', priority: 'medium', updatedAt: h(2), dueOn: '2026-11-06',
        steps: [], finishedSteps: [], outputs: [], updates: []},
      {id: 'wi_script', channelId: W, title: '写第 13 期的提纲', status: 'upNext', owner: 'user', priority: 'high', updatedAt: h(4),
        steps: [], finishedSteps: [], outputs: [], updates: []},
      {id: 'wi_weekly', channelId: W, title: '每周汇总观看数据', status: 'scheduled', owner: 'agent', priority: 'medium', updatedAt: d(1), startAt: now + 2 * 86400000,
        steps: [], finishedSteps: [], outputs: [], updates: []},
      {id: 'wi_intro', channelId: W, title: '剪第 11 期的片头', status: 'resolved', owner: 'agent', resolution: {kind: 'done', at: d(1)}, priority: 'medium', updatedAt: d(1),
        outcome: '片头 8 秒，已放进时间线', steps: [], finishedSteps: [], outputs: [{kind: 'video', label: '第 11 期 · 片头'}], updates: [], thread: []},
      {id: 'wi_logo', channelId: W, title: '换掉片尾的旧标志', status: 'resolved', owner: 'user', resolution: {kind: 'dismissed', at: d(3)}, priority: 'low', updatedAt: d(3),
        steps: [], finishedSteps: [], outputs: [], updates: []},
      {id: 'wi_sugg', channelId: W, title: '把第 12 期切成 3 条竖版短视频', status: 'suggested', owner: 'agent', priority: 'medium', updatedAt: m(5),
        suggestion: {reason: '粗剪里有三段完整的演示，适合单独发'}, steps: [], finishedSteps: [], outputs: [], updates: []},
      {id: 'wi_clip', channelId: 'chan_weekly', title: '导出第 12 期的预告', status: 'active', owner: 'agent', active: {state: 'needsReview'}, priority: 'medium', updatedAt: m(12),
        steps: [step('等你看预告', 'active')], finishedSteps: [], outputs: [], updates: [], thread: []},
      {id: 'wi_short', channelId: 'chan_shorts', title: '从访谈里切 5 条短视频', status: 'active', owner: 'agent', active: {state: 'working'}, priority: 'medium', updatedAt: h(3),
        steps: [step('找出 5 个高光片段', 'active')], finishedSteps: [], outputs: [], updates: [], thread: []},
    ];
    const timelines = {
      chan_main: [
        {kind: 'message', role: 'user', text: '把第 12 期粗剪一下，控制在 12 分钟内；顺便配上双语字幕，再挑几张封面给我选。', at: m(50)},
        {kind: 'message', role: 'assistant', text: '好，拆成三件事在后台做：粗剪、双语字幕、封面候选。做完或者要你决定的时候，会在这里告诉你。', at: m(49)},
        {kind: 'work-item-ref', workItemId: 'wi_cut'},
        {kind: 'work-item-ref', workItemId: 'wi_sub'},
        {kind: 'work-item-ref', workItemId: 'wi_cover'},
        {kind: 'relay', direction: 'report', workItemId: 'wi_cover', text: '挑了三张候选封面，等你选一张。\n第一张是人物特写，第二张是产品界面，第三张是纯文字。', cited: []},
        {kind: 'relay', direction: 'report', workItemId: 'wi_cut', text: '粗剪好了，11 分 40 秒，删了 61 处口误和停顿。\n第二段演示里有一处画面跳切。', cited: [{author: 'user', text: '控制在 12 分钟内'}]},
        {kind: 'message', role: 'assistant', text: '粗剪好了，等你看一眼；封面也挑好了三张。字幕还在翻第 2 章。', at: m(5),
          chips: [{label: '打开粗剪', recommended: true}, {label: '先选封面'}, {label: '字幕好了再叫我'}]},
      ],
      chan_weekly: [
        {kind: 'message', role: 'user', text: '这周的预告也导出一下', at: m(30)},
        {kind: 'work-item-ref', workItemId: 'wi_clip'},
      ],
      chan_shorts: [{kind: 'work-item-ref', workItemId: 'wi_short'}],
      chan_dub: [],
      chan_old: [],
    };
    return {channels, items, timelines};
  }

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.BC_BOT = {STATUS, RELAY, QUICK_LABEL, NEW_TASK_DEFAULTS, statusKey, statusOf, needsUser, nextLine, channelSummaries, needsYouTotal,
    channelGroups, compareWorkItems, matchesFilter, TASK_TABS, TAB_LABEL, tabOf, taskSections, tabCounts, defaultTab, quickActions, applyAction, newTask, openChips, demo};
})();
