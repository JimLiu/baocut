import {
  BOT_LIMITS,
  needsUser,
  type ActiveState,
  type ChannelSummary,
  type Id,
  type InboxRow,
  type SuggestionChip,
  type TimelineItem,
  type WorkItem,
  type WorkItemPriority,
  type WorkItemQuestion,
} from '@baocut/protocol';

/**
 * Bot 模式界面的纯逻辑（docs/design/bot-mode 需求 §11、技术方案 §17）：频道侧栏的分组、任务面板的分段与排序、
 * 「等你」收件箱的分组、提示芯片的取舍、要订阅哪些频道的任务。组件只管画，规则都在这里，便于单测。
 */

// ---- 状态 ----

/** 任务在界面上的状态键：§11.5 状态表的一行（进行中按子状态，已解决按结局）。 */
export type WorkItemStatusKey = 'suggested' | 'upNext' | 'scheduled' | ActiveState | 'done' | 'dismissed' | 'merged';

export function statusKey(item: Pick<WorkItem, 'status' | 'active' | 'resolution'>): WorkItemStatusKey {
  switch (item.status) {
    case 'active':
      return item.active?.state ?? 'working';
    case 'resolved':
      return item.resolution?.kind ?? 'done';
    default:
      return item.status;
  }
}

// ---- 频道 ----

/** Rail 上 Bot 的徽标：全部频道（含静音、归档）里「待你审阅 + 需要你输入」的任务数。 */
export function needsYouTotal(channels: readonly ChannelSummary[]): number {
  return channels.reduce((sum, row) => sum + Math.max(0, row.counts.needsYou), 0);
}

export interface ChannelGroups {
  /** 主频道固定第一行，然后置顶的，然后按最近活动。 */
  active: ChannelSummary[];
  archived: ChannelSummary[];
}

const byActivity = (a: ChannelSummary, b: ChannelSummary) => b.lastActivityAt.localeCompare(a.lastActivityAt);

/** 频道侧栏（需求 §11.2）：主频道、置顶、其余按最近活动；归档的收进底部的折叠组。 */
export function channelGroups(channels: readonly ChannelSummary[]): ChannelGroups {
  const live = channels.filter((row) => !row.channel.archived);
  const main = live.filter((row) => row.channel.kind === 'main');
  const pinned = live.filter((row) => row.channel.kind !== 'main' && row.channel.pinned).sort(byActivity);
  const rest = live.filter((row) => row.channel.kind !== 'main' && !row.channel.pinned).sort(byActivity);
  return {
    active: [...main, ...pinned, ...rest],
    archived: channels.filter((row) => row.channel.archived).sort(byActivity),
  };
}

/**
 * 要订阅任务主题的频道（技术方案 §17.2）：当前打开的频道，加上有「等你」的频道（收件箱就地作答要读它们的任务）。
 * 按 id 排序，调用方好比较前后两次是不是一样。
 */
export function wantedWorkItemChannels(channels: readonly ChannelSummary[], openChannelId: Id | null): Id[] {
  const ids = new Set<Id>();
  if (openChannelId) ids.add(openChannelId);
  for (const row of channels) if (row.counts.needsYou > 0) ids.add(row.channel.id);
  return [...ids].sort();
}

// ---- 任务面板 ----

export type TaskFilter = 'all' | 'mine' | 'agent';

export interface TaskSections {
  suggested: WorkItem[];
  needsYou: WorkItem[];
  working: WorkItem[];
  /** 接下来，后面接着定时的（按开始时刻）。 */
  upNext: WorkItem[];
  done: WorkItem[];
  /** 已解决的里因为条数或时间没列出的。 */
  moreDone: number;
}

const PRIORITY_RANK: Record<WorkItemPriority, number> = { high: 0, medium: 1, low: 2 };
/** 进行中段内的顺序（需求 §11.5）：待你审阅 → 需要你输入 → 已停下 → 工作中 → 等别人。 */
const ACTIVE_RANK: Record<ActiveState, number> = { needsReview: 0, needsInput: 1, blocked: 2, working: 3, waitingOnOthers: 4 };
const RESOLVED_DAYS = 30;

/** 同组内按优先级、截止日（没有的在后）、最近更新排。 */
export function compareWorkItems(a: WorkItem, b: WorkItem): number {
  const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (rank) return rank;
  if (a.dueOn !== b.dueOn) {
    if (!a.dueOn) return 1;
    if (!b.dueOn) return -1;
    return a.dueOn.localeCompare(b.dueOn);
  }
  return b.updatedAt.localeCompare(a.updatedAt);
}

function compareActive(a: WorkItem, b: WorkItem): number {
  const rank = ACTIVE_RANK[a.active?.state ?? 'working'] - ACTIVE_RANK[b.active?.state ?? 'working'];
  return rank || compareWorkItems(a, b);
}

function resolvedAt(item: WorkItem): string {
  return item.resolution?.at ?? item.updatedAt;
}

export function matchesFilter(item: WorkItem, filter: TaskFilter): boolean {
  if (filter === 'mine') return item.owner === 'user';
  if (filter === 'agent') return item.owner === 'agent';
  return true;
}

/**
 * 任务面板的四段（需求 §11.5）：等你、工作中（已停下、工作中、等别人）、接下来（含定时）、已解决（最近 20 条、30 天内）；
 * 建议另放，最多 3 条。
 */
export function taskSections(items: readonly WorkItem[], filter: TaskFilter, now: number, showAllDone = false): TaskSections {
  const shown = items.filter((item) => matchesFilter(item, filter));
  const suggested = shown
    .filter((item) => item.status === 'suggested')
    .sort(compareWorkItems)
    .slice(0, BOT_LIMITS.pendingSuggestionsPerChannel);
  const active = shown.filter((item) => item.status === 'active').sort(compareActive);
  const upNext = shown.filter((item) => item.status === 'upNext').sort(compareWorkItems);
  const scheduled = shown
    .filter((item) => item.status === 'scheduled')
    .sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? '') || compareWorkItems(a, b));
  const cutoff = now - RESOLVED_DAYS * 86_400_000;
  const resolved = shown.filter((item) => item.status === 'resolved').sort((a, b) => resolvedAt(b).localeCompare(resolvedAt(a)));
  const recent = showAllDone ? resolved : resolved.filter((item) => Date.parse(resolvedAt(item)) >= cutoff).slice(0, BOT_LIMITS.resolvedTail);
  return {
    suggested,
    needsYou: active.filter((item) => needsUser(item)),
    working: active.filter((item) => !needsUser(item)),
    upNext: [...upNext, ...scheduled],
    done: recent,
    moreDone: resolved.length - recent.length,
  };
}

/** 今天的日期（YYYY-MM-DD），按用户时区（`BotSettings.timeZone`，空 = 系统时区）。 */
export function localDate(now: number, timeZone: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone ?? undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

/** 过了截止日还没解决（需求 §11.5：过期用 negative 色加「已过期」字样）。 */
export function isOverdue(item: Pick<WorkItem, 'dueOn' | 'status'>, today: string): boolean {
  return !!item.dueOn && item.status !== 'resolved' && item.status !== 'suggested' && item.dueOn < today;
}

// ---- 收件箱 ----

export interface InboxGroup {
  channelId: Id;
  channelName: string;
  rows: InboxRow[];
}

/** 收件箱按频道分组（BOT-CH-11）：Runtime 已经把最急的排在前面，组的顺序按各组第一行出现的先后，组内保持原顺序。 */
/**
 * 收件箱一行给哪种操作：有选项的问题点选项作答；授权审批（命令、工具、改文件）带的问题外壳没有选项，给允许与拒绝；
 * 都没有的（报告里的开放问题、用户自己的任务）只能打开任务去回。
 */
export function inboxRowAction(row: Pick<InboxRow, 'question' | 'approval'>, hasThread: boolean): 'answer' | 'approve' | 'open' {
  if (row.question?.options.length && hasThread) return 'answer';
  // 线程的提问卡（多问、多选）不是授权：没有选项时打开任务去答，不给允许与拒绝。
  if (row.approval && !row.question?.options.length && row.question?.askedBy !== 'thread') return 'approve';
  return 'open';
}

/**
 * 一个问题选项怎么送达：Runtime 自己问的（卡住时「继续还是停止」、要你在场才能跑）没有提问卡，第一个选项是继续（`unblocked`），
 * 第二个是停止（`workItems.stop`）；提问卡推出的按卡作答；线程报告里的问题把选项原话发给线程。
 */
export function questionAnswerRoute(question: Pick<WorkItemQuestion, 'askedBy' | 'approvalId' | 'options'>, index: number): 'continue' | 'stop' | 'card' | 'message' {
  if (question.askedBy === 'system' && !question.approvalId) return index === 0 ? 'continue' : 'stop';
  return question.approvalId ? 'card' : 'message';
}

export function groupInbox(rows: readonly InboxRow[]): InboxGroup[] {
  const groups = new Map<Id, InboxGroup>();
  for (const row of rows) {
    const group = groups.get(row.channelId);
    if (group) group.rows.push(row);
    else groups.set(row.channelId, { channelId: row.channelId, channelName: row.channelName, rows: [row] });
  }
  return [...groups.values()];
}

// ---- 提示芯片 ----

type Item<K extends TimelineItem['kind']> = Extract<TimelineItem, { kind: K }>;

const LINK = /\bhttps?:\/\/|\bwww\./i;

/** 字样规则（需求 §7.3）：发出的句子不超长、不含链接。违反的不显示，不截断后硬发。 */
export function chipAllowed(chip: SuggestionChip): boolean {
  const text = chip.text.trim();
  if (!chip.label.trim() || (!chip.fillOnly && chip.kind !== 'other' && !text)) return false;
  if (text.length > BOT_LIMITS.chipText) return false;
  return !LINK.test(chip.text) && !LINK.test(chip.label);
}

export interface OpenChips {
  /** 那组提示条目的 id。 */
  itemId: Id;
  chips: SuggestionChip[];
}

/**
 * 现在能点的提示（需求 §7.3）：最后一组 `open` 的提示，并且它挂的那条消息之后没有用户消息、也没有更新的智能体消息；
 * 违反字样规则的去掉，最多 4 个。
 */
export function openChips(items: readonly TimelineItem[]): OpenChips | null {
  const index = items.findLastIndex((item) => item.kind === 'suggestions');
  if (index < 0) return null;
  const group = items[index] as Item<'suggestions'>;
  if (group.state !== 'open') return null;
  const anchorIndex = items.findIndex((item) => item.id === group.forItemId);
  const from = anchorIndex >= 0 ? anchorIndex : index;
  for (let i = from + 1; i < items.length; i++) {
    const item = items[i]!;
    if (item.kind === 'user-message') return null;
    if (item.kind === 'agent-message' && item.id !== group.forItemId && item.text.trim()) return null;
  }
  const chips = group.chips.filter(chipAllowed).slice(0, BOT_LIMITS.chips);
  return chips.length ? { itemId: group.id, chips } : null;
}

/** 芯片点下去做什么（技术方案 §12.4）：发出一条用户消息、只填输入框、或只把光标放进输入框。 */
export type ChipAction = 'send' | 'fill' | 'focus';

export function chipAction(chip: SuggestionChip): ChipAction {
  if (chip.kind === 'other') return 'focus';
  if (chip.fillOnly || chip.kind === 'starter') return 'fill';
  return 'send';
}

// ---- 其他 ----

/** 时间线里的线程卡是不是这一条任务。 */
export function isWorkItemRef(item: TimelineItem, workItemId: Id): boolean {
  return item.kind === 'work-item-ref' && item.workItemId === workItemId;
}

/** 已完成步骤默认只露最近 3 条（需求 §11.6）。 */
export const FINISHED_STEPS_SHOWN = 3;
