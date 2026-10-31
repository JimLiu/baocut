import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { newId, type AgentMode, type BotNotificationEvent, type Money, type TaskBudgetLimits, type TaskBudgetPolicy, type Channel, type ChannelsEvent, type Evidence, type Id, type ResourceRef, type RevertPlan, type TimelineItem, type WorkItem, type WorkItemTemplate } from '@baocut/protocol';
import { DriverRegistry, Harness, silentLogger, type RunEvent, type TaskBudgetPort } from '@baocut/harness';
import { ScriptedDriver, testToolAccess, type ScriptedTurn } from '@baocut/harness/testing';
import { ChannelFiles, ChannelStore, ConversationStore, ProjectStore, WorkItemStore, resolveRuntimeHome } from '@baocut/runtime-storage';
import { ToolCatalog, type ToolErrorBody } from '../../agent-tools/tool-catalog.ts';
import type { AgentPrincipal } from '../../agent-tools/grants.ts';
import { wrapBotSend } from '../bot-methods.ts';
import { BotService, type BotClock, type BotSchedules, type BotWorkspace, type MakeCandidate, type MakeGenerator, type MakeInput } from '../bot-service.ts';
import { BotTools } from '../bot-tools.ts';

/*
 * Bot 的测试装置（只给测试用）：真的 Harness（脚本 Driver）、真的频道与任务存储（临时目录），假的工作区、Make、定时任务与时钟。
 * 脚本像协调者或线程一样经工具目录（按会话角色过滤，与 MCP 端点同一条路）调用 Bot 工具。
 */

export class ToolCallFailed extends Error {
  readonly code: string;
  readonly body: ToolErrorBody;
  constructor(body: ToolErrorBody) {
    super(`${body.code}: ${body.message}`);
    this.code = body.code;
    this.body = body;
  }
}

/** 只在测试手动触发的计时器；`now()` 从真实时间起，可以往前拨。 */
export class FakeClock implements BotClock {
  offset = 0;
  readonly timers = new Map<number, { ms: number; fn: () => void }>();
  #seq = 0;
  now = () => Date.now() + this.offset;
  setTimer = (fn: () => void, ms: number) => {
    const id = ++this.#seq;
    this.timers.set(id, { ms, fn });
    return () => void this.timers.delete(id);
  };
}

export class FakeWorkspace implements BotWorkspace {
  factLines: string[] = [];
  evidenceProblems = new Map<string, string>();
  verified: { evidence: Evidence; since: string }[] = [];
  done = new Set<string>();
  plan: RevertPlan = { videos: [] };
  reverts: { item: Id; keepUserEdits: boolean }[] = [];
  threadReverts: { item: Id; to: 'before-thread' | number }[] = [];
  hung: string | null = null;
  budget: number | null = null;

  facts = async () => this.factLines;
  verifyEvidence = async (evidence: Evidence, _item: WorkItem, since: string) => {
    this.verified.push({ evidence, since });
    return this.evidenceProblems.get(evidence.kind) ?? null;
  };
  alreadyDone = async (kindTag: string, ref: ResourceRef) => this.done.has(`${kindTag}:${JSON.stringify(ref)}`);
  describe = async (ref: ResourceRef) => `fact about ${ref.kind}`;
  revertPlan = async () => this.plan;
  revert = async (item: WorkItem, keepUserEdits: boolean) => {
    this.reverts.push({ item: item.id, keepUserEdits });
    return this.plan.videos.map((v) => ({ videoId: v.videoId, version: v.baseVersion }));
  };
  revertThread = async (item: WorkItem, to: 'before-thread' | number) => {
    this.threadReverts.push({ item: item.id, to });
    return [{ videoId: 'vid_1', version: 3, before: true }];
  };
  /** 线程回合结束后报出的视频基线；已记在任务上的不再报。 */
  baselineFinds: { projectId: Id; videoId: Id; version: number }[] = [];
  baselines = async (item: WorkItem) => this.baselineFinds.filter((b) => !(item.baseVersions ?? []).some((x) => x.videoId === b.videoId));
  hungJob = async () => this.hung;
  budgetUsed = () => this.budget;
  /** 频道花费（§14.5）：所有频道都按这个算；`spendAsks` 记下每次被问到的会话。 */
  spend: { day: Money[]; month: Money[] } = { day: [], month: [] };
  spendAsks: Id[][] = [];
  channelSpend = async (ids: ReadonlySet<Id>) => {
    this.spendAsks.push([...ids]);
    return structuredClone(this.spend);
  };
}

/** 任务预算账本：只记上限。 */
export class FakeBudgets implements TaskBudgetPort {
  readonly limits = new Map<Id, TaskBudgetLimits>();
  taskBudget(taskId: Id): TaskBudgetPolicy | null {
    const limits = this.limits.get(taskId);
    if (!limits) return null;
    const at = new Date().toISOString();
    return { policyId: `tbp_${taskId}`, taskId, ...limits, usage: { calls: 0, reservedCalls: 0, spent: [], reserved: [], unknownCostCalls: 0 }, createdAt: at, updatedAt: at };
  }
  setTaskBudget(taskId: Id, limits: TaskBudgetLimits): TaskBudgetPolicy {
    this.limits.set(taskId, structuredClone(limits));
    return this.taskBudget(taskId)!;
  }
}

export class FakeMake implements MakeGenerator {
  candidates: MakeCandidate[] = [];
  inputs: MakeInput[] = [];
  suggest = async (input: MakeInput) => {
    this.inputs.push(input);
    return this.candidates;
  };
}

export class FakeSchedules implements BotSchedules {
  changed: { id: Id; status: WorkItem['status']; state: string | null }[] = [];
  channelChanges: Id[] = [];
  created: { channelId: Id; name: string; template: WorkItemTemplate }[] = [];
  createForChannel = async (p: { channel: Channel; name: string; template: WorkItemTemplate }) => {
    this.created.push({ channelId: p.channel.id, name: p.name, template: p.template });
    return `sched_${this.created.length}`;
  };
  countForChannel = () => 0;
  nextForStatus = () => [];
  channelChanged = (channelId: Id) => void this.channelChanges.push(channelId);
  workItemChanged = (item: WorkItem) => void this.changed.push({ id: item.id, status: item.status, state: item.active?.state ?? null });
}

export interface TurnContext {
  turn: ScriptedTurn;
  conversationId: Id;
  call<T = Record<string, unknown>>(name: string, args?: unknown): Promise<T>;
  tryCall(name: string, args?: unknown): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: ToolErrorBody }>;
}

export type BotScript = (ctx: TurnContext) => void | Promise<void>;

/** 智能体请求一条越出沙箱的命令（Harness 算 high）：回合停着等审批，返回 approvalId。 */
export function escalate(ctx: TurnContext, command: string): Id {
  const approvalId = newId('ap');
  ctx.turn.hold();
  ctx.turn.session.emit({
    type: 'approval.requested',
    turnId: ctx.turn.session.turnId!,
    approvalId,
    request: { kind: 'command', command, cwd: null, reason: command },
    escalation: true,
  });
  return approvalId;
}

export class BotKit {
  dir!: string;
  harness!: Harness;
  driver!: ScriptedDriver;
  otherDriver: ScriptedDriver | null = null;
  bot!: BotService;
  tools!: BotTools;
  catalog!: ToolCatalog;
  clock = new FakeClock();
  workspace = new FakeWorkspace();
  budgets = new FakeBudgets();
  make = new FakeMake();
  schedules = new FakeSchedules();
  events: ChannelsEvent[] = [];
  runs: RunEvent[] = [];
  main!: Channel;
  /** 协调者与线程的默认脚本；`scripts` 按会话覆盖。 */
  coordinator: BotScript = () => {};
  thread: BotScript = () => {};
  readonly scripts = new Map<Id, BotScript>();
  #home!: ReturnType<typeof resolveRuntimeHome>;

  static async open(options: { approvals?: boolean; steer?: boolean; facts?: string[]; seedTimeoutMs?: number; otherDriver?: boolean; followPreferences?: boolean } = {}): Promise<BotKit> {
    const kit = new BotKit();
    kit.dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-bot-')));
    kit.#home = resolveRuntimeHome({ BAOCUT_HOME: path.join(kit.dir, 'home') });
    kit.workspace.factLines = options.facts ?? [];
    await kit.#boot(options);
    return kit;
  }

  async #boot(options: { approvals?: boolean; steer?: boolean; seedTimeoutMs?: number; otherDriver?: boolean; followPreferences?: boolean }): Promise<void> {
    const home = this.#home;
    this.driver = new ScriptedDriver({ ...(options.approvals !== undefined ? { approvals: options.approvals } : {}), ...(options.steer !== undefined ? { steer: options.steer } : {}) });
    const drivers = new DriverRegistry();
    drivers.register(this.driver);
    // 第二个 Agent（id `other`）：测换 Driver 用，脚本和第一个一样。
    if (options.otherDriver) {
      this.otherDriver = new ScriptedDriver({ id: 'other', name: 'Other' });
      drivers.register(this.otherDriver);
    }
    this.harness = await Harness.open({
      home,
      conversations: new ConversationStore(home.conversationsDir),
      projects: new ProjectStore(home.projectsFile),
      drivers,
      log: silentLogger,
      tools: testToolAccess(),
      budgets: this.budgets,
    });
    this.harness.onRun((event) => this.runs.push(event));
    this.bot = new BotService({
      harness: this.harness,
      channels: new ChannelStore(home.channelsFile),
      workItems: new WorkItemStore(home.workItemsDir),
      files: new ChannelFiles(home.channelsDir),
      log: silentLogger,
      workspace: this.workspace,
      make: this.make,
      schedules: this.schedules,
      defaults: () => ({ driverId: null, accessMode: options.followPreferences ? null : 'fullAccess' }),
      clock: this.clock,
      seedTimeoutMs: options.seedTimeoutMs ?? 60_000,
    });
    this.tools = new BotTools({ bot: this.bot, harness: this.harness });
    this.catalog = new ToolCatalog([this.tools], silentLogger);
    this.driver.script = async (turn) => {
      const conversationId = turn.conversationId!;
      const role = this.harness.conversationOf(conversationId)?.role;
      const script = this.scripts.get(conversationId) ?? (role === 'thread' ? this.thread : role === 'channel' ? this.coordinator : null);
      if (script) await script(this.#context(turn));
    };
    if (this.otherDriver) this.otherDriver.script = this.driver.script;
    await this.bot.start();
    this.bot.subscribe('channels', undefined, ((event: { event: ChannelsEvent }) => this.events.push(event.event)) as never);
    this.main = await this.bot.ensureMain();
    await this.settle();
  }

  /** 存储目录（测试改坏文件用）。 */
  get home(): ReturnType<typeof resolveRuntimeHome> {
    return this.#home;
  }

  /** 模拟进程重启：Harness 与 BotService 关掉再从同一个目录打开。`whileDown` 在两者之间跑（模拟停机期间的文件变化）。 */
  async restart(options: { approvals?: boolean; whileDown?: () => Promise<void> } = {}): Promise<void> {
    await this.bot.stop();
    await this.harness.shutdown();
    await options.whileDown?.();
    this.events = [];
    this.runs = [];
    await this.#boot(options);
  }

  #context(turn: ScriptedTurn): TurnContext {
    const conversationId = turn.conversationId!;
    const tryCall = (name: string, args: unknown = {}) => this.invoke(conversationId, name, args);
    return {
      turn,
      conversationId,
      tryCall,
      call: async <T,>(name: string, args: unknown = {}) => {
        const outcome = await tryCall(name, args);
        if (!outcome.ok) throw new ToolCallFailed(outcome.error);
        return outcome.result as T;
      },
    };
  }

  principal(conversationId: Id): AgentPrincipal {
    return { kind: 'agent', conversationId, connectionId: 'agent-test', name: 'agent' };
  }

  /** 经按角色过滤的目录调用（与 McpEndpoint 的 `roleOf` 同一条路）。 */
  async invoke(conversationId: Id, name: string, args: unknown = {}): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; error: ToolErrorBody }> {
    const role = this.harness.conversationOf(conversationId)?.role ?? 'chat';
    const outcome = await this.catalog.forRole(role).invoke(name, args, this.principal(conversationId));
    return outcome.ok ? { ok: true, result: outcome.result as Record<string, unknown> } : { ok: false, error: outcome.error };
  }

  /** 用户在频道或线程里发一条消息（经 Bot 的 `conversations.send` 包装）。 */
  async send(
    conversationId: Id,
    text: string,
    extra: { via?: 'typed' | 'suggestion' | 'reaction'; suggestionChipId?: Id; replyToItemId?: Id; accessMode?: AgentMode } = {},
  ): Promise<{ taskId: Id }> {
    const handler = wrapBotSend(
      () => this.bot,
      this.harness,
      (async (p: { conversationId: Id; text: string; commandId: Id; via?: 'typed' | 'suggestion' | 'reaction'; suggestionChipId?: Id; replyToItemId?: Id; accessMode?: AgentMode }) =>
        this.harness.send({
          conversationId: p.conversationId,
          text: p.text,
          commandId: p.commandId,
          ...(p.accessMode ? { accessMode: p.accessMode } : {}),
          ...(p.via ? { via: p.via } : {}),
          ...(p.suggestionChipId ? { suggestionChipId: p.suggestionChipId } : {}),
          ...(p.replyToItemId ? { replyToItemId: p.replyToItemId } : {}),
        })) as never,
    );
    const result = await handler({ conversationId, text, commandId: newId('cmd'), ...extra } as never, { kind: 'desktop', connectionId: 'ui', name: 'desktop' });
    return result as { taskId: Id };
  }

  items(conversationId: Id): TimelineItem[] {
    return this.harness.getConversation(conversationId).items;
  }

  /** 交给智能体的每个回合的文字（按会话）。 */
  turns(conversationId: Id): string[] {
    return this.driver.sessions.filter((s) => s.conversationId === conversationId).flatMap((s) => s.turns);
  }

  item(id: Id): WorkItem {
    return this.bot.item(id);
  }

  threadOf(id: Id): Id {
    const threadId = this.bot.item(id).threadId;
    if (!threadId) throw new Error(`task ${id} has no thread`);
    return threadId;
  }

  notifications(): BotNotificationEvent[] {
    return this.events.filter((e): e is BotNotificationEvent => e.type === 'bot.notification');
  }

  /** 等到所有 Bot 会话都没有进行中的回合，且连续两次看都不再变。 */
  async settle(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let quiet = 0;
    let lastRuns = -1;
    for (;;) {
      // 停在审批或提问上的回合不算忙（它在等用户）。
      const busy = this.harness
        .directorySnapshot()
        .conversations.some((c) => c.role !== 'chat' && (c.activity === 'running' || c.activity === 'stopping' || (this.harness.runInfo(c.id) && !c.activity.startsWith('awaiting'))));
      if (!busy && this.runs.length === lastRuns) quiet++;
      else quiet = 0;
      lastRuns = this.runs.length;
      if (quiet >= 3) return;
      if (Date.now() > deadline) throw new Error('settle timeout');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async until<T>(read: () => T | undefined | null | false, timeoutMs = 4000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = read();
      if (value) return value;
      if (Date.now() > deadline) throw new Error('until: timeout');
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
  }

  /** 协调者在一个用户回合里建任务并开线程（常用的前置）。返回任务。 */
  async startTask(text: string, create: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Promise<WorkItem> {
    let id: Id | null = null;
    const previous = this.coordinator;
    this.coordinator = async (ctx) => {
      const run = this.bot.runOf(ctx.conversationId)!;
      // 别的回合（报告、转交）交给原来的脚本。
      if (id || run.origin !== 'user') return previous(ctx);
      const sourceMessageId = run.userMessageId!;
      const result = await ctx.call<{ workItemId: Id }>('thread_start', {
        create: { title: text, sourceMessageId, ...create },
        citedMessageIds: [sourceMessageId],
        ...extra,
      });
      id = result.workItemId;
      ctx.turn.say('On it.');
    };
    try {
      await this.send(this.main.conversationId, text);
      await this.until(() => id);
      await this.settle();
    } finally {
      this.coordinator = previous;
    }
    return this.bot.item(id!);
  }

  /** 一个只跑一次的脚本：之后的回合（报告、兜底）什么都不做。 */
  once<T>(fn: (ctx: TurnContext) => Promise<T> | T): { script: BotScript; result: () => Promise<T> } {
    let out: { value: T } | null = null;
    let error: { error: unknown } | null = null;
    const script: BotScript = async (ctx) => {
      if (out || error) return;
      try {
        out = { value: await fn(ctx) };
      } catch (e) {
        error = { error: e };
      }
    };
    const result = async () => {
      await this.until(() => out || error);
      await this.settle();
      if (error) throw error.error;
      return out!.value;
    };
    return { script, result };
  }

  /** 用户在频道里说一句，协调者这一回合跑 `fn`。 */
  async coordinatorTurn<T>(text: string, fn: (ctx: TurnContext) => Promise<T> | T, extra: { via?: 'typed' | 'suggestion' | 'reaction'; replyToItemId?: Id } = {}): Promise<T> {
    const { script, result } = this.once(fn);
    const previous = this.coordinator;
    this.coordinator = script;
    try {
      await this.send(this.main.conversationId, text, extra);
      return await result();
    } finally {
      this.coordinator = previous;
    }
  }

  /** 用户在任务的线程里说一句，线程这一回合跑 `fn`。 */
  async threadTurn<T>(workItemId: Id, text: string, fn: (ctx: TurnContext) => Promise<T> | T): Promise<T> {
    const threadId = this.threadOf(workItemId);
    // 线程回合开始时 Bot 先把任务转回工作中（异步写盘）：等它落定再跑脚本，免得报告抢在前面。
    const { script, result } = this.once(async (ctx) => {
      await this.until(() => this.bot.item(workItemId).active?.state === 'working', 500).catch(() => {});
      return fn(ctx);
    });
    this.scripts.set(threadId, script);
    try {
      await this.send(threadId, text);
      return await result();
    } finally {
      this.scripts.delete(threadId);
    }
  }

  async close(): Promise<void> {
    await this.bot.stop().catch(() => {});
    await this.harness.shutdown().catch(() => {});
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}
