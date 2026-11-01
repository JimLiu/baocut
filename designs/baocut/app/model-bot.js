/* BaoCut 原型 — Bot 模式：频道、任务与时间线的纯函数和演示数据（docs/design/bot-mode/bot-mode-requirements.md §11）
   window.BC_BOT。无 React、无 DOM；只在 App 入口加载（Web 没有 Bot）。

   分组、排序与状态对照照 packages/ui 的 model/bot.ts 与 work-item-status.ts 抄：原型和实现读同一份规则。
   任务的形状是 WorkItem 的简化：
     {id, channelId, title, status: 'suggested'|'upNext'|'scheduled'|'active'|'resolved', owner: 'user'|'agent',
      active?: {state, reason?}, resolution?: {kind: 'done'|'dismissed'|'merged', at}, priority, dueOn?, startAt?, updatedAt,
      description?, outcome?, question?: {text, options: [{label, description?}], pick?}, steps: [{text, state}],
      finishedSteps: [{text, result?, at}], outputs: [{kind, label, at?, project?, body?, images?, cues?}], updates: [{text, by, at}], suggestion?: {reason, kind?}, thread?}
   产物可以在右栏推开看（需求 §11.6 修订）：视频带 project（原型里的视频 id，开嵌入的编辑器），文档带 body（几行 Markdown），
   图片带 images（每张的说明），字幕带 cues（[{t, src, dst}]）。任务线程里智能体的消息可以带 outputs（产物下标），画成产物卡。
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
  /** 置顶的在前，其余按最近活动。 */
  const pinnedFirst = rows => [...rows.filter(r => r.channel.pinned).sort(byActivity), ...rows.filter(r => !r.channel.pinned).sort(byActivity)];

  /** 侧栏按状态筛频道（综合行上的筛选）：进行中、已归档、全部。主频道不能归档，总在。 */
  const CHANNEL_STATUS = ['active', 'archived', 'all'];
  const CHANNEL_STATUS_LABEL = {active: '进行中', archived: '已归档', all: '全部'};
  const matchesStatus = (channel, status) => status === 'all' || (status === 'archived' ? !!channel.archived : !channel.archived);

  /**
   * 频道侧栏的树（需求 §11.2 修订）：主频道一行，没分组的频道挂在它下面；每个分组另起一段，组里的频道挂在组下。
   * 段内置顶的在前、其余按最近活动；分组按建立的先后。按状态筛掉的频道不列；进行中与全部时空的分组也列（刚建的分组要能看到、能往里放），
   * 只看已归档时空的分组不列。频道的分组已经不在了，按没分组算。
   */
  function channelTree(rows, groups, status) {
    const main = rows.find(r => r.channel.kind === 'main') || null;
    const shown = rows.filter(r => r.channel.kind !== 'main' && matchesStatus(r.channel, status));
    const known = new Set(groups.map(g => g.id));
    const groupOf = r => (r.channel.groupId && known.has(r.channel.groupId) ? r.channel.groupId : null);
    return {
      main,
      loose: pinnedFirst(shown.filter(r => !groupOf(r))),
      groups: groups
        .map(group => ({group, rows: pinnedFirst(shown.filter(r => groupOf(r) === group.id))}))
        .filter(g => g.rows.length || status !== 'archived'),
    };
  }

  // ---- 频道的图标、名字与确认框里的数 ----

  /** 频道图标可选的 S2 workflow 图标（24 个，三行八列）；主频道固定用 Layers，不在里面。 */
  const CHANNEL_ICONS = [
    'Chat', 'Video', 'MovieCamera', 'Filmstrip', 'Microphone', 'MusicNote', 'Camera', 'Image',
    'Edit', 'Brush', 'Translate', 'Education', 'Lightbulb', 'Code', 'ChartBarVert', 'Target',
    'Calendar', 'Email', 'Briefcase', 'UserGroup', 'Heart', 'Star', 'GlobeGrid', 'Home',
  ];
  const CHANNEL_ICON_LABEL = {
    Chat: '对话', Video: '视频', MovieCamera: '摄像机', Filmstrip: '胶片', Microphone: '话筒', MusicNote: '音乐', Camera: '相机', Image: '图片',
    Edit: '笔', Brush: '画笔', Translate: '翻译', Education: '书', Lightbulb: '灯泡', Code: '代码', ChartBarVert: '图表', Target: '目标',
    Calendar: '日历', Email: '邮件', Briefcase: '公文包', UserGroup: '人', Heart: '心', Star: '星', GlobeGrid: '地球', Home: '家',
  };
  /** 频道颜色：S2 色板里有 200（底色）与 1000（图标）两档的色相，两行各五个。 */
  const CHANNEL_COLORS = ['magenta', 'red', 'orange', 'yellow', 'green', 'seafoam', 'cyan', 'blue', 'indigo', 'purple'];
  const CHANNEL_COLOR_LABEL = {magenta: '品红', red: '红', orange: '橙', yellow: '黄', green: '绿', seafoam: '海绿', cyan: '青', blue: '蓝', indigo: '靛蓝', purple: '紫'};
  const DEFAULT_CHANNEL_ICON = 'Chat';

  /** 没选过颜色的频道按 id 取一个，同一个频道每次一样。 */
  function defaultChannelColor(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return CHANNEL_COLORS[h % CHANNEL_COLORS.length];
  }
  /** 频道在侧栏与频道头的图标与颜色：主频道是 Layers、不着色；其余没选过的用对话气泡与按 id 取的颜色。 */
  function channelLook(channel) {
    if (channel.kind === 'main') return {icon: 'Layers', color: null};
    return {
      icon: CHANNEL_ICONS.includes(channel.icon) ? channel.icon : DEFAULT_CHANNEL_ICON,
      color: CHANNEL_COLORS.includes(channel.color) ? channel.color : defaultChannelColor(channel.id),
    };
  }

  const NAME_MAX = 40;
  /** 频道名与分组名（BOT-CH-02）：必填，最多 40 字。 */
  function nameError(name, what) {
    const value = String(name || '').trim();
    if (!value) return `给${what}起个名字`;
    if (value.length > NAME_MAX) return `最多 ${NAME_MAX} 个字`;
    return null;
  }

  /** 归档确认框里的数（需求 §2.3）：还没解决的任务（建议不算）里，定时的会暂停。 */
  function archiveImpact(items, channelId) {
    const open = items.filter(i => i.channelId === channelId && i.status !== 'resolved' && i.status !== 'suggested');
    return {open: open.length, scheduled: open.filter(i => i.status === 'scheduled').length};
  }
  /** 删除确认框里的数（需求 §2.3）：会停掉的进行中智能体任务、会删掉的任务（建议不算）与定时任务。 */
  function deleteImpact(items, channelId) {
    const mine = items.filter(i => i.channelId === channelId && i.status !== 'suggested');
    return {
      working: mine.filter(i => i.owner === 'agent' && i.status === 'active' && (!i.active || i.active.state === 'working')).length,
      tasks: mine.length,
      scheduled: mine.filter(i => i.status === 'scheduled').length,
    };
  }

  // ---- 频道设置与记忆 ----

  /** 频道设置（需求 §2.3、BOT-CH-03）：没写的项跟随全局；Agent 为 null 表示用 Bot 的默认 Agent。同时工作的任务数 1–6。 */
  const CHANNEL_SETTINGS = {driverId: null, model: null, defaultAccessMode: null, maxAccessMode: null, outputLanguage: '', private: false,
    concurrentThreads: 3, stallMinutes: null, dailyBudget: '', monthlyBudget: '', currency: 'USD'};
  const MAX_CONCURRENT = 6;
  function channelSettings(channel) {
    return {...CHANNEL_SETTINGS, ...(channel && channel.settings)};
  }

  /** 记忆的上限（需求 §11.7）：频道 16 KB，所有频道共用的偏好 8 KB；九成以上算快满。 */
  const MEMORY_LIMIT = {channel: 16 * 1024, user: 8 * 1024};
  const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`;
  function memoryUsage(text, scope) {
    const limit = MEMORY_LIMIT[scope === 'user' ? 'user' : 'channel'];
    const bytes = new TextEncoder().encode(String(text || '')).length;
    const over = bytes > limit;
    const near = !over && bytes > limit * 0.9;
    return {bytes, limit, over, near, label: [`${kb(bytes)} / ${kb(limit)}`, over ? '太长，没法保存。先删短一些。' : near ? '快满了：智能体会先整理再往里加。' : null].filter(Boolean).join(' · ')};
  }

  // ---- 右栏宽度 ----

  /** 右栏能拖的范围：至少 300，中间至少留 360。 */
  const SIDE_MIN = 300;
  const CENTER_MIN = 360;
  /**
   * 右栏各形态的默认宽：任务面板 340、Make 380；任务详情占主区的 45%（480–640）；推进来的产物（视频编辑器、文档……）
   * 把中间压到 440 左右，至少 560。
   */
  function sideDefault(mode, available) {
    if (mode === 'make') return 380;
    if (mode === 'detail') return Math.min(640, Math.max(480, Math.round(available * 0.45)));
    if (mode === 'output') return Math.max(560, available - 440);
    return 340;
  }
  /** 实际宽：拖过的用拖过的，否则用默认；都夹在 [300, 主区 − 360] 里。 */
  function sideWidth(mode, stored, available) {
    const max = Math.max(SIDE_MIN, available - CENTER_MIN);
    const want = stored == null ? sideDefault(mode, available) : stored;
    return {width: Math.round(Math.min(max, Math.max(SIDE_MIN, want))), min: SIDE_MIN, max};
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

  // ---- Make 面板 ----

  /** 产物的种类：图标与文字（Make 面板的产物卡、任务详情的产物）。 */
  const OUTPUT_KIND = {
    video:    {icon: 'Video',          label: '视频'},
    image:    {icon: 'Image',          label: '图片'},
    subtitle: {icon: 'CloseCaptions',  label: '字幕'},
    doc:      {icon: 'FileText',       label: '文档'},
  };
  /** 建议的种类：大卡上的标签与预览画法；没写种类的用「任务」。 */
  const SUGGESTION_KIND = {shorts: '竖版短视频', subtitles: '字幕', task: '任务'};
  const MAKE_EARLIER_MAX = 6;

  /**
   * 周期任务模板（BOT-MK-05、BOT-VE-04）：Make 面板底部的一排卡，点「＋」在当前频道建一条定时任务。
   * `next(now)` 给出下一次开始的时刻（本地时间）。只做 BaoCut 自己的数据（需求 §6 首期）。
   */
  const at = (now, days, hour) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.getTime(); };
  const nextWeekday = (now, weekday, hour) => { const d = new Date(now); const add = (weekday - d.getDay() + 7) % 7 || (d.getHours() >= hour ? 7 : 0); return at(now, add, hour); };
  const MAKE_TEMPLATES = [
    {id: 'transcribe', title: '每周素材转录', text: '把素材文件夹里新录的音频转录好，整理一份提纲', every: '每周一 09:00', next: now => nextWeekday(now, 1, 9)},
    {id: 'inbox', title: '每日素材整理', text: '整理关注的文件夹里新进的文件，按视频归好', every: '每天 08:00', next: now => (new Date(now).getHours() >= 8 ? at(now, 1, 8) : at(now, 0, 8))},
    {id: 'captions', title: '字幕补齐', text: '找出缺字幕、缺译文的视频，列一张单子', every: '每周日 20:00', next: now => nextWeekday(now, 0, 20)},
    {id: 'drafts', title: '半成品清点', text: '列出 30 天没动过的半成品，问你留不留', every: '每月 1 日 09:00', next: now => { const d = new Date(now); d.setMonth(d.getMonth() + 1, 1); d.setHours(9, 0, 0, 0); return d.getTime(); }},
  ];

  /** 本地时区当天零点。 */
  const startOfDay = now => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };

  /**
   * Make 面板的内容（需求 §6、§11.5）：`scope` 是 'channel'（这个频道）或 'all'（全部频道，不含归档）。
   * 建议按频道各取前 3 条；产物来自任务的 outputs（带着它在任务里的下标 index），按时间倒排，分成今天的与更早的（更早的最多 6 条）。
   */
  function makeGallery(items, channelId, scope, now, archivedIds) {
    const archived = new Set(archivedIds || []);
    const shown = items.filter(i => (scope === 'all' ? !archived.has(i.channelId) : i.channelId === channelId));
    const byChannel = {};
    shown.filter(i => i.status === 'suggested').sort(compareWorkItems).forEach(i => { (byChannel[i.channelId] = byChannel[i.channelId] || []).push(i); });
    const suggestions = Object.values(byChannel).flatMap(list => list.slice(0, SUGGESTIONS_MAX)).sort((a, b) => b.updatedAt - a.updatedAt);
    const outputs = shown.flatMap(item => (item.outputs || []).map((o, index) => ({...o, index, at: o.at || item.updatedAt, item})))
      .sort((a, b) => b.at - a.at);
    const today = startOfDay(now);
    return {
      suggestions,
      today: outputs.filter(o => o.at >= today),
      earlier: outputs.filter(o => o.at < today).slice(0, MAKE_EARLIER_MAX),
    };
  }

  /** 从模板建一条定时任务（BOT-MK-05）：交给智能体，到点开线程。 */
  function taskFromTemplate({id, channelId, template}, now) {
    return {...newTask({id, channelId, title: template.title, owner: 'agent', start: false}, now),
      status: 'scheduled', startAt: template.next(now), description: `${template.every}：${template.text}`};
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
  const CUT_NOTES = [
    '# 第 12 期 · 剪辑说明',
    '原片 42 分钟，粗剪后 11 分 40 秒。保留三段演示，按「问题 → 演示 → 小结」重排了章节。',
    '## 删掉的',
    '- 61 处口误和超过 1.5 秒的停顿',
    '- 开头 2 分钟的调试麦克风',
    '- 第三段演示里重复的一次导出',
    '## 要你看的',
    '- 06:12 第二段演示有一处画面跳切，可以补一个 0.3 秒的溶解',
    '- 09:40 的口播语速偏快，要不要放慢到 0.9 倍',
  ].join('\n');
  const SUB_CUES = [
    {t: '00:00:03', src: '这一期我们讲怎么把录屏剪成讲解视频。', dst: 'This episode covers turning a screen recording into an explainer.'},
    {t: '00:00:08', src: '先看原片：四十二分钟，有两个人在说话。', dst: 'First, the raw footage: 42 minutes, two speakers.'},
    {t: '00:00:14', src: '我们只留三段演示，其余的都可以删。', dst: 'We keep only the three demos; the rest can go.'},
    {t: '00:00:21', src: '转录好以后，口误和停顿会自动标出来。', dst: 'Once transcribed, slips and pauses are marked automatically.'},
    {t: '00:00:27', src: '你只要确认一遍，再按章节排好。', dst: 'You just confirm them, then arrange by chapter.'},
  ];
  /** 记忆的演示文本（需求 §11.7 的五节：目标、规则、人与对象、未了的事、已谈过）。 */
  const DEMO_MEMORIES = {
    chan_main: ['## 目标', '- 每周一期产品讲解，周五前出粗剪', '## 规则', '- 成片控制在 12 分钟以内', '- 字幕中英双语，术语按词表', '## 人与对象',
      '- 嘉宾：产品经理小林，说话快，口误多', '## 未了的事', '- 第 12 期封面还没定', '## 已谈过', '- 第 11 期片头 8 秒的版本用户满意'].join('\n'),
    chan_weekly: ['## 目标', '- 每周一期，周一发预告', '## 规则', '- 预告 30 秒以内，竖版另出一版'].join('\n'),
    user: ['- 回复用中文，结论先说', '- 导出默认 1080p、H.264', '- 不要在晚上十点以后提醒'].join('\n'),
  };

  function demo(now) {
    const m = n => now - n * 60000;
    const h = n => now - n * 3600000;
    const d = n => now - n * 86400000;
    const step = (text, state) => ({text, state});
    const channels = [
      {id: 'chan_main', kind: 'main', name: '综合', purpose: '', lastActivityAt: m(4), unread: false},
      {id: 'chan_weekly', kind: 'custom', name: '每周讲解', purpose: '每周一期产品讲解视频：粗剪、字幕和封面', pinned: true, lastActivityAt: m(12), unread: true,
        icon: 'Video', color: 'purple', groupId: 'grp_tutorials'},
      {id: 'chan_shorts', kind: 'custom', name: '短视频切条', purpose: '从长访谈里切竖版短视频', lastActivityAt: h(3), unread: false, icon: 'Filmstrip', color: 'orange'},
      {id: 'chan_dub', kind: 'custom', name: '英文配音', purpose: '给教程做英文配音版', muted: true, lastActivityAt: d(2), unread: false,
        icon: 'Microphone', color: 'blue', groupId: 'grp_tutorials'},
      {id: 'chan_old', kind: 'custom', name: '旧版教程', purpose: '', archived: true, lastActivityAt: d(40), unread: false, icon: 'Education', color: 'seafoam'},
    ];
    /** 侧栏的分组（需求 §11.2 修订）：只有名字；频道的 groupId 指过来，空的分组也留着。 */
    const groups = [{id: 'grp_tutorials', name: '教程系列'}];
    const W = 'chan_main';
    const items = [
      {id: 'wi_cut', channelId: W, title: '粗剪第 12 期讲解', status: 'active', owner: 'agent', active: {state: 'needsReview'}, priority: 'high', updatedAt: m(6),
        description: '把 42 分钟的录屏剪到 12 分钟以内，保留三段演示。', steps: [step('等你看粗剪', 'active')],
        finishedSteps: [{text: '转录全片', result: '42 分钟，2 位说话人', at: m(40)}, {text: '标出口误与停顿', result: '删掉 61 处', at: m(25)}, {text: '按章节重排', at: m(9)}],
        outputs: [{kind: 'video', label: '第 12 期 · 粗剪 v1', at: m(6), project: 'p12'}, {kind: 'doc', label: '第 12 期 · 剪辑说明.md', at: m(7), body: CUT_NOTES}], updates: [{text: '粗剪好了，11 分 40 秒，等你看', by: 'agent', at: m(6)}],
        thread: [
          {role: 'user', text: '把第 12 期粗剪一下，控制在 12 分钟内', at: m(48)},
          {role: 'assistant', text: '先转录全片、标出口误和长停顿，再按三段演示重排。剪好了我在这里叫你。', at: m(47)},
          {role: 'assistant', text: '粗剪好了：11 分 40 秒，删了 61 处口误和停顿。第二段演示里有一处画面跳切，你看看要不要补一个转场。', at: m(6), outputs: [0, 1], chips: [{label: '看起来不错', recommended: true}, {label: '补一个转场'}]},
        ]},
      {id: 'wi_cover', channelId: W, title: '选第 12 期的封面', status: 'active', owner: 'agent', active: {state: 'needsInput'}, priority: 'medium', updatedAt: m(15),
        question: {text: '三张封面里用哪一张？', options: [{label: '第一张', description: '人物特写，标题在左'}, {label: '第二张', description: '产品界面截图'}, {label: '第三张', description: '纯文字'}], pick: 0},
        steps: [step('等你选封面', 'active')], finishedSteps: [{text: '从粗剪里挑出 3 帧', at: m(18)}], outputs: [{kind: 'image', label: '封面候选 3 张', at: m(15), images: ['人物特写，标题在左', '产品界面截图', '纯文字']}], updates: [],
        thread: [{role: 'assistant', text: '挑了三张候选封面，你选一张，我再把标题排上去。', at: m(15), outputs: [0], chips: [{label: '第一张', recommended: true}, {label: '第二张'}, {label: '第三张'}]}]},
      {id: 'wi_sub', channelId: W, title: '给第 12 期配双语字幕', status: 'active', owner: 'agent', active: {state: 'working'}, priority: 'medium', updatedAt: m(3),
        steps: [step('翻译第 2 章', 'active'), step('校对术语', 'pending')], finishedSteps: [{text: '翻译第 1 章', at: m(8)}],
        outputs: [{kind: 'subtitle', label: '第 12 期 · 双语字幕（第 1 章）', at: m(8), cues: SUB_CUES}], updates: [],
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
        outcome: '片头 8 秒，已放进时间线', steps: [], finishedSteps: [], outputs: [{kind: 'video', label: '第 11 期 · 片头', at: d(1), project: 'p14'}], updates: [], thread: []},
      {id: 'wi_logo', channelId: W, title: '换掉片尾的旧标志', status: 'resolved', owner: 'user', resolution: {kind: 'dismissed', at: d(3)}, priority: 'low', updatedAt: d(3),
        steps: [], finishedSteps: [], outputs: [], updates: []},
      {id: 'wi_sugg', channelId: W, title: '把第 12 期切成 3 条竖版短视频', status: 'suggested', owner: 'agent', priority: 'medium', updatedAt: m(5),
        suggestion: {reason: '粗剪里有三段完整的演示，适合单独发', kind: 'shorts'}, steps: [], finishedSteps: [], outputs: [], updates: []},
      {id: 'wi_sugg2', channelId: W, title: '给第 11 期补英文字幕', status: 'suggested', owner: 'agent', priority: 'medium', updatedAt: h(2),
        suggestion: {reason: '第 11 期还没有英文字幕，英文配音频道下周要用', kind: 'subtitles'}, steps: [], finishedSteps: [], outputs: [], updates: []},
      {id: 'wi_clip', channelId: 'chan_weekly', title: '导出第 12 期的预告', status: 'active', owner: 'agent', active: {state: 'needsReview'}, priority: 'medium', updatedAt: m(12),
        steps: [step('等你看预告', 'active')], finishedSteps: [], outputs: [{kind: 'video', label: '第 12 期 · 预告 30 秒', at: m(12), project: 'p11'}], updates: [], thread: []},
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
    return {channels, groups, items, timelines, memories: {...DEMO_MEMORIES}};
  }

  const root = typeof window !== 'undefined' ? window : globalThis;
  root.BC_BOT = {STATUS, RELAY, QUICK_LABEL, NEW_TASK_DEFAULTS, statusKey, statusOf, needsUser, nextLine, channelSummaries, needsYouTotal,
    CHANNEL_STATUS, CHANNEL_STATUS_LABEL, matchesStatus, channelTree, CHANNEL_ICONS, CHANNEL_ICON_LABEL, CHANNEL_COLORS, CHANNEL_COLOR_LABEL, DEFAULT_CHANNEL_ICON,
    defaultChannelColor, channelLook, NAME_MAX, nameError, archiveImpact, deleteImpact, compareWorkItems, matchesFilter, TASK_TABS, TAB_LABEL, tabOf, taskSections, tabCounts, defaultTab, quickActions, applyAction, newTask, openChips,
    OUTPUT_KIND, SUGGESTION_KIND, MAKE_TEMPLATES, makeGallery, taskFromTemplate, CHANNEL_SETTINGS, MAX_CONCURRENT, channelSettings,
    MEMORY_LIMIT, memoryUsage, SIDE_MIN, CENTER_MIN, sideDefault, sideWidth, demo};
})();
