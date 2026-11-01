import type { AgentMode } from './access.ts';
import type {
  AwaySummary,
  BotSettings,
  BotStatus,
  Channel,
  ChannelColor,
  ChannelGroup,
  ChannelIcon,
  ChannelSummary,
  InboxRow,
  ResourceRef,
  RevertPlan,
  ThreadReport,
  UserWorkItemEvent,
  WorkItem,
  WorkItemOverrides,
  WorkItemOwner,
  WorkItemPriority,
  WorkItemTransition,
} from './bot.ts';
import type { DriverId, Id, TimelineItem } from './domain.ts';
import type { Money } from './grants.ts';

/** Bot 投递的结果（技术方案 §8.1）。 */
export type DeliveryResult = 'steered' | 'held' | 'woke' | 'started' | 'dropped';

/** 频道可改的字段（`channels.update`）。 */
export interface ChannelPatch {
  name?: string;
  purpose?: string;
  /** null = 回到默认。主频道的图标、颜色与分组忽略。 */
  icon?: ChannelIcon | null;
  color?: ChannelColor | null;
  /** 移进分组（分组不存在时 `not-found`），null = 移出分组。 */
  groupId?: Id | null;
  driverId?: DriverId;
  model?: string | null;
  effort?: string | null;
  defaultAccessMode?: AgentMode | null;
  maxAccessMode?: AgentMode | null;
  pinned?: boolean;
  muted?: boolean;
  private?: boolean;
  outputLanguage?: string | null;
  stallMinutes?: number | null;
  concurrentThreads?: number;
  dailyBudget?: Money | null;
  monthlyBudget?: Money | null;
  unwantedKinds?: string[];
}

/** 任务可由用户改的字段（`workItems.update`）。 */
export interface WorkItemPatch {
  title?: string;
  description?: string;
  priority?: WorkItemPriority;
  dueOn?: string | null;
  eventOn?: string | null;
  resources?: ResourceRef[];
  dependsOn?: Id[];
  overrides?: WorkItemOverrides | null;
}

/**
 * Bot 模式的方法（docs/design/bot-mode 技术方案 §16.1）。主体都是用户：智能体主体调用 `forbidden`。
 * 频道对话与线程会话本身仍走 `conversations.send` / `steer` 等方法（`via`、`suggestionChipId`、`replyToItemId` 是 Bot 的附加参数）。
 */
export interface BotRpcMethods {
  'channels.list': { params: Record<string, never>; result: { channels: ChannelSummary[]; groups: ChannelGroup[] } };
  /** 主频道不存在时建出来（BOT-CH-01）；第一次建出时起协调者的种子回合。 */
  'channels.ensureMain': { params: Record<string, never>; result: { channel: Channel } };
  'channels.create': {
    params: {
      name: string;
      purpose?: string;
      templateId?: string | null;
      driverId?: DriverId;
      model?: string | null;
      effort?: string | null;
      defaultAccessMode?: AgentMode | null;
      outputLanguage?: string | null;
      icon?: ChannelIcon | null;
      color?: ChannelColor | null;
      /** 直接建在这个分组里；分组不存在时 `not-found`。 */
      groupId?: Id | null;
      commandId?: Id;
    };
    result: { channel: Channel };
  };
  'channels.update': { params: { id: Id; patch: ChannelPatch }; result: { channel: Channel } };
  /** 建分组；给了 `channelIds` 时把这些频道一起移进来（主频道跳过；有不存在的频道时 `not-found`，什么都不建）。 */
  'channelGroups.create': { params: { name: string; channelIds?: Id[] }; result: { group: ChannelGroup } };
  'channelGroups.update': { params: { id: Id; patch: { name?: string } }; result: { group: ChannelGroup } };
  /** 删分组不删频道：组里的频道回到没分组，不用确认。 */
  'channelGroups.delete': { params: { id: Id }; result: { deleted: true } };
  'channels.archive': { params: { id: Id }; result: { channel: Channel } };
  'channels.unarchive': { params: { id: Id }; result: { channel: Channel } };
  /** `confirm` 与实时计数不符时 `conflict`（`details` 是实时计数）。主频道不能删。 */
  'channels.delete': { params: { id: Id; confirm: { threads: number; schedules: number } }; result: { deleted: true } };
  'channels.readMemory': { params: { id: Id }; result: { content: string; version: number } };
  /** 版本不符时 `conflict`，`details` 是 `{ content, version }`；超过上限或含敏感内容时 `invalid-request`。 */
  'channels.writeMemory': { params: { id: Id; content: string; ifVersion: number }; result: { version: number } };
  'channels.markSeen': { params: { id: Id; itemId: Id | null }; result: { channel: Channel } };
  /** 对话、任务（含转换记录与报告）、记忆导出成 Markdown + JSON；视频只列引用。 */
  'channels.export': { params: { id: Id; dir: string }; result: { path: string } };
  'bot.readUserMemory': { params: Record<string, never>; result: { content: string; version: number } };
  'bot.writeUserMemory': { params: { content: string; ifVersion: number }; result: { content: string; version: number } };
  'bot.settings': { params: { patch?: Partial<BotSettings> }; result: { settings: BotSettings } };

  /**
   * 频道的任务。给了 `limit` 或 `cursor` 时分页：按解决时间（没解决的按更新时间）从新到旧，每页最多 `limit` 条（默认 50，
   * 最多 200）；`nextCursor` 交回来取下一页，没有更多时为 null。不分页时一次给全部，`nextCursor` 为 null。
   * 界面用 `{ status: 'resolved', limit }` 翻看快照里最近 20 条之外更早解决的任务（§11.5）。
   */
  'workItems.list': {
    params: { channelId: Id; status?: WorkItem['status']; limit?: number; cursor?: string | null };
    result: { items: WorkItem[]; nextCursor: string | null };
  };
  'workItems.get': { params: { id: Id }; result: { item: WorkItem; transitions: WorkItemTransition[]; reports: ThreadReport[] } };
  'workItems.create': {
    params: {
      channelId: Id;
      title: string;
      owner: WorkItemOwner;
      description?: string;
      priority?: WorkItemPriority;
      dueOn?: string | null;
      start?: boolean;
      commandId?: Id;
    };
    result: { item: WorkItem };
  };
  'workItems.update': { params: { id: Id; patch: WorkItemPatch }; result: { item: WorkItem } };
  'workItems.transition': { params: { id: Id; event: UserWorkItemEvent }; result: { item: WorkItem } };
  'workItems.stop': { params: { id: Id }; result: { item: WorkItem } };
  'workItems.redirect': { params: { id: Id; text: string; oldWork: 'stop' | 'keep' }; result: { item: WorkItem } };
  'workItems.refresh': { params: { id: Id }; result: { delivered: DeliveryResult } };
  'workItems.move': { params: { id: Id; toChannelId: Id }; result: { item: WorkItem } };
  'workItems.revertAll': {
    params: { id: Id; dryRun?: boolean; keepUserEdits?: boolean };
    result: { plan: RevertPlan } | { restored: { videoId: Id; version: number }[] };
  };
  'workItems.deleteRecord': {
    params: { id: Id; dryRun?: boolean; confirm?: { files: string[] } };
    result: { files: string[]; keptShared: string[]; deleted: boolean };
  };

  'bot.proposals.respond': {
    params: { conversationId: Id; itemId: Id; accept: boolean; edits?: { name?: string; purpose?: string } };
    result: { resultId: Id | null };
  };
  'bot.make.run': { params: { channelId: Id }; result: { runId: Id; shown: number } };
  'bot.react': { params: { conversationId: Id; itemId: Id; emoji: string }; result: { taskId: Id | null } };
  'bot.status': { params: Record<string, never>; result: BotStatus };
  'bot.awaySummary': { params: { channelId: Id }; result: AwaySummary };
  'bot.inbox': { params: Record<string, never>; result: { rows: InboxRow[] } };
  'bot.pauseAutomation': { params: { paused: boolean }; result: { paused: boolean } };
  /** 用户改自己亲手打的消息（BOT-EX-06）：原文留在 `history`，转交过的线程收到新旧两版。 */
  'conversations.editMessage': { params: { conversationId: Id; itemId: Id; text: string }; result: { item: TimelineItem } };
}
