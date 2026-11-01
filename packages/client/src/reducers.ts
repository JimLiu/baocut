import {
  AGENT_SETUP_OUTPUT_LINES,
  applyVideoEvent,
  clampOutput,
  type AgentSetupEvent,
  type AgentSetupSnapshot,
  type ChannelsEvent,
  type ChannelsSnapshot,
  type WorkItemsEvent,
  type WorkItemsSnapshot,
  type ConversationEvent,
  type ConversationPage,
  type ConversationSnapshot,
  type DirectoryEvent,
  type DirectorySnapshot,
  type JobsEvent,
  type JobsSnapshot,
  type ModelsEvent,
  type ModelsSnapshot,
  type SettingsEvent,
  type SettingsSnapshot,
  type ServicesEvent,
  type ServicesSnapshot,
  type VideoTopicEvent,
  type VideoTopicSnapshot,
  type SpaceEvent,
  type SpaceSnapshot,
  type TasksEvent,
  type TasksSnapshot,
  type TimelineItem,
} from '@baocut/protocol';

/**
 * 本地镜像的纯函数归约（架构设计 §11.4）。只依赖事件本身，不做业务判断；
 * 返回新对象，供 Zustand 这类按引用比较的状态库使用。
 */
export function applyDirectoryEvent(state: DirectorySnapshot, event: DirectoryEvent): DirectorySnapshot {
  switch (event.type) {
    case 'project.upsert':
      return { ...state, projects: upsertBy(state.projects, event.project, (p) => p.id) };
    case 'project.removed':
      return { ...state, projects: state.projects.filter((p) => p.id !== event.projectId) };
    case 'conversation.upsert':
      return { ...state, conversations: upsertBy(state.conversations, event.conversation, (c) => c.id) };
    case 'conversation.removed':
      return { ...state, conversations: state.conversations.filter((c) => c.id !== event.conversationId) };
  }
}

/** 新任务放在最前面，与快照的排序一致。定时任务同样新建的在前。 */
export function applyTasksEvent(state: TasksSnapshot, event: TasksEvent): TasksSnapshot {
  switch (event.type) {
    case 'task.upsert': {
      const index = state.tasks.findIndex((t) => t.taskId === event.task.taskId);
      if (index < 0) return { ...state, tasks: [event.task, ...state.tasks] };
      const tasks = state.tasks.slice();
      tasks[index] = event.task;
      return { ...state, tasks };
    }
    case 'task.removed':
      return { ...state, tasks: state.tasks.filter((t) => t.taskId !== event.taskId) };
    // 待处理的审批（会话的与对外服务的）：出现时追加在后面（旧的在前，与快照一致），结束时去掉。
    // 旧镜像没有 `approvals` 时当作空列表。
    case 'approval.upsert': {
      const approvals = (state.approvals ?? []).slice();
      const index = approvals.findIndex((a) => a.approvalId === event.approval.approvalId);
      if (index < 0) approvals.push(event.approval);
      else approvals[index] = event.approval;
      return { ...state, approvals };
    }
    case 'approval.removed':
      return { ...state, approvals: (state.approvals ?? []).filter((a) => a.approvalId !== event.approvalId) };
    case 'schedule.upsert': {
      const schedules = (state.schedules ?? []).slice();
      const index = schedules.findIndex((s) => s.id === event.schedule.id);
      if (index < 0) schedules.unshift(event.schedule);
      else schedules[index] = event.schedule;
      return { ...state, schedules };
    }
    case 'schedule.removed':
      return { ...state, schedules: (state.schedules ?? []).filter((s) => s.id !== event.scheduleId) };
  }
}

/**
 * 后台任务（转写等）：一条记录的新状态替换旧的，新任务放在最前面，与快照的排序一致。
 * 转录的实时段落（`liveSegments`）：`job.segments` 从 `from` 起逐段写入，已有的序号替换、其后的保留；`from` 越过已有的段数
 * 时整条忽略（不补猜，下一次快照补齐）。记录不再是 `running` 时丢掉这个任务的段落，没有段落时不带 `liveSegments`。
 * `job.removed`（账本淘汰）删掉这些记录与它们的段落；一条都不在时返回原状态。
 */
export function applyJobsEvent(state: JobsSnapshot, event: JobsEvent): JobsSnapshot {
  switch (event.type) {
    case 'job.updated': {
      const index = state.jobs.findIndex((j) => j.jobId === event.job.jobId);
      let jobs: JobsSnapshot['jobs'];
      if (index < 0) jobs = [event.job, ...state.jobs];
      else {
        jobs = state.jobs.slice();
        jobs[index] = event.job;
      }
      let live = state.liveSegments;
      if (live && event.job.state !== 'running' && event.job.jobId in live) {
        const rest = { ...live };
        delete rest[event.job.jobId];
        live = Object.keys(rest).length > 0 ? rest : undefined;
      }
      return live ? { jobs, liveSegments: live } : { jobs };
    }
    case 'job.segments': {
      const existing = state.liveSegments?.[event.jobId] ?? [];
      if (event.from > existing.length || event.segments.length === 0) return state;
      const segments = existing.slice();
      event.segments.forEach((segment, i) => (segments[event.from + i] = segment));
      return { ...state, liveSegments: { ...state.liveSegments, [event.jobId]: segments } };
    }
    case 'job.removed': {
      const removed = new Set(event.jobIds);
      const jobs = state.jobs.filter((j) => !removed.has(j.jobId));
      let live = state.liveSegments;
      if (live && event.jobIds.some((id) => id in live!)) {
        live = Object.fromEntries(Object.entries(live).filter(([id]) => !removed.has(id)));
        if (Object.keys(live).length === 0) live = undefined;
      }
      if (jobs.length === state.jobs.length && live === state.liveSegments) return state;
      return live ? { jobs, liveSegments: live } : { jobs };
    }
  }
}

/** 模型：能力视图整个替换；一个模型包的新状态按 `bundleId` 替换（没有时追加），移出列表的去掉。 */
export function applyModelsEvent(state: ModelsSnapshot, event: ModelsEvent): ModelsSnapshot {
  switch (event.type) {
    case 'capabilities.updated':
      return { ...state, capabilities: event.capabilities };
    case 'bundle.updated': {
      const index = state.bundles.findIndex((b) => b.bundleId === event.bundle.bundleId);
      if (index < 0) return { ...state, bundles: [...state.bundles, event.bundle] };
      const bundles = state.bundles.slice();
      bundles[index] = event.bundle;
      return { ...state, bundles };
    }
    case 'bundle.removed':
      return { ...state, bundles: state.bundles.filter((b) => b.bundleId !== event.bundleId) };
  }
}

/** 偏好设置：变了的键换成新的有效值，默认值不变。 */
export function applySettingsEvent(state: SettingsSnapshot, event: SettingsEvent): SettingsSnapshot {
  switch (event.type) {
    case 'settings.updated':
      return { ...state, settings: { ...state.settings, ...event.changed } };
  }
}

/** 对外服务：服务状态按 `serviceId` 替换；审批出现时追加，结束时移除。 */
export function applyServicesEvent(state: ServicesSnapshot, event: ServicesEvent): ServicesSnapshot {
  switch (event.type) {
    case 'service.updated':
      return { ...state, services: upsertBy(state.services, event.service, (s) => s.serviceId) };
    case 'approval.requested':
      return { ...state, approvals: upsertBy(state.approvals, event.approval, (a) => a.approvalId) };
    case 'approval.resolved':
      return { ...state, approvals: state.approvals.filter((a) => a.approvalId !== event.approvalId) };
  }
}

/**
 * 应用内运行的 Agent 安装命令：新的一次放在最前面（与快照一致）；输出行追加，只留最后 `AGENT_SETUP_OUTPUT_LINES` 行。
 * 不认识的 `runId` 的输出丢掉（它的记录会随下一次快照到来）。
 */
export function applyAgentSetupEvent(state: AgentSetupSnapshot, event: AgentSetupEvent): AgentSetupSnapshot {
  switch (event.type) {
    case 'setup.updated': {
      const index = state.runs.findIndex((r) => r.runId === event.run.runId);
      if (index < 0) return { runs: [event.run, ...state.runs] };
      const runs = state.runs.slice();
      runs[index] = event.run;
      return { runs };
    }
    case 'setup.output': {
      const index = state.runs.findIndex((r) => r.runId === event.runId);
      if (index < 0) return state;
      const run = state.runs[index]!;
      const output = [...run.output, ...event.lines];
      const dropped = Math.max(0, output.length - AGENT_SETUP_OUTPUT_LINES);
      const runs = state.runs.slice();
      runs[index] = { ...run, output: dropped ? output.slice(dropped) : output, droppedLines: run.droppedLines + dropped };
      return { runs };
    }
  }
}

export function applySpaceEvent(state: SpaceSnapshot, event: SpaceEvent): SpaceSnapshot {
  switch (event.type) {
    case 'entry.upsert':
      return { ...state, entries: upsertBy(state.entries, event.entry, (e) => e.id) };
    case 'entry.removed':
      return { ...state, entries: state.entries.filter((e) => e.id !== event.entryId) };
    case 'catalog.replaced':
      return event.snapshot;
    // 只是通知（外部 Agent 新建了视频），目录不变；条目随后的 `entry.upsert` 到。
    case 'video.created':
      return state;
  }
}

/** 会话被删除时返回 null。 */
/**
 * 会话主题的增量。快照只有最近几个回合时（`offset`），没有的条目按事件带的位置分：在已载入那一段之前的不要（翻页时再取），
 * 其余是新条目，接在最后；已有的条目不管位置都原地替换（包括钉在最前面的旧任务条目）。
 */
export function applyConversationEvent(state: ConversationSnapshot, event: ConversationEvent): ConversationSnapshot | null {
  switch (event.type) {
    case 'item.upsert': {
      const index = state.items.findIndex((i) => i.id === event.item.id);
      if (index < 0 && state.offset && event.index !== undefined && event.index < state.offset) return state;
      return { ...state, items: upsertBy(state.items, event.item, (i) => i.id) };
    }
    case 'item.append': {
      const index = state.items.findIndex((i) => i.id === event.itemId);
      if (index < 0) return state;
      const item = appendToItem(state.items[index]!, event.field, event.delta);
      if (!item) return state;
      const items = state.items.slice();
      items[index] = item;
      return { ...state, items };
    }
    case 'conversation.updated':
      return { ...state, conversation: event.conversation };
    case 'conversation.removed':
      return null;
  }
}

/**
 * 把往前翻到的一页接在最前面。`before` 是请求时已载入那一段的起点：之后快照被整体替换过（重连）、起点变了，这一页作废。
 * 页里也有的条目（钉在最前面的旧任务）换成页里的，页是更晚读的。
 */
export function prependConversationPage(state: ConversationSnapshot, before: number, page: ConversationPage): ConversationSnapshot {
  if (!state.offset || state.offset !== before || page.offset >= before) return state;
  const ids = new Set(page.items.map((i) => i.id));
  return { ...state, items: [...page.items, ...state.items.filter((i) => !ids.has(i.id))], offset: page.offset };
}

function appendToItem(item: TimelineItem, field: 'text' | 'output', delta: string): TimelineItem | null {
  if (field === 'text' && (item.kind === 'agent-message' || item.kind === 'reasoning')) {
    return { ...item, text: item.text + delta };
  }
  if (field === 'output' && item.kind === 'tool-call') {
    return { ...item, output: clampOutput(item.output + delta) };
  }
  return null;
}

function upsertBy<T>(list: readonly T[], value: T, key: (v: T) => string): T[] {
  const id = key(value);
  const index = list.findIndex((v) => key(v) === id);
  if (index < 0) return [...list, value];
  const next = list.slice();
  next[index] = value;
  return next;
}

/** 视频主题：增量用共享的投影 reducer（与 Runtime 的镜像同一个）；视频关闭时返回 null。 */
export function applyVideoTopicEvent(state: VideoTopicSnapshot, event: VideoTopicEvent): VideoTopicSnapshot | null {
  switch (event.type) {
    case 'video.event':
      return applyVideoEvent(state, event.event);
    case 'video.replaced':
      return event.snapshot;
    case 'video.closed':
      return null;
  }
}

/**
 * `channels` 主题（Bot 模式）：频道摘要按 id 替换，置顶在前、再按最近活动排；分组按 id 替换、新的排在最后（按建立的先后）；
 * 通知事件不改快照（由订阅方另行处理）。
 */
export function applyChannelsEvent(state: ChannelsSnapshot, event: ChannelsEvent): ChannelsSnapshot {
  switch (event.type) {
    case 'channel.upsert': {
      const others = state.channels.filter((row) => row.channel.id !== event.summary.channel.id);
      return { ...state, channels: sortChannels([...others, event.summary]) };
    }
    case 'channel.removed':
      return { ...state, channels: state.channels.filter((row) => row.channel.id !== event.id) };
    case 'channel-group.upsert': {
      const groups = state.groups ?? [];
      const index = groups.findIndex((group) => group.id === event.group.id);
      return { ...state, groups: index < 0 ? [...groups, event.group] : groups.map((group, i) => (i === index ? event.group : group)) };
    }
    case 'channel-group.removed':
      return { ...state, groups: (state.groups ?? []).filter((group) => group.id !== event.id) };
    case 'bot.settings':
      return { ...state, settings: event.settings };
    case 'bot.notification':
      return state;
  }
}

function sortChannels(rows: ChannelsSnapshot['channels']): ChannelsSnapshot['channels'] {
  return [...rows].sort((a, b) => {
    if (a.channel.kind !== b.channel.kind) return a.channel.kind === 'main' ? -1 : 1;
    if (a.channel.pinned !== b.channel.pinned) return a.channel.pinned ? -1 : 1;
    return a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0;
  });
}

/** `work-items:<channelId>` 主题：任务按 id 替换或追加；报告按 id 替换；转换记录不进快照（任务详情按需取）。 */
export function applyWorkItemsEvent(state: WorkItemsSnapshot, event: WorkItemsEvent): WorkItemsSnapshot {
  switch (event.type) {
    case 'work-item.upsert': {
      const index = state.items.findIndex((item) => item.id === event.item.id);
      const items = index < 0 ? [...state.items, event.item] : state.items.map((item, i) => (i === index ? event.item : item));
      return { ...state, items };
    }
    case 'work-item.removed':
      return { ...state, items: state.items.filter((item) => item.id !== event.id) };
    case 'work-item.report': {
      const index = state.reports.findIndex((report) => report.id === event.report.id);
      const reports = index < 0 ? [...state.reports, event.report] : state.reports.map((report, i) => (i === index ? event.report : report));
      return { ...state, reports };
    }
    case 'work-item.transition':
      return state;
  }
}
