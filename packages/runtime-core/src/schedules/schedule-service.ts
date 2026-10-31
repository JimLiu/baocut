import { randomUUID } from 'node:crypto';
import type { Logger } from '@baocut/harness';
import {
  nextScheduleRun,
  normalizeAgentMode,
  refOf,
  RpcError,
  SCHEDULE_GRACE_MS,
  SCHEDULE_LIMITS,
  scheduleDefaultName,
  scheduleOccurrences,
  scheduleProblem,
  scheduleRunOpen,
  type Conversation,
  type ConversationActivity,
  type Id,
  type RpcParams,
  type RpcResult,
  type Schedule,
  type ScheduleAgent,
  type ScheduleFireOutcome,
  type SchedulePauseReason,
  type ScheduleRun,
  type TaskSummary,
  type TasksEvent,
  type ActiveState,
  type WorkItemStatus,
  type WorkItemTemplate,
} from '@baocut/protocol';
import { RcBot, RcSchedules } from '@baocut/protocol/messages/runtime-core';

/** 计时器最长等多久：机器睡醒、系统时间改过之后，最迟这么久重新对一次表。 */
export const SCHEDULE_MAX_TIMER_MS = 60 * 60_000;

/** 会话正忙（在跑、在停、在等用户允许或回答）：到点时排队，等它空下来再发。 */
const BUSY: ReadonlySet<ConversationActivity> = new Set(['running', 'stopping', 'awaiting-approval', 'awaiting-answer']);

/** 记住多少个 `commandId`（建立与立即运行只做一次）。 */
const COMMAND_MEMORY = 200;

/** 定时任务要用的 Runtime 能力：会话与项目、新开会话、发消息（方法表的 `conversations.send`，带品牌与 skill 的同一条路）、任务状态与发布。 */
export interface ScheduleHost {
  conversation(id: Id): Conversation | undefined;
  hasProject(id: Id): boolean;
  createConversation(params: { projectId: Id; title: string; agent: ScheduleAgent; commandId: Id }): Promise<Conversation>;
  send(params: { conversationId: Id; text: string; commandId: Id }): Promise<{ taskId: Id }>;
  task(taskId: Id): TaskSummary | undefined;
  publish(event: Extract<TasksEvent, { type: 'schedule.upsert' | 'schedule.removed' }>): void;
  /**
   * Bot 模式（技术方案 §11.1）：`work-item` 目标到点时在频道里建一条任务（按模板），不给时这类定时任务按失败记。
   * `channel` 查频道是否还在、是否归档；`workItem` 查任务的状态（到了停点就算这一次结束）。
   */
  bot?: {
    channel(channelId: Id): { archived: boolean } | undefined;
    createWorkItem(channelId: Id, template: WorkItemTemplate, scheduleId: Id, runId: Id): Promise<{ workItemId: Id }>;
    workItem(workItemId: Id): { status: WorkItemStatus; activeState: ActiveState | null } | undefined;
  };
}

export interface ScheduleClock {
  now(): number;
  /** 过 `ms` 毫秒调一次 `fn`；返回取消。 */
  setTimer(fn: () => void, ms: number): () => void;
}

export interface ScheduleStoreLike {
  load(): Promise<Schedule[]>;
  save(schedules: readonly Schedule[]): Promise<void>;
}

const systemClock: ScheduleClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};

type Decision = { k: 'run' | 'queue' | 'skip' | 'complete'; target?: Conversation } | { k: 'pause'; reason: SchedulePauseReason };

/**
 * 定时任务（产品设计 §6.1「定时任务」，架构设计 §3.13）。Runtime 开着才跑，按本机时区：
 *
 * - 到点时上一次还没结束（在跑或在排队）：这次跳过，记一条「跳过」；
 * - 目标会话正忙：记一条「排队」，会话空下来时再发，不跳过；
 * - 目标会话归档、删除，或新开会话的项目移除：自动暂停并记下原因；
 * - 迟到（刚启动、机器睡醒）：最近一次到点在 `SCHEDULE_GRACE_MS` 之内的照常发一次，其余记一条「错过 · N 次」，从现在起算下一次；
 * - 完成与失败算进最多运行次数，跑满就标为完成。
 *
 * 到点与立即运行都走 `#fire`：先同步记下这一次（在跑的那条让之后的到点跳过，不会重发），再异步新开会话、发消息。
 * 发不出去记在运行记录上，不往计时器里抛。
 */
export class ScheduleService {
  readonly #store: ScheduleStoreLike;
  readonly #host: ScheduleHost;
  readonly #clock: ScheduleClock;
  readonly #log: Logger;
  readonly #newId: () => Id;
  #schedules: Schedule[] = [];
  #cancelTimer: (() => void) | null = null;
  #started = false;
  #stopped = false;
  readonly #commands = new Map<Id, Promise<unknown>>();

  constructor(options: { store: ScheduleStoreLike; host: ScheduleHost; log: Logger; clock?: ScheduleClock; newId?: () => Id }) {
    this.#store = options.store;
    this.#host = options.host;
    this.#log = options.log;
    this.#clock = options.clock ?? systemClock;
    this.#newId = options.newId ?? (() => `sch_${randomUUID()}`);
  }

  /** 读出定时任务，收尾上次没收完的运行，对齐目标会话的现状，再按时刻补发或记错过。 */
  async start(): Promise<void> {
    this.#schedules = await this.#store.load();
    this.#started = true;
    for (const schedule of this.#schedules) {
      for (const run of schedule.runs) {
        if (run.status !== 'running') continue;
        const task = run.taskId ? this.#host.task(run.taskId) : undefined;
        // 上次关掉时还没拿到任务的那一轮不知道发没发出去，按失败记。
        if (!task) this.#finish(schedule, run, 'failed', null);
        else if (task.status !== 'running' && task.status !== 'stopping') this.#settle(schedule, run, task);
      }
      this.#checkTarget(schedule);
      this.#startQueued(schedule);
    }
    void this.#persist();
    this.#tick();
  }

  stop(): void {
    this.#stopped = true;
    this.#cancelTimer?.();
    this.#cancelTimer = null;
  }

  list(): Schedule[] {
    return structuredClone(this.#schedules);
  }

  // ---- 方法表 ----

  create(params: RpcParams<'schedules.create'>): Promise<RpcResult<'schedules.create'>> {
    return this.#once(`create:${params.commandId}`, async () => {
      const conversation = this.#host.conversation(params.conversationId);
      if (!conversation) throw new RpcError('not-found', RcSchedules.conversationNotFound({ id: params.conversationId }));
      if (params.target === 'work-item' && (!params.workItem || !this.#host.bot?.channel(params.workItem.channelId))) {
        throw new RpcError('invalid-request', RcSchedules.invalid());
      }
      if (conversation.archived) throw new RpcError('invalid-request', RcSchedules.conversationArchived());
      if (params.target === 'new' && !conversation.projectId) throw new RpcError('invalid-request', RcSchedules.noProject());
      const now = this.#clock.now();
      const problem = scheduleProblem(params, now);
      if (problem) throw new RpcError('invalid-request', RcSchedules.invalid(), problem);
      const stamp = new Date(now).toISOString();
      const schedule: Schedule = {
        id: this.#newId(),
        name: params.name?.trim() || scheduleDefaultName(params.prompt),
        prompt: params.prompt.trim(),
        cadence: params.cadence,
        conversationId: conversation.id,
        target: params.target,
        projectId: conversation.projectId,
        agent: {
          driverId: conversation.driverId,
          model: conversation.model,
          effort: conversation.effort,
          accessMode: conversation.accessMode ? normalizeAgentMode(conversation.accessMode) : null,
        },
        maxRuns: params.maxRuns,
        runCount: 0,
        status: 'active',
        pauseReason: null,
        nextAt: iso(nextScheduleRun(params.cadence, now)),
        createdAt: stamp,
        updatedAt: stamp,
        runs: [],
        ...(params.target === 'work-item' && params.workItem ? { workItem: params.workItem } : {}),
      };
      this.#schedules.unshift(schedule);
      this.#changed(schedule);
      await this.#persist();
      this.#arm();
      if (!params.runNow) return { schedule: structuredClone(schedule) };
      const outcome = await this.#fire(schedule, true);
      return { schedule: structuredClone(schedule), outcome };
    });
  }

  async update(params: RpcParams<'schedules.update'>): Promise<RpcResult<'schedules.update'>> {
    const schedule = this.#require(params.scheduleId);
    const now = this.#clock.now();
    const next = {
      name: params.name !== undefined ? params.name.trim() || scheduleDefaultName(params.prompt ?? schedule.prompt) : schedule.name,
      prompt: params.prompt !== undefined ? params.prompt.trim() : schedule.prompt,
      cadence: params.cadence ?? schedule.cadence,
      maxRuns: params.maxRuns !== undefined ? params.maxRuns : schedule.maxRuns,
    };
    const problem = scheduleProblem(next, now);
    if (problem) throw new RpcError('invalid-request', RcSchedules.invalid(), problem);
    if (params.target === 'new' && !schedule.projectId) throw new RpcError('invalid-request', RcSchedules.noProject());
    Object.assign(schedule, next);
    if (params.target) schedule.target = params.target;
    if (params.paused === true && schedule.status === 'active') this.#pause(schedule, null);
    else if (params.paused === false && schedule.status !== 'active') {
      const blocked = this.#blocked(schedule);
      if (blocked) throw new RpcError('invalid-request', blocked);
      schedule.status = 'active';
      schedule.pauseReason = null;
    }
    if (schedule.status === 'active') {
      schedule.nextAt = iso(nextScheduleRun(schedule.cadence, now));
      this.#completeIfFull(schedule);
    }
    this.#changed(schedule);
    await this.#persist();
    this.#arm();
    return { schedule: structuredClone(schedule) };
  }

  run(params: RpcParams<'schedules.run'>): Promise<RpcResult<'schedules.run'>> {
    return this.#once(`run:${params.commandId}`, async () => {
      const schedule = this.#require(params.scheduleId);
      if (schedule.status !== 'active') throw new RpcError('invalid-request', RcSchedules.notActive());
      const outcome = await this.#fire(schedule, true);
      return { schedule: structuredClone(schedule), outcome };
    });
  }

  async remove(params: RpcParams<'schedules.remove'>): Promise<RpcResult<'schedules.remove'>> {
    this.#require(params.scheduleId);
    this.#schedules = this.#schedules.filter((s) => s.id !== params.scheduleId);
    this.#host.publish({ type: 'schedule.removed', scheduleId: params.scheduleId });
    await this.#persist();
    this.#arm();
    return { removed: true };
  }

  // ---- Harness 的变化 ----

  /** 会话变了：归档的暂停；排队的那一轮在会话空下来时发出去。 */
  conversationChanged(conversation: Conversation): void {
    for (const schedule of this.#schedules) {
      if (schedule.target !== 'conversation' || schedule.conversationId !== conversation.id) continue;
      if (this.#checkTarget(schedule)) continue;
      this.#startQueued(schedule);
    }
  }

  /** 会话删除了：发给它的定时任务暂停。 */
  conversationRemoved(conversationId: Id): void {
    for (const schedule of this.#schedules) {
      if (schedule.target === 'conversation' && schedule.conversationId === conversationId) this.#checkTarget(schedule);
    }
  }

  /** 项目移除了：在它里面新开会话的定时任务暂停。 */
  projectRemoved(projectId: Id): void {
    for (const schedule of this.#schedules) {
      if (schedule.target === 'new' && schedule.projectId === projectId) this.#checkTarget(schedule);
    }
  }

  /** 任务结束：那一次运行收尾（完成或失败），跑满就标完成。 */
  taskChanged(task: TaskSummary): void {
    if (task.status === 'running' || task.status === 'stopping') return;
    for (const schedule of this.#schedules) {
      const run = schedule.runs.find((r) => r.status === 'running' && r.taskId === task.taskId);
      if (run) this.#settle(schedule, run, task);
    }
  }

  /** Bot 任务变了（§11.1）：这一次建的任务到了停点（待你审阅、待你回答、卡住或完成）就把这一次记成完成。 */
  workItemChanged(workItemId: Id): void {
    for (const schedule of this.#schedules) {
      if (schedule.target !== 'work-item') continue;
      const run = schedule.runs.find((r) => r.status === 'running' && r.workItemId === workItemId);
      if (run) this.#settleWorkItem(schedule, run);
    }
  }

  /** 频道归档或删除：在里面建任务的定时任务暂停；恢复了不自动继续（用户自己点）。 */
  channelChanged(channelId: Id): void {
    for (const schedule of this.#schedules) {
      if (schedule.target === 'work-item' && schedule.workItem?.channelId === channelId) this.#checkTarget(schedule);
    }
  }

  /** 频道里的定时任务（删除频道时的确认计数、托盘的「接下来」）。 */
  forChannel(channelId: Id): Schedule[] {
    return this.#schedules.filter((s) => s.target === 'work-item' && s.workItem?.channelId === channelId).map((s) => structuredClone(s));
  }

  #settleWorkItem(schedule: Schedule, run: ScheduleRun): void {
    const item = run.workItemId ? this.#host.bot?.workItem(run.workItemId) : undefined;
    if (!item) {
      this.#finish(schedule, run, 'failed', RcSchedules.runStopped().text);
      return;
    }
    const stopped =
      item.status === 'resolved' ||
      (item.status === 'active' && item.activeState !== null && item.activeState !== 'working' && item.activeState !== 'waitingOnOthers');
    if (stopped) this.#finish(schedule, run, item.activeState === 'blocked' ? 'failed' : 'done', null);
  }

  // ---- 到点 ----

  #tick(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = null;
    if (this.#stopped) return;
    const now = this.#clock.now();
    for (const schedule of [...this.#schedules]) {
      if (schedule.status === 'active' && schedule.nextAt && Date.parse(schedule.nextAt) <= now) this.#due(schedule, now);
    }
    this.#arm();
  }

  /** 到点（可能迟到了）：最近一次在宽限之内的发一次，更早的记成错过；从现在起算下一次。 */
  #due(schedule: Schedule, now: number): void {
    const due = Date.parse(schedule.nextAt!);
    const total = 1 + scheduleOccurrences(schedule.cadence, due, now);
    const recent = nextScheduleRun(schedule.cadence, Math.max(due - 1, now - SCHEDULE_GRACE_MS));
    const fire = recent !== null && recent <= now;
    const missed = Math.min(total - (fire ? 1 : 0), SCHEDULE_LIMITS.missedCap);
    schedule.nextAt = iso(nextScheduleRun(schedule.cadence, now));
    if (missed > 0) {
      this.#addRun(schedule, { status: 'missed', at: iso(due)!, count: missed });
      this.#log.info('Scheduled runs missed', { scheduleId: schedule.id, count: missed });
    }
    if (fire) void this.#fire(schedule, false);
    else {
      this.#changed(schedule);
      void this.#persist();
    }
  }

  /** 到点或立即运行：按现状起一轮、排队、跳过、暂停或标完成。 */
  async #fire(schedule: Schedule, manual: boolean): Promise<ScheduleFireOutcome> {
    const decision = this.#decide(schedule);
    const at = iso(this.#clock.now())!;
    const flag = manual ? { manual: true } : {};
    let outcome: ScheduleFireOutcome;
    switch (decision.k) {
      case 'complete':
        this.#completeIfFull(schedule);
        outcome = 'complete';
        break;
      case 'pause':
        this.#pause(schedule, decision.reason);
        outcome = 'pause';
        break;
      case 'skip':
        this.#addRun(schedule, { status: 'skipped', at, ...flag });
        outcome = 'skip';
        break;
      case 'queue':
        this.#addRun(schedule, { status: 'queued', at, conversationId: decision.target!.id, ...flag });
        outcome = 'queue';
        break;
      case 'run': {
        const run = this.#addRun(schedule, { status: 'running', at, startedAt: at, conversationId: decision.target?.id ?? null, ...flag });
        this.#changed(schedule);
        outcome = await this.#start(schedule, run);
        break;
      }
    }
    this.#changed(schedule);
    void this.#persist();
    this.#arm();
    return outcome;
  }

  #decide(schedule: Schedule): Decision {
    if (schedule.maxRuns !== null && schedule.runCount >= schedule.maxRuns) return { k: 'complete' };
    const reason = this.#targetGone(schedule);
    if (reason) return { k: 'pause', reason };
    if (schedule.runs.some(scheduleRunOpen)) return { k: 'skip' };
    // 频道任务：上一次建的任务还没解决（待你审阅也算），这次跳过，不堆积（§11.1）。
    if (schedule.target === 'work-item') {
      const last = schedule.runs.find((r) => r.workItemId);
      const item = last?.workItemId ? this.#host.bot?.workItem(last.workItemId) : undefined;
      if (item && item.status !== 'resolved') return { k: 'skip' };
    }
    const target = schedule.target === 'conversation' ? this.#host.conversation(schedule.conversationId) : undefined;
    if (target && busy(target)) return { k: 'queue', target };
    return { k: 'run', ...(target ? { target } : {}) };
  }

  /** 发出去：新开会话（需要时）、发消息、记下任务。会话正忙（抢在我们前面）时退回排队；别的失败记在这一次上。 */
  async #start(schedule: Schedule, run: ScheduleRun): Promise<ScheduleFireOutcome> {
    try {
      if (schedule.target === 'work-item') {
        if (!this.#host.bot || !schedule.workItem) throw new RpcError('unsupported', RcSchedules.invalid());
        const { workItemId } = await this.#host.bot.createWorkItem(schedule.workItem.channelId, schedule.workItem.template, schedule.id, run.id);
        run.workItemId = workItemId;
        this.#settleWorkItem(schedule, run);
        this.#changed(schedule);
        return 'run';
      }
      if (!run.conversationId) {
        const created = await this.#host.createConversation({
          projectId: schedule.projectId!,
          title: schedule.name,
          agent: schedule.agent,
          commandId: `schedule:${run.id}:create`,
        });
        run.conversationId = created.id;
        this.#changed(schedule);
      }
      const { taskId } = await this.#host.send({
        conversationId: run.conversationId,
        text: schedule.prompt,
        commandId: `schedule:${run.id}`,
      });
      run.taskId = taskId;
      const task = this.#host.task(taskId);
      if (task && task.status !== 'running' && task.status !== 'stopping') this.#settle(schedule, run, task);
      else this.#changed(schedule);
      return 'run';
    } catch (error) {
      if (error instanceof RpcError && error.code === 'busy' && schedule.target === 'conversation' && run.status === 'running') {
        run.status = 'queued';
        run.startedAt = null;
        this.#changed(schedule);
        return 'queue';
      }
      const message = error instanceof Error ? error.message : String(error);
      this.#log.warn('Scheduled run failed to start', { scheduleId: schedule.id, error: error instanceof RpcError ? error.code : 'error' });
      this.#finish(schedule, run, 'failed', message, error instanceof RpcError ? error.messageRef : undefined);
      return 'failed';
    }
  }

  /** 排队的那一轮：目标会话空下来、定时任务还启用时发出去。 */
  #startQueued(schedule: Schedule): void {
    if (schedule.status !== 'active') return;
    const run = schedule.runs.find((r) => r.status === 'queued');
    if (!run?.conversationId) return;
    const conversation = this.#host.conversation(run.conversationId);
    if (!conversation || conversation.archived || busy(conversation)) return;
    run.status = 'running';
    run.startedAt = iso(this.#clock.now());
    this.#changed(schedule);
    void this.#start(schedule, run).then(() => this.#persist());
  }

  // ---- 状态 ----

  /** 目标还在不在：不在时暂停并返回 true。跑满的不动。 */
  #checkTarget(schedule: Schedule): boolean {
    if (schedule.status === 'completed') return false;
    const reason = this.#targetGone(schedule);
    if (!reason) return false;
    // 用户自己暂停的，目标不在了也换上原因（继续时一样被拦）。
    if (schedule.status === 'paused' && schedule.pauseReason === reason) return true;
    this.#pause(schedule, reason);
    this.#changed(schedule);
    void this.#persist();
    this.#arm();
    return true;
  }

  #targetGone(schedule: Schedule): SchedulePauseReason | null {
    if (schedule.target === 'work-item') {
      const channel = schedule.workItem ? this.#host.bot?.channel(schedule.workItem.channelId) : undefined;
      if (!channel) return 'conversation-deleted';
      return channel.archived ? 'channel-archived' : null;
    }
    if (schedule.target === 'conversation') {
      const conversation = this.#host.conversation(schedule.conversationId);
      if (!conversation) return 'conversation-deleted';
      if (conversation.archived) return 'conversation-archived';
      return null;
    }
    return schedule.projectId && this.#host.hasProject(schedule.projectId) ? null : 'project-removed';
  }

  /** 继续之前的检查：目标不在或已跑满时的原因。 */
  #blocked(schedule: Schedule) {
    const reason = this.#targetGone(schedule);
    if (reason === 'conversation-archived') return RcSchedules.resumeArchived();
    // 频道归档时也不能继续（否则继续后到点又被暂停）。
    if (reason === 'channel-archived') return RcBot.channelArchived();
    if (reason === 'conversation-deleted') return RcSchedules.resumeDeleted();
    if (reason === 'project-removed') return RcSchedules.resumeProjectRemoved();
    if (schedule.maxRuns !== null && schedule.runCount >= schedule.maxRuns) return RcSchedules.resumeCompleted();
    return null;
  }

  /** 暂停：没有下一次；还在排队的那一轮不再发（它从没发出去，去掉）。 */
  #pause(schedule: Schedule, reason: SchedulePauseReason | null): void {
    schedule.status = 'paused';
    schedule.pauseReason = reason;
    schedule.nextAt = null;
    schedule.runs = schedule.runs.filter((r) => r.status !== 'queued');
  }

  #completeIfFull(schedule: Schedule): void {
    if (schedule.status !== 'active' || schedule.maxRuns === null || schedule.runCount < schedule.maxRuns) return;
    schedule.status = 'completed';
    schedule.nextAt = null;
    schedule.runs = schedule.runs.filter((r) => r.status !== 'queued');
  }

  /** 任务结束了：完成记完成，失败与停下记失败（停下的写明）。 */
  #settle(schedule: Schedule, run: ScheduleRun, task: TaskSummary): void {
    if (task.status === 'completed') this.#finish(schedule, run, 'done', null, undefined, task.endedAt);
    else if (task.status === 'stopped') {
      const stopped = RcSchedules.runStopped();
      this.#finish(schedule, run, 'failed', stopped.text, refOf(stopped), task.endedAt);
    } else this.#finish(schedule, run, 'failed', task.error, task.errorRef, task.endedAt);
  }

  #finish(
    schedule: Schedule,
    run: ScheduleRun,
    status: 'done' | 'failed',
    error: string | null,
    errorRef?: ScheduleRun['errorRef'],
    endedAt?: string | null,
  ): void {
    run.status = status;
    run.endedAt = endedAt ?? iso(this.#clock.now());
    run.error = error;
    if (errorRef) run.errorRef = errorRef;
    schedule.runCount += 1;
    this.#completeIfFull(schedule);
    this.#changed(schedule);
    void this.#persist();
    this.#arm();
  }

  #addRun(schedule: Schedule, patch: Partial<ScheduleRun> & Pick<ScheduleRun, 'status' | 'at'>): ScheduleRun {
    const run: ScheduleRun = {
      id: this.#newId(),
      startedAt: null,
      endedAt: null,
      conversationId: null,
      taskId: null,
      error: null,
      ...patch,
    };
    schedule.runs = [run, ...schedule.runs].slice(0, SCHEDULE_LIMITS.runs);
    return run;
  }

  #require(id: Id): Schedule {
    const schedule = this.#schedules.find((s) => s.id === id);
    if (!schedule) throw new RpcError('not-found', RcSchedules.notFound({ id }));
    return schedule;
  }

  /** 改过之后推送（只推还在列表里的）。 */
  #changed(schedule: Schedule): void {
    if (!this.#schedules.includes(schedule)) return;
    schedule.updatedAt = iso(this.#clock.now())!;
    if (this.#started) this.#host.publish({ type: 'schedule.upsert', schedule: structuredClone(schedule) });
  }

  #persist(): Promise<void> {
    return this.#store.save(this.#schedules).catch((error) => this.#log.warn('Failed to save schedules', { error: (error as Error).name }));
  }

  /** 按最早的下一次定时，最长 `SCHEDULE_MAX_TIMER_MS`。 */
  #arm(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = null;
    if (this.#stopped || !this.#started) return;
    let soonest = Infinity;
    for (const schedule of this.#schedules) {
      if (schedule.status === 'active' && schedule.nextAt) soonest = Math.min(soonest, Date.parse(schedule.nextAt));
    }
    if (!Number.isFinite(soonest)) return;
    const delay = Math.min(Math.max(soonest - this.#clock.now(), 0), SCHEDULE_MAX_TIMER_MS);
    this.#cancelTimer = this.#clock.setTimer(() => this.#tick(), delay);
  }

  /** 同一个 `commandId` 只做一次：重发拿回同一个结果；失败的不留。 */
  #once<T>(key: string, run: () => Promise<T>): Promise<T> {
    const done = this.#commands.get(key);
    if (done) return done as Promise<T>;
    const result = run();
    this.#commands.set(key, result);
    result.catch(() => this.#commands.delete(key));
    if (this.#commands.size > COMMAND_MEMORY) this.#commands.delete(this.#commands.keys().next().value!);
    return result;
  }
}

function busy(conversation: Conversation): boolean {
  return conversation.activeTaskId !== null || BUSY.has(conversation.activity);
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
