import {
  type ActiveState,
  type BotActor,
  type Evidence,
  type Id,
  type TaskOrigin,
  type ThreadReport,
  type ThreadStop,
  type WorkItem,
  type WorkItemEvent,
  type WorkItemQuestion,
  type WorkItemStateName,
  type WorkItemTransition,
  BOT_LIMITS,
} from '@baocut/protocol';
import { RcBot } from '@baocut/protocol/messages/runtime-core';

/*
 * 任务状态机（技术方案 §9）：唯一能改 `status`、`active`、`resolution`、`question` 的地方。纯函数：给当前任务、事件、谁发的、
 * 当前回合的事实，返回新任务、转换记录与要做的副作用；表外的事件抛 `TransitionDenied`。副作用由 BotService 执行。
 */

/** 发出事件的那一回合的事实（Harness 起回合时写定，智能体无法自己声称）。 */
export interface MachineRun {
  conversationId: Id;
  origin: TaskOrigin;
  attended: boolean;
  tainted: boolean;
  userCitations: ReadonlySet<Id>;
  /** 起这一回合的用户 typed 消息。 */
  userMessageId: Id | null;
}

export interface MachineContext {
  actor: BotActor;
  now: string;
  /** 智能体发的事件：它所在会话正在跑的回合。 */
  run?: MachineRun | null;
  /** 协调者的 schedule / merge / eventOn：引用的消息已由调用方核对过是本频道用户 typed 的。 */
  citedUserTyped?: boolean;
  /** `resolve(confirmedBy)`：调用方核对过 confirmedBy 是那条会话里的用户 typed 消息。 */
  confirmedIsTyped?: boolean;
  /** `resolve(evidence)`：调用方逐条核验过证据（§9.5）。 */
  evidenceVerified?: boolean;
  /** 同一个刷新回合刚刚关了这条任务（§9.2 的 resolved·done 行）。 */
  resolvedInThisRefresh?: boolean;
  /** 卡住检测的分钟数（stalled 的 reason 用）。 */
  stallMinutes?: number;
}

export type MachineEffect =
  | { kind: 'start-thread' }
  | { kind: 'stop-thread' }
  | { kind: 'interrupt-thread' }
  | { kind: 'notify'; reason: 'needs-review' | 'needs-input' | 'reminder' | 'stalled' | 'unattended-approval' }
  | { kind: 'schedule-once'; startAt: string }
  | { kind: 'unschedule' }
  | { kind: 'ignore-subject'; subjectKey: string }
  | { kind: 'reminder' }
  | { kind: 'continue'; reason: 'stalled' | 'stopped' | 'needs-you' | 'other' }
  | { kind: 'merge'; into: Id }
  | { kind: 'maybe-start' }
  | { kind: 'release-session' };

export interface MachineResult {
  item: WorkItem;
  transitions: WorkItemTransition[];
  effects: MachineEffect[];
}

export class TransitionDenied extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.reason = reason;
  }
}

export function stateName(item: Pick<WorkItem, 'status' | 'active' | 'resolution'>): WorkItemStateName {
  if (item.status === 'active') return item.active?.state ?? 'working';
  if (item.status === 'resolved') return item.resolution?.kind ?? 'done';
  return item.status;
}

const STOP_STATE: Record<ThreadStop, ActiveState> = {
  done: 'needsReview',
  'needs-review': 'needsReview',
  'needs-input': 'needsInput',
  blocked: 'blocked',
  waiting: 'waitingOnOthers',
};

/** 「继续还是停止？」：卡住、停下之后的问题。 */
export function continueQuestion(): WorkItemQuestion {
  return {
    text: RcBot.continueOrStop().text,
    kind: 'input',
    options: [
      { label: RcBot.optionContinue().text, description: null },
      { label: RcBot.optionStop().text, description: null },
    ],
    pick: null,
    risky: false,
    askedBy: 'system',
    approvalId: null,
  };
}

export function applyEvent(current: WorkItem, event: WorkItemEvent, ctx: MachineContext): MachineResult {
  const item: WorkItem = structuredClone(current);
  const transitions: WorkItemTransition[] = [];
  const effects: MachineEffect[] = [];
  const { actor, now } = ctx;
  const from = stateName(current);
  const deny = (reason: string): never => {
    throw new TransitionDenied(reason, RcBot.transitionDenied({ from, event: event.type }).text);
  };
  const requireActor = (...allowed: BotActor[]) => {
    if (!allowed.includes(actor)) deny(`actor-${actor}`);
  };
  const record = (cause: string, note: string | null = null, extra: Partial<WorkItemTransition> = {}) => {
    const to = stateName(item);
    transitions.push({ workItemId: item.id, from, to, actor, cause, note, at: now, ...extra });
  };
  const setActive = (state: ActiveState, reason: string | null = null) => {
    const since = item.status === 'active' && item.active?.state === state ? item.active.since : now;
    item.status = 'active';
    item.active = { state, reason, since };
    item.resolution = null;
  };
  const toWorking = () => {
    setActive('working');
    item.question = null;
    item.beforeInput = null;
    item.lastProgressAt = now;
  };
  const pushUpdate = (text: string, by: BotActor = actor) => {
    item.updates = [...item.updates, { text: [...text].slice(0, BOT_LIMITS.updateText).join(''), at: now, by }].slice(-BOT_LIMITS.updatesKept);
  };
  const resolve = (kind: 'done' | 'dismissed' | 'merged', by: BotActor, extra: { evidence?: Evidence[] | null; confirmedBy?: Id | null; mergedInto?: Id | null } = {}) => {
    item.status = 'resolved';
    item.active = null;
    item.question = null;
    item.beforeInput = null;
    item.deferredStop = null;
    item.startAt = null;
    item.resolution = {
      kind,
      by,
      at: now,
      evidence: extra.evidence ?? null,
      confirmedBy: extra.confirmedBy ?? null,
      mergedInto: extra.mergedInto ?? null,
    };
  };
  const unresolved = current.status !== 'resolved';
  const hasThreadRun = current.status === 'active' && current.threadId !== null;

  switch (event.type) {
    case 'accept': {
      requireActor('user');
      if (current.status !== 'suggested') deny('not-suggested');
      const owner = event.owner ?? current.suggestion?.owner ?? current.owner;
      if (event.start && owner === 'user') deny('user-owned');
      item.owner = owner;
      if (event.title) {
        item.title = event.title;
        item.titleBy = 'user';
      }
      item.suggestion = null;
      if (event.start) {
        toWorking();
        effects.push({ kind: 'start-thread' });
      } else {
        item.status = 'upNext';
        item.active = null;
      }
      record(event.start ? 'user:accept-start' : 'user:accept');
      break;
    }
    case 'dismiss': {
      requireActor('user');
      if (!unresolved) deny('resolved');
      if (current.suggestion) effects.push({ kind: 'ignore-subject', subjectKey: current.suggestion.subjectKey });
      if (hasThreadRun) effects.push({ kind: 'stop-thread' });
      if (current.status === 'scheduled') effects.push({ kind: 'unschedule' });
      resolve('dismissed', 'user');
      record('user:dismiss');
      break;
    }
    case 'expire': {
      requireActor('system');
      if (current.status !== 'suggested') deny('not-suggested');
      if (current.suggestion) effects.push({ kind: 'ignore-subject', subjectKey: current.suggestion.subjectKey });
      resolve('dismissed', 'system');
      record('system:expire');
      break;
    }
    case 'schedule': {
      if (actor === 'coordinator') {
        if (!ctx.citedUserTyped) deny('needs-user-time');
      } else requireActor('user');
      if (current.status !== 'upNext' && current.status !== 'scheduled') deny('not-up-next');
      item.status = 'scheduled';
      item.active = null;
      item.startAt = event.startAt;
      effects.push({ kind: 'schedule-once', startAt: event.startAt });
      record(`${actor}:schedule`);
      break;
    }
    case 'unschedule': {
      requireActor('user');
      if (current.status !== 'scheduled') deny('not-scheduled');
      item.status = 'upNext';
      item.startAt = null;
      effects.push({ kind: 'unschedule' });
      record('user:unschedule');
      break;
    }
    case 'start': {
      requireActor('user', 'system');
      // 定好时间的任务也可以提前开始（任务菜单的「开始」）：先撤掉定时。
      if (current.status !== 'upNext' && !(current.status === 'scheduled' && actor === 'user')) deny('not-up-next');
      if (current.owner === 'user') deny('user-owned');
      if (current.status === 'scheduled') {
        item.startAt = null;
        effects.push({ kind: 'unschedule' });
      }
      toWorking();
      effects.push({ kind: 'start-thread' });
      record(`${actor}:start`);
      break;
    }
    case 'due': {
      requireActor('system');
      if (current.status !== 'scheduled') deny('not-scheduled');
      item.startAt = null;
      if (current.owner === 'agent') {
        toWorking();
        effects.push({ kind: 'start-thread' });
        record('system:due');
      } else {
        // 用户自己的事到点不开线程（BOT-TK-04）：回到接下来，频道里提醒一行、发通知。
        item.status = 'upNext';
        item.active = null;
        effects.push({ kind: 'reminder' }, { kind: 'notify', reason: 'reminder' });
        record('system:due-reminder');
      }
      break;
    }
    case 'report': {
      const report = event.report;
      requireActor('thread', 'system');
      if (current.status === 'resolved') {
        // 同一个刷新回合刚刚关了它：只追加报告并投递，供转述（D6）。
        if (actor === 'thread' && ctx.resolvedInThisRefresh && report.stop === 'done' && current.resolution?.kind === 'done') {
          item.lastReportId = report.id;
          mergeOutputs(item, report);
          break;
        }
        deny('resolved');
      }
      if (current.status !== 'active') deny('not-active');
      const state = current.active?.state ?? 'working';
      // 审批在等时收到的报告：只记下停点，审批结束再落（§9.3）。
      if (state === 'needsInput' && current.question?.approvalId) {
        item.deferredStop = report.stop;
        item.lastReportId = report.id;
        mergeOutputs(item, report);
        break;
      }
      if (state !== 'working') {
        // 刷新回合里的报告可以从任一子状态落到新的子状态（BOT-EX-08）。
        if (!(actor === 'thread' && ctx.run?.origin === 'refresh')) deny('not-working');
        if (current.question) pushUpdate(RcBot.previousQuestion({ text: current.question.text }).text, 'system');
      }
      applyStop(item, report, now);
      record(`report:${report.stop}`, report.headline);
      if (item.active?.state === 'needsReview') effects.push({ kind: 'notify', reason: 'needs-review' });
      if (item.active?.state === 'needsInput') effects.push({ kind: 'notify', reason: 'needs-input' });
      break;
    }
    case 'approval': {
      requireActor('system');
      if (current.status !== 'active') return { item: current, transitions, effects };
      const state = current.active?.state ?? 'working';
      if (event.pending) {
        const question = event.question ?? null;
        if (state === 'needsInput') {
          if (question) item.question = question;
          if (!item.question?.approvalId && question) item.question = question;
          if (isDeepSame(item, current)) return { item: current, transitions, effects };
          break;
        }
        if (state !== 'working' && state !== 'waitingOnOthers' && state !== 'blocked') return { item: current, transitions, effects };
        item.beforeInput = state;
        setActive('needsInput', null);
        item.question = question;
        record('approval:pending', question?.text ?? null);
        effects.push({ kind: 'notify', reason: 'needs-input' });
        break;
      }
      if (state !== 'needsInput' || (current.question?.approvalId && current.question.approvalId !== event.approvalId)) {
        return { item: current, transitions, effects };
      }
      const back = current.beforeInput ?? 'working';
      setActive(back === 'needsInput' ? 'working' : back, current.active?.reason ?? null);
      item.question = null;
      item.beforeInput = null;
      record('approval:settled');
      if (current.deferredStop) {
        const stop = current.deferredStop;
        item.deferredStop = null;
        setActive(STOP_STATE[stop]);
        transitions.push({ workItemId: item.id, from: back, to: stateName(item), actor: 'system', cause: `report:${stop}`, note: null, at: now });
        if (item.active?.state === 'needsReview') effects.push({ kind: 'notify', reason: 'needs-review' });
      }
      break;
    }
    case 'user-replied': {
      requireActor('system', 'user');
      if (current.status !== 'active') return { item: current, transitions, effects };
      const state = current.active?.state;
      if (state !== 'needsReview' && state !== 'needsInput' && state !== 'blocked') return { item: current, transitions, effects };
      // 审批在等时用户在线程里说话不结束审批：审批卡还在。
      if (state === 'needsInput' && current.question?.approvalId) return { item: current, transitions, effects };
      toWorking();
      record('user:replied', event.note ? RcBot.youAnswered({ text: [...event.note].slice(0, 40).join('') }).text : null);
      break;
    }
    case 'unblocked': {
      requireActor('system', 'thread', 'user');
      if (current.status !== 'active') deny('not-active');
      const state = current.active?.state;
      const runtimeQuestion = state === 'needsInput' && current.question?.askedBy === 'system' && !current.question.approvalId;
      if (state !== 'blocked' && state !== 'waitingOnOthers' && !(runtimeQuestion && actor === 'user')) deny('not-blocked');
      const wasStopped = current.active?.reason === RcBot.stoppedByYou().text;
      toWorking();
      record(`${actor}:unblocked`, null);
      if (actor === 'user') {
        effects.push({
          kind: 'continue',
          reason: runtimeQuestion ? 'needs-you' : wasStopped ? 'stopped' : current.question?.askedBy === 'system' ? 'stalled' : 'other',
        });
      }
      transitions[transitions.length - 1]!.cause = `unblocked:${event.cause}`;
      break;
    }
    case 'stalled': {
      requireActor('system');
      if (current.status !== 'active') deny('not-active');
      const state = current.active?.state;
      const allowed = state === 'working' || (state === 'waitingOnOthers' && event.reason === 'job-hung');
      if (!allowed) deny('not-working');
      setActive('blocked', event.note);
      item.question = continueQuestion();
      if (event.reason === 'budget') item.budgetWarnedAt = now;
      effects.push({ kind: 'interrupt-thread' }, { kind: 'notify', reason: 'stalled' });
      record(`stalled:${event.reason}`, event.note);
      break;
    }
    case 'stop': {
      requireActor('user');
      if (current.status !== 'active') deny('not-active');
      setActive('blocked', RcBot.stoppedByYou().text);
      item.question = continueQuestion();
      effects.push({ kind: 'stop-thread' });
      record('user:stop', RcBot.stoppedByYou().text);
      break;
    }
    case 'resolve': {
      if (current.status === 'suggested' || current.status === 'resolved') deny(current.status);
      if (actor === 'user') {
        if (hasThreadRun) effects.push({ kind: 'stop-thread' });
        if (current.status === 'scheduled') effects.push({ kind: 'unschedule' });
        resolve('done', 'user');
        effects.push({ kind: 'release-session' });
        record('user:resolve');
        break;
      }
      if (actor !== 'coordinator' && actor !== 'thread') deny(`actor-${actor}`);
      const run = ctx.run;
      if (event.confirmedBy) {
        // 智能体替用户关：本回合由那条用户 typed 消息起，且没插进过转交（§9.2）。
        if (!run || !run.attended || run.tainted || run.userMessageId !== event.confirmedBy || !ctx.confirmedIsTyped) deny('not-confirmed');
        if (actor === 'coordinator' && hasThreadRun) effects.push({ kind: 'stop-thread' });
        if (current.status === 'scheduled') effects.push({ kind: 'unschedule' });
        resolve('done', 'user', { confirmedBy: event.confirmedBy });
        effects.push({ kind: 'release-session' });
        record('user:confirmed', RcBot.youConfirmedDone().text, { citedMessageId: event.confirmedBy });
        break;
      }
      // 线程只在刷新回合、凭核验过的证据关（§9.5）。
      if (actor !== 'thread' || run?.origin !== 'refresh' || current.status !== 'active') deny('needs-refresh');
      if (!event.evidence?.length || !ctx.evidenceVerified) deny('evidence-rejected');
      resolve('done', 'thread', { evidence: event.evidence });
      effects.push({ kind: 'release-session' });
      record('thread:evidence', null, event.evidence ? { evidence: event.evidence } : {});
      break;
    }
    case 'reopen': {
      if (current.status !== 'resolved') deny('not-resolved');
      if (actor === 'thread' || actor === 'system') {
        const run = ctx.run;
        const typedTurn = !!run && run.attended && run.userMessageId !== null;
        const cited = !!event.citedMessageId && !!run && run.userCitations.has(event.citedMessageId);
        if (!typedTurn && !cited) deny('needs-user-words');
      } else requireActor('user');
      if (current.owner === 'user') {
        item.status = 'upNext';
        item.active = null;
        item.resolution = null;
      } else {
        toWorking();
        if (actor === 'user') effects.push({ kind: 'start-thread' });
      }
      item.resolution = null;
      record(actor === 'system' ? 'system:implicit-reopen' : `${actor}:reopen`, actor === 'user' ? RcBot.youReopened().text : null, {
        ...(event.citedMessageId ? { citedMessageId: event.citedMessageId } : {}),
      });
      break;
    }
    case 'merge': {
      requireActor('coordinator', 'user');
      if (actor === 'coordinator' && !ctx.citedUserTyped) deny('needs-user-consent');
      if (!unresolved) deny('resolved');
      if (event.into === current.id) deny('self');
      if (hasThreadRun) effects.push({ kind: 'stop-thread' });
      if (current.status === 'scheduled') effects.push({ kind: 'unschedule' });
      resolve('merged', actor, { mergedInto: event.into });
      effects.push({ kind: 'merge', into: event.into });
      record(`${actor}:merge`);
      break;
    }
    case 'set-owner': {
      requireActor('user');
      if (!unresolved) deny('resolved');
      if (event.owner === current.owner) return { item: current, transitions, effects };
      item.owner = event.owner;
      if (event.owner === 'user' && current.status === 'active') {
        item.status = 'upNext';
        item.active = null;
        item.question = null;
        effects.push({ kind: 'stop-thread' });
      } else if (event.owner === 'agent' && current.status === 'upNext') {
        effects.push({ kind: 'maybe-start' });
      }
      record(`user:set-owner-${event.owner}`);
      break;
    }
    default:
      deny('unknown');
  }
  item.updatedAt = now;
  return { item, transitions, effects };
}

/** 报告的停点落到子状态（`done` 一律落成待审阅：线程不能直接关任务）。 */
function applyStop(item: WorkItem, report: ThreadReport, now: string): void {
  const state = STOP_STATE[report.stop];
  item.status = 'active';
  item.active = { state, reason: state === 'blocked' ? report.headline : null, since: now };
  item.question = state === 'needsInput' || state === 'needsReview' || state === 'blocked' ? report.question : null;
  item.lastReportId = report.id;
  item.deferredStop = null;
  item.beforeInput = null;
  item.lastProgressAt = now;
  mergeOutputs(item, report);
}

function mergeOutputs(item: WorkItem, report: ThreadReport): void {
  if (report.outputs.length === 0) return;
  const key = (o: object) => JSON.stringify(o);
  const seen = new Set(item.outputs.map(key));
  item.outputs = [...item.outputs, ...report.outputs.filter((o) => !seen.has(key(o)))];
}

function isDeepSame(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 一条新任务的空白字段（工具与 RPC 建任务时用）。 */
export function newWorkItem(fields: Pick<WorkItem, 'id' | 'channelId' | 'title' | 'owner'> & Partial<WorkItem>, now: string): WorkItem {
  return {
    titleBy: 'agent',
    description: '',
    status: 'upNext',
    active: null,
    resolution: null,
    priority: 'medium',
    dueOn: null,
    eventOn: null,
    startAt: null,
    steps: [],
    finishedSteps: [],
    updates: [],
    outcome: null,
    question: null,
    resources: [],
    outputs: [],
    dependsOn: [],
    overrides: null,
    baseVersions: [],
    lastProgressAt: null,
    budgetWarnedAt: null,
    files: [],
    suggestion: null,
    source: { kind: 'manual', messageId: null, scheduleId: null, runId: null },
    threadId: null,
    threadStarts: 0,
    lastReportId: null,
    deferredStop: null,
    beforeInput: null,
    reminded: [],
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}
