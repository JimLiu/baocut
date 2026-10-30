import {
  intlLocale,
  nextScheduleRun,
  scheduleCron,
  SCHEDULE_LIMITS,
  type Conversation,
  type Id,
  type Schedule,
  type ScheduleCadence,
  type ScheduleCadenceType,
  type ScheduleFireOutcome,
  type ScheduleProblem,
  type ScheduleRun,
} from '@baocut/protocol';
import { SCHEDULE_COPY as C } from '../components/agent-schedule/schedule-copy.ts';
import { S } from '../components/shell-copy.ts';
import { formatDuration } from './format.ts';

/*
 * 定时任务（产品设计 §6.1「定时任务」，原型 model-agent-schedule.js）里界面要算的东西：频率与时刻的说法、状态与运行记录的状态词、
 * 检查不过时的那一行、能不能继续。到点、跳过、排队、暂停与跑满由 Runtime 决定（`ScheduleService`），这里只显示它给的结果。
 */

/** 每周的按钮从周一排到周日（`Date.getDay()` 的编号）。 */
export const WEEK_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

/** StatusLight 的色调。 */
export type ScheduleTone = 'informative' | 'neutral' | 'positive' | 'notice' | 'negative';

const pad = (n: number) => String(n).padStart(2, '0');

/** 频率的说法：每小时第 5 分、每天 09:00、每周一、周四 21:00、cron 0 9 * * 1-5。 */
export function describeCadence(cadence: ScheduleCadence): string {
  if (cadence.type === 'hourly') return C.everyHour(cadence.minute);
  if (cadence.type === 'daily') return C.everyDay(cadence.time);
  if (cadence.type === 'weekly') {
    const days = WEEK_ORDER.filter((d) => cadence.days.includes(d)).map((d) => C.weekdays[d] ?? String(d));
    return C.everyWeek(S.list(days), cadence.time);
  }
  return C.cronCadence(cadence.expr);
}

/** 什么时候：今天 / 明天 / 某月某日 + 时刻（本机时区）；没有下一次时如实说。 */
export function whenLabel(t: number | null, now: number): string {
  if (t === null || Number.isNaN(t)) return C.never;
  const at = new Date(t);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(at) - day(new Date(now))) / 86_400_000);
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (diff === 0) return C.today(time);
  if (diff === 1) return C.tomorrow(time);
  const sameYear = at.getFullYear() === new Date(now).getFullYear();
  const date = new Intl.DateTimeFormat(
    intlLocale(),
    sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' },
  ).format(at);
  return C.onDate(date, time);
}

/** 运行记录里的时刻：同上，但今天的只写时刻。 */
export function runTimeLabel(iso: string, now: number): string {
  return whenLabel(Date.parse(iso), now);
}

/** 换频率：保留能保留的时刻；换成自定义时把当前的写成等价的 cron。 */
export function cadenceFor(type: ScheduleCadenceType, previous: ScheduleCadence): ScheduleCadence {
  const time = previous.type === 'daily' || previous.type === 'weekly' ? previous.time : '09:00';
  if (type === 'hourly') return { type, minute: previous.type === 'hourly' ? previous.minute : 0 };
  if (type === 'daily') return { type, time };
  if (type === 'weekly') return { type, days: previous.type === 'weekly' ? previous.days : [1], time };
  if (previous.type === 'cron') return previous;
  return { type: 'cron', expr: safeCron(previous) };
}

function safeCron(cadence: ScheduleCadence): string {
  try {
    return scheduleCron(cadence);
  } catch {
    return '0 9 * * *';
  }
}

/** 检查不过时的说明（`scheduleProblem` 的结果）。 */
export function problemText(problem: ScheduleProblem): string {
  switch (problem.code) {
    case 'prompt-empty':
      return C.promptEmpty;
    case 'name-too-long':
      return C.nameTooLong(SCHEDULE_LIMITS.name);
    case 'prompt-too-long':
      return C.promptTooLong(SCHEDULE_LIMITS.prompt);
    case 'minute-invalid':
      return C.minuteInvalid;
    case 'time-invalid':
      return C.timeInvalid;
    case 'weekly-no-day':
      return C.weeklyNoDay;
    case 'cron-fields':
      return C.cronFields;
    case 'cron-syntax':
      return C.cronSyntax(C.cronFieldNames[problem.field] ?? String(problem.field + 1), problem.part);
    case 'cron-range':
      return C.cronRange(C.cronFieldNames[problem.field] ?? String(problem.field + 1), problem.part, problem.min, problem.max);
    case 'cron-never':
      return C.cronNever;
    case 'max-runs-invalid':
      return C.maxRunsInvalid;
  }
}

/** 下一次：Runtime 算好的 `nextAt`；还没有（刚改完、旧记录）时按频率从现在算。 */
export function nextAtOf(schedule: Schedule, now: number): number | null {
  if (schedule.status !== 'active') return null;
  if (schedule.nextAt) return Date.parse(schedule.nextAt);
  return nextScheduleRun(schedule.cadence, now);
}

/** 定时任务本身的状态：下一次什么时候、为什么暂停、跑满了几次。 */
export function scheduleStatus(schedule: Schedule, now: number): { label: string; tone: ScheduleTone } {
  if (schedule.status === 'paused') {
    return { label: schedule.pauseReason ? C.statusPausedFor(C.pauseReason[schedule.pauseReason]) : C.statusPaused, tone: 'neutral' };
  }
  if (schedule.status === 'completed') return { label: C.statusCompleted(schedule.maxRuns ?? schedule.runCount), tone: 'positive' };
  return { label: C.statusNext(whenLabel(nextAtOf(schedule, now), now)), tone: 'informative' };
}

const RUN_TONE: Record<ScheduleRun['status'], ScheduleTone> = {
  running: 'informative',
  queued: 'notice',
  done: 'positive',
  failed: 'negative',
  skipped: 'neutral',
  missed: 'neutral',
};

/** 运行记录一行的状态词与色调；错过的写明几次。 */
export function runStatus(run: ScheduleRun): { label: string; tone: ScheduleTone } {
  return { label: run.status === 'missed' ? C.missed(run.count ?? 1) : C.run[run.status], tone: RUN_TONE[run.status] };
}

/** 用了多久（发出去到结束）；没发出去或还没结束的没有。 */
export function tookLabel(run: ScheduleRun): string | null {
  if (!run.startedAt || !run.endedAt) return null;
  const ms = Date.parse(run.endedAt) - Date.parse(run.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? C.took(formatDuration(Math.max(1000, ms))) : null;
}

/**
 * 能不能「继续」：同 Runtime 的检查（`schedules.update` 的 `paused: false`）——发给的会话还在且没归档，新开会话的项目还在，没跑满。
 * `target` 是发给的那条会话（新开会话的不看），`hasProject` 是建立时的项目还在不在。
 */
export function resumable(schedule: Schedule, target: Conversation | undefined, hasProject: boolean): boolean {
  if (schedule.status === 'active') return false;
  if (schedule.target === 'conversation' && (!target || target.archived)) return false;
  if (schedule.target === 'new' && !hasProject) return false;
  return schedule.maxRuns === null || schedule.runCount < schedule.maxRuns;
}

/** 发给这条会话、或建在这条会话上的定时任务有几个（会话菜单「定时运行…」下面那一行）。 */
export function schedulesOf(schedules: readonly Schedule[], conversationId: Id): number {
  return schedules.filter((s) => s.conversationId === conversationId).length;
}

/** 「立即运行一次」之后的提示；`pause` 写明原因。 */
export function outcomeToast(
  outcome: ScheduleFireOutcome,
  schedule: Schedule,
): { text: string; tone: 'positive' | 'neutral' | 'negative' } {
  switch (outcome) {
    case 'run':
      return { text: C.started, tone: 'positive' };
    case 'queue':
      return { text: C.queued, tone: 'neutral' };
    case 'skip':
      return { text: C.skipped, tone: 'neutral' };
    case 'pause':
      return { text: C.paused(schedule.pauseReason ? C.pauseReason[schedule.pauseReason] : C.statusPaused), tone: 'neutral' };
    case 'complete':
      return { text: C.completed, tone: 'neutral' };
    case 'failed':
      return { text: C.startFailed, tone: 'negative' };
  }
}

/** 对话框里的草稿：名称可以空（Runtime 用这段话的开头）；不限次数时 `maxRuns` 记着上次填的，勾上时用。 */
export interface ScheduleDraft {
  name: string;
  prompt: string;
  cadence: ScheduleCadence;
  target: Schedule['target'];
  limit: boolean;
  maxRuns: number;
  runNow: boolean;
}

export function draftOf(schedule: Schedule | null): ScheduleDraft {
  if (schedule) {
    return {
      name: schedule.name,
      prompt: schedule.prompt,
      cadence: structuredClone(schedule.cadence),
      target: schedule.target,
      limit: schedule.maxRuns !== null,
      maxRuns: schedule.maxRuns ?? 5,
      runNow: false,
    };
  }
  return {
    name: '',
    prompt: '',
    cadence: { type: 'daily', time: '09:00' },
    target: 'conversation',
    limit: false,
    maxRuns: 5,
    runNow: false,
  };
}
