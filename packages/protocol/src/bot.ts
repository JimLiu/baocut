import type { AgentMode } from './access.ts';
import type { ConversationActivity, DriverId, Id, TaskStatus } from './domain.ts';
import type { Money } from './grants.ts';
import type { ScheduleCadence } from './schedule.ts';

/**
 * Bot 模式（docs/design/bot-mode）：频道、任务（WorkItem）、线程报告与提示。频道对话与线程都是普通的 `Conversation`
 * （`role` 区分），这里只放 Bot 自己的状态。字段长度与条数是硬限制（`BOT_LIMITS`），Runtime 在状态机与工具里同时校验。
 */

export type ChannelKind = 'main' | 'topic';

/** 主频道的固定 id（技术方案 §5.2）：两个窗口同时第一次打开也只建出一个。 */
export const MAIN_CHANNEL_ID = 'chan_main';

export interface ChannelLimits {
  concurrentThreads: number;
  dailyBudget: Money | null;
  monthlyBudget: Money | null;
}

export interface Channel {
  id: Id;
  kind: ChannelKind;
  name: string;
  purpose: string;
  /** 频道对话（`role: 'channel'`）。 */
  conversationId: Id;
  driverId: DriverId;
  model: string | null;
  effort: string | null;
  /** null = 跟随全局默认。 */
  defaultAccessMode: AgentMode | null;
  /** 线程与任务级覆盖的上限（BOT-SF-01）；null = 不设上限。 */
  maxAccessMode: AgentMode | null;
  templateId: string | null;
  pinned: boolean;
  archived: boolean;
  archivedAt: string | null;
  limits: ChannelLimits;
  /** 产物语言（BCP 47）；null = 跟随对话语言（BOT-BH-10）。 */
  outputLanguage: string | null;
  /** 不被其他频道读取（BOT-CH-12）。 */
  private: boolean;
  /** 只进徽标与收件箱，不弹系统通知（BOT-NF-08）。 */
  muted: boolean;
  /** 卡住检测的分钟数（频道覆盖），null = 全局默认。 */
  stallMinutes: number | null;
  /** 用户上次看到的位置（BOT-BH-08）。 */
  lastSeen: { at: string; itemId: Id | null } | null;
  /** MEMORY.md 的版本号，写入时校验。 */
  memoryVersion: number;
  /** 种子回合没写出东西时留下的工作区事实，下一个有人在场的回合带上（技术方案 §13.5）。 */
  seedPending: string | null;
  /** 不想要的建议与提示的类别（BOT-MK-10）：kindTag 列表。 */
  unwantedKinds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ChannelCounts {
  needsYou: number;
  working: number;
  upNext: number;
  suggested: number;
}

export interface ChannelSummary {
  channel: Channel;
  unread: boolean;
  counts: ChannelCounts;
  lastActivityAt: string;
  /** 频道的花费（BOT-NF-04）；没有账本时为 null。 */
  spend: { today: Money | null; month: Money | null } | null;
}

/** 会话在 Bot 模式里的角色（技术方案 §4.2）：缺省等于 `chat`。 */
export type ConversationRole = 'chat' | 'channel' | 'thread';

// ---- 任务 ----

export type WorkItemStatus = 'suggested' | 'upNext' | 'scheduled' | 'active' | 'resolved';
export type ActiveState = 'working' | 'needsReview' | 'needsInput' | 'blocked' | 'waitingOnOthers';
export type Resolution = 'done' | 'dismissed' | 'merged';
export type BotActor = 'user' | 'coordinator' | 'thread' | 'system';
export type WorkItemOwner = 'agent' | 'user';
export type WorkItemPriority = 'high' | 'medium' | 'low';

export const WORK_ITEM_STATUSES: readonly WorkItemStatus[] = ['suggested', 'upNext', 'scheduled', 'active', 'resolved'];
export const ACTIVE_STATES: readonly ActiveState[] = ['working', 'needsReview', 'needsInput', 'blocked', 'waitingOnOthers'];

export interface WorkItemStep {
  text: string;
  state: 'pending' | 'active';
}

export interface WorkItemQuestionOption {
  label: string;
  description: string | null;
}

export interface WorkItemQuestion {
  /** 提问在前，≤ 140。 */
  text: string;
  kind: 'review' | 'input';
  options: WorkItemQuestionOption[];
  /** 智能体的推荐；`risky` 时必须为 null。 */
  pick: number | null;
  /** 花钱、外发、不可撤销。 */
  risky: boolean;
  askedBy: 'thread' | 'coordinator' | 'system';
  /** 由审批或提问卡推出时指向它（统一审批号）。 */
  approvalId: Id | null;
  /** 由提问卡推出时那一问的 id（`agents.answerQuestion` 按它作答）；没打开线程也能在收件箱里直接回答。 */
  questionId?: Id | null;
}

export type ResourceRef =
  | { kind: 'video'; projectId: Id; videoId: Id }
  | { kind: 'file'; path: string }
  | { kind: 'space'; entryId: Id }
  | { kind: 'doc' | 'slides' | 'design'; id: Id }
  | { kind: 'message'; conversationId: Id; itemId: Id }
  | { kind: 'video-range'; projectId: Id; videoId: Id; startMs: number; endMs: number }
  | { kind: 'work-item'; workItemId: Id };

export type ArtifactRef = ResourceRef & { label: string; version: string | null };

export type SuggestionTrigger = 'manual' | 'channel-created' | 'item-resolved' | 'thread-report' | 'new-media';

export interface SuggestionMeta {
  reason: string;
  owner: WorkItemOwner;
  evidence: ResourceRef[];
  trigger: SuggestionTrigger;
  kindTag: string;
  /** kindTag + 对象 id 的哈希：14 天去重窗口的键。 */
  subjectKey: string;
  expiresAt: string;
}

export interface WorkItemTemplate {
  title: string;
  description: string;
  owner: WorkItemOwner;
  /** 线程简报的正文。 */
  prompt: string;
  resources: ResourceRef[];
  /** 用户接受提议时看到并同意的访问模式；每次建出的任务都用它（仍不高于频道上限）。没有时跟随频道。 */
  accessMode?: AgentMode | null;
}

/** 关任务的证据（技术方案 §9.5）：结构化引用，Runtime 逐条核验。 */
export type Evidence =
  | { kind: 'export'; projectId: Id; videoId: Id; exportId: Id }
  | { kind: 'job'; jobId: Id; attempt: number }
  | { kind: 'video-version'; projectId: Id; videoId: Id; version: string }
  | { kind: 'past-date'; date: string };

export interface WorkItemResolution {
  kind: Resolution;
  by: BotActor;
  at: string;
  evidence: Evidence[] | null;
  /** 用户确认完成的那条消息。 */
  confirmedBy: Id | null;
  mergedInto: Id | null;
}

export interface WorkItemOverrides {
  accessMode: AgentMode | null;
  driverId: DriverId | null;
  model: string | null;
  budget: Money | null;
  outputLanguage: string | null;
}

export type WorkItemSourceKind = 'conversation' | 'manual' | 'make' | 'schedule' | 'thread' | 'import';

export interface WorkItem {
  id: Id;
  channelId: Id;
  title: string;
  /** 用户写的标题智能体不能改。 */
  titleBy: 'user' | 'agent';
  description: string;
  owner: WorkItemOwner;
  status: WorkItemStatus;
  active: { state: ActiveState; reason: string | null; since: string } | null;
  resolution: WorkItemResolution | null;
  priority: WorkItemPriority;
  /** 截止日（YYYY-MM-DD，用户时区）：过了不等于不用做。 */
  dueOn: string | null;
  /** 事件日：任务是为某个活动做的；只由用户或用户原话里的日期设。 */
  eventOn: string | null;
  /** `scheduled` 时的开始时刻（RFC 3339）。 */
  startAt: string | null;
  steps: WorkItemStep[];
  finishedSteps: { text: string; result: string; at: string }[];
  updates: { text: string; at: string; by: BotActor }[];
  outcome: string | null;
  question: WorkItemQuestion | null;
  resources: ResourceRef[];
  outputs: ArtifactRef[];
  dependsOn: Id[];
  overrides: WorkItemOverrides | null;
  /** 任务第一次动某部视频前的版本，整体撤销用（BOT-EX-19）。 */
  baseVersions: { projectId: Id; videoId: Id; version: number }[];
  lastProgressAt: string | null;
  budgetWarnedAt: string | null;
  /** 线程写过的频道目录内文件（相对路径），删除任务记录用（BOT-EX-20）。 */
  files: string[];
  suggestion: SuggestionMeta | null;
  source: { kind: WorkItemSourceKind; messageId: Id | null; scheduleId: Id | null; runId: Id | null };
  threadId: Id | null;
  /** 开过几次线程（简报的幂等键）。 */
  threadStarts: number;
  lastReportId: Id | null;
  /** 审批期间收到、等审批结束再落的报告停点（技术方案 §9.3）。 */
  deferredStop: ThreadStop | null;
  /** `needsInput` 之前的子状态（审批结束时回到它）。 */
  beforeInput: ActiveState | null;
  /** 提醒过的标记（技术方案 §11.4）：同一任务同一原因只提一次。 */
  reminded: string[];
  createdAt: string;
  updatedAt: string;
}

export type ThreadStop = 'done' | 'needs-review' | 'needs-input' | 'blocked' | 'waiting';

export interface ThreadReport {
  id: Id;
  workItemId: Id;
  threadId: Id;
  taskId: Id;
  stop: ThreadStop;
  /** 第一句结论，≤ 120。 */
  headline: string;
  text: string;
  question: WorkItemQuestion | null;
  outputs: ArtifactRef[];
  userTodos: string[];
  followUps: string[];
  waitingFor: { jobIds: Id[]; workItemIds: Id[]; note: string | null } | null;
  /** 报告里按哪几条规则做的（记忆里规则的编号，BOT-EX-11）。 */
  appliedRules: string[];
  /** 线程没有写、由 Runtime 兜底写的。 */
  fallback: boolean;
  createdAt: string;
  delivery: 'pending' | 'delivered' | 'superseded';
}

export type WorkItemStateName = WorkItemStatus | ActiveState | Resolution;

export interface WorkItemTransition {
  workItemId: Id;
  from: WorkItemStateName;
  to: WorkItemStateName;
  actor: BotActor;
  /** 机器可读：'report:needs-review'、'approval:pending'、'user:resolve'… */
  cause: string;
  note: string | null;
  at: string;
  /** 关任务时核验过的证据、替用户关时用户的那条消息。 */
  evidence?: Evidence[];
  citedMessageId?: Id;
}

/** 状态机的事件（技术方案 §9.1）。 */
export type WorkItemEvent =
  | { type: 'accept'; start: boolean; owner?: WorkItemOwner; title?: string }
  | { type: 'dismiss' }
  | { type: 'expire' }
  | { type: 'schedule'; startAt: string }
  | { type: 'unschedule' }
  | { type: 'start' }
  | { type: 'due' }
  | { type: 'report'; report: ThreadReport }
  | { type: 'thread-activity'; activity: ConversationActivity; taskStatus: TaskStatus | null }
  /** `deferredReport`：审批结束时，审批期间收到、只记下停点的那份报告（Runtime 按 `lastReportId` 找来），用来恢复它的提问与原因。 */
  | { type: 'approval'; approvalId: Id; pending: boolean; question?: WorkItemQuestion | null; deferredReport?: ThreadReport | null }
  | { type: 'user-replied'; note?: string }
  | { type: 'unblocked'; cause: string }
  | { type: 'stalled'; reason: 'no-progress' | 'job-hung' | 'budget'; note: string }
  | { type: 'resolve'; evidence: Evidence[] | null; confirmedBy?: Id }
  | { type: 'reopen'; citedMessageId?: Id }
  | { type: 'merge'; into: Id }
  | { type: 'set-owner'; owner: WorkItemOwner }
  | { type: 'stop' };

/** 用户方法能发的事件（`workItems.transition`）。 */
export type UserWorkItemEvent = Extract<
  WorkItemEvent,
  { type: 'accept' | 'dismiss' | 'schedule' | 'unschedule' | 'start' | 'resolve' | 'reopen' | 'set-owner' | 'unblocked' }
>;

// ---- 会话里的新条目 ----

export interface CitedMessage {
  messageId: Id;
  conversationId: Id;
  author: 'user' | 'coordinator';
  via: UserMessageVia | null;
  text: string;
  truncated: boolean;
  at: string;
}

export type UserMessageVia = 'typed' | 'suggestion' | 'reaction' | 'notification';

export type RelayDirection = 'report' | 'brief' | 'relay' | 'refresh' | 'schedule' | 'make' | 'moved';

export interface RelayBody {
  direction: RelayDirection;
  workItemId: Id | null;
  reportId: Id | null;
  from: { role: 'coordinator' | 'thread' | 'system'; conversationId: Id | null };
  text: string;
  cited: CitedMessage[];
}

export type ProposalBody =
  | { type: 'channel'; name: string; purpose: string; templateId: string | null }
  | { type: 'schedule'; name: string; cadence: ScheduleCadence; template: WorkItemTemplate; accessMode: AgentMode | null }
  | { type: 'suggestions'; workItemIds: Id[] };

export interface ProposalState {
  proposal: ProposalBody;
  status: 'pending' | 'accepted' | 'declined' | 'stale';
  resultId: Id | null;
}

export type SuggestionChipKind = 'answer' | 'confirm' | 'decline' | 'other' | 'next-step' | 'starter' | 'disambiguate';

export interface SuggestionChip {
  id: Id;
  label: string;
  text: string;
  kind: SuggestionChipKind;
  kindTag: string | null;
  fillOnly: boolean;
  recommended: boolean;
  answers: { approvalId: Id; optionIndex: number } | null;
  target: { workItemId: Id } | null;
  action: { kind: 'resolve'; workItemId: Id } | null;
}

export interface SuggestionsBody {
  forItemId: Id;
  source: 'agent' | 'question' | 'system';
  chips: SuggestionChip[];
  state: 'open' | 'used' | 'stale';
  usedChipId: Id | null;
}

// ---- 设置、收件箱、通知 ----

export interface BotSettings {
  /** 用户时区（IANA）；null = 系统时区。 */
  timeZone: string | null;
  quietHours: { start: string; end: string; enabled: boolean };
  stallMinutes: number;
  maxConcurrentThreads: number;
  background: boolean;
  openAtLogin: boolean;
  automationPaused: boolean;
  /** Make 的自动触发（需求 §6.2 BOT-MK-02、§11.8）：关掉后只有手动「Make」才生成建议。 */
  makeAutoTrigger: boolean;
  /** 补充提示（技术方案 §12.1 的 `system` 来源）：智能体没给提示时，Runtime 在「要我……吗」下面补「好」「不」。 */
  supplementHints: boolean;
}

export const DEFAULT_BOT_SETTINGS: BotSettings = {
  timeZone: null,
  quietHours: { start: '22:00', end: '08:00', enabled: true },
  stallMinutes: 20,
  maxConcurrentThreads: 6,
  background: true,
  openAtLogin: false,
  automationPaused: false,
  makeAutoTrigger: true,
  supplementHints: true,
};

export type BotNotificationReason = 'needs-review' | 'needs-input' | 'reminder' | 'unattended-approval' | 'stalled';

export interface BotNotificationEvent {
  type: 'bot.notification';
  channelId: Id;
  workItemId: Id;
  reason: BotNotificationReason;
  headline: string;
  question: WorkItemQuestion | null;
  at: string;
  /** 静音频道：只计入角标，不弹通知。 */
  muted: boolean;
}

export interface InboxRow {
  channelId: Id;
  channelName: string;
  workItemId: Id;
  title: string;
  state: ActiveState;
  question: WorkItemQuestion | null;
  /** 待处理的授权（付费调用带金额）。 */
  approval: { approvalId: Id; summary: string; cost: Money | null } | null;
  priority: WorkItemPriority;
  since: string;
}

export interface AwaySummary {
  since: string | null;
  done: AwaySummaryRow[];
  needsYou: AwaySummaryRow[];
  stopped: AwaySummaryRow[];
  firstUnreadItemId: Id | null;
}

export interface AwaySummaryRow {
  id: Id;
  title: string;
  headline: string | null;
}

export interface BotStatus {
  workingThreads: { workItemId: Id; channelId: Id; title: string }[];
  nextSchedules: { scheduleId: Id; name: string; nextAt: string }[];
  paused: boolean;
  /** 常驻条件（技术方案 §15.2）：有活要等。 */
  resident: boolean;
  needsYou: number;
}

/** 整体撤销的试算结果（BOT-EX-19）。 */
export interface RevertPlan {
  videos: { projectId: Id; videoId: Id; baseVersion: number; userEdits: { version: number; at: string }[]; agentOnlyPossible: boolean; reason: string | null }[];
}

// ---- 主题 ----

export interface ChannelsSnapshot {
  channels: ChannelSummary[];
  settings: BotSettings;
}

export type ChannelsEvent =
  | { type: 'channel.upsert'; summary: ChannelSummary }
  | { type: 'channel.removed'; id: Id }
  | { type: 'bot.settings'; settings: BotSettings }
  | BotNotificationEvent;

export interface WorkItemsSnapshot {
  items: WorkItem[];
  /** 快照里只给最近这么多条已解决的。 */
  resolvedTail: number;
  reports: ThreadReport[];
}

export type WorkItemsEvent =
  | { type: 'work-item.upsert'; item: WorkItem }
  | { type: 'work-item.removed'; id: Id }
  | { type: 'work-item.transition'; transition: WorkItemTransition }
  | { type: 'work-item.report'; report: ThreadReport };

export function workItemsTopic(channelId: Id): `work-items:${Id}` {
  return `work-items:${channelId}`;
}

export function parseWorkItemsTopic(topic: string): Id | null {
  return topic.startsWith('work-items:') ? topic.slice('work-items:'.length) : null;
}

// ---- 限制 ----

export const BOT_LIMITS = {
  channelName: 40,
  channelPurpose: 2000,
  title: 140,
  description: 280,
  steps: 6,
  stepText: 120,
  updateText: 80,
  updatesKept: 50,
  questionText: 140,
  questionOptions: 4,
  optionLabel: 40,
  resources: 5,
  headline: 120,
  reportText: 8000,
  brief: 8000,
  note: 4000,
  citedMessages: 8,
  citedText: 4000,
  chips: 4,
  chipLabel: 12,
  chipText: 80,
  nextStepChips: 3,
  channelMemoryBytes: 16 * 1024,
  userMemoryBytes: 8 * 1024,
  resolvedTail: 20,
  concurrentThreads: 3,
  maxConcurrentThreads: 6,
  pendingSuggestionsPerChannel: 3,
  pendingSuggestionsTotal: 9,
  makeAutoPerDay: 3,
  suggestionTtlDays: 7,
  dismissMemoryDays: 14,
  channelStateChars: 6000,
  handoffChars: 40_000,
} as const;

/** 进行中的子状态里哪些算「等你」。 */
export function needsUser(item: Pick<WorkItem, 'status' | 'active' | 'owner'>): boolean {
  return item.status === 'active' && (item.active?.state === 'needsReview' || item.active?.state === 'needsInput');
}
