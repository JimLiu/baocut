import {
  BOT_LIMITS,
  type ActiveState,
  type ArtifactRef,
  type ChannelSummary,
  type Id,
  type InboxRow,
  type ScheduleCadence,
  type SuggestionChip,
  type TimelineItem,
  type WorkItem,
  type WorkItemPriority,
  type WorkItemQuestion,
} from '@baocut/protocol';
import type { BaoCutClient } from '@baocut/client';

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
 * 要订阅任务主题的频道（技术方案 §17.2）：当前打开的频道，加上有「等你」的频道（收件箱就地作答要读它们的任务）；
 * Make 面板看「全部频道」时（`everyChannel`）再加上所有没归档的频道。按 id 排序，调用方好比较前后两次是不是一样。
 */
export function wantedWorkItemChannels(channels: readonly ChannelSummary[], openChannelId: Id | null, everyChannel = false): Id[] {
  const ids = new Set<Id>();
  if (openChannelId) ids.add(openChannelId);
  for (const row of channels) if (row.counts.needsYou > 0 || (everyChannel && !row.channel.archived)) ids.add(row.channel.id);
  return [...ids].sort();
}

// ---- 任务面板 ----

export type TaskFilter = 'all' | 'mine' | 'agent';

/** 任务面板的四个页签（需求 §11.5）；建议不在页签里，另放在页签上方。 */
export type TaskTab = 'active' | 'upNext' | 'scheduled' | 'resolved';
export const TASK_TABS: readonly TaskTab[] = ['active', 'upNext', 'scheduled', 'resolved'];

/** 一条任务落在哪个页签；建议不落在任何页签。 */
export function tabOf(item: Pick<WorkItem, 'status'>): TaskTab | null {
  return item.status === 'suggested' ? null : item.status;
}

export interface ActiveGroup {
  state: ActiveState;
  items: WorkItem[];
}

export interface TaskSections {
  /** 进行中，按子状态分组：待你审阅 → 需要你输入 → 已停下 → 工作中 → 等别人；空组不列。 */
  active: ActiveGroup[];
  upNext: WorkItem[];
  /** 定时的，按开始时刻。 */
  scheduled: WorkItem[];
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
 * 任务面板的四个页签（需求 §11.5）：进行中（按子状态分组）、接下来、定时、已解决（最近 20 条、30 天内）；
 * 建议不在任务面板里，在 Make 面板（`makeGallery`）。
 */
export function taskSections(items: readonly WorkItem[], filter: TaskFilter, now: number, showAllDone = false): TaskSections {
  const shown = items.filter((item) => matchesFilter(item, filter));
  const active: ActiveGroup[] = [];
  for (const item of shown.filter((item) => item.status === 'active').sort(compareActive)) {
    const state = item.active?.state ?? 'working';
    const group = active[active.length - 1];
    if (group?.state === state) group.items.push(item);
    else active.push({ state, items: [item] });
  }
  const upNext = shown.filter((item) => item.status === 'upNext').sort(compareWorkItems);
  const scheduled = shown
    .filter((item) => item.status === 'scheduled')
    .sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? '') || compareWorkItems(a, b));
  const cutoff = now - RESOLVED_DAYS * 86_400_000;
  const resolved = shown.filter((item) => item.status === 'resolved').sort((a, b) => resolvedAt(b).localeCompare(resolvedAt(a)));
  const recent = showAllDone ? resolved : resolved.filter((item) => Date.parse(resolvedAt(item)) >= cutoff).slice(0, BOT_LIMITS.resolvedTail);
  return { active, upNext, scheduled, done: recent, moreDone: resolved.length - recent.length };
}

/** 页签上的条数；已解决只列最近一段，不计数。 */
export function tabCounts(sections: TaskSections): Record<TaskTab, number> {
  return {
    active: sections.active.reduce((n, group) => n + group.items.length, 0),
    upNext: sections.upNext.length,
    scheduled: sections.scheduled.length,
    resolved: 0,
  };
}

/** 用户还没点过页签时停在哪个：第一个有任务的，都没有时是进行中。 */
export function defaultTab(sections: TaskSections): TaskTab {
  const counts = tabCounts(sections);
  return TASK_TABS.find((tab) => (tab === 'resolved' ? sections.done.length > 0 || sections.moreDone > 0 : counts[tab] > 0)) ?? 'active';
}

/**
 * 快照只带最近 `resolvedTail` 条已解决的（技术方案 §16.2）：条数到了上限，说明 Runtime 那边可能还有更早的，
 * 面板给「显示更早的」，按需用 `loadResolvedWorkItems` 取。
 */
export function mayHaveOlderResolved(items: readonly WorkItem[], resolvedTail: number | undefined): boolean {
  return !!resolvedTail && items.filter((item) => item.status === 'resolved').length >= resolvedTail;
}

/** 取一个频道全部已解决的任务（`workItems.list`）：任务面板「显示更早的」用，界面里只有这一处调它。 */
export async function loadResolvedWorkItems(client: Pick<BaoCutClient, 'request'>, channelId: Id): Promise<WorkItem[]> {
  const { items } = await client.request('workItems.list', { channelId, status: 'resolved' });
  return items;
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

// ---- Make 面板 ----

/** Make 面板看哪些频道（需求 §11.11）：这个频道，或全部没归档的频道。 */
export type MakeScope = 'channel' | 'all';

/** 建议大卡上的示意画法：竖版短片（三块 9:16）、字幕（一帧画面加两行字幕条），其余是灯泡。 */
export type SuggestionPreview = 'clips' | 'captions' | 'idea';

/** 按建议的 `kindTag`（Make 生成器写的自由小写词，如 highlights、captions、translate-draft）选预览。 */
export function suggestionPreview(kindTag: string | null | undefined): SuggestionPreview {
  const tag = (kindTag ?? '').toLowerCase();
  if (/short|highlight|clip|reel|vertical/.test(tag)) return 'clips';
  if (/caption|subtitle|transcri|translat/.test(tag)) return 'captions';
  return 'idea';
}

/** 产物卡的种类：决定图标与种类字样。线程卡、消息这类引用不算产物卡。 */
export type OutputKind = 'video' | 'image' | 'subtitle' | 'doc';

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|heic|svg)$/i;
const SUBTITLE_EXT = /\.(srt|vtt|ass|ssa|sbv)$/i;

export function outputKind(ref: ArtifactRef): OutputKind | null {
  if (ref.kind === 'video' || ref.kind === 'video-range') return 'video';
  if (ref.kind === 'file') {
    if (VIDEO_EXT.test(ref.path)) return 'video';
    return IMAGE_EXT.test(ref.path) ? 'image' : SUBTITLE_EXT.test(ref.path) ? 'subtitle' : 'doc';
  }
  if (ref.kind === 'space' || ref.kind === 'doc' || ref.kind === 'slides' || ref.kind === 'design') return 'doc';
  return null;
}

export interface MakeOutput {
  item: WorkItem;
  output: ArtifactRef;
  kind: OutputKind;
  /** 产物出来的时刻（毫秒）：任务解决的时刻，没解决的用最近更新。 */
  at: number;
}

export interface MakeGallery {
  /** 每个频道最多 3 条，最近更新的在前；第一条画成大卡。 */
  suggestions: WorkItem[];
  today: MakeOutput[];
  /** 今天以前的，最多 `MAKE_EARLIER_MAX` 条。 */
  earlier: MakeOutput[];
}

export const MAKE_EARLIER_MAX = 6;

/** 本机时区当天零点。 */
function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Make 面板的内容（需求 §6、§11.11）：`items` 是要看的那些频道的任务（调用方按范围取好）。
 * 建议按频道各取前 3 条；产物来自任务的 outputs，按时间倒排，分成今天的与更早的。
 */
export function makeGallery(items: readonly WorkItem[], now: number): MakeGallery {
  const byChannel = new Map<Id, WorkItem[]>();
  for (const item of items.filter((i) => i.status === 'suggested').sort(compareWorkItems)) {
    const list = byChannel.get(item.channelId) ?? [];
    if (list.length < BOT_LIMITS.pendingSuggestionsPerChannel) list.push(item);
    byChannel.set(item.channelId, list);
  }
  const suggestions = [...byChannel.values()].flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const outputs: MakeOutput[] = [];
  for (const item of items) {
    const at = Date.parse(item.resolution?.at ?? item.updatedAt);
    for (const output of item.outputs) {
      const kind = outputKind(output);
      if (kind) outputs.push({ item, output, kind, at });
    }
  }
  outputs.sort((a, b) => b.at - a.at);
  const today = startOfDay(now);
  return {
    suggestions,
    today: outputs.filter((o) => o.at >= today),
    earlier: outputs.filter((o) => o.at < today).slice(0, MAKE_EARLIER_MAX),
  };
}

/**
 * 周期任务模板（BOT-MK-05、BOT-VE-04）：Make 面板底部的一排卡。点「＋」打开周期任务对话框，名字、指令与频率填好，
 * 目标是当前频道，用户确认才建。名字与指令是文案（`make.templates`），频率在这里。只做 BaoCut 自己的数据（需求 §6 首期）。
 */
export type MakeTemplateId = 'transcribe' | 'tidy' | 'captions' | 'drafts';

export const MAKE_TEMPLATES: readonly { id: MakeTemplateId; cadence: ScheduleCadence }[] = [
  { id: 'transcribe', cadence: { type: 'weekly', days: [1], time: '09:00' } },
  { id: 'tidy', cadence: { type: 'daily', time: '08:00' } },
  { id: 'captions', cadence: { type: 'weekly', days: [0], time: '20:00' } },
  { id: 'drafts', cadence: { type: 'weekly', days: [5], time: '17:00' } },
];

// ---- 收件箱 ----

export interface InboxGroup {
  channelId: Id;
  channelName: string;
  rows: InboxRow[];
}

/** 收件箱按频道分组（BOT-CH-11）：Runtime 已经把最急的排在前面，组的顺序按各组第一行出现的先后，组内保持原顺序。 */
/**
 * 任务详情里给不给「撤销这个任务的改动」（BOT-EX-19）：任务有过线程、资源里有视频时就给，线程实际改了哪些版本由撤销对话框试算时查。
 * 已经记下基线版本的也给。
 */
export function canRevertItem(item: Pick<WorkItem, 'threadId' | 'resources' | 'baseVersions'>): boolean {
  if (item.baseVersions.length) return true;
  return !!item.threadId && item.resources.some((ref) => ref.kind === 'video' || ref.kind === 'video-range');
}

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
