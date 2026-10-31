import path from 'node:path';
import fs from 'node:fs/promises';
import {
  AGENT_MODES,
  BOT_LIMITS,
  DEFAULT_BOT_SETTINGS,
  MAIN_CHANNEL_ID,
  RpcError,
  needsUser,
  newId,
  normalizeAgentMode,
  nowIso,
  workItemsTopic,
  type AgentMode,
  type AwaySummary,
  type BotActor,
  type BotNotificationReason,
  type BotSettings,
  type BotStatus,
  type Channel,
  type ChannelPatch,
  type ChannelSummary,
  type ChannelsEvent,
  type ChannelsSnapshot,
  type CitedMessage,
  type Conversation,
  type TaskBudgetLimits,
  type DeliveryResult,
  type DirectoryEvent,
  type DriverId,
  type Evidence,
  type Id,
  type InboxRow,
  type ProposalBody,
  type RelayBody,
  type ResourceRef,
  type ArtifactRef,
  type RevertPlan,
  type SuggestionChip,
  type SuggestionsBody,
  type ThreadReport,
  type TimelineItem,
  type UserMessageVia,
  type UserWorkItemEvent,
  type WorkItem,
  type WorkItemEvent,
  type WorkItemPatch,
  type WorkItemQuestion,
  type WorkItemTemplate,
  type WorkItemTransition,
  type WorkItemsEvent,
  type WorkItemsSnapshot,
} from '@baocut/protocol';
import { RcBot } from '@baocut/protocol/messages/runtime-core';
import { BOT_INTERNAL, TopicLog, type Delivery, type Harness, type Logger, type RunEvent } from '@baocut/harness';
import type { ChannelFiles, ChannelStore, WorkItemStore } from '@baocut/runtime-storage';
import {
  ambiguousAnswerBlock,
  channelStateBlock,
  handoffBlock,
  localDay,
  refreshBlock,
  relayBlock,
  replyTargetBlock,
  rulesSection,
  threadBriefBlock,
  threadReportBlock,
  userMemoryBlock,
  workspaceFactsBlock,
} from './context-blocks.ts';
import { coordinatorInstructions, threadInstructions } from './instructions.ts';
import { carryTaskFiles, relativeInside, rewriteFileRef, taskFilePaths } from './move-files.ts';
import { spendWindow, threadTaskBudget, type ChannelSpend } from './bot-budget.ts';
import { questionChips, questionCount } from './suggestions.ts';
import { byteLength, firstSentence, guessLanguage, sensitiveMemory, trigramJaccard } from './text-rules.ts';
import { TransitionDenied, applyEvent, continueQuestion, newWorkItem, stateName, type MachineContext, type MachineEffect, type MachineRun } from './work-item-machine.ts';

/*
 * Bot 模式的服务（docs/design/bot-mode 技术方案 §3）：频道、任务状态机的副作用、线程路由（简报、转交、报告）、活动桥（回合与审批
 * 推导出的子状态、卡住检测、提醒）、并发闸门、智能提示与 Make。方法表（bot-handlers.ts）与智能体工具（bot-tools.ts）都调这里。
 *
 * 频道对话与线程都是普通的 Harness 会话（`role`）；任务存在 WorkItemStore，频道在 ChannelStore。
 */

// ---- 端口 ----

/** 工作区的事实（项目与视频）：种子回合、证据核验、Make 的事实核对、整体撤销。由 Runtime 接到视频服务上；测试给假的。 */
export interface BotWorkspace {
  /** 首次使用的事实（§13.5）：每行一个项目或视频，只有事实、没有内容。没有项目时空数组。 */
  facts(): Promise<string[]>;
  /** 一条证据（§9.5）：通过时 null，否则是原因。`since` 是任务最近一次进入 active 的时刻。 */
  verifyEvidence(evidence: Evidence, item: WorkItem, since: string): Promise<string | null>;
  /** Make 的事实核对（§11.3）：这类建议对这个对象是不是已经做过了。 */
  alreadyDone?(kindTag: string, ref: ResourceRef): Promise<boolean>;
  /** 一个资源的一行事实（Make 的收集）。 */
  describe?(ref: ResourceRef): Promise<string | null>;
  /** 整体撤销（BOT-EX-19）。 */
  revertPlan?(item: WorkItem): Promise<RevertPlan>;
  revert?(item: WorkItem, keepUserEdits: boolean): Promise<{ videoId: Id; version: number }[]>;
  /**
   * 线程的「改回去」：算出每部视频该回到哪一版（线程第一次动手之前，或指定的一版），不自己恢复；线程用视频工具去做，
   * 照样过它的授权、确认与保护范围。
   */
  revertThread?(item: WorkItem, to: 'before-thread' | number): Promise<{ videoId: Id; version: number; before: boolean }[]>;
  /** 线程等的 Job 是不是挂住了（§9.3 job-hung）：挂住的返回它的名字。 */
  hungJob?(jobIds: readonly Id[]): Promise<string | null>;
  /** 任务合同的用量占预算的比例（0–1），没有预算时 null。 */
  budgetUsed?(conversationId: Id, taskId: Id | null): number | null;
  /** 一组会话（频道对话与它的线程）从 `since.day` / `since.month` 起花掉的钱（§14.5）。 */
  channelSpend?(conversationIds: ReadonlySet<Id>, since: { day: string; month: string }): Promise<ChannelSpend>;
}

/** Make 的候选（§11.3 第 3 步的输出）。 */
export interface MakeCandidate {
  title: string;
  reason: string;
  kindTag: string;
  evidence: number[];
}

export interface MakeInput {
  channelName: string;
  purpose: string;
  memory: string;
  openTasks: string[];
  recentlyResolved: string[];
  userMessages: string[];
  facts: { index: number; line: string }[];
  language: string | null;
}

/** 文本能力（§11.3）：Runtime 接到 TextGenerator 上；测试给假的。 */
export interface MakeGenerator {
  suggest(input: MakeInput): Promise<MakeCandidate[]>;
}

/** 定时任务（§11.1）：建频道任务的周期任务，与频道归档、删除的联动。 */
export interface BotSchedules {
  createForChannel(params: { channel: Channel; name: string; cadence: unknown; template: WorkItemTemplate; accessMode: AgentMode | null }): Promise<Id>;
  countForChannel(channelId: Id): number;
  nextForStatus(): { scheduleId: Id; name: string; nextAt: string }[];
  channelChanged(channelId: Id): void;
  workItemChanged(item: WorkItem): void;
}

export interface BotClock {
  now(): number;
  setTimer(fn: () => void, ms: number): () => void;
}

export interface BotServiceOptions {
  harness: Harness;
  channels: ChannelStore;
  workItems: WorkItemStore;
  files: ChannelFiles;
  log: Logger;
  workspace: BotWorkspace;
  make?: MakeGenerator | null;
  schedules?: BotSchedules | null;
  /** 新频道的默认 Driver 与访问模式（偏好设置）。 */
  defaults: () => { driverId: DriverId | null; accessMode: AgentMode | null };
  clock?: BotClock;
  /** 种子回合等多久没写出消息就兜底（毫秒）。 */
  seedTimeoutMs?: number;
}

const systemClock: BotClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ONE_SHOT_GRACE_MS = 5 * MINUTE;
const NEEDS_REVIEW_STALE_DAYS = 3;
/** 建议任务默认的「本地、可撤销」类别（§11.3 第 4 步的白名单）。 */
const MAKE_KIND_ALLOW = /^(derive-|add-|translate|transcribe|export|tidy|cleanup|chapters|highlights|summar|review|caption|subtitle|cut|trim|shorts|thumbnail|title|organize|rename|fix-)/;
const MAKE_KIND_DENY = /(publish|upload|post|send|share|buy|pay|order|dub-online|clone)/;

type ActorRun = { actor: BotActor; run?: MachineRun | null; citedUserTyped?: boolean; confirmedIsTyped?: boolean; evidenceVerified?: boolean };

interface RunStart {
  workItemId: Id;
  status: WorkItem['status'];
  reported: boolean;
  resolvedInRefresh: boolean;
  origin: RunEvent['origin'];
}

interface PendingChips {
  conversationId: Id;
  taskId: Id;
  chips: SuggestionChip[];
  source: SuggestionsBody['source'];
}

export class BotService {
  readonly #harness: Harness;
  readonly #channels: ChannelStore;
  #loaded = false;
  readonly #store: WorkItemStore;
  readonly #files: ChannelFiles;
  readonly #log: Logger;
  readonly #workspace: BotWorkspace;
  readonly #make: MakeGenerator | null;
  #schedules: BotSchedules | null;
  readonly #defaults: BotServiceOptions['defaults'];
  readonly #clock: BotClock;
  readonly #seedTimeoutMs: number;

  readonly #items = new Map<Id, WorkItem>();
  readonly #reports = new Map<Id, ThreadReport>();
  readonly #transitions = new Map<Id, WorkItemTransition[]>();
  /** 频道今天与本月已花的钱（§14.5），投递前刷新，线程任务的预算上限由它算。 */
  readonly #spend = new Map<Id, ChannelSpend>();
  readonly #channelsTopic: TopicLog<ChannelsSnapshot, ChannelsEvent>;
  readonly #itemTopics = new Map<Id, TopicLog<WorkItemsSnapshot, WorkItemsEvent>>();
  readonly #runStarts = new Map<Id, RunStart>();
  /** 正在由我们投递的会话：这期间起的回合不是 Job 叫醒（§9.3）。 */
  readonly #expecting = new Set<Id>();
  /** 报告投递进了哪个回合（频道对话的 taskId → 报告）：回合结束没有转述时兜底（§8.3）。 */
  readonly #relayRuns = new Map<Id, ThreadReport[]>();
  /** 协调者的上一份报告挂在 held 里：等 onDelivered 再记到那一回合上。 */
  readonly #pendingChips = new Map<Id, PendingChips>();
  /** 要你在场才能跑的投递（§14.2）：用户点「继续」时以有人在场的回合重投。 */
  readonly #needsYou = new Map<Id, Delivery>();
  /** 频道对话接力之后下一回合带的种子（§6.3）。 */
  readonly #memoryWrites = new Map<string, Promise<void>>();
  readonly #handoffPending = new Set<Id>();
  /** 下一次用户回合的前置（§8.4 回复线程卡、§9.4 消歧），按会话。 */
  readonly #prelude = new Map<Id, string[]>();
  /** 种子回合：频道对话 → 取消超时。 */
  readonly #seedTimers = new Map<Id, () => void>();
  readonly #approvalSeen = new Map<Id, Id | null>();
  #cancelOneShot: (() => void) | null = null;
  #cancelWatchdog: (() => void) | null = null;
  #cancelHourly: (() => void) | null = null;
  readonly #unsubscribe: (() => void)[] = [];
  #stopped = false;

  constructor(options: BotServiceOptions) {
    this.#harness = options.harness;
    this.#channels = options.channels;
    this.#store = options.workItems;
    this.#files = options.files;
    this.#log = options.log.child('bot');
    this.#workspace = options.workspace;
    this.#make = options.make ?? null;
    this.#schedules = options.schedules ?? null;
    this.#defaults = options.defaults;
    this.#clock = options.clock ?? systemClock;
    this.#seedTimeoutMs = options.seedTimeoutMs ?? 60_000;
    this.#channelsTopic = new TopicLog(() => this.channelsSnapshot(), '0');
  }

  setSchedules(schedules: BotSchedules): void {
    this.#schedules = schedules;
  }

  // ---- 启动与停止 ----

  /** 读入频道与任务，接上 Harness，做重启对账（§8.6）。 */
  /**
   * 只读入频道与任务，不起任何东西。Runtime 在定时任务启动之前调用：定时任务核对 `work-item` 目标时要看得到已有的频道，
   * 否则会把它们当成没了而暂停。`start()` 没读过时自己读。
   */
  async load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    await this.#channels.load();
    for (const channel of this.#channels.list()) await this.#loadChannel(channel.id);
  }

  async start(): Promise<void> {
    await this.load();
    this.#harness.setTurnContext((conversation, kind) => this.#turnContext(conversation, kind));
    this.#harness.setTaskBudgetResolver((conversation) => this.#taskBudget(conversation));
    for (const channel of this.#channels.list()) await this.#refreshSpend(channel.id);
    // 回合上下文里的记忆来自缓存：对账可能马上投报告、起协调者回合，先把各频道的记忆与全局记忆读进来。
    for (const channel of this.#channels.list()) await this.refreshMemoryCache(channel.id);
    this.#unsubscribe.push(this.#harness.onRun((event) => this.#onRun(event)));
    const directory = this.#harness.subscribe('directory', undefined, (event) => {
      const directoryEvent = event.event as DirectoryEvent;
      if (directoryEvent.type === 'conversation.upsert') this.#onConversation(directoryEvent.conversation);
    });
    this.#unsubscribe.push(() => directory.unsubscribe?.());
    await this.#reconcile();
    this.#armOneShot();
    this.#armWatchdog();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    for (const off of this.#unsubscribe.splice(0)) off();
    this.#harness.setTurnContext(null);
    this.#harness.setTaskBudgetResolver(null);
    this.#cancelOneShot?.();
    this.#cancelWatchdog?.();
    this.#cancelHourly?.();
    for (const cancel of this.#seedTimers.values()) cancel();
    this.#seedTimers.clear();
    await this.#store.flush();
    await this.#channels.flush();
  }

  async #loadChannel(channelId: Id): Promise<void> {
    const log = await this.#store.load(channelId);
    for (const item of log.items) this.#items.set(item.id, item);
    for (const report of log.reports) this.#reports.set(report.id, report);
    this.#transitions.set(channelId, log.transitions);
  }

  /** §8.6 重启对账。 */
  async #reconcile(): Promise<void> {
    const now = nowIso();
    for (const item of [...this.#items.values()]) {
      if (item.status !== 'active') continue;
      const thread = item.threadId ? this.#harness.conversationOf(item.threadId) : undefined;
      if (item.threadId && !thread) {
        this.#log.warn('Thread conversation missing', { workItemId: item.id });
        await this.#force(item, { state: 'blocked', reason: RcBot.threadLost().text, question: continueQuestion() }, 'system:thread-lost', now);
        continue;
      }
      if (item.active?.state === 'working' && thread && thread.activity !== 'running' && thread.activity !== 'stopping') {
        await this.#force(item, { state: 'blocked', reason: RcBot.interruptedOnExit().text, question: continueQuestion() }, 'system:interrupted', now);
      }
    }
    // 有线程会话但没有任务的：归档成孤儿。
    for (const conversation of this.#harness.directorySnapshot().conversations) {
      if (conversation.role !== 'thread' || conversation.archived) continue;
      const item = conversation.workItemId ? this.#items.get(conversation.workItemId) : undefined;
      if (!item) {
        this.#log.warn('Orphan thread conversation', { conversationId: conversation.id });
        await this.#harness.updateConversation({ conversationId: conversation.id, archived: true }, { internal: BOT_INTERNAL }).catch(() => {});
      }
    }
    const pending = [...this.#reports.values()].filter((r) => r.delivery === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const report of pending) await this.#deliverReport(report, true);
    // 停机期间等的任务结了的：「已结」事件没赶上，这里对账一次（同样过并发闸门）。
    for (const item of [...this.#items.values()]) {
      if (item.status === 'active' && item.active?.state === 'waitingOnOthers') await this.#wakeIfReady(item, null);
    }
    await this.#pump();
  }

  /** 状态机之外的强制落点（重启对账）：直接写 active 子状态并记转换。 */
  async #force(item: WorkItem, to: { state: 'blocked'; reason: string; question: WorkItemQuestion }, cause: string, now: string): Promise<void> {
    const next: WorkItem = { ...item, active: { state: to.state, reason: to.reason, since: now }, question: to.question, updatedAt: now };
    await this.#commit(item, next, [{ workItemId: item.id, from: stateName(item), to: to.state, actor: 'system', cause, note: to.reason, at: now }], []);
  }

  // ---- 主题 ----

  channelsSnapshot(): ChannelsSnapshot {
    return { channels: this.#channels.list().map((c) => this.#summary(c)), settings: this.#channels.settings() };
  }

  subscribe(topic: string, afterSeq: string | undefined, listener: (event: never) => void) {
    if (topic === 'channels') return this.#channelsTopic.subscribe(afterSeq, listener as never);
    const channelId = topic.startsWith('work-items:') ? topic.slice('work-items:'.length) : null;
    if (channelId) return this.#topicOf(channelId).subscribe(afterSeq, listener as never);
    return null;
  }

  #topicOf(channelId: Id): TopicLog<WorkItemsSnapshot, WorkItemsEvent> {
    let topic = this.#itemTopics.get(channelId);
    if (!topic) {
      topic = new TopicLog(() => this.workItemsSnapshot(channelId), '0');
      this.#itemTopics.set(channelId, topic);
    }
    return topic;
  }

  workItemsSnapshot(channelId: Id): WorkItemsSnapshot {
    const all = this.#channelItems(channelId);
    const open = all.filter((i) => i.status !== 'resolved');
    const resolved = all
      .filter((i) => i.status === 'resolved')
      .sort((a, b) => (b.resolution?.at ?? b.updatedAt).localeCompare(a.resolution?.at ?? a.updatedAt))
      .slice(0, BOT_LIMITS.resolvedTail);
    const ids = new Set([...open, ...resolved].map((i) => i.id));
    const reports = [...this.#reports.values()].filter((r) => ids.has(r.workItemId) && this.#items.get(r.workItemId)?.lastReportId === r.id);
    return { items: [...open, ...resolved], resolvedTail: BOT_LIMITS.resolvedTail, reports };
  }

  #publishChannel(channel: Channel): void {
    this.#channelsTopic.publish({ type: 'channel.upsert', summary: this.#summary(channel) });
  }

  #summary(channel: Channel): ChannelSummary {
    const items = this.#channelItems(channel.id);
    const counts = { needsYou: 0, working: 0, upNext: 0, suggested: 0 };
    let last = channel.updatedAt;
    for (const item of items) {
      if (needsUser(item)) counts.needsYou++;
      else if (item.status === 'active' && item.active?.state === 'working') counts.working++;
      if (item.status === 'upNext' || item.status === 'scheduled') counts.upNext++;
      if (item.status === 'suggested') counts.suggested++;
      if (item.updatedAt > last) last = item.updatedAt;
    }
    const conversation = this.#harness.conversationOf(channel.conversationId);
    if (conversation && conversation.updatedAt > last) last = conversation.updatedAt;
    const unread = channel.lastSeen ? last > channel.lastSeen.at : items.length > 0;
    return { channel, unread, counts, lastActivityAt: last, spend: null };
  }

  // ---- 频道 ----

  listChannels(): ChannelSummary[] {
    return this.#channels.list().map((c) => this.#summary(c));
  }

  channel(id: Id): Channel {
    const channel = this.#channels.get(id);
    if (!channel) throw new RpcError('not-found', RcBot.channelNotFound({ id }));
    return channel;
  }

  channelOfConversation(conversationId: Id): Channel | undefined {
    const conversation = this.#harness.conversationOf(conversationId);
    return conversation?.channelId ? this.#channels.get(conversation.channelId) : undefined;
  }

  settings(): BotSettings {
    return this.#channels.settings();
  }

  async updateSettings(patch: Partial<BotSettings>): Promise<BotSettings> {
    const next = { ...DEFAULT_BOT_SETTINGS, ...this.#channels.settings(), ...patch };
    await this.#channels.setSettings(next);
    this.#channelsTopic.publish({ type: 'bot.settings', settings: next });
    this.#armOneShot();
    return next;
  }

  async ensureMain(): Promise<Channel> {
    return this.#channels.withLock(async () => {
      const existing = this.#channels.get(MAIN_CHANNEL_ID);
      if (existing) return existing;
      const channel = await this.#createChannel({ id: MAIN_CHANNEL_ID, kind: 'main', name: RcBot.mainChannelName().text, purpose: '' });
      void this.#seed(channel).catch((error: unknown) => this.#log.warn('Seed turn failed', { error: String(error) }));
      return channel;
    });
  }

  async createChannel(params: {
    name: string;
    purpose?: string;
    templateId?: string | null;
    driverId?: DriverId;
    model?: string | null;
    effort?: string | null;
    defaultAccessMode?: AgentMode | null;
    outputLanguage?: string | null;
  }): Promise<Channel> {
    const channel = await this.#createChannel({ id: newId('chan'), kind: 'topic', ...params, purpose: params.purpose ?? '' });
    await this.#writeWelcome(channel, false);
    void this.runMake(channel.id, 'channel-created').catch(() => {});
    return channel;
  }

  async #createChannel(params: {
    id: Id;
    kind: Channel['kind'];
    name: string;
    purpose: string;
    templateId?: string | null;
    driverId?: DriverId;
    model?: string | null;
    effort?: string | null;
    defaultAccessMode?: AgentMode | null;
    outputLanguage?: string | null;
  }): Promise<Channel> {
    const defaults = this.#defaults();
    const { filesDir } = await this.#files.ensure(params.id);
    const wantedDriver = params.driverId ?? defaults.driverId ?? undefined;
    const accessMode = params.defaultAccessMode ?? defaults.accessMode;
    const conversation = await this.#harness.createConversation(
      {
        title: params.name,
        ...(wantedDriver ? { driverId: wantedDriver } : {}),
        ...(params.model ? { model: params.model } : {}),
        ...(params.effort ? { effort: params.effort } : {}),
        ...(accessMode ? { accessMode } : {}),
      },
      undefined,
      { role: 'channel', channelId: params.id, cwd: filesDir },
    );
    const driverId = conversation.driverId;
    const now = nowIso();
    const channel: Channel = {
      id: params.id,
      kind: params.kind,
      name: params.name,
      purpose: params.purpose,
      conversationId: conversation.id,
      driverId,
      model: conversation.model ?? null,
      effort: conversation.effort ?? null,
      defaultAccessMode: params.defaultAccessMode ?? null,
      maxAccessMode: null,
      templateId: params.templateId ?? null,
      pinned: params.kind === 'main',
      archived: false,
      archivedAt: null,
      limits: { concurrentThreads: BOT_LIMITS.concurrentThreads, dailyBudget: null, monthlyBudget: null },
      outputLanguage: params.outputLanguage ?? null,
      private: false,
      muted: false,
      stallMinutes: null,
      lastSeen: null,
      memoryVersion: 0,
      seedPending: null,
      unwantedKinds: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.#channels.put(channel);
    this.#transitions.set(channel.id, []);
    this.#publishChannel(channel);
    return channel;
  }

  /** 首次使用的种子回合（§13.5）：有项目时起协调者回合，否则写静态的第一条消息。 */
  async #seed(channel: Channel): Promise<void> {
    const facts = await this.#workspace.facts().catch(() => []);
    if (facts.length === 0) {
      await this.#writeWelcome(channel, false);
      return;
    }
    const block = workspaceFactsBlock(facts);
    const text = [
      block,
      'This is the first time the user opens BaoCut in bot mode. Write one short first message: greet them, say in a sentence what you can see in their workspace, and what you can help with. Then offer two to four starter suggestions with suggest_replies (kind "starter"). Do not create tasks.',
    ].join('\n\n');
    const outcome = await this.#harness.deliver({
      id: `seed_${channel.id}`,
      conversationId: channel.conversationId,
      item: { direction: 'make', workItemId: null, reportId: null, from: { role: 'system', conversationId: null }, text: '', cited: [] },
      agentText: text,
      wake: 'new-task',
      origin: 'seed',
      goal: RcBot.welcome().text,
      unattended: true,
    });
    if (outcome.result !== 'started') {
      await this.#seedFallback(channel, block);
      return;
    }
    this.#seedTimers.set(
      channel.conversationId,
      this.#clock.setTimer(() => {
        this.#seedTimers.delete(channel.conversationId);
        if (!this.#hasAgentMessage(channel.conversationId, outcome.taskId)) {
          void this.#harness.interrupt(channel.conversationId).catch(() => {});
          void this.#seedFallback(channel, block);
        }
      }, this.#seedTimeoutMs),
    );
  }

  async #seedFallback(channel: Channel, facts: string): Promise<void> {
    const current = this.#channels.get(channel.id) ?? channel;
    await this.#putChannel({ ...current, seedPending: facts });
    await this.#writeWelcome(current, true);
  }

  async #writeWelcome(channel: Channel, withFacts: boolean): Promise<void> {
    const id = `welcome_${channel.id}`;
    if (this.#findItem(channel.conversationId, id)) return;
    const facts = withFacts ? await this.#workspace.facts().catch(() => []) : [];
    const projects = facts.filter((f) => f.startsWith('project')).length;
    const videos = facts.filter((f) => f.startsWith('video') || f.startsWith('  video')).length;
    const text = projects ? RcBot.welcomeWithProjects({ projects, videos }).text : RcBot.welcome().text;
    this.#harness.writeItem(channel.conversationId, { kind: 'agent-message', id, createdAt: nowIso(), taskId: null, text, streaming: false, fallback: true });
    const starter = (label: string, text: string): SuggestionChip => ({
      id: newId('chip'),
      label,
      text,
      kind: 'starter',
      kindTag: null,
      fillOnly: true,
      recommended: false,
      answers: null,
      target: null,
      action: null,
    });
    this.#writeSuggestions(channel.conversationId, id, 'system', [
      starter(RcBot.starterSummarize().text, RcBot.starterSummarizeText().text),
      starter(RcBot.starterCaptions().text, RcBot.starterCaptionsText().text),
      starter(RcBot.starterHighlights().text, RcBot.starterHighlightsText().text),
    ]);
  }

  async updateChannel(id: Id, patch: ChannelPatch): Promise<Channel> {
    const channel = this.channel(id);
    const { concurrentThreads, dailyBudget, monthlyBudget, ...rest } = patch;
    const next: Channel = {
      ...channel,
      ...rest,
      limits: {
        concurrentThreads: concurrentThreads ?? channel.limits.concurrentThreads,
        dailyBudget: dailyBudget !== undefined ? dailyBudget : channel.limits.dailyBudget,
        monthlyBudget: monthlyBudget !== undefined ? monthlyBudget : channel.limits.monthlyBudget,
      },
      updatedAt: nowIso(),
    };
    const conversationPatch: Parameters<Harness['updateConversation']>[0] = { conversationId: channel.conversationId };
    if (patch.name !== undefined) conversationPatch.title = patch.name;
    if (patch.driverId !== undefined) conversationPatch.driverId = patch.driverId;
    if (patch.model !== undefined) conversationPatch.model = patch.model;
    if (patch.effort !== undefined) conversationPatch.effort = patch.effort;
    // 频道的默认模式也不能越过上限（§14.4）：协调者会话按压过的模式走。
    if (patch.defaultAccessMode !== undefined && patch.defaultAccessMode !== null) {
      conversationPatch.accessMode = minMode(patch.defaultAccessMode, next.maxAccessMode ?? null) ?? patch.defaultAccessMode;
    } else if (next.defaultAccessMode && (next.maxAccessMode ?? null) !== (channel.maxAccessMode ?? null)) {
      // 上限变了：协调者回到「默认模式压到新上限」，上限放宽时也能回到频道设的默认。
      conversationPatch.accessMode = minMode(next.defaultAccessMode, next.maxAccessMode ?? null) ?? next.defaultAccessMode;
    }
    // 先改会话（换 Driver 可能因为协调者正忙而失败），成功了再存频道，免得频道和会话对不上。
    if (Object.keys(conversationPatch).length > 1) {
      await this.#harness.updateConversation(conversationPatch, { internal: BOT_INTERNAL });
    }
    await this.#putChannel(next);
    if (dailyBudget !== undefined || monthlyBudget !== undefined) await this.#refreshSpend(id);
    // 上限压低了（§14.4）：频道与已有线程里高于上限的模式一起压下来，直接发给它们的消息也不会越过上限。
    if (next.maxAccessMode && next.maxAccessMode !== channel.maxAccessMode) {
      const max = next.maxAccessMode;
      const ids = [next.conversationId, ...this.#channelItems(id).flatMap((i) => (i.threadId ? [i.threadId] : []))];
      for (const conversationId of ids) {
        const mode = this.#threadMode(conversationId);
        if (!mode || rank(mode) <= rank(max)) continue;
        await this.#harness.updateConversation({ conversationId, accessMode: max }, { internal: BOT_INTERNAL }).catch((error: unknown) =>
          this.#log.warn('Lowering a conversation to the channel ceiling failed', { conversationId, error: String(error) }),
        );
      }
    }
    // 换了 Driver 或模型：接力到新的原生会话（§6.3），换 Driver 时写一行。
    if ((patch.driverId !== undefined && patch.driverId !== channel.driverId) || (patch.model !== undefined && patch.model !== channel.model)) {
      await this.#handoff(channel.conversationId, patch.driverId !== undefined && patch.driverId !== channel.driverId ? patch.driverId : null);
    }
    if (patch.purpose !== undefined || patch.name !== undefined) this.#harness.instructionsChanged();
    if (patch.concurrentThreads !== undefined) await this.#pump();
    return next;
  }

  async archiveChannel(id: Id, archived: boolean): Promise<Channel> {
    const channel = this.channel(id);
    if (channel.kind === 'main') throw new RpcError('invalid-request', RcBot.mainChannelLocked());
    const next = { ...channel, archived, archivedAt: archived ? nowIso() : null, updatedAt: nowIso() };
    // 先标归档再停任务：停下空出的名额不能被这个频道里排队的任务接走（#pump 与 #launch 跳过归档的频道）。
    if (archived) await this.#putChannel(next);
    if (archived) {
      // 归档等于用户把频道里在做的任务都停下（§5.6）：走 stop，任务转为停下（不再占并发名额），线程的回合也停掉。
      for (const listed of this.#channelItems(id)) {
        const item = this.#items.get(listed.id) ?? listed;
        if (item.status !== 'active' || !item.threadId) continue;
        if (item.owner === 'agent' && item.active?.state !== 'blocked') {
          const stopped = await this.transition(item.id, { type: 'stop' } as never, { actor: 'user' }).then(
            () => true,
            () => false,
          );
          if (stopped) continue;
        }
        await this.#stopThread(item);
      }
    }
    if (!archived) await this.#putChannel(next);
    await this.#harness.updateConversation({ conversationId: channel.conversationId, archived }, { internal: BOT_INTERNAL });
    this.#schedules?.channelChanged(id);
    // 恢复时补投挂起的报告（§8.3 dropped 的那一类）。
    if (!archived) for (const r of [...this.#reports.values()].filter((r) => r.delivery === 'pending')) await this.#deliverReport(r, true);
    // 归档的频道不跑到点的条目与排队的任务；恢复时补上。
    if (archived) this.#armOneShot();
    else {
      await this.#pump();
      await this.fireDue();
    }
    return next;
  }

  async deleteChannel(id: Id, confirm: { threads: number; schedules: number }): Promise<void> {
    const channel = this.channel(id);
    if (channel.kind === 'main') throw new RpcError('invalid-request', RcBot.mainChannelLocked());
    const items = this.#channelItems(id);
    const threads = items.filter((i) => i.threadId).length;
    const schedules = this.#schedules?.countForChannel(id) ?? 0;
    if (threads !== confirm.threads || schedules !== confirm.schedules) {
      throw new RpcError('conflict', RcBot.channelDeleteCountsChanged(), { threads, schedules });
    }
    for (const item of items) {
      if (item.status === 'active' && item.threadId) await this.#stopThread(item).catch(() => {});
      if (item.threadId) await this.#harness.deleteConversation(item.threadId, { internal: BOT_INTERNAL }).catch(() => {});
      this.#items.delete(item.id);
      for (const r of [...this.#reports.values()]) if (r.workItemId === item.id) this.#reports.delete(r.id);
    }
    await this.#harness.deleteConversation(channel.conversationId, { internal: BOT_INTERNAL }).catch(() => {});
    await this.#store.deleteChannel(id);
    await this.#files.remove(id);
    await this.#channels.remove(id);
    this.#transitions.delete(id);
    this.#channelsTopic.publish({ type: 'channel.removed', id });
    this.#schedules?.channelChanged(id);
  }

  async readMemory(id: Id): Promise<{ content: string; version: number }> {
    const channel = this.channel(id);
    return { content: await this.#files.readMemory(id), version: channel.memoryVersion };
  }

  /** 写频道记忆（§5.4、§13.3）：版本、16 KiB、敏感内容。 */
  async writeMemory(id: Id, content: string, ifVersion: number): Promise<{ version: number; content?: string }> {
    // 版本核对、写文件、版本加一是一件事：同一份记忆的写一个接一个来，同一个 ifVersion 的第二次写拿到冲突，不会悄悄盖掉第一次的。
    return this.#memorySerial(`channel:${id}`, async () => {
      const channel = this.channel(id);
      if (ifVersion !== channel.memoryVersion) {
        throw new RpcError('conflict', RcBot.memoryVersionConflict(), { version: channel.memoryVersion, content: await this.#files.readMemory(id) });
      }
      this.#checkMemory(content, BOT_LIMITS.channelMemoryBytes);
      await this.#files.writeMemory(id, content);
      // 写完就更新缓存：之后的自动回合（报告、简报）也拿到新的规则。
      this.#memoryCache.set(id, content);
      this.#rulesCache.set(id, rulesSection(content));
      const next = { ...this.channel(id), memoryVersion: channel.memoryVersion + 1, updatedAt: nowIso() };
      await this.#putChannel(next);
      return { version: next.memoryVersion };
    });
  }

  async readUserMemory(): Promise<{ content: string; version: number }> {
    return { content: await this.#files.readUserMemory(), version: this.#channels.userMemoryVersion() };
  }

  async writeUserMemory(content: string, ifVersion: number): Promise<{ content: string; version: number }> {
    return this.#memorySerial('user', async () => {
      const version = this.#channels.userMemoryVersion();
      if (ifVersion !== version) throw new RpcError('conflict', RcBot.memoryVersionConflict(), { version, content: await this.#files.readUserMemory() });
      this.#checkMemory(content, BOT_LIMITS.userMemoryBytes);
      await this.#files.writeUserMemory(content);
      this.#userMemoryCache = content;
      await this.#channels.setUserMemoryVersion(version + 1);
      return { content, version: version + 1 };
    });
  }

  /** 同一份记忆的写排成一队（前一个失败不影响后一个）。 */
  #memorySerial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.#memoryWrites.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.then(() => {}, () => {});
    this.#memoryWrites.set(key, tail);
    void tail.then(() => {
      if (this.#memoryWrites.get(key) === tail) this.#memoryWrites.delete(key);
    });
    return run;
  }

  #checkMemory(content: string, max: number): void {
    if (byteLength(content) > max) throw new RpcError('invalid-request', RcBot.memoryTooLarge({ max: Math.round(max / 1024) }), { code: 'MEMORY_TOO_LARGE' });
    const sensitive = sensitiveMemory(content);
    if (sensitive) throw new RpcError('invalid-request', RcBot.memorySensitive(), { code: 'MEMORY_SENSITIVE', reason: sensitive });
  }

  async markSeen(id: Id, itemId: Id | null): Promise<Channel> {
    const channel = this.channel(id);
    const next = { ...channel, lastSeen: { at: nowIso(), itemId } };
    await this.#putChannel(next);
    return next;
  }

  /** 导出一个频道（记忆、任务、对话）到用户选的目录。 */
  async exportChannel(id: Id, dir: string): Promise<string> {
    const channel = this.channel(id);
    const target = path.join(dir, `${channel.name.replace(/[\\/:*?"<>|]/g, '_')}-${channel.id}`);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'MEMORY.md'), await this.#files.readMemory(id));
    const items = this.#channelItems(id);
    await fs.writeFile(path.join(target, 'tasks.json'), JSON.stringify({ channel, items, reports: [...this.#reports.values()].filter((r) => items.some((i) => i.id === r.workItemId)) }, null, 2));
    const lines = this.#harness
      .getConversation(channel.conversationId)
      .items.filter((i) => i.kind === 'user-message' || i.kind === 'agent-message')
      .map((i) => `**${i.kind === 'user-message' ? 'You' : 'BaoCut'}** (${i.createdAt})\n\n${(i as { text: string }).text}\n`);
    await fs.writeFile(path.join(target, 'conversation.md'), lines.join('\n'));
    return target;
  }

  async #putChannel(channel: Channel): Promise<void> {
    await this.#channels.put(channel);
    this.#publishChannel(channel);
  }

  // ---- 任务：读 ----

  #channelItems(channelId: Id): WorkItem[] {
    return [...this.#items.values()].filter((i) => i.channelId === channelId);
  }

  listItems(channelId: Id, status?: WorkItem['status']): WorkItem[] {
    this.channel(channelId);
    return this.#channelItems(channelId).filter((i) => !status || i.status === status);
  }

  item(id: Id): WorkItem {
    const item = this.#items.get(id);
    if (!item) throw new RpcError('not-found', RcBot.workItemNotFound({ id }));
    return item;
  }

  itemOrNull(id: Id): WorkItem | undefined {
    return this.#items.get(id);
  }

  getItem(id: Id): { item: WorkItem; transitions: WorkItemTransition[]; reports: ThreadReport[] } {
    const item = this.item(id);
    return {
      item,
      transitions: (this.#transitions.get(item.channelId) ?? []).filter((t) => t.workItemId === id),
      reports: [...this.#reports.values()].filter((r) => r.workItemId === id),
    };
  }

  /** 线程能打开视频的项目（技术方案 §7.1、BOT-VE-02）：任务资源里的视频所在的项目。cwd 仍是频道文件目录。别的会话没有。 */
  videoProjectsOf(conversation: Pick<Conversation, 'id' | 'role'>): Id[] {
    if (conversation.role !== 'thread') return [];
    const item = this.itemOfThread(conversation.id);
    if (!item) return [];
    const ids = new Set<Id>();
    for (const ref of item.resources) if (ref.kind === 'video' || ref.kind === 'video-range') ids.add(ref.projectId);
    return [...ids];
  }

  itemOfThread(conversationId: Id): WorkItem | undefined {
    const conversation = this.#harness.conversationOf(conversationId);
    return conversation?.workItemId ? this.#items.get(conversation.workItemId) : undefined;
  }

  report(id: Id): ThreadReport | undefined {
    return this.#reports.get(id);
  }

  /** 本频道未解决、与这段文字相似的任务（§10.5）。 */
  duplicatesOf(channelId: Id, text: string, resources: ResourceRef[], exclude?: Id): WorkItem[] {
    const key = JSON.stringify(resources);
    return this.#channelItems(channelId).filter(
      (i) =>
        i.id !== exclude &&
        i.status !== 'resolved' &&
        (trigramJaccard(`${i.title} ${i.description}`, text) >= 0.6 || (resources.length > 0 && JSON.stringify(i.resources) === key)),
    );
  }

  // ---- 任务：写 ----

  async createItem(
    fields: Pick<WorkItem, 'channelId' | 'title' | 'owner'> & Partial<WorkItem>,
    options: { start?: boolean; attended?: boolean; brief?: string; cited?: CitedMessage[]; fileOwnership?: string | null } = {},
  ): Promise<WorkItem> {
    const channel = this.channel(fields.channelId);
    if (channel.archived) throw new RpcError('invalid-request', RcBot.channelArchived());
    const now = nowIso();
    const item = newWorkItem({ id: newId('wi'), ...fields }, now);
    this.#items.set(item.id, item);
    await this.#store.putItem(item.channelId, item, { sync: true });
    this.#topicOf(item.channelId).publish({ type: 'work-item.upsert', item });
    this.#publishChannel(channel);
    if (options.start && item.owner === 'agent') {
      return this.#startItem(item, options);
    }
    return item;
  }

  /** 让一条 upNext 的任务开工（工具 `thread_start`、用户的「开始」）。闸门满时排队。 */
  async #startItem(item: WorkItem, options: { attended?: boolean; brief?: string; cited?: CitedMessage[]; fileOwnership?: string | null }): Promise<WorkItem> {
    const result = await this.transition(item.id, { type: 'start' }, { actor: 'system' }, options);
    return result;
  }

  async startItem(id: Id, options: { attended: boolean; brief?: string; cited?: CitedMessage[]; fileOwnership?: string | null }): Promise<{ item: WorkItem; queued: boolean; position: number }> {
    const item = this.item(id);
    if (item.owner === 'user') throw new RpcError('invalid-request', RcBot.userTasksNoThread());
    const after = await this.transition(id, { type: 'start' }, { actor: 'system' }, options);
    const queued = after.status === 'upNext';
    return { item: after, queued, position: queued ? this.#queuePosition(after) : 0 };
  }

  async updateItem(id: Id, patch: WorkItemPatch & { by?: BotActor }): Promise<WorkItem> {
    const item = this.item(id);
    const channel = this.channel(item.channelId);
    if (patch.overrides?.accessMode && channel.maxAccessMode && rank(patch.overrides.accessMode) > rank(channel.maxAccessMode)) {
      throw new RpcError('invalid-request', RcBot.accessAboveChannelMax());
    }
    const { by = 'user', ...rest } = patch;
    const next: WorkItem = { ...item, ...rest, updatedAt: nowIso() };
    if (rest.title !== undefined && by === 'user') next.titleBy = 'user';
    if (rest.overrides && item.overrides?.budget !== rest.overrides.budget) next.budgetWarnedAt = null;
    await this.#commit(item, next, [], []);
    return next;
  }

  /** 智能体工具对任务内容的修改（步骤、更新、资源、产物）：不改状态，只刷新进展时刻。 */
  async patchItemContent(id: Id, fn: (item: WorkItem) => WorkItem, progress: boolean): Promise<WorkItem> {
    const item = this.item(id);
    const next = fn(structuredClone(item));
    next.updatedAt = nowIso();
    if (progress) next.lastProgressAt = next.updatedAt;
    await this.#commit(item, next, [], []);
    return next;
  }

  /** 状态机的唯一入口（§9.1）。拒绝时抛 RpcError（RPC）或原样抛 TransitionDenied（工具层再换成 ToolError）。 */
  async transition(
    id: Id,
    event: WorkItemEvent,
    who: ActorRun,
    startOptions: { attended?: boolean; brief?: string; cited?: CitedMessage[]; fileOwnership?: string | null } = {},
  ): Promise<WorkItem> {
    const item = this.item(id);
    const channel = this.channel(item.channelId);
    const ctx: MachineContext = {
      actor: who.actor,
      now: nowIso(),
      run: who.run ?? null,
      ...(who.citedUserTyped !== undefined ? { citedUserTyped: who.citedUserTyped } : {}),
      ...(who.confirmedIsTyped !== undefined ? { confirmedIsTyped: who.confirmedIsTyped } : {}),
      ...(who.evidenceVerified !== undefined ? { evidenceVerified: who.evidenceVerified } : {}),
      stallMinutes: channel.stallMinutes ?? this.settings().stallMinutes,
    };
    if (event.type === 'report' && who.run) {
      const info = this.#runStarts.get(this.#harness.runInfo(who.run.conversationId)?.taskId ?? '');
      if (info?.resolvedInRefresh) ctx.resolvedInThisRefresh = true;
    }
    const result = applyEvent(item, event, ctx);
    if (result.item === item) return item;
    if (event.type === 'resolve' && who.actor === 'thread' && who.run?.origin === 'refresh') {
      const info = this.#runStarts.get(this.#harness.runInfo(who.run.conversationId)?.taskId ?? '');
      if (info) info.resolvedInRefresh = true;
    }
    await this.#commit(item, result.item, result.transitions, result.effects, startOptions);
    return this.#items.get(id) ?? result.item;
  }

  /** 用户方法（`workItems.transition`）：拒绝换成 RpcError。 */
  async userTransition(id: Id, event: UserWorkItemEvent): Promise<WorkItem> {
    try {
      return await this.transition(id, event, { actor: 'user' }, { attended: true });
    } catch (error) {
      if (error instanceof TransitionDenied) throw new RpcError('invalid-request', error.message, { code: 'TRANSITION_DENIED', reason: error.reason });
      throw error;
    }
  }

  async stopItem(id: Id): Promise<WorkItem> {
    return this.userTransition(id, { type: 'stop' } as never).catch(async (error: unknown) => {
      // 「停止」也用在 upNext 排队的任务上：去掉排队标记。
      const item = this.item(id);
      if (item.status === 'upNext' && item.reminded.includes('queued')) {
        const next = { ...item, reminded: item.reminded.filter((r) => r !== 'queued') };
        await this.#commit(item, next, [], []);
        return next;
      }
      throw error;
    });
  }

  async redirectItem(id: Id, text: string, oldWork: 'stop' | 'keep'): Promise<WorkItem> {
    const item = this.item(id);
    const thread = item.threadId ? this.#harness.conversationOf(item.threadId) : undefined;
    const taskId = thread ? this.#lastTaskId(thread.id) : null;
    if (!thread || !taskId) throw new RpcError('invalid-request', RcBot.transitionDenied({ from: stateName(item), event: 'redirect' }));
    this.#expecting.add(thread.id);
    try {
      await this.#harness.changeGoal({ taskId, goal: text, previousWork: oldWork, commandId: newId('cmd') });
    } finally {
      this.#expecting.delete(thread.id);
    }
    const now = nowIso();
    const next: WorkItem = { ...item, status: 'active', active: { state: 'working', reason: null, since: now }, question: null, lastProgressAt: now, updatedAt: now };
    await this.#commit(item, next, [{ workItemId: id, from: stateName(item), to: 'working', actor: 'user', cause: 'user:redirect', note: null, at: now }], []);
    return next;
  }

  /** 刷新（BOT-EX-08）：只投给线程，无人在场。 */
  async refreshItem(id: Id, reason: 'manual' | 'patrol' = 'manual'): Promise<DeliveryResult> {
    const item = this.item(id);
    if (!item.threadId) return 'dropped';
    const changes: string[] = [];
    if (item.question?.approvalId) changes.push('The earlier question may no longer apply; check whether its approval is still pending.');
    const minute = Math.floor(this.#clock.now() / MINUTE);
    const outcome = await this.#deliverToThread(item, {
      id: `refresh_${item.id}_${minute}`,
      direction: 'refresh',
      text: refreshBlock(reason, changes),
      origin: 'refresh',
      unattended: true,
      note: '',
    });
    return outcome.result;
  }

  async moveItem(id: Id, toChannelId: Id): Promise<WorkItem> {
    const item = this.item(id);
    const from = this.channel(item.channelId);
    const to = this.channel(toChannelId);
    if (to.archived) throw new RpcError('invalid-request', RcBot.channelArchived());
    if (item.channelId === toChannelId) return item;
    const thread = item.threadId ? this.#harness.conversationOf(item.threadId) : undefined;
    // 线程还有进行中的任务（在跑、在停、在等审批或回答）时不能搬：先查完整的条件，再动任何文件。
    if (thread && (thread.activeTaskId || thread.activity === 'running' || thread.activity === 'stopping' || thread.activity.startsWith('awaiting'))) {
      throw new RpcError('busy', RcBot.transitionDenied({ from: stateName(item), event: 'move' }));
    }
    const reports = [...this.#reports.values()].filter((r) => r.workItemId === id);
    // 任务的文件跟着走（BOT-TK-09）：线程的工作目录换成新频道的文件夹，它的输入输出也得在那里；别的任务也在用的复制一份。
    const { filesDir } = await this.#files.ensure(to.id);
    const fromDir = this.#files.filesDir(from.id);
    const ownRefs = [...item.resources, ...item.outputs, ...reports.flatMap((r) => r.outputs)];
    const others = this.#channelItems(from.id).filter((i) => i.id !== id);
    const shared = new Set(others.flatMap((i) => taskFilePaths(fromDir, i.files, [...i.resources, ...i.outputs])));
    const carried = await carryTaskFiles({ fromDir, toDir: filesDir, paths: taskFilePaths(fromDir, item.files, ownRefs), shared });
    // 线程跟着走：线程会话换到新频道与它的工作目录，工作笔记搬过去，免得记忆、笔记与删除旧频道时对不上。
    if (thread && item.threadId) {
      const oldNotes = path.dirname(this.#files.notesPath(from.id, item.threadId));
      const newNotes = path.dirname(this.#files.notesPath(to.id, item.threadId));
      let notesMoved = false;
      try {
        await fs.mkdir(path.dirname(newNotes), { recursive: true });
        notesMoved = true;
        await fs.rename(oldNotes, newNotes).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          notesMoved = false;
        });
        await this.#harness.moveThread(item.threadId, { channelId: to.id, cwd: filesDir }, { internal: BOT_INTERNAL });
      } catch (error) {
        // 会话没搬成：笔记与文件搬回原处，任务、会话、笔记与文件仍在原频道。
        if (notesMoved) await fs.rename(newNotes, oldNotes).catch(() => {});
        await carried.undo();
        throw error;
      }
    }
    const rewrite = <T extends ResourceRef | ArtifactRef>(ref: T): T => rewriteFileRef(ref, fromDir, filesDir, carried.renamed);
    const next: WorkItem = {
      ...item,
      channelId: toChannelId,
      resources: item.resources.map(rewrite),
      outputs: item.outputs.map(rewrite),
      files: item.files.map((f) => {
        const rel = relativeInside(fromDir, f);
        return (rel && carried.renamed.get(rel)) ?? f;
      }),
      updatedAt: nowIso(),
    };
    // 等你在场再投的那一份也跟着走。
    const held = this.#needsYou.get(id) ?? heldFrom(await this.#files.readHeld(from.id, id).catch(() => null), item);
    if (held) {
      await this.#hold(next, held);
      await this.#files.removeHeld(from.id, id).catch(() => {});
    }
    // 排队任务的开工内容跟着走。
    const queued = this.#queuedBriefs.get(id) ?? launchFrom(await this.#files.readQueued(from.id, id).catch(() => null));
    if (queued) {
      await this.#queueLaunch(next, queued);
      await this.#files.removeQueued(from.id, id).catch(() => {});
    }
    // 报告与转换记录跟着任务走：先写进新频道，再从旧频道删（旧频道的 removed 会把它们一起清掉）。
    const movedReports = reports.map((r) => ({ ...r, outputs: r.outputs.map(rewrite) }));
    for (const report of movedReports) this.#reports.set(report.id, report);
    const fromLog = this.#transitions.get(from.id) ?? [];
    const moved = fromLog.filter((t) => t.workItemId === id);
    this.#items.set(id, next);
    await this.#store.putItem(to.id, next, { sync: true });
    for (const report of movedReports) await this.#store.appendReport(to.id, report);
    for (const transition of moved) await this.#store.appendTransition(to.id, transition);
    await this.#store.removeItem(from.id, id);
    this.#transitions.set(from.id, fromLog.filter((t) => t.workItemId !== id));
    this.#transitions.set(to.id, [...(this.#transitions.get(to.id) ?? []), ...moved].sort((a, b) => a.at.localeCompare(b.at)).slice(-2000));
    this.#topicOf(from.id).publish({ type: 'work-item.removed', id });
    this.#topicOf(to.id).publish({ type: 'work-item.upsert', item: next });
    const note = (conversationId: Id, text: string) =>
      this.#harness.writeItem(conversationId, {
        kind: 'relay',
        id: newId('relay'),
        createdAt: nowIso(),
        taskId: null,
        direction: 'moved',
        workItemId: id,
        reportId: null,
        from: { role: 'system', conversationId: null },
        text,
        cited: [],
      });
    note(to.conversationId, RcBot.movedFrom({ channel: from.name }).text);
    note(from.conversationId, `${item.title} → ${to.name}`);
    this.#publishChannel(from);
    this.#publishChannel(to);
    return next;
  }

  async revertAll(id: Id, dryRun: boolean, keepUserEdits: boolean): Promise<{ plan: RevertPlan } | { restored: { videoId: Id; version: number }[] }> {
    const item = this.item(id);
    if (dryRun) {
      if (!this.#workspace.revertPlan) return { plan: { videos: [] } };
      return { plan: await this.#workspace.revertPlan(item) };
    }
    if (!this.#workspace.revert) return { restored: [] };
    const plan = this.#workspace.revertPlan ? await this.#workspace.revertPlan(item) : { videos: [] };
    if (keepUserEdits) {
      const blocked = plan.videos.find((v) => !v.agentOnlyPossible);
      if (blocked) throw new RpcError('conflict', blocked.reason ?? RcBot.revertMixedVersion({ video: blocked.videoId, version: blocked.baseVersion }), { videoId: blocked.videoId });
    }
    return { restored: await this.#workspace.revert(item, keepUserEdits) };
  }

  /** 线程的「改回去」（工具 `work_items_revert`）：只给出该回到的版本，恢复由线程用视频工具做。 */
  async revertThread(item: WorkItem, to: 'before-thread' | number): Promise<{ videoId: Id; version: number; before: boolean }[]> {
    if (!this.#workspace.revertThread) throw new RpcError('unsupported', RcBot.makeNoGenerator());
    return this.#workspace.revertThread(item, to);
  }

  /** 删除任务记录（BOT-EX-20）：dryRun 列出会删的与保留的文件。 */
  async deleteRecord(id: Id, dryRun: boolean, confirm?: { files: string[] }): Promise<{ files: string[]; keptShared: string[]; deleted: boolean }> {
    const item = this.item(id);
    const others = new Set(this.#channelItems(item.channelId).filter((i) => i.id !== id).flatMap((i) => i.files));
    const files = item.files.filter((f) => !others.has(f));
    const keptShared = item.files.filter((f) => others.has(f));
    if (dryRun) return { files, keptShared, deleted: false };
    if (!confirm || JSON.stringify([...confirm.files].sort()) !== JSON.stringify([...files].sort())) {
      throw new RpcError('conflict', RcBot.channelDeleteCountsChanged(), { files, keptShared });
    }
    if (item.status === 'active' && item.threadId) await this.#stopThread(item).catch(() => {});
    const base = this.#files.filesDir(item.channelId);
    for (const file of files) {
      const full = path.resolve(base, file);
      if (!full.startsWith(base + path.sep)) continue;
      await fs.rm(full, { force: true }).catch(() => {});
    }
    if (item.threadId) {
      await fs.rm(path.dirname(this.#files.notesPath(item.channelId, item.threadId)), { recursive: true, force: true }).catch(() => {});
      await this.#harness.deleteConversation(item.threadId, { internal: BOT_INTERNAL }).catch(() => {});
    }
    this.#items.delete(id);
    for (const r of [...this.#reports.values()]) if (r.workItemId === id) this.#reports.delete(r.id);
    await this.#store.removeItem(item.channelId, id);
    this.#topicOf(item.channelId).publish({ type: 'work-item.removed', id });
    this.#publishChannel(this.channel(item.channelId));
    return { files, keptShared, deleted: true };
  }

  /** 写进任务、发事件、做副作用。所有改动任务的路径都经这里。 */
  async #commit(
    before: WorkItem,
    next: WorkItem,
    transitions: WorkItemTransition[],
    effects: MachineEffect[],
    startOptions: { attended?: boolean; brief?: string; cited?: CitedMessage[]; fileOwnership?: string | null } = {},
  ): Promise<void> {
    this.#items.set(next.id, next);
    const statusChanged = transitions.length > 0;
    await this.#store.putItem(next.channelId, next, { sync: statusChanged });
    const topic = this.#topicOf(next.channelId);
    topic.publish({ type: 'work-item.upsert', item: next });
    const log = this.#transitions.get(next.channelId) ?? [];
    for (const t of transitions) {
      log.push(t);
      await this.#store.appendTransition(next.channelId, t);
      topic.publish({ type: 'work-item.transition', transition: t });
    }
    this.#transitions.set(next.channelId, log.slice(-2000));
    const channel = this.#channels.get(next.channelId);
    if (channel) this.#publishChannel(channel);
    for (const effect of effects) {
      try {
        await this.#effect(next, effect, startOptions);
      } catch (error) {
        this.#log.warn('Work item effect failed', { workItemId: next.id, effect: effect.kind, error: String(error) });
      }
    }
    if (!statusChanged) return;
    const after = this.#items.get(next.id) ?? next;
    this.#schedules?.workItemChanged(after);
    if (after.status === 'resolved' && before.status !== 'resolved') await this.#onResolved(after);
    const freed = before.status === 'active' && before.active?.state === 'working' && !(after.status === 'active' && after.active?.state === 'working');
    if (freed) await this.#pump();
  }

  async #effect(item: WorkItem, effect: MachineEffect, startOptions: { attended?: boolean; brief?: string; cited?: CitedMessage[]; fileOwnership?: string | null }): Promise<void> {
    switch (effect.kind) {
      case 'start-thread':
        await this.#launch(item, startOptions);
        return;
      case 'stop-thread':
        await this.#stopThread(item);
        return;
      case 'interrupt-thread':
        if (item.threadId) await this.#harness.interrupt(item.threadId).catch(() => {});
        return;
      case 'notify':
        this.#notify(item, effect.reason);
        return;
      case 'schedule-once':
      case 'unschedule':
        this.#armOneShot();
        return;
      case 'reminder':
        this.#remind(item, RcBot.reminder({ title: item.title }).text, 'due');
        return;
      case 'continue':
        await this.#continue(item, effect.reason);
        return;
      case 'merge': {
        const target = this.#items.get(effect.into);
        if (target) await this.patchItemContent(target.id, (t) => ({ ...t, updates: [...t.updates, { text: [...item.title].slice(0, 80).join(''), at: nowIso(), by: 'system' as const }].slice(-BOT_LIMITS.updatesKept) }), false);
        return;
      }
      case 'maybe-start':
        if (item.reminded.includes('queued') || item.status === 'upNext') {
          const marked = { ...item, reminded: [...new Set([...item.reminded, 'queued'])] };
          this.#items.set(item.id, marked);
          await this.#store.putItem(item.channelId, marked, { sync: false });
          await this.#pump();
        }
        return;
      case 'ignore-subject':
      case 'release-session':
        return;
    }
  }

  /** 开工：闸门有空位就开线程投简报，否则回到 upNext 排队（§18.1）。 */
  async #launch(item: WorkItem, options: { attended?: boolean; brief?: string; cited?: CitedMessage[]; fileOwnership?: string | null }): Promise<void> {
    const deps = item.dependsOn.map((d) => this.#items.get(d)).filter((d): d is WorkItem => !!d && d.status !== 'resolved');
    if (deps.length || !this.#slotFree(item.channelId, item.id) || this.settings().automationPaused || this.#channels.get(item.channelId)?.archived) {
      const queued: WorkItem = {
        ...item,
        status: 'upNext',
        active: null,
        reminded: [...new Set([...item.reminded, 'queued'])],
        updatedAt: nowIso(),
      };
      if (options.brief) queued.updates = [...queued.updates, { text: [...options.brief].slice(0, 80).join(''), at: nowIso(), by: 'coordinator' as const }].slice(-BOT_LIMITS.updatesKept);
      this.#items.set(item.id, queued);
      await this.#store.putItem(item.channelId, queued, { sync: true });
      this.#topicOf(item.channelId).publish({ type: 'work-item.upsert', item: queued });
      if (options.brief || options.cited?.length || options.fileOwnership) await this.#queueLaunch(item, options);
      return;
    }
    await this.#openThread(item, options);
  }

  readonly #queuedBriefs = new Map<Id, LaunchOptions>();

  /** 记下排队任务开工时要带的东西；同时落盘，重启后照样带上（有没有人在场不存：重启后开工就是无人在场）。 */
  async #queueLaunch(item: WorkItem, options: LaunchOptions): Promise<void> {
    this.#queuedBriefs.set(item.id, options);
    const { attended: _attended, ...stored } = options;
    await this.#files.writeQueued(item.channelId, item.id, stored).catch((error: unknown) =>
      this.#log.warn('Saving the queued brief failed', { workItemId: item.id, error: String(error) }),
    );
  }

  /** 取出并清掉排队任务的开工内容：内存里没有（重启过）时读盘上的。 */
  async #takeQueued(item: WorkItem): Promise<LaunchOptions> {
    const inMemory = this.#queuedBriefs.get(item.id);
    this.#queuedBriefs.delete(item.id);
    const stored = inMemory ? null : launchFrom(await this.#files.readQueued(item.channelId, item.id).catch(() => null));
    await this.#files.removeQueued(item.channelId, item.id).catch(() => {});
    return inMemory ?? stored ?? {};
  }

  #workingCount(channelId?: Id, exclude?: Id): number {
    let n = 0;
    for (const item of this.#items.values()) {
      if (item.id === exclude || (channelId && item.channelId !== channelId)) continue;
      if (item.status === 'active' && item.active?.state === 'working' && item.owner === 'agent') n++;
    }
    return n;
  }

  #slotFree(channelId: Id, exclude: Id): boolean {
    const channel = this.channel(channelId);
    return this.#workingCount(channelId, exclude) < channel.limits.concurrentThreads && this.#workingCount(undefined, exclude) < this.settings().maxConcurrentThreads;
  }

  #queuePosition(item: WorkItem): number {
    const queued = [...this.#items.values()].filter((i) => i.status === 'upNext' && i.reminded.includes('queued')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return queued.findIndex((i) => i.id === item.id) + 1;
  }

  /** 空出位置时按顺序开排队的任务。 */
  async #pump(): Promise<void> {
    if (this.#stopped || this.settings().automationPaused) return;
    // 先叫醒等到了、却因为没空位还停着的任务：它们比排队的新任务先占位。
    for (const id of [...this.#readyToWake.keys()]) {
      const item = this.#items.get(id);
      if (!item) {
        this.#readyToWake.delete(id);
        continue;
      }
      await this.#wakeIfReady(item, null);
    }
    const queued = [...this.#items.values()]
      .filter((i) => i.status === 'upNext' && i.owner === 'agent' && i.reminded.includes('queued'))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const item of queued) {
      const channel = this.#channels.get(item.channelId);
      if (!channel || channel.archived) continue;
      const deps = item.dependsOn.map((d) => this.#items.get(d)).filter((d) => d && d.status !== 'resolved');
      if (deps.length || !this.#slotFree(item.channelId, item.id)) continue;
      const options = await this.#takeQueued(item);
      const current = this.#items.get(item.id)!;
      const unmarked = { ...current, reminded: current.reminded.filter((r) => r !== 'queued') };
      this.#items.set(item.id, unmarked);
      await this.transition(item.id, { type: 'start' }, { actor: 'system' }, options).catch((error: unknown) =>
        this.#log.warn('Queued start failed', { workItemId: item.id, error: String(error) }),
      );
    }
  }

  async #onResolved(item: WorkItem): Promise<void> {
    // 依赖它的任务（BOT-EX-14），以及线程上次报告里说在等它的任务（§7.4 waitingFor）：等的都结了就转回工作中，并叫醒线程接着做。
    for (const other of [...this.#items.values()]) {
      if (other.status === 'resolved' || other.id === item.id) continue;
      if (!other.dependsOn.includes(item.id) && !this.#waitingOn(other).includes(item.id)) continue;
      await this.#wakeIfReady(other, item);
    }
    await this.#pump();
    if (item.resolution?.kind === 'done') void this.runMake(item.channelId, 'item-resolved').catch(() => {});
  }

  /** 线程上次报告里说在等的任务（只在它停在「等别人」时算数）。 */
  #waitingOn(item: WorkItem): Id[] {
    if (item.status !== 'active' || item.active?.state !== 'waitingOnOthers') return [];
    const report = item.lastReportId ? this.#reports.get(item.lastReportId) : undefined;
    return report?.waitingFor?.workItemIds ?? [];
  }

  /** 等到能叫醒、但当时没有空位的任务：有空位时由 `#pump` 接着叫醒（与开工同一道并发闸门，§18.1）。 */
  readonly #readyToWake = new Map<Id, { id: Id; title: string } | null>();

  /**
   * 停在「等别人」的任务，等的都结了就叫醒：先过并发闸门，没空位就记下来等 `#pump`。
   * `resolved` 是刚结的那一个（叫醒的话里提它）；报告刚落下时自查、重启后对账时为 null。
   */
  async #wakeIfReady(item: WorkItem, resolved: { id: Id; title: string } | null): Promise<void> {
    const current = this.#items.get(item.id);
    if (!current || current.status !== 'active' || current.active?.state !== 'waitingOnOthers') {
      this.#readyToWake.delete(item.id);
      return;
    }
    const waitingOn = this.#waitingOn(current);
    const report = current.lastReportId ? this.#reports.get(current.lastReportId) : undefined;
    // 报告里还在等后台作业的，作业结束时另有叫醒；这里只管等任务的。
    if (!current.dependsOn.length && !waitingOn.length) return;
    if (report?.waitingFor?.jobIds.length && !resolved && !this.#readyToWake.has(current.id)) return;
    const open = [...current.dependsOn, ...waitingOn].some((d) => this.#items.get(d)?.status !== 'resolved');
    if (open) return;
    const channel = this.#channels.get(current.channelId);
    if (this.#stopped || this.settings().automationPaused || !channel || channel.archived || !this.#slotFree(current.channelId, current.id)) {
      this.#readyToWake.set(current.id, resolved ? { id: resolved.id, title: resolved.title } : (this.#readyToWake.get(current.id) ?? null));
      return;
    }
    const cause = resolved ?? this.#readyToWake.get(current.id) ?? null;
    this.#readyToWake.delete(current.id);
    await this.transition(current.id, { type: 'unblocked', cause: 'dependency' }, { actor: 'system' }).catch(() => {});
    const woke = this.#items.get(current.id);
    if (woke?.threadId && woke.status === 'active' && woke.active?.state === 'working') {
      const line = cause
        ? `Task ${cause.id} ("${cause.title}") that you were waiting for is resolved. Check its result and continue.`
        : 'The tasks you were waiting for are resolved. Check their results and continue.';
      await this.#deliverToThread(woke, {
        id: `deps_${woke.id}_${cause?.id ?? woke.lastReportId ?? 'all'}`,
        direction: 'refresh',
        text: refreshBlock('dependency-resolved', [line]),
        origin: 'relay',
        unattended: true,
        note: '',
      }).catch((error: unknown) => this.#log.warn('Waking a waiting thread failed', { workItemId: woke.id, error: String(error) }));
    }
  }

  // ---- 线程路由（§7、§8） ----

  async #openThread(item: WorkItem, given: LaunchOptions): Promise<void> {
    // 排队时记下的开工内容（直接开工、没经过队列时也带上），这次给的优先。
    const leftover = await this.#takeQueued(item);
    const options: LaunchOptions = {
      ...leftover,
      ...given,
      brief: [leftover.brief, given.brief].filter(Boolean).join('\n\n') || undefined,
      cited: [...(leftover.cited ?? []), ...(given.cited ?? [])],
    };
    if (!options.brief) delete options.brief;
    // 两边都没带引用（比如用户在任务上点了开工）：不给空表，下面才会退回任务来源的那条用户消息。
    if (!options.cited?.length) delete options.cited;
    const channel = this.channel(item.channelId);
    let threadId = item.threadId;
    if (!threadId || !this.#harness.conversationOf(threadId)) {
      // 没有指定模式时线程跟随偏好设置，不是直接取频道上限；建好后再压到上限以内。
      const mode = minMode(item.overrides?.accessMode ?? channel.defaultAccessMode, channel.maxAccessMode);
      const conversation = await this.#harness.createConversation(
        {
          title: item.title,
          driverId: item.overrides?.driverId ?? channel.driverId,
          model: item.overrides?.model ?? channel.model,
          effort: channel.effort,
          accessMode: mode,
        },
        undefined,
        { role: 'thread', channelId: channel.id, workItemId: item.id, cwd: this.#files.filesDir(channel.id) },
      );
      threadId = conversation.id;
      const followed = this.#threadMode(threadId);
      if (!mode && channel.maxAccessMode && followed && rank(followed) > rank(channel.maxAccessMode)) {
        await this.#harness.updateConversation({ conversationId: threadId, accessMode: channel.maxAccessMode }, { internal: BOT_INTERNAL });
      }
      await this.#files.ensureNotes(channel.id, threadId).catch(() => {});
    }
    const current = this.#items.get(item.id) ?? item;
    const starts = current.threadStarts + 1;
    const withThread: WorkItem = { ...current, threadId, threadStarts: starts, updatedAt: nowIso() };
    this.#items.set(item.id, withThread);
    await this.#store.putItem(item.channelId, withThread, { sync: true });
    this.#topicOf(item.channelId).publish({ type: 'work-item.upsert', item: withThread });
    const memory = await this.#files.readMemory(channel.id).catch(() => '');
    const userMemory = await this.#files.readUserMemory().catch(() => '');
    const cited = options.cited ?? (item.source.messageId ? this.#citeFrom(channel.conversationId, [item.source.messageId]) : []);
    const brief = threadBriefBlock({
      item: withThread,
      brief: options.brief ?? '',
      cited,
      channelName: channel.name,
      rules: rulesSection(memory),
      notesPath: this.#files.notesPath(channel.id, threadId),
      fileOwnership: options.fileOwnership ?? null,
      outputLanguage: item.overrides?.outputLanguage ?? channel.outputLanguage,
      asOf: nowIso(),
    });
    const userBlock = userMemoryBlock(userMemory);
    const deliveryId = `brief_${item.id}_${starts}`;
    for (const c of cited) {
      if (c.author === 'user') await this.#files.appendRelayIndex(channel.id, { citedMessageId: c.messageId, workItemId: item.id, deliveryId }).catch(() => {});
    }
    await this.#deliverToThread(withThread, {
      id: deliveryId,
      direction: 'brief',
      text: [brief, userBlock].filter(Boolean).join('\n'),
      origin: item.source.kind === 'schedule' ? 'schedule' : 'relay',
      unattended: !options.attended,
      note: options.brief ?? '',
      cited,
    });
  }

  /** 向线程投递一段文字（简报、转交、刷新、继续）。 */
  async #deliverToThread(
    item: WorkItem,
    d: { id: Id; direction: RelayBody['direction']; text: string; origin: Delivery['origin']; unattended: boolean; note: string; cited?: CitedMessage[]; wake?: Delivery['wake']; reopenTaskId?: Id },
  ): Promise<{ result: DeliveryResult; reason: string | null }> {
    if (!item.threadId) return { result: 'dropped', reason: 'no-thread' };
    const citations = (d.cited ?? []).filter((c) => c.author === 'user' && (c.via === 'typed' || c.via === null)).map((c) => c.messageId);
    const delivery: Delivery = {
      id: d.id,
      conversationId: item.threadId,
      item: {
        direction: d.direction,
        workItemId: item.id,
        reportId: null,
        from: { role: d.direction === 'refresh' ? 'system' : 'coordinator', conversationId: this.channel(item.channelId).conversationId },
        text: d.note,
        cited: d.cited ?? [],
      },
      agentText: d.text,
      wake: d.wake ?? 'new-task',
      origin: d.origin,
      goal: item.title,
      unattended: d.unattended,
      userCitations: citations,
      ...(d.reopenTaskId ? { reopenTaskId: d.reopenTaskId } : {}),
    };
    const mode = this.#deliveryMode(item);
    if (mode) delivery.accessMode = mode;
    // 等回合结束才交的投递，起回合时按那时的任务覆盖与频道上限重算（§14.4）。
    delivery.accessModeAt = () => this.#deliveryMode(this.itemOrNull(item.id) ?? item);
    await this.#refreshSpend(item.channelId);
    this.#expecting.add(item.threadId);
    let outcome;
    try {
      outcome = await this.#harness.deliver(delivery);
    } finally {
      this.#expecting.delete(item.threadId);
    }
    if (outcome.result === 'dropped' && outcome.reason === 'unattended-needs-approvals') {
      await this.#hold(item, delivery);
      await this.#needsYouToRun(item);
    }
    return { result: outcome.result, reason: outcome.reason };
  }

  /**
   * 投给线程时要明确带上的模式：先定下这次实际会用的（任务覆盖的，否则线程自己的），再按频道此刻的上限压低；
   * 没有覆盖时不能直接取上限。不用明确带（就是线程自己的模式）时为 null。
   */
  #deliveryMode(item: WorkItem): AgentMode | null {
    if (!item.threadId) return null;
    const override = item.overrides?.accessMode ?? null;
    const effective = override ?? this.#threadMode(item.threadId);
    const capped = minMode(effective, this.channel(item.channelId).maxAccessMode);
    return capped && (override || capped !== effective) ? capped : null;
  }

  /** 线程此刻的访问模式（会话设的，否则偏好设置）；读不到时为 null。 */
  #threadMode(threadId: Id): AgentMode | null {
    try {
      return this.#harness.conversationMode(threadId);
    } catch {
      return null;
    }
  }

  /** 线程新任务的预算上限（§14.5）：任务预算与频道剩余额度的较小值。别的会话不设。 */
  #taskBudget(conversation: Conversation): TaskBudgetLimits | null {
    if (conversation.role !== 'thread') return null;
    const item = this.itemOfThread(conversation.id);
    const channel = item ? this.#channels.get(item.channelId) : undefined;
    if (!item || !channel) return null;
    return threadTaskBudget(item, channel, this.#spend.get(channel.id));
  }

  /** 重读频道的花费。没有频道预算或没有账本时不读。读失败时留着旧值。 */
  async #refreshSpend(channelId: Id): Promise<void> {
    const channel = this.#channels.get(channelId);
    if (!channel || !this.#workspace.channelSpend || (!channel.limits.dailyBudget && !channel.limits.monthlyBudget)) {
      this.#spend.delete(channelId);
      return;
    }
    const ids = new Set<Id>([channel.conversationId]);
    for (const item of this.#channelItems(channelId)) if (item.threadId) ids.add(item.threadId);
    try {
      this.#spend.set(channelId, await this.#workspace.channelSpend(ids, spendWindow(this.#clock.now())));
    } catch (error) {
      this.#log.warn('Reading the channel spend failed', { channelId, error: String(error) });
    }
  }

  /** 记下等用户在场再投的那一份；同时落盘，重启后点「继续」照样投原来那份（简报、引用、文件归属都在里面）。 */
  async #hold(item: WorkItem, delivery: Delivery): Promise<void> {
    this.#needsYou.set(item.id, delivery);
    await this.#files.writeHeld(item.channelId, item.id, delivery).catch((error: unknown) =>
      this.#log.warn('Saving the held delivery failed', { workItemId: item.id, error: String(error) }),
    );
  }

  /** 取出并清掉等着的那一份：内存里没有（重启过）时读盘上的，只认投给这条任务线程的。 */
  async #takeHeld(item: WorkItem): Promise<Delivery | null> {
    const inMemory = this.#needsYou.get(item.id);
    this.#needsYou.delete(item.id);
    const stored = inMemory ? null : heldFrom(await this.#files.readHeld(item.channelId, item.id).catch(() => null), item);
    await this.#files.removeHeld(item.channelId, item.id).catch(() => {});
    return inMemory ?? stored;
  }

  /** §14.2：Driver 不支持逐次审批，无人在场的回合不起；任务转 needsInput 等用户点「继续」。 */
  async #needsYouToRun(item: WorkItem): Promise<void> {
    const current = this.#items.get(item.id) ?? item;
    if (current.status !== 'active') return;
    const thread = current.threadId ? this.#harness.conversationOf(current.threadId) : undefined;
    const agent = thread ? (await this.#driverName(thread.driverId)) : '';
    const now = nowIso();
    const question: WorkItemQuestion = {
      text: RcBot.needsYouToRun({ agent }).text,
      kind: 'input',
      options: [{ label: RcBot.optionContinue().text, description: null }],
      pick: null,
      risky: false,
      askedBy: 'system',
      approvalId: null,
    };
    const next: WorkItem = { ...current, active: { state: 'needsInput', reason: null, since: now }, question, beforeInput: current.active?.state ?? 'working', updatedAt: now };
    await this.#commit(current, next, [{ workItemId: item.id, from: stateName(current), to: 'needsInput', actor: 'system', cause: 'unattended-needs-approvals', note: null, at: now }], [
      { kind: 'notify', reason: 'unattended-approval' },
    ]);
  }

  async #driverName(driverId: DriverId): Promise<string> {
    const view = this.#harness.agentsSnapshot();
    return view.drivers?.find((d) => d.id === driverId)?.name ?? driverId;
  }

  /** 用户点了「继续」（§9.3）：卡住与停下投 `<baocut-refresh>`，要你在场的重投原来那份。都是有人在场的回合。 */
  async #continue(item: WorkItem, reason: 'stalled' | 'stopped' | 'needs-you' | 'other'): Promise<void> {
    if (!item.threadId) {
      await this.#openThread(item, { attended: true });
      return;
    }
    const held = reason === 'needs-you' ? await this.#takeHeld(item) : null;
    if (held) {
      this.#expecting.add(item.threadId);
      try {
        // 存下之后频道上限或任务的模式可能改过：按现在的重新算，不沿用存下的模式。
        const { accessMode: _saved, ...rest } = held;
        const mode = this.#deliveryMode(this.#items.get(item.id) ?? item);
        await this.#harness.deliver({ ...rest, id: `${held.id}_attended`, unattended: false, ...(mode ? { accessMode: mode } : {}) });
      } finally {
        this.#expecting.delete(item.threadId);
      }
      return;
    }
    await this.#deliverToThread(item, {
      id: `continue_${item.id}_${newId('c')}`,
      direction: 'refresh',
      text: refreshBlock(reason === 'stopped' ? 'continue' : 'stalled', [
        'The user asked you to continue. Read your working notes first. If the last approach got stuck, try a different one.',
      ]),
      origin: 'relay',
      unattended: false,
      note: '',
    });
  }

  async #stopThread(item: WorkItem): Promise<void> {
    if (!item.threadId) return;
    const thread = this.#harness.conversationOf(item.threadId);
    if (!thread) return;
    if (thread.activeTaskId && (thread.activity === 'running' || thread.activity.startsWith('awaiting'))) {
      await this.#harness.stopTask(thread.activeTaskId).catch(() => {});
    } else {
      await this.#harness.cancelJobs(item.threadId).catch(() => 0);
    }
  }

  /** 复制频道对话里的消息成引用（§8.2）：只认用户消息与协调者自己的消息。 */
  #citeFrom(conversationId: Id, ids: readonly Id[]): CitedMessage[] {
    const items = this.#harness.getConversation(conversationId).items;
    const out: CitedMessage[] = [];
    for (const id of ids.slice(0, BOT_LIMITS.citedMessages)) {
      const found = items.find((i) => i.id === id);
      if (!found || (found.kind !== 'user-message' && found.kind !== 'agent-message')) continue;
      if (found.kind === 'agent-message' && found.fallback) continue;
      const text = found.text;
      const chars = [...text];
      out.push({
        messageId: found.id,
        conversationId,
        author: found.kind === 'user-message' ? 'user' : 'coordinator',
        via: found.kind === 'user-message' ? (found.via ?? 'typed') : null,
        text: chars.slice(0, BOT_LIMITS.citedText).join(''),
        truncated: chars.length > BOT_LIMITS.citedText,
        at: found.createdAt,
      });
    }
    return out;
  }

  /** 协调者的 `thread_relay`。 */
  async relay(item: WorkItem, note: string, citedIds: readonly Id[]): Promise<DeliveryResult> {
    const channel = this.channel(item.channelId);
    const cited = this.#citeFrom(channel.conversationId, citedIds);
    if (!item.threadId) {
      // 任务还没线程（排队中）：把补充记在任务上，开工时一起带上。
      const prev = this.#queuedBriefs.get(item.id) ?? launchFrom(await this.#files.readQueued(item.channelId, item.id).catch(() => null)) ?? {};
      await this.#queueLaunch(item, { ...prev, brief: [prev.brief, note].filter(Boolean).join('\n\n'), cited: [...(prev.cited ?? []), ...cited] });
      return 'held';
    }
    const key = cited.find((c) => c.author === 'user')?.messageId ?? newId('n');
    const deliveryId = `relay_${key}_${item.id}`;
    for (const c of cited) {
      if (c.author === 'user') await this.#files.appendRelayIndex(channel.id, { citedMessageId: c.messageId, workItemId: item.id, deliveryId }).catch(() => {});
    }
    const outcome = await this.#deliverToThread(item, {
      id: deliveryId,
      direction: 'relay',
      text: relayBlock({ workItemId: item.id, note, cited, asOf: nowIso() }),
      origin: 'relay',
      unattended: true,
      note,
      cited,
    });
    if (outcome.result !== 'dropped' && cited.some((c) => c.author === 'user')) {
      await this.transition(item.id, { type: 'user-replied' }, { actor: 'system' }).catch(() => {});
    }
    return outcome.result;
  }

  /** 线程的 `thread_report`（§7.4）：追加报告、走状态机、建用户的任务与建议，再交给协调者。 */
  async submitReport(
    item: WorkItem,
    input: Omit<ThreadReport, 'id' | 'workItemId' | 'threadId' | 'taskId' | 'createdAt' | 'delivery' | 'fallback'>,
    run: MachineRun & { taskId: Id },
    actor: 'thread' | 'system' = 'thread',
  ): Promise<ThreadReport> {
    const report: ThreadReport = {
      ...input,
      id: newId('rep'),
      workItemId: item.id,
      threadId: item.threadId ?? run.conversationId,
      taskId: run.taskId,
      createdAt: nowIso(),
      delivery: 'pending',
      fallback: actor === 'system',
    };
    const info = this.#runStarts.get(run.taskId);
    // 先登记报告再转换：转换落盘期间结掉的依赖读到新的 lastReportId 时，能找到它在等谁。
    this.#reports.set(report.id, report);
    try {
      await this.transition(item.id, { type: 'report', report }, { actor, run });
    } catch (error) {
      this.#reports.delete(report.id);
      throw error;
    }
    if (info) info.reported = true;
    await this.#store.appendReport(item.channelId, report);
    this.#topicOf(item.channelId).publish({ type: 'work-item.report', report });
    for (const todo of report.userTodos.slice(0, 5)) {
      await this.createItem({ channelId: item.channelId, title: [...todo].slice(0, BOT_LIMITS.title).join(''), owner: 'user', source: { kind: 'thread', messageId: null, scheduleId: null, runId: null } });
    }
    if (report.followUps.length) {
      void this.suggestItems(
        item.channelId,
        report.followUps.map((f) => ({ title: f, reason: item.title, kindTag: 'follow-up', evidence: [] as ResourceRef[] })),
        'thread-report',
      ).catch(() => {});
    }
    await this.#deliverReport(report, run.attended);
    // 报告说在等的任务可能在报告之前就结了：那时的「已结」事件找不到它，这里补查一次。
    // 不等它：这份报告常是线程在回合里交的，叫醒的投递要等这一回合结束才开始。
    if (report.stop === 'waiting') {
      const current = this.#items.get(item.id);
      if (current) void this.#wakeIfReady(current, null).catch((error: unknown) => this.#log.warn('Rechecking a waiting task failed', { workItemId: item.id, error: String(error) }));
    }
    return report;
  }

  async #deliverReport(report: ThreadReport, attended: boolean): Promise<void> {
    const item = this.#items.get(report.workItemId);
    const channel = item ? this.#channels.get(item.channelId) : undefined;
    if (!item || !channel) return;
    if (channel.archived) return;
    // 同一任务上一份还 pending 的报告标 superseded（§8.3 第 4 条）。
    const superseded: string[] = [];
    for (const other of this.#reports.values()) {
      if (other.workItemId === report.workItemId && other.id !== report.id && other.delivery === 'pending' && other.createdAt <= report.createdAt) {
        const marked = { ...other, delivery: 'superseded' as const };
        this.#reports.set(other.id, marked);
        superseded.push(other.headline);
        await this.#store.appendReport(item.channelId, marked);
      }
    }
    const markDelivered = async () => {
      const current = this.#reports.get(report.id);
      if (!current || current.delivery !== 'pending') return;
      const delivered = { ...current, delivery: 'delivered' as const };
      this.#reports.set(report.id, delivered);
      await this.#store.appendReport(item.channelId, delivered);
      this.#topicOf(item.channelId).publish({ type: 'work-item.report', report: delivered });
    };
    const outcome = await this.#harness.deliver({
      id: `report_${report.id}`,
      conversationId: channel.conversationId,
      item: {
        direction: 'report',
        workItemId: item.id,
        reportId: report.id,
        from: { role: 'thread', conversationId: report.threadId },
        text: report.headline,
        cited: [],
      },
      agentText: threadReportBlock(report, item, superseded),
      wake: 'new-task',
      origin: 'relay',
      goal: `${item.title}: ${report.headline}`,
      unattended: !attended || true,
      onDelivered: () => {
        const taskId = this.#harness.runInfo(channel.conversationId)?.taskId;
        if (taskId) this.#relayRuns.set(taskId, [...(this.#relayRuns.get(taskId) ?? []), report]);
        void markDelivered();
      },
    });
    if (outcome.result === 'dropped' && outcome.reason === 'unattended-needs-approvals') {
      // 协调者没有任务卡可停（§14.2）：直接写兜底转述，报告记为已投。
      this.#fallbackRelay(channel.conversationId, [report]);
      await markDelivered();
    }
  }

  /** 「<任务标题>：<headline>」（§8.3）。 */
  #fallbackRelay(conversationId: Id, reports: ThreadReport[]): void {
    for (const report of reports) {
      const item = this.#items.get(report.workItemId);
      this.#harness.writeItem(conversationId, {
        kind: 'agent-message',
        id: `fallback_${report.id}`,
        createdAt: nowIso(),
        taskId: null,
        text: RcBot.fallbackRelay({ title: item?.title ?? '', headline: report.headline }).text,
        streaming: false,
        fallback: true,
      });
    }
  }

  // ---- 活动桥（§9.3） ----

  #onRun(event: RunEvent): void {
    void this.#handleRun(event).catch((error: unknown) => this.#log.warn('Run handling failed', { error: String(error) }));
  }

  async #handleRun(event: RunEvent): Promise<void> {
    const conversation = this.#harness.conversationOf(event.conversationId);
    if (!conversation) return;
    if (conversation.role === 'thread') {
      const item = conversation.workItemId ? this.#items.get(conversation.workItemId) : undefined;
      if (!item) return;
      if (event.type === 'started') {
        this.#runStarts.set(event.taskId, { workItemId: item.id, status: item.status, reported: false, resolvedInRefresh: false, origin: event.origin });
        const info = this.#harness.runInfo(conversation.id);
        if (event.origin === 'user' && info?.userMessageId) {
          const message = this.#findItem(conversation.id, info.userMessageId);
          const note = message?.kind === 'user-message' ? message.text : undefined;
          await this.transition(item.id, { type: 'user-replied', ...(note ? { note } : {}) }, { actor: 'user' }).catch(() => {});
        } else if (item.status === 'active' && item.active?.state === 'waitingOnOthers' && !this.#expecting.has(conversation.id)) {
          await this.transition(item.id, { type: 'unblocked', cause: 'job-finished' }, { actor: 'system' }).catch(() => {});
        }
        const current = this.#items.get(item.id);
        if (current?.status === 'active' && current.active?.state === 'working') {
          await this.patchItemContent(item.id, (i) => i, true);
        }
        return;
      }
      this.bindThreadChips(conversation.id, event.taskId);
      const info = this.#runStarts.get(event.taskId);
      this.#runStarts.delete(event.taskId);
      if (event.error === 'unattended-needs-approvals') {
        await this.#hold(item, {
          id: `job_${event.taskId}_${newId('w')}`,
          conversationId: conversation.id,
          item: { direction: 'refresh', workItemId: item.id, reportId: null, from: { role: 'system', conversationId: null }, text: '', cited: [] },
          agentText: refreshBlock('job-finished', ['A background job you were waiting for has finished. Check its result and continue.']),
          wake: 'new-task',
          origin: 'relay',
          goal: item.title,
          unattended: false,
        });
        await this.#needsYouToRun(item);
        return;
      }
      // 开始时已解决的任务：回合里没重开就不动（下面的 status 检查）；重开了又没报告的，照常兜底，不留在「工作中」。
      if (!info || info.reported || info.origin === 'refresh') return;
      const current = this.#items.get(item.id);
      if (!current || current.status !== 'active' || current.active?.state !== 'working') return;
      const run: MachineRun & { taskId: Id } = {
        conversationId: conversation.id,
        taskId: event.taskId,
        origin: event.origin,
        attended: event.attended,
        tainted: event.tainted,
        userCitations: new Set(),
        userMessageId: null,
      };
      if (event.status === 'completed') {
        const last = this.#lastAgentMessage(conversation.id, event.taskId);
        await this.submitReport(
          current,
          { stop: 'needs-review', headline: last ? firstSentence(last) : current.title, text: last ?? '', question: null, outputs: [], userTodos: [], followUps: [], waitingFor: null, appliedRules: [] },
          run,
          'system',
        );
      } else if (event.status === 'failed') {
        const reason = firstSentence(event.error ?? event.errorCode ?? 'failed');
        await this.submitReport(
          current,
          { stop: 'blocked', headline: reason, text: event.error ?? '', question: continueQuestion(), outputs: [], userTodos: [], followUps: [], waitingFor: null, appliedRules: [] },
          run,
          'system',
        );
      }
      return;
    }
    if (conversation.role !== 'channel') return;
    if (event.type === 'started') return;
    // 频道对话的回合结束：报告转述兜底（§8.3）、提示绑定、种子、接力（§6.3）。
    const reports = this.#relayRuns.get(event.taskId);
    this.#relayRuns.delete(event.taskId);
    const chips = this.#pendingChips.get(conversation.id);
    if (chips && chips.taskId === event.taskId) {
      this.#pendingChips.delete(conversation.id);
      const last = this.#lastAgentMessageItem(conversation.id, event.taskId);
      if (last) this.#writeSuggestions(conversation.id, last.id, chips.source, chips.chips);
    }
    if (reports?.length && !this.#hasAgentMessage(conversation.id, event.taskId) && !this.#hasSuggestions(conversation.id, event.taskId)) {
      this.#fallbackRelay(conversation.id, reports);
    }
    if (event.origin === 'seed') {
      this.#seedTimers.get(conversation.id)?.();
      this.#seedTimers.delete(conversation.id);
      const channel = conversation.channelId ? this.#channels.get(conversation.channelId) : undefined;
      if (channel && !this.#hasAgentMessage(conversation.id, event.taskId)) {
        const facts = await this.#workspace.facts().catch(() => []);
        await this.#seedFallback(channel, workspaceFactsBlock(facts));
      }
    }
    const stats = this.#harness.generationStats(conversation.id);
    if (stats.compactions >= 3 || stats.turns > 400) await this.#handoff(conversation.id, null);
  }

  /** 线程会话的提示条目在回合结束时绑定。 */
  bindThreadChips(conversationId: Id, taskId: Id): void {
    const chips = this.#pendingChips.get(conversationId);
    if (!chips || chips.taskId !== taskId) return;
    this.#pendingChips.delete(conversationId);
    const last = this.#lastAgentMessageItem(conversationId, taskId);
    if (last) this.#writeSuggestions(conversationId, last.id, chips.source, chips.chips);
  }

  async #handoff(conversationId: Id, newDriver: DriverId | null): Promise<void> {
    const notice = newDriver ? RcBot.handoffDriver({ agent: await this.#driverName(newDriver) }) : null;
    await this.#harness.handoff(conversationId, notice);
    this.#handoffPending.add(conversationId);
  }

  /** 审批与提问（§9.3）：线程会话的 activity 变成等你 → needsInput；回来 → 审批结束。同时把提问卡的选项做成答案提示。 */
  #onConversation(conversation: Conversation): void {
    if (conversation.role !== 'thread' && conversation.role !== 'channel') return;
    void this.#handleConversation(conversation).catch((error: unknown) => this.#log.warn('Conversation handling failed', { error: String(error) }));
  }

  async #handleConversation(conversation: Conversation): Promise<void> {
    const awaiting = conversation.activity === 'awaiting-approval' || conversation.activity === 'awaiting-answer';
    const items = awaiting || this.#approvalSeen.get(conversation.id) ? this.#harness.getConversation(conversation.id).items : [];
    const pending = awaiting
      ? [...items].reverse().find((i): i is Extract<TimelineItem, { kind: 'approval' }> => i.kind === 'approval' && i.status === 'pending')
      : undefined;
    const seen = this.#approvalSeen.get(conversation.id) ?? null;
    if (pending && pending.approvalId === seen) return;
    if (pending) {
      this.#approvalSeen.set(conversation.id, pending.approvalId);
      const question = approvalQuestion(pending);
      if (pending.request.kind === 'question' && pending.request.questions.length === 1) {
        const q = pending.request.questions[0]!;
        if (!q.multiSelect && q.options.length) this.#writeSuggestions(conversation.id, pending.id, 'question', questionChips(pending.approvalId, q.options));
      }
      if (conversation.role === 'thread') {
        const item = this.itemOfThread(conversation.id);
        if (item) await this.transition(item.id, { type: 'approval', approvalId: pending.approvalId, pending: true, question }, { actor: 'system' }).catch(() => {});
      }
      return;
    }
    if (!awaiting && seen) {
      this.#approvalSeen.delete(conversation.id);
      if (conversation.role === 'thread') {
        const item = this.itemOfThread(conversation.id);
        const deferredReport = item?.deferredStop && item.lastReportId ? (this.#reports.get(item.lastReportId) ?? null) : null;
        if (item) await this.transition(item.id, { type: 'approval', approvalId: seen, pending: false, deferredReport }, { actor: 'system' }).catch(() => {});
      }
    }
  }

  /** 每分钟的看门狗（§9.3）与每小时的提醒（§11.4）、建议过期。 */
  #armWatchdog(): void {
    const tick = () => {
      if (this.#stopped) return;
      void this.watchdog().catch((error: unknown) => this.#log.warn('Watchdog failed', { error: String(error) }));
      this.#cancelWatchdog = this.#clock.setTimer(tick, MINUTE);
    };
    this.#cancelWatchdog = this.#clock.setTimer(tick, MINUTE);
    const hourly = () => {
      if (this.#stopped) return;
      void this.hourly().catch((error: unknown) => this.#log.warn('Reminder scan failed', { error: String(error) }));
      this.#cancelHourly = this.#clock.setTimer(hourly, HOUR);
    };
    this.#cancelHourly = this.#clock.setTimer(hourly, HOUR);
  }

  /** 卡住检测：没有进展、Job 挂住、预算到 80%。 */
  async watchdog(): Promise<void> {
    const now = this.#clock.now();
    for (const item of [...this.#items.values()]) {
      if (item.status !== 'active' || item.owner !== 'agent') continue;
      const state = item.active?.state;
      const channel = this.#channels.get(item.channelId);
      if (!channel) continue;
      const minutes = channel.stallMinutes ?? this.settings().stallMinutes;
      if (state === 'waitingOnOthers' || state === 'working') {
        const report = item.lastReportId ? this.#reports.get(item.lastReportId) : undefined;
        const jobs = state === 'waitingOnOthers' ? (report?.waitingFor?.jobIds ?? []) : [];
        if (jobs.length && this.#workspace.hungJob) {
          const hung = await this.#workspace.hungJob(jobs);
          if (hung) {
            await this.transition(item.id, { type: 'stalled', reason: 'job-hung', note: RcBot.stalledJobHung({ job: hung }).text }, { actor: 'system' }).catch(() => {});
            continue;
          }
        }
      }
      if (state !== 'working') continue;
      const thread = item.threadId ? this.#harness.conversationOf(item.threadId) : undefined;
      if (this.#workspace.budgetUsed && thread && !item.budgetWarnedAt) {
        const used = this.#workspace.budgetUsed(thread.id, thread.activeTaskId);
        if (used !== null && used >= 0.8) {
          await this.transition(item.id, { type: 'stalled', reason: 'budget', note: RcBot.stalledBudget().text }, { actor: 'system' }).catch(() => {});
          continue;
        }
      }
      // 线程在等审批或提问时不算卡住。
      if (thread && (thread.activity === 'awaiting-approval' || thread.activity === 'awaiting-answer')) continue;
      // 线程在会话里有了实在的进展（改视频、产出、说话、勾步骤），哪怕没调 work_items_update，也算进展（§9.3 卡住判定）。
      if (thread) {
        const mark = this.#progressMark(thread.id);
        const previous = this.#progressMarks.get(item.id);
        this.#progressMarks.set(item.id, mark);
        if (previous !== undefined && previous !== mark) {
          await this.patchItemContent(item.id, (i) => ({ ...i, lastProgressAt: new Date(now).toISOString() }), false).catch(() => {});
          continue;
        }
      }
      const since = Date.parse(item.lastProgressAt ?? item.active?.since ?? item.updatedAt);
      if (now - since >= minutes * MINUTE) {
        await this.transition(item.id, { type: 'stalled', reason: 'no-progress', note: RcBot.stalledNoProgress({ minutes }).text }, { actor: 'system' }).catch(() => {});
      }
    }
  }

  readonly #progressMarks = new Map<Id, string>();

  /** 线程会话里看得见的进展的指纹：视频修改与产出、智能体的话、当前任务的步骤。变了就是有进展。 */
  #progressMark(threadId: Id): string {
    let items: TimelineItem[];
    try {
      items = this.#harness.getConversation(threadId).items;
    } catch {
      return '';
    }
    let count = 0;
    let last = '';
    let todo = '';
    for (const i of items) {
      if (i.kind === 'video-change' || i.kind === 'agent-message' || i.kind.endsWith('-created')) {
        count++;
        last = i.id;
      } else if (i.kind === 'task' && i.todo) {
        todo = i.todo.items.map((t) => `${t.status}:${t.text}`).join('|');
      }
    }
    return `${count}/${last}/${todo}`;
  }

  /** 提醒（§11.4）：用户的任务截止前一天、待你审阅超过 3 天；建议过期。 */
  async hourly(): Promise<void> {
    const now = this.#clock.now();
    const tz = this.#timeZone();
    const tomorrow = localDay(new Date(now + DAY), tz);
    const today = localDay(new Date(now), tz);
    for (const item of [...this.#items.values()]) {
      if (item.status === 'suggested' && item.suggestion && Date.parse(item.suggestion.expiresAt) <= now) {
        await this.transition(item.id, { type: 'expire' }, { actor: 'system' }).catch(() => {});
        continue;
      }
      if (item.status === 'resolved') continue;
      if (item.owner === 'user' && item.dueOn && (item.dueOn === tomorrow || item.dueOn < today)) {
        const overdue = item.dueOn < today;
        this.#remind(
          item,
          overdue ? RcBot.reminderOverdue({ title: item.title, date: item.dueOn }).text : RcBot.reminder({ title: item.title }).text,
          overdue ? `overdue:${item.dueOn}` : `due:${item.dueOn}`,
        );
      }
      if (needsUser(item) && item.active && now - Date.parse(item.active.since) >= NEEDS_REVIEW_STALE_DAYS * DAY) {
        const days = Math.floor((now - Date.parse(item.active.since)) / DAY);
        this.#remind(item, RcBot.reminderStale({ title: item.title, days }).text, `stale:${item.active.since}`);
      }
    }
  }

  /** 频道里写一行提醒（不起回合），同一任务同一原因只提一次。 */
  #remind(item: WorkItem, text: string, key: string): void {
    const current = this.#items.get(item.id) ?? item;
    if (current.reminded.includes(key)) return;
    const channel = this.#channels.get(item.channelId);
    if (!channel) return;
    this.#harness.writeItem(channel.conversationId, {
      kind: 'relay',
      id: `remind_${item.id}_${key.replace(/[^\w-]/g, '_')}`,
      createdAt: nowIso(),
      taskId: null,
      direction: 'make',
      workItemId: item.id,
      reportId: null,
      from: { role: 'system', conversationId: null },
      text,
      cited: [],
    });
    const next = { ...current, reminded: [...current.reminded, key] };
    this.#items.set(item.id, next);
    void this.#store.putItem(item.channelId, next, { sync: false });
    this.#topicOf(item.channelId).publish({ type: 'work-item.upsert', item: next });
    if (key.startsWith('due') || key.startsWith('overdue')) this.#notify(next, 'reminder');
  }

  #notify(item: WorkItem, reason: BotNotificationReason): void {
    const channel = this.#channels.get(item.channelId);
    if (!channel) return;
    const report = item.lastReportId ? this.#reports.get(item.lastReportId) : undefined;
    const headline =
      reason === 'needs-review'
        ? RcBot.notifyNeedsReview({ title: item.title }).text
        : reason === 'needs-input' || reason === 'unattended-approval'
          ? RcBot.notifyNeedsInput({ title: item.title }).text
          : reason === 'stalled'
            ? RcBot.notifyStalled({ title: item.title }).text
            : RcBot.notifyReminder({ title: item.title }).text;
    this.#channelsTopic.publish({
      type: 'bot.notification',
      channelId: channel.id,
      workItemId: item.id,
      reason,
      headline: report && reason === 'needs-review' ? `${headline}: ${report.headline}` : headline,
      question: item.question,
      at: nowIso(),
      muted: channel.muted,
    });
  }

  /** 一次性定时（§11.2）：按 startAt 排序，最长一小时一跳。 */
  #armOneShot(): void {
    this.#cancelOneShot?.();
    this.#cancelOneShot = null;
    // 暂停了自动运行时不挂定时：到点的条目在恢复时由 `pauseAutomation(false)` 补跑，否则过期的条目会让定时器空转。
    if (this.#stopped || this.settings().automationPaused) return;
    const now = this.#clock.now();
    const due = [...this.#items.values()].filter((i) => this.#oneShotEligible(i)).map((i) => Date.parse(i.startAt!));
    if (due.length === 0) return;
    const next = Math.min(...due);
    const wait = Math.max(0, Math.min(next - now, HOUR));
    this.#cancelOneShot = this.#clock.setTimer(() => void this.fireDue(), wait);
  }

  /** 一次性定时的候选：已排期、有时刻，且所在频道没有归档（归档的频道恢复时重新挂定时）。 */
  #oneShotEligible(item: WorkItem): boolean {
    return item.status === 'scheduled' && !!item.startAt && this.#channels.get(item.channelId)?.archived !== true;
  }

  async fireDue(): Promise<void> {
    const now = this.#clock.now();
    for (const item of [...this.#items.values()]) {
      if (!this.#oneShotEligible(item) || !item.startAt || Date.parse(item.startAt) > now) continue;
      if (this.settings().automationPaused) break;
      const late = now - Date.parse(item.startAt);
      await this.transition(item.id, { type: 'due' }, { actor: 'system' }).catch(() => {});
      if (late > ONE_SHOT_GRACE_MS) {
        const log = this.#transitions.get(item.channelId);
        const last = log?.findLast((t) => t.workItemId === item.id);
        if (last) last.note = RcBot.lateStart({ minutes: Math.round(late / MINUTE) }).text;
      }
    }
    this.#armOneShot();
  }

  // ---- 每回合的上下文（§13.2） ----

  #turnContext(conversation: Conversation, kind: 'user' | 'delivery'): string | null {
    if (conversation.role !== 'channel' || !conversation.channelId) return null;
    const channel = this.#channels.get(conversation.channelId);
    if (!channel) return null;
    const parts: string[] = [];
    if (this.#handoffPending.has(conversation.id)) {
      this.#handoffPending.delete(conversation.id);
      parts.push(this.#handoffSeed(channel));
    }
    parts.push(
      channelStateBlock({
        now: new Date(this.#clock.now()),
        timeZone: this.#timeZone(),
        lang: this.#language(conversation.id),
        items: this.#channelItems(channel.id),
        memoryVersion: channel.memoryVersion,
        rules: this.#rulesCache.get(channel.id) ?? null,
      }),
    );
    const userMemory = this.#userMemoryCache;
    if (userMemory) {
      const block = userMemoryBlock(userMemory);
      if (block) parts.push(block);
    }
    if (kind === 'user') {
      const prelude = this.#prelude.get(conversation.id);
      this.#prelude.delete(conversation.id);
      if (prelude) parts.push(...prelude);
      if (channel.seedPending) {
        parts.push(channel.seedPending);
        void this.#putChannel({ ...channel, seedPending: null });
      }
    }
    return parts.join('\n');
  }

  readonly #rulesCache = new Map<Id, string | null>();
  #userMemoryCache = '';

  /** 记忆的缓存（回合上下文是同步的）：发送前与写记忆后刷新。 */
  async refreshMemoryCache(channelId: Id): Promise<void> {
    const memory = await this.#files.readMemory(channelId).catch(() => '');
    this.#memoryCache.set(channelId, memory);
    this.#rulesCache.set(channelId, rulesSection(memory));
    this.#userMemoryCache = await this.#files.readUserMemory().catch(() => '');
  }

  #handoffSeed(channel: Channel): string {
    const items = this.#harness.getConversation(channel.conversationId).items;
    const transcript: string[] = [];
    let size = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]!;
      if (it.kind !== 'user-message' && it.kind !== 'agent-message') continue;
      const line = `${it.kind === 'user-message' ? 'user' : 'you'}: ${it.text}`;
      if (size + line.length > BOT_LIMITS.handoffChars) break;
      size += line.length;
      transcript.unshift(line);
    }
    const task = [...items].reverse().find((i): i is Extract<TimelineItem, { kind: 'task' }> => i.kind === 'task' && !!i.todo);
    return handoffBlock({
      memory: this.#memoryCache.get(channel.id) ?? '',
      items: this.#channelItems(channel.id),
      transcript,
      todo: task?.todo ? task.todo.items.map((t) => `[${t.status}] ${t.text}`) : [],
    });
  }

  readonly #memoryCache = new Map<Id, string>();

  /** 发送前（handlers 的 `conversations.send` 包装）：核验提示、算前置、刷新缓存。 */
  async beforeSend(params: { conversationId: Id; text: string; via?: UserMessageVia; suggestionChipId?: Id; replyToItemId?: Id; accessMode?: Parameters<typeof normalizeAgentMode>[0] }): Promise<{
    chip: SuggestionChip | null;
    suggestionsItemId: Id | null;
    /** 这次发送要用的模式：压到频道上限以内后与原来不同（或调用方指定了）时给出，否则 null。 */
    accessMode: AgentMode | null;
  }> {
    const conversation = this.#harness.conversationOf(params.conversationId);
    if (!conversation || (conversation.role !== 'channel' && conversation.role !== 'thread')) return { chip: null, suggestionsItemId: null, accessMode: null };
    const threadItem = conversation.role === 'thread' ? this.itemOfThread(conversation.id) : undefined;
    if (threadItem) await this.#refreshSpend(threadItem.channelId);
    // 频道上限（§14.4）对直接发给线程或频道的消息同样生效：用户指定的或会话自己的模式都压在上限以内。
    const channelId = threadItem?.channelId ?? conversation.channelId ?? null;
    const max = channelId ? (this.#channels.get(channelId)?.maxAccessMode ?? null) : null;
    const asked = params.accessMode ? normalizeAgentMode(params.accessMode) : null;
    const effective = asked ?? this.#threadMode(conversation.id);
    const capped = minMode(effective, max);
    const accessMode = capped && (asked || capped !== effective) ? capped : null;
    let chip: SuggestionChip | null = null;
    let suggestionsItemId: Id | null = null;
    if (params.suggestionChipId) {
      const found = this.#findChip(conversation.id, params.suggestionChipId);
      if (!found || found.item.state !== 'open') throw new RpcError('conflict', RcBot.chipStale(), { code: 'SUGGESTION_STALE' });
      chip = found.chip;
      suggestionsItemId = found.item.id;
      if (chip.action?.kind === 'resolve') {
        const target = this.#items.get(chip.action.workItemId);
        if (!target || target.status !== 'active' || target.active?.state !== 'needsReview') throw new RpcError('conflict', RcBot.chipStale(), { code: 'SUGGESTION_STALE' });
      }
    }
    if (conversation.role === 'channel' && conversation.channelId) {
      const channelId = conversation.channelId;
      await this.refreshMemoryCache(channelId);
      const prelude: string[] = [];
      const replyItem = params.replyToItemId ? this.#findItem(conversation.id, params.replyToItemId) : undefined;
      const target = replyItem?.kind === 'work-item-ref' ? replyItem.workItemId : replyItem?.kind === 'relay' ? replyItem.workItemId : null;
      if (target) prelude.push(replyTargetBlock(target));
      const waiting = this.#channelItems(channelId).filter(needsUser);
      if (!target && waiting.length >= 2 && isBareAnswer(params.text)) prelude.push(ambiguousAnswerBlock(waiting));
      if (prelude.length) this.#prelude.set(conversation.id, prelude);
    }
    return { chip, suggestionsItemId, accessMode };
  }

  /** 发送后：提示改 used、其余作废；「标为完成」提示以用户身份关任务（§12.4）。 */
  async afterSend(params: { conversationId: Id }, sent: { messageId: Id }, chip: SuggestionChip | null, suggestionsItemId: Id | null): Promise<void> {
    this.staleSuggestions(params.conversationId, suggestionsItemId);
    if (chip && suggestionsItemId) {
      this.#harness.patchItem(params.conversationId, suggestionsItemId, (it) => (it.kind === 'suggestions' ? { ...it, state: 'used', usedChipId: chip.id } : it));
    }
    if (chip?.action?.kind === 'resolve') {
      await this.transition(chip.action.workItemId, { type: 'resolve', evidence: null, confirmedBy: sent.messageId }, { actor: 'user' }).catch(() => {});
    }
  }

  /** 点答案提示（`answers` 不为空）：走提问卡的回答，同时写一条 via suggestion 的用户消息，不另起回合。 */
  async answerWithChip(conversationId: Id, chip: SuggestionChip, suggestionsItemId: Id): Promise<{ messageId: Id }> {
    const answers = chip.answers!;
    const approval = [...this.#harness.getConversation(conversationId).items].reverse().find((i) => i.kind === 'approval' && i.approvalId === answers.approvalId);
    if (approval?.kind !== 'approval' || approval.request.kind !== 'question') throw new RpcError('conflict', RcBot.chipStale());
    const q = approval.request.questions[0]!;
    const option = q.options[answers.optionIndex];
    if (!option) throw new RpcError('conflict', RcBot.chipStale());
    const result = await this.#harness.answerQuestion({ conversationId, approvalId: answers.approvalId, answers: { [q.id]: [option.label] } });
    if (result.status !== 'answered') throw new RpcError('conflict', RcBot.chipStale());
    const messageId = newId('msg');
    this.#harness.writeItem(conversationId, { kind: 'user-message', id: messageId, createdAt: nowIso(), taskId: approval.taskId, text: chip.text, via: 'suggestion', suggestionChipId: chip.id });
    this.#harness.patchItem(conversationId, suggestionsItemId, (it) => (it.kind === 'suggestions' ? { ...it, state: 'used', usedChipId: chip.id } : it));
    return { messageId };
  }

  findChip(conversationId: Id, chipId: Id): { chip: SuggestionChip; item: Extract<TimelineItem, { kind: 'suggestions' }> } | null {
    return this.#findChip(conversationId, chipId);
  }

  #findChip(conversationId: Id, chipId: Id): { chip: SuggestionChip; item: Extract<TimelineItem, { kind: 'suggestions' }> } | null {
    const items = this.#harness.getConversation(conversationId).items;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]!;
      if (it.kind !== 'suggestions') continue;
      const chip = it.chips.find((c) => c.id === chipId);
      if (chip) return { chip, item: it };
    }
    return null;
  }

  /** 会话里 open 的提示全部作废（§12.3），`except` 除外。 */
  staleSuggestions(conversationId: Id, except: Id | null = null): void {
    for (const it of this.#harness.getConversation(conversationId).items) {
      if (it.kind === 'suggestions' && it.state === 'open' && it.id !== except) {
        this.#harness.patchItem(conversationId, it.id, (x) => (x.kind === 'suggestions' ? { ...x, state: 'stale' } : x));
      }
    }
  }

  #writeSuggestions(conversationId: Id, forItemId: Id, source: SuggestionsBody['source'], chips: SuggestionChip[]): void {
    this.staleSuggestions(conversationId);
    this.#harness.writeItem(conversationId, {
      kind: 'suggestions',
      id: newId('sug'),
      createdAt: nowIso(),
      taskId: null,
      forItemId,
      source,
      chips,
      state: 'open',
      usedChipId: null,
    });
  }

  /** 智能体的 `suggest_replies`：forItemId 给了就立即写，否则等回合结束绑定最后一条 agent-message。 */
  addSuggestions(conversationId: Id, taskId: Id, forItemId: Id | null, chips: SuggestionChip[]): void {
    if (forItemId) {
      this.#writeSuggestions(conversationId, forItemId, 'agent', chips);
      return;
    }
    this.#pendingChips.set(conversationId, { conversationId, taskId, chips, source: 'agent' });
  }

  // ---- 表情与编辑（§12.4、§8.2） ----

  async react(conversationId: Id, itemId: Id, emoji: string): Promise<{ taskId: Id | null }> {
    const target = this.#findItem(conversationId, itemId);
    if (target?.kind !== 'agent-message') throw new RpcError('not-found', RcBot.proposalNotFound());
    this.#harness.patchItem(conversationId, itemId, (it) => (it.kind === 'agent-message' ? { ...it, reactions: [...new Set([...(it.reactions ?? []), emoji])] } : it));
    const items = this.#harness.getConversation(conversationId).items;
    const latest = [...items].reverse().find((i) => i.kind === 'agent-message');
    const yes = emoji === '\u{1F44D}' || emoji === '✓' || emoji === '✔️' || emoji === '✅';
    const no = emoji === '\u{1F44E}';
    if (yes && latest?.id === itemId && isYesNoQuestion(target.text)) {
      return this.#sendAsUser(conversationId, RcBot.reactionYes().text, 'reaction');
    }
    if (no) return this.#sendAsUser(conversationId, '\u{1F44E}', 'reaction');
    return { taskId: null };
  }

  async #sendAsUser(conversationId: Id, text: string, via: UserMessageVia): Promise<{ taskId: Id | null }> {
    await this.beforeSend({ conversationId, text, via });
    const conversation = this.#harness.conversationOf(conversationId);
    if (conversation && (conversation.activity === 'running' || conversation.activity === 'stopping')) {
      const result = await this.#harness.steer({ conversationId, text, commandId: newId('cmd'), via });
      if (result.status === 'steered' && result.messageId) this.staleSuggestions(conversationId);
      return { taskId: conversation.activeTaskId };
    }
    const sent = await this.#harness.send({ conversationId, text, commandId: newId('cmd'), via });
    this.staleSuggestions(conversationId);
    return { taskId: sent.taskId };
  }

  /** `conversations.editMessage`（BOT-EX-06）：改自己的 typed 消息，转给过的线程连同旧文本重投。 */
  async editMessage(conversationId: Id, itemId: Id, text: string): Promise<TimelineItem> {
    const conversation = this.#harness.conversationOf(conversationId);
    const target = this.#findItem(conversationId, itemId);
    if (!conversation || target?.kind !== 'user-message' || (target.via && target.via !== 'typed')) {
      throw new RpcError('invalid-request', RcBot.proposalNotFound());
    }
    if (target.text === text) return target;
    const revision = (target.revision ?? 0) + 1;
    const updated = this.#harness.patchItem(conversationId, itemId, (it) =>
      it.kind === 'user-message' ? { ...it, text, history: [...(it.history ?? []), { text: target.text, editedAt: nowIso() }], revision } : it,
    );
    const cited = (version: string, old: boolean): CitedMessage => ({
      messageId: old ? `${itemId}@${revision - 1}` : itemId,
      conversationId,
      author: 'user',
      via: 'typed',
      text: version,
      truncated: false,
      at: nowIso(),
    });
    const both = [cited(target.text, true), cited(text, false)];
    const note = 'The user edited this message. The first quote is the old text, the second is the new one. If the request changed, follow the new text; if only a typo changed, say nothing about it.';
    // 改的是频道消息：转给过的线程重投；频道对话本身也收到一份（协调者一行说改了什么）。
    if (conversation.role === 'channel' && conversation.channelId) {
      const rows = (await this.#files.readRelayIndex(conversation.channelId).catch(() => [])).filter((r) => r.citedMessageId === itemId);
      for (const workItemId of new Set(rows.map((r) => r.workItemId))) {
        const item = this.#items.get(workItemId);
        if (!item?.threadId) continue;
        await this.#deliverToThread(item, {
          id: `relay_edit_${itemId}_${revision}_${workItemId}`,
          direction: 'relay',
          text: relayBlock({ workItemId, note, cited: both, kind: 'edited', asOf: nowIso() }),
          origin: 'relay',
          unattended: false,
          note: RcBot.editedMessage().text,
          cited: both,
        });
      }
    }
    if (conversation.role === 'channel' || conversation.role === 'thread') {
      const workItemId = conversation.workItemId ?? null;
      await this.#harness.deliver({
        id: `edit_${itemId}_${revision}`,
        conversationId,
        item: { direction: 'relay', workItemId, reportId: null, from: { role: 'system', conversationId: null }, text: RcBot.editedMessage().text, cited: both },
        agentText: relayBlock({ workItemId: workItemId ?? '', note, cited: both, kind: 'edited', asOf: nowIso() }),
        wake: 'new-task',
        origin: 'relay',
        unattended: false,
        userCitations: [itemId],
      });
    }
    return updated;
  }

  // ---- 提议（§10.2） ----

  writeProposal(conversationId: Id, proposal: ProposalBody, taskId: Id | null): Id {
    const id = newId('prop');
    this.#harness.writeItem(conversationId, { kind: 'proposal', id, createdAt: nowIso(), taskId, proposal, status: 'pending', resultId: null });
    return id;
  }

  async respondProposal(conversationId: Id, itemId: Id, accept: boolean, edits?: { name?: string; purpose?: string }): Promise<{ resultId: Id | null }> {
    const item = this.#findItem(conversationId, itemId);
    if (item?.kind !== 'proposal') throw new RpcError('not-found', RcBot.proposalNotFound());
    if (item.status !== 'pending') throw new RpcError('conflict', RcBot.proposalHandled());
    let resultId: Id | null = null;
    if (accept) {
      const proposal = item.proposal;
      if (proposal.type === 'channel') {
        const channel = await this.createChannel({ name: edits?.name ?? proposal.name, purpose: edits?.purpose ?? proposal.purpose, templateId: proposal.templateId });
        resultId = channel.id;
      } else if (proposal.type === 'schedule') {
        const channel = this.channelOfConversation(conversationId);
        if (!channel || !this.#schedules) throw new RpcError('unsupported', RcBot.scheduleNotReady());
        resultId = await this.#schedules.createForChannel({
          channel,
          name: edits?.name ?? proposal.name,
          cadence: proposal.cadence,
          // 卡片上给用户看过的访问模式跟着模板存下，每次建任务都用它。
          template: proposal.accessMode ? { ...proposal.template, accessMode: proposal.accessMode } : proposal.template,
          accessMode: proposal.accessMode,
        });
      } else {
        for (const id of proposal.workItemIds) {
          const wi = this.#items.get(id);
          if (wi?.status === 'suggested') await this.userTransition(id, { type: 'accept', start: false }).catch(() => {});
        }
      }
    } else if (item.proposal.type === 'suggestions') {
      for (const id of item.proposal.workItemIds) {
        const wi = this.#items.get(id);
        if (wi?.status === 'suggested') await this.userTransition(id, { type: 'dismiss' }).catch(() => {});
      }
    }
    this.#harness.patchItem(conversationId, itemId, (it) => (it.kind === 'proposal' ? { ...it, status: accept ? 'accepted' : 'declined', resultId } : it));
    return { resultId };
  }

  // ---- Make（§11.3） ----

  /** 14 天忽略表：被拒的建议的 subjectKey。 */
  #ignored(channelId: Id): Set<string> {
    const cutoff = this.#clock.now() - BOT_LIMITS.dismissMemoryDays * DAY;
    const keys = new Set<string>();
    for (const item of this.#channelItems(channelId)) {
      if (item.resolution?.kind === 'dismissed' && item.suggestion && Date.parse(item.resolution.at) >= cutoff) keys.add(item.suggestion.subjectKey);
    }
    return keys;
  }

  unwantedKinds(channelId: Id): Set<string> {
    const channel = this.#channels.get(channelId);
    const kinds = new Set(channel?.unwantedKinds ?? []);
    const cutoff = this.#clock.now() - BOT_LIMITS.dismissMemoryDays * DAY;
    for (const item of this.#channelItems(channelId)) {
      if (item.resolution?.kind === 'dismissed' && item.suggestion && Date.parse(item.resolution.at) >= cutoff) kinds.add(`${item.suggestion.kindTag}`);
    }
    return kinds;
  }

  /** 把候选过滤后建成建议任务并写一张卡（Make 与协调者的 `make_suggest`、报告的 followUps 共用）。返回建了几条。 */
  async suggestItems(
    channelId: Id,
    candidates: { title: string; reason: string; kindTag: string; evidence: ResourceRef[] }[],
    trigger: WorkItem['suggestion'] extends infer S ? (S extends { trigger: infer T } ? T : never) : never,
    options: { manual?: boolean } = {},
  ): Promise<number> {
    const channel = this.channel(channelId);
    const ignored = this.#ignored(channelId);
    const unwanted = new Set(channel.unwantedKinds);
    const open = () => [...this.#items.values()].filter((i) => i.status === 'suggested');
    const channelOpen = () => open().filter((i) => i.channelId === channelId).length;
    if (open().length >= BOT_LIMITS.pendingSuggestionsTotal) {
      if (!options.manual) return 0;
      const oldest = open().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const old of oldest.slice(0, candidates.length)) await this.transition(old.id, { type: 'expire' }, { actor: 'system' }).catch(() => {});
    }
    const made: Id[] = [];
    for (const candidate of candidates) {
      if (made.length >= 3 || channelOpen() >= BOT_LIMITS.pendingSuggestionsPerChannel) break;
      const tag = candidate.kindTag.toLowerCase();
      if (MAKE_KIND_DENY.test(tag) || MAKE_KIND_DENY.test(candidate.title.toLowerCase())) continue;
      if (tag !== 'follow-up' && !MAKE_KIND_ALLOW.test(tag)) continue;
      if (unwanted.has(tag)) continue;
      const subjectKey = `${tag}:${candidate.evidence.map((e) => JSON.stringify(e)).join('|') || candidate.title.toLowerCase()}`;
      if (ignored.has(subjectKey)) continue;
      if (this.duplicatesOf(channelId, candidate.title, candidate.evidence).length) continue;
      if (this.#workspace.alreadyDone && candidate.evidence.length) {
        const done = await Promise.all(candidate.evidence.map((e) => this.#workspace.alreadyDone!(tag, e).catch(() => false)));
        if (done.some(Boolean)) continue;
      }
      const title = [...candidate.title].slice(0, BOT_LIMITS.title).join('');
      if (/https?:\/\/|www\./i.test(title)) continue;
      const item = await this.createItem({
        channelId,
        title,
        owner: 'agent',
        status: 'suggested',
        suggestion: {
          reason: [...candidate.reason].slice(0, BOT_LIMITS.description).join(''),
          owner: 'agent',
          evidence: candidate.evidence,
          trigger,
          kindTag: tag,
          subjectKey,
          expiresAt: new Date(this.#clock.now() + BOT_LIMITS.suggestionTtlDays * DAY).toISOString(),
        },
        resources: candidate.evidence.slice(0, BOT_LIMITS.resources),
        source: { kind: 'make', messageId: null, scheduleId: null, runId: null },
      });
      made.push(item.id);
    }
    if (made.length) this.writeProposal(channel.conversationId, { type: 'suggestions', workItemIds: made }, null);
    return made.length;
  }

  /** Make（§11.3）：收集事实 → 生成 → 过滤 → 落地。 */
  async runMake(channelId: Id, trigger: 'manual' | 'channel-created' | 'item-resolved' | 'thread-report' | 'new-media'): Promise<{ runId: Id; shown: number }> {
    const runId = newId('make');
    const channel = this.channel(channelId);
    const manual = trigger === 'manual';
    if (!this.#make) {
      if (manual) throw new RpcError('unsupported', RcBot.makeNoGenerator());
      return { runId, shown: 0 };
    }
    if (!manual) {
      if (this.settings().automationPaused || channel.archived) return { runId, shown: 0 };
      const runs = (await this.#files.readMakeRuns(channelId).catch(() => [])) as { at?: string; trigger?: string }[];
      const today = localDay(new Date(this.#clock.now()), this.#timeZone());
      const autoToday = runs.filter((r) => r.trigger !== 'manual' && r.at && localDay(new Date(r.at), this.#timeZone()) === today).length;
      if (autoToday >= BOT_LIMITS.makeAutoPerDay) return { runId, shown: 0 };
    }
    const memory = await this.#files.readMemory(channelId).catch(() => '');
    const items = this.#channelItems(channelId);
    const refs: ResourceRef[] = [];
    for (const item of items) for (const r of item.resources) if (!refs.some((x) => JSON.stringify(x) === JSON.stringify(r))) refs.push(r);
    const facts: { index: number; line: string }[] = [];
    for (const ref of refs.slice(0, 20)) {
      const line = this.#workspace.describe ? await this.#workspace.describe(ref).catch(() => null) : null;
      facts.push({ index: facts.length, line: line ?? JSON.stringify(ref) });
    }
    const conversationItems = this.#harness.getConversation(channel.conversationId).items;
    const userMessages = conversationItems.filter((i) => i.kind === 'user-message').slice(-30).map((i) => (i as { text: string }).text);
    const recent = this.#clock.now() - 14 * DAY;
    let candidates: MakeCandidate[] = [];
    try {
      candidates = await this.#make.suggest({
        channelName: channel.name,
        purpose: channel.purpose,
        memory,
        openTasks: items.filter((i) => i.status !== 'resolved').map((i) => i.title),
        recentlyResolved: items.filter((i) => i.status === 'resolved' && i.resolution && Date.parse(i.resolution.at) >= recent).map((i) => `${i.title}${i.outcome ? `: ${i.outcome}` : ''}`),
        userMessages,
        facts,
        language: guessLanguage(userMessages),
      });
    } catch (error) {
      await this.#files.appendMakeRun(channelId, { id: runId, trigger, at: nowIso(), candidates: 0, shown: 0, error: String(error) }).catch(() => {});
      if (manual) throw new RpcError('unsupported', RcBot.makeNoGenerator(), { error: String(error) });
      return { runId, shown: 0 };
    }
    const shown = await this.suggestItems(
      channelId,
      candidates.slice(0, 6).map((c) => ({
        title: c.title,
        reason: c.reason,
        kindTag: c.kindTag,
        evidence: c.evidence.map((i) => refs[i]).filter((r): r is ResourceRef => !!r),
      })),
      trigger,
      { manual },
    );
    await this.#files.appendMakeRun(channelId, { id: runId, trigger, at: nowIso(), candidates: candidates.length, shown }).catch(() => {});
    return { runId, shown };
  }

  // ---- 定时任务建任务（§11.1） ----

  async createScheduledItem(channelId: Id, template: WorkItemTemplate, scheduleId: Id, runId: Id): Promise<{ workItemId: Id }> {
    if (this.settings().automationPaused) throw new RpcError('unsupported', RcBot.automationPaused());
    const existing = [...this.#items.values()].find((i) => i.source.runId === runId);
    if (existing) return { workItemId: existing.id };
    const item = await this.createItem(
      {
        channelId,
        title: template.title,
        description: template.description,
        owner: template.owner,
        resources: template.resources,
        source: { kind: 'schedule', messageId: null, scheduleId, runId },
        // 提议卡上写明并经用户同意的访问模式，每一次都照用（开工时仍压在频道上限以内）。
        ...(template.accessMode ? { overrides: { accessMode: template.accessMode, driverId: null, model: null, budget: null, outputLanguage: null } } : {}),
      },
      { start: template.owner === 'agent', attended: false, brief: template.prompt },
    );
    return { workItemId: item.id };
  }

  // ---- 汇总与收件箱 ----

  awaySummary(channelId: Id): AwaySummary {
    const channel = this.channel(channelId);
    const since = channel.lastSeen?.at ?? null;
    const latest = new Map<Id, WorkItemTransition>();
    for (const t of this.#transitions.get(channelId) ?? []) {
      if (since && t.at <= since) continue;
      latest.set(t.workItemId, t);
    }
    const row = (t: WorkItemTransition) => {
      const item = this.#items.get(t.workItemId);
      const report = item?.lastReportId ? this.#reports.get(item.lastReportId) : undefined;
      return { id: t.workItemId, title: item?.title ?? '', headline: report?.headline ?? t.note };
    };
    const done = [];
    const needsYou = [];
    const stopped = [];
    for (const t of latest.values()) {
      if (!since) break;
      if (t.to === 'done') done.push(row(t));
      else if (t.to === 'needsReview' || t.to === 'needsInput') needsYou.push(row(t));
      else if (t.to === 'blocked') stopped.push(row(t));
    }
    const items = this.#harness.conversationOf(channel.conversationId) ? this.#harness.getConversation(channel.conversationId).items : [];
    const first = since ? items.find((i) => i.createdAt > since && i.kind !== 'user-message') : undefined;
    return { since, done, needsYou, stopped, firstUnreadItemId: first?.id ?? null };
  }

  inbox(): InboxRow[] {
    const rows: InboxRow[] = [];
    const pending = this.#harness.approvals.pending();
    for (const item of this.#items.values()) {
      if (!needsUser(item) && !(item.status === 'active' && item.active?.state === 'blocked')) continue;
      const channel = this.#channels.get(item.channelId);
      if (!channel) continue;
      const approval = item.question?.approvalId ? pending.find((p) => p.approvalId === item.question!.approvalId) : undefined;
      rows.push({
        channelId: channel.id,
        channelName: channel.name,
        workItemId: item.id,
        title: item.title,
        state: item.active!.state,
        question: item.question,
        approval: approval ? { approvalId: approval.approvalId, summary: approval.action.summary, cost: null } : null,
        priority: item.priority,
        since: item.active!.since,
      });
    }
    const order = { high: 0, medium: 1, low: 2 };
    return rows.sort((a, b) => order[a.priority] - order[b.priority] || a.since.localeCompare(b.since));
  }

  status(): BotStatus {
    const working = [...this.#items.values()].filter((i) => i.status === 'active' && i.active?.state === 'working' && i.owner === 'agent');
    const nextSchedules = this.#schedules?.nextForStatus() ?? [];
    const waiting = [...this.#items.values()].some((i) => i.status === 'scheduled' || (i.status === 'active' && i.active?.state === 'waitingOnOthers'));
    return {
      workingThreads: working.map((i) => ({ workItemId: i.id, channelId: i.channelId, title: i.title })),
      nextSchedules,
      paused: this.settings().automationPaused,
      resident: working.length > 0 || nextSchedules.length > 0 || waiting,
      needsYou: [...this.#items.values()].filter(needsUser).length,
    };
  }

  async pauseAutomation(paused: boolean): Promise<boolean> {
    await this.updateSettings({ automationPaused: paused });
    if (!paused) {
      await this.#pump();
      await this.fireDue();
    }
    return paused;
  }

  // ---- 线程会话的角色指令（§6.2） ----

  async instructionsFor(conversationId: Id): Promise<string> {
    const conversation = this.#harness.conversationOf(conversationId);
    if (!conversation?.channelId) return '';
    const channel = this.#channels.get(conversation.channelId);
    if (!channel) return '';
    if (conversation.role === 'channel') return coordinatorInstructions(channel);
    if (conversation.role === 'thread') {
      const item = conversation.workItemId ? this.#items.get(conversation.workItemId) : undefined;
      return threadInstructions(channel, item, this.#files.notesPath(channel.id, conversation.id));
    }
    return '';
  }

  notesPath(item: WorkItem): string | null {
    return item.threadId ? this.#files.notesPath(item.channelId, item.threadId) : null;
  }

  filesDir(channelId: Id): string {
    return this.#files.filesDir(channelId);
  }

  async verifyEvidence(item: WorkItem, evidence: Evidence[]): Promise<string | null> {
    const since = this.#lastActiveSince(item);
    for (const e of evidence) {
      if (e.kind === 'past-date') {
        if (!item.eventOn || e.date !== item.eventOn) return 'past-date must equal the task event day';
        if (e.date >= localDay(new Date(this.#clock.now()), this.#timeZone())) return 'the event day has not passed yet';
        continue;
      }
      const problem = await this.#workspace.verifyEvidence(e, item, since);
      if (problem) return problem;
    }
    return null;
  }

  #lastActiveSince(item: WorkItem): string {
    const log = this.#transitions.get(item.channelId) ?? [];
    const enter = log.filter((t) => t.workItemId === item.id && ['working', 'needsReview', 'needsInput', 'blocked', 'waitingOnOthers'].includes(t.to) && !['working', 'needsReview', 'needsInput', 'blocked', 'waitingOnOthers'].includes(t.from)).at(-1);
    return enter?.at ?? item.createdAt;
  }

  // ---- 小工具 ----

  #timeZone(): string {
    return this.settings().timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  }

  timeZone(): string {
    return this.#timeZone();
  }

  #language(conversationId: Id): string | null {
    const items = this.#harness.getConversation(conversationId).items;
    return guessLanguage(items.filter((i) => i.kind === 'user-message').slice(-20).map((i) => (i as { text: string }).text));
  }

  #findItem(conversationId: Id, itemId: Id): TimelineItem | undefined {
    if (!this.#harness.conversationOf(conversationId)) return undefined;
    return this.#harness.getConversation(conversationId).items.find((i) => i.id === itemId);
  }

  findItem(conversationId: Id, itemId: Id): TimelineItem | undefined {
    return this.#findItem(conversationId, itemId);
  }

  #hasAgentMessage(conversationId: Id, taskId: Id | null): boolean {
    return this.#harness.getConversation(conversationId).items.some((i) => i.kind === 'agent-message' && !i.fallback && (taskId === null || i.taskId === taskId));
  }

  #hasSuggestions(conversationId: Id, taskId: Id): boolean {
    const items = this.#harness.getConversation(conversationId).items;
    return items.some((i) => i.kind === 'suggestions' && i.source === 'agent' && items.some((m) => m.id === i.forItemId && m.taskId === taskId));
  }

  #lastAgentMessageItem(conversationId: Id, taskId: Id): Extract<TimelineItem, { kind: 'agent-message' }> | undefined {
    return [...this.#harness.getConversation(conversationId).items]
      .reverse()
      .find((i): i is Extract<TimelineItem, { kind: 'agent-message' }> => i.kind === 'agent-message' && i.taskId === taskId && !i.fallback);
  }

  #lastAgentMessage(conversationId: Id, taskId: Id): string | null {
    return this.#lastAgentMessageItem(conversationId, taskId)?.text ?? null;
  }

  #lastTaskId(conversationId: Id): Id | null {
    const conversation = this.#harness.conversationOf(conversationId);
    if (conversation?.activeTaskId) return conversation.activeTaskId;
    const task = [...this.#harness.getConversation(conversationId).items].reverse().find((i) => i.kind === 'task');
    return task?.id ?? null;
  }

  /** 智能体工具调用的这一回合（Harness 写定的事实）。 */
  runOf(conversationId: Id): (MachineRun & { taskId: Id }) | null {
    const info = this.#harness.runInfo(conversationId);
    if (!info) return null;
    return {
      conversationId,
      taskId: info.taskId,
      origin: info.origin,
      attended: info.attended,
      tainted: info.tainted,
      userCitations: info.userCitations,
      userMessageId: info.userMessageId,
    };
  }

  /** 引用的消息是不是本会话里用户亲手打的（§14.6 的 merge、schedule、eventOn、confirmedBy）。 */
  isUserTyped(conversationId: Id, messageId: Id): boolean {
    const item = this.#findItem(conversationId, messageId);
    return item?.kind === 'user-message' && (!item.via || item.via === 'typed');
  }

  cite(conversationId: Id, ids: readonly Id[]): CitedMessage[] {
    return this.#citeFrom(conversationId, ids);
  }

  recordThreadFile(item: WorkItem, file: string): Promise<WorkItem> {
    if (item.files.includes(file)) return Promise.resolve(item);
    return this.patchItemContent(item.id, (i) => ({ ...i, files: [...i.files, file] }), true);
  }

  writeWorkItemRef(conversationId: Id, workItemId: Id, ackGroup: Id | null): void {
    this.#harness.writeItem(conversationId, { kind: 'work-item-ref', id: `ref_${workItemId}`, createdAt: nowIso(), taskId: ackGroup, workItemId, ackGroup });
  }
}

// ---- 纯函数 ----

function rank(mode: AgentMode): number {
  return AGENT_MODES.indexOf(mode);
}

/** 盘上读回的等你在场的那一份：形状对、投给这条任务的线程才用。 */
function heldFrom(raw: unknown, item: WorkItem): Delivery | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<Delivery>;
  if (typeof d.id !== 'string' || typeof d.agentText !== 'string' || !d.item || typeof d.item !== 'object') return null;
  if (!item.threadId || d.conversationId !== item.threadId || d.item.workItemId !== item.id) return null;
  return d as Delivery;
}

/** 任务的访问模式不高于频道上限（§14.4）。 */
export function minMode(mode: AgentMode | null, max: AgentMode | null): AgentMode | null {
  if (!mode || !max) return mode;
  return rank(mode) > rank(max) ? max : mode;
}

/** 一句裸的「好」「可以」「ok」（§9.4 的消歧）。 */
export function isBareAnswer(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!。！]+$/, '');
  return /^(ok|okay|yes|yep|sure|go|go ahead|do it|fine|y|\u{1F44D}|好|好的|可以|行|嗯|对|没问题|做吧|继续)$/u.test(t);
}

/**
 * 👍 / ✓ 能当「好」的问句（§12.4、BOT-SF-06）：整条消息只有一个问句，且是「要我……吗」这类是非问题，不是「A 还是 B」的选择题。
 * 指令要求问题写成下一步（「导出成片？」），所以只有一个问句、又不是选择题的也算。
 */
export function isYesNoQuestion(text: string): boolean {
  if (questionCount(text) !== 1) return false;
  // 先排除选择题（「用哪一条？」「竖版还是横版？」），即使问句以「要我……」开头。
  const question = /[^.!\u3002\uFF01?\uFF1F\n]*[?\uFF1F]/.exec(text)?.[0] ?? '';
  return !/\b(or|which|what|when|where|who|how)\b|\u8FD8\u662F|\u6216\u8005|\u54EA|\u4EC0\u4E48|\u600E\u4E48|\u591A\u5C11|\u51E0/i.test(question);
}

/** 审批卡或提问卡 → 任务上的问题。 */
type LaunchOptions = { attended?: boolean; brief?: string; cited?: CitedMessage[]; fileOwnership?: string | null };

/** 盘上的排队开工内容（自己写的，仍按形状核对）；不认识时 null。 */
function launchFrom(raw: unknown): LaunchOptions | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: LaunchOptions = {};
  if (typeof r.brief === 'string') out.brief = r.brief;
  if (typeof r.fileOwnership === 'string' || r.fileOwnership === null) out.fileOwnership = r.fileOwnership as string | null;
  if (Array.isArray(r.cited)) {
    out.cited = r.cited.filter(
      (c): c is CitedMessage => !!c && typeof c === 'object' && typeof (c as CitedMessage).messageId === 'string' && typeof (c as CitedMessage).conversationId === 'string',
    );
  }
  return out.brief || out.cited?.length || out.fileOwnership ? out : null;
}

function approvalQuestion(item: Extract<TimelineItem, { kind: 'approval' }>): WorkItemQuestion {
  if (item.request.kind === 'question' && item.request.questions.length) {
    const questions = item.request.questions;
    const q = questions[0]!;
    // 只有一问、单选、选项原样放得下时才能在收件箱与任务详情里一键作答；否则不给选项，打开线程用完整的提问卡回答。
    const inline =
      questions.length === 1 &&
      !q.multiSelect &&
      q.options.length > 0 &&
      q.options.length <= BOT_LIMITS.questionOptions &&
      q.options.every((o) => [...o.label].length <= BOT_LIMITS.optionLabel);
    return {
      text: [...q.question].slice(0, BOT_LIMITS.questionText).join(''),
      kind: 'input',
      options: inline ? q.options.map((o) => ({ label: o.label, description: o.description })) : [],
      pick: null,
      risky: false,
      askedBy: 'thread',
      approvalId: item.approvalId,
      questionId: inline ? q.id : null,
    };
  }
  const summary =
    item.request.kind === 'command' ? item.request.command : item.request.kind === 'tool' ? item.request.tool : item.request.kind === 'file-change' ? item.request.files.join(', ') : '';
  return {
    text: [...RcBot.approvalWaiting({ summary }).text].slice(0, BOT_LIMITS.questionText).join(''),
    kind: 'input',
    options: [],
    pick: null,
    risky: item.risk === 'high',
    askedBy: 'system',
    approvalId: item.approvalId,
  };
}
