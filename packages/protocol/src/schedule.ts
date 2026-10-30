import type { AgentMode } from './access.ts';
import type { DriverId, Id } from './domain.ts';
import type { MessageRef } from './message-ref.ts';

/**
 * 定时任务（产品设计 §6.1「定时任务」，架构设计 §3.13）：按频率把同一段话发给一条会话，或每次在它的项目里新开一条会话。
 * Runtime 开着才跑，频率一律按本机时区；没开着时错过的不补跑。这里是两端共用的部分：数据形状、cron 的解析与下一次的计算、
 * 建立时的检查。到点时怎么办（起一轮、排队、跳过、暂停、标完成）在 Runtime 的 `ScheduleService`。
 */

/** 频率。`hourly` 每小时第几分；`daily` 每天的时刻（`HH:MM`）；`weekly` 星期几（0 = 周日）与时刻；`cron` 五段表达式（分 时 日 月 周）。 */
export type ScheduleCadence =
  | { type: 'hourly'; minute: number }
  | { type: 'daily'; time: string }
  | { type: 'weekly'; days: number[]; time: string }
  | { type: 'cron'; expr: string };

export type ScheduleCadenceType = ScheduleCadence['type'];

/** 发给谁：建它的那条会话（`conversation`），或每次在那条会话的项目里新开一条（`new`，无项目会话没有）。 */
export type ScheduleTarget = 'conversation' | 'new';

/** `completed`：跑满了最多运行次数；要再跑先把次数改大，再「继续」。 */
export type ScheduleStatus = 'active' | 'paused' | 'completed';

/** 自动暂停的原因：目标会话归档了、删除了，或每次新开会话的那个项目从 BaoCut 移除了。用户自己暂停的没有原因。 */
export type SchedulePauseReason = 'conversation-archived' | 'conversation-deleted' | 'project-removed';

/**
 * 一次运行的状态。`queued`：到点时目标会话正忙，等它空下来再发；`skipped`：到点时上一次还没跑完；
 * `missed`：Runtime 没开着时错过的，一条记几次（`count`）。只有 `done` 与 `failed` 算进最多运行次数。
 */
export type ScheduleRunStatus = 'running' | 'queued' | 'done' | 'failed' | 'skipped' | 'missed';

export interface ScheduleRun {
  id: Id;
  status: ScheduleRunStatus;
  /** 到点（或点「立即运行一次」）的时刻，RFC 3339。 */
  at: string;
  /** 真正发出去的时刻：排过队的晚于 `at`；没发出去的为 null。 */
  startedAt: string | null;
  endedAt: string | null;
  /** 那一次的会话：发给的会话，或新开的那条；跳过与错过的为 null。 */
  conversationId: Id | null;
  /** 发出去之后的任务。 */
  taskId: Id | null;
  /** `missed`：错过了几次（数到 `SCHEDULE_LIMITS.missedCap` 为止）。 */
  count?: number;
  /** 用户点的「立即运行一次」（或建立时勾的「建好后立即运行一次」），不是到点起的。 */
  manual?: boolean;
  /** `failed`：发不出去（会话不在、Agent 起不来）或任务失败的原因。 */
  error: string | null;
  errorRef?: MessageRef;
}

/** 每次新开会话时用的 Agent 设置：建立时取自那条会话，之后不跟着它变。 */
export interface ScheduleAgent {
  driverId: DriverId;
  model: string | null;
  effort: string | null;
  /** null：那条会话没切换过访问模式，新会话照常取 `agent.defaultAccessMode`。 */
  accessMode: AgentMode | null;
}

export interface Schedule {
  id: Id;
  name: string;
  /** 每次发的话：到点时原样发给 Agent，和在输入框里发一样。 */
  prompt: string;
  cadence: ScheduleCadence;
  /** 建它的会话：`target` 是 `conversation` 时发给它。会话删除后仍留着这个 id（定时任务暂停，写明原因）。 */
  conversationId: Id;
  target: ScheduleTarget;
  /** 建立时那条会话的项目：`target` 是 `new` 时在这里新开会话。无项目会话为 null。 */
  projectId: Id | null;
  agent: ScheduleAgent;
  /** 最多运行次数；null 不限。 */
  maxRuns: number | null;
  /** 算进最多运行次数的次数（完成与失败）。运行记录只留最近的，所以单独记。 */
  runCount: number;
  status: ScheduleStatus;
  pauseReason: SchedulePauseReason | null;
  /** 下一次到点的时刻；不在启用状态、或频率再也不会到点时为 null。 */
  nextAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 运行记录，新的在前，最多 `SCHEDULE_LIMITS.runs` 条。 */
  runs: ScheduleRun[];
}

/**
 * 到点（或手动）时的决定：`run` 发出去了；`queue` 目标会话正忙，等它空下来；`skip` 上一次还在跑；
 * `pause` 目标会话或项目不在了（定时任务随之暂停）；`complete` 已经跑满；`failed` 发不出去（记在运行记录上）。
 */
export type ScheduleFireOutcome = 'run' | 'queue' | 'skip' | 'pause' | 'complete' | 'failed';

export const SCHEDULE_LIMITS = {
  name: 120,
  prompt: 20_000,
  cron: 200,
  /** 运行记录留几条。 */
  runs: 50,
  maxRuns: 10_000,
  /** 错过的次数数到几为止。 */
  missedCap: 10_000,
} as const;

/**
 * 迟到多久以内仍算到点：Runtime 刚启动、或机器睡醒时，最近一次到点在这之内的照常发一次，更早的记成错过。
 */
export const SCHEDULE_GRACE_MS = 5 * 60_000;

/** 名称空着时取要发的话的开头：第一行，最多这么多个字。 */
const DEFAULT_NAME_CHARS = 24;

/** 名称空着时的名称：要发的话的第一行开头。 */
export function scheduleDefaultName(prompt: string): string {
  const line = prompt.trim().split(/\r?\n/, 1)[0]!.trim();
  const chars = [...line];
  return chars.length > DEFAULT_NAME_CHARS ? `${chars.slice(0, DEFAULT_NAME_CHARS).join('')}…` : line;
}

// ---- cron ----

/** 五段的取值范围；周的 7 当作 0（周日）。 */
const CRON_FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
] as const;

/** 五段里的哪一段：0 分、1 时、2 日、3 月、4 周。 */
export type CronField = 0 | 1 | 2 | 3 | 4;

export interface ParsedCron {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  days: ReadonlySet<number>;
  months: ReadonlySet<number>;
  weekdays: ReadonlySet<number>;
  /** 写成 `*` 的段：日与周都限定时满足其一就算；时是 `*` 时夏令时重复的那一小时照常跑。 */
  anyHour: boolean;
  anyDay: boolean;
  anyWeekday: boolean;
}

/**
 * 建立或编辑时的问题，给界面按自己的语言说。`cron-syntax` 是看不懂的一段，`cron-range` 是超出范围的一段（`field` 从 0 起）；
 * `cron-never` 是一年里都不会到点（如 2 月 30 日）。
 */
export type ScheduleProblem =
  | { code: 'prompt-empty' }
  | { code: 'name-too-long' }
  | { code: 'prompt-too-long' }
  | { code: 'minute-invalid' }
  | { code: 'time-invalid' }
  | { code: 'weekly-no-day' }
  | { code: 'cron-fields' }
  | { code: 'cron-syntax'; field: CronField; part: string }
  | { code: 'cron-range'; field: CronField; part: string; min: number; max: number }
  | { code: 'cron-never' }
  | { code: 'max-runs-invalid' };

/** 一段：`*`、`n`、`a-b`、`*\/k`、`a-b/k`、`n/k`，逗号分隔。 */
function parseCronField(text: string, field: CronField): { values: Set<number>; any: boolean } | ScheduleProblem {
  const { min, max } = CRON_FIELDS[field];
  const values = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return { code: 'cron-syntax', field, part };
    const lo = m[1] === '*' ? min : Number(m[2]);
    const hi = m[1] === '*' ? max : m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? max : lo;
    const step = m[4] !== undefined ? Number(m[4]) : 1;
    if (lo < min || hi > max || lo > hi || step < 1) return { code: 'cron-range', field, part, min, max };
    for (let v = lo; v <= hi; v += step) values.add(field === 4 && v === 7 ? 0 : v);
  }
  return { values, any: text === '*' };
}

/** 解析五段 cron（分 时 日 月 周）。 */
export function parseCron(expr: string): { ok: true; cron: ParsedCron } | { ok: false; problem: ScheduleProblem } {
  const parts = expr.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 5) return { ok: false, problem: { code: 'cron-fields' } };
  const fields: { values: Set<number>; any: boolean }[] = [];
  for (let i = 0; i < 5; i++) {
    const parsed = parseCronField(parts[i]!, i as CronField);
    if ('code' in parsed) return { ok: false, problem: parsed };
    fields.push(parsed);
  }
  const [minutes, hours, days, months, weekdays] = fields as [
    (typeof fields)[0],
    (typeof fields)[0],
    (typeof fields)[0],
    (typeof fields)[0],
    (typeof fields)[0],
  ];
  return {
    ok: true,
    cron: {
      minutes: minutes.values,
      hours: hours.values,
      days: days.values,
      months: months.values,
      weekdays: weekdays.values,
      anyHour: hours.any,
      anyDay: days.any,
      anyWeekday: weekdays.any,
    },
  };
}

/** `HH:MM` → [时, 分]；写得不对为 null。 */
export function parseScheduleTime(time: string): [number, number] | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** 频率换成等价的 cron（切到「自定义」时用，也是计算下一次的统一入口）。时刻写错时按 09:00。 */
export function scheduleCron(cadence: ScheduleCadence): string {
  if (cadence.type === 'cron') return cadence.expr.trim();
  if (cadence.type === 'hourly') return `${cadence.minute} * * * *`;
  const [hh, mm] = parseScheduleTime(cadence.time) ?? [9, 0];
  if (cadence.type === 'daily') return `${mm} ${hh} * * *`;
  const days = [...new Set(cadence.days)].sort((a, b) => a - b);
  return `${mm} ${hh} * * ${days.length ? days.join(',') : '1'}`;
}

/** 这一天对不对：月份要对；日与周都限定时满足其一就算（cron 的老规矩）。 */
function dayMatches(c: ParsedCron, d: Date): boolean {
  if (!c.months.has(d.getMonth() + 1)) return false;
  const day = c.days.has(d.getDate());
  const weekday = c.weekdays.has(d.getDay());
  if (c.anyDay && c.anyWeekday) return true;
  if (c.anyDay) return weekday;
  if (c.anyWeekday) return day;
  return day || weekday;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** 往后找多远：五年，2 月 29 日这样的也找得到。 */
const SEARCH_MS = 5 * 366 * 24 * HOUR_MS;

/** 本机时区的墙上时间（到分钟）。 */
function wallMinute(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
}

/**
 * `from`（毫秒）之后（不含）下一次到点的时刻，按本机时区；五年里都不会到点时为 null。
 * 分与时按绝对时间往前走（夏令时跳过的那一小时自然没有，那天这一刻不跑）；时是固定值的，回拨时重复的那一小时只跑第一次。
 */
export function nextCronRun(c: ParsedCron, from: number): number | null {
  let t = Math.floor(from / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const end = from + SEARCH_MS;
  while (t <= end) {
    const d = new Date(t);
    if (!c.months.has(d.getMonth() + 1)) {
      t = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
      continue;
    }
    if (!dayMatches(c, d)) {
      t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      continue;
    }
    if (!c.hours.has(d.getHours())) {
      t += (60 - d.getMinutes()) * MINUTE_MS;
      continue;
    }
    if (!c.minutes.has(d.getMinutes()) || (!c.anyHour && wallMinute(t - HOUR_MS) === wallMinute(t))) {
      t += MINUTE_MS;
      continue;
    }
    return t;
  }
  return null;
}

/** 频率的下一次（毫秒）；频率写得不对、或再也不会到点时为 null。 */
export function nextScheduleRun(cadence: ScheduleCadence, from: number): number | null {
  const parsed = parseCron(scheduleCron(cadence));
  return parsed.ok ? nextCronRun(parsed.cron, from) : null;
}

/** `(from, to]` 之间到点了几次，数到 `cap` 为止。 */
export function scheduleOccurrences(cadence: ScheduleCadence, from: number, to: number, cap: number = SCHEDULE_LIMITS.missedCap): number {
  const parsed = parseCron(scheduleCron(cadence));
  if (!parsed.ok) return 0;
  let count = 0;
  for (let t = nextCronRun(parsed.cron, from); t !== null && t <= to && count < cap; t = nextCronRun(parsed.cron, t)) count++;
  return count;
}

/** 建立或编辑时的检查；没问题为 null。`now` 用来判断会不会到点。 */
export function scheduleProblem(
  input: { name?: string; prompt: string; cadence: ScheduleCadence; maxRuns: number | null },
  now: number = Date.now(),
): ScheduleProblem | null {
  if (!input.prompt.trim()) return { code: 'prompt-empty' };
  if (input.prompt.length > SCHEDULE_LIMITS.prompt) return { code: 'prompt-too-long' };
  if (input.name !== undefined && input.name.trim().length > SCHEDULE_LIMITS.name) return { code: 'name-too-long' };
  const { cadence } = input;
  if (cadence.type === 'hourly' && !(Number.isInteger(cadence.minute) && cadence.minute >= 0 && cadence.minute <= 59))
    return { code: 'minute-invalid' };
  if (cadence.type === 'weekly' && (!cadence.days.length || cadence.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) {
    return { code: 'weekly-no-day' };
  }
  if ((cadence.type === 'daily' || cadence.type === 'weekly') && !parseScheduleTime(cadence.time)) return { code: 'time-invalid' };
  if (cadence.type === 'cron') {
    if (cadence.expr.length > SCHEDULE_LIMITS.cron) return { code: 'cron-fields' };
    const parsed = parseCron(cadence.expr);
    if (!parsed.ok) return parsed.problem;
    if (nextCronRun(parsed.cron, now) === null) return { code: 'cron-never' };
  }
  if (input.maxRuns !== null && !(Number.isInteger(input.maxRuns) && input.maxRuns >= 1 && input.maxRuns <= SCHEDULE_LIMITS.maxRuns)) {
    return { code: 'max-runs-invalid' };
  }
  return null;
}

/** 算进最多运行次数的：真跑过的（完成或失败），跳过、错过与还没结束的不算。 */
export function scheduleRunCounts(run: ScheduleRun): boolean {
  return run.status === 'done' || run.status === 'failed';
}

/** 还没结束的一次（在跑或在排队）：这时到点要跳过。 */
export function scheduleRunOpen(run: ScheduleRun): boolean {
  return run.status === 'running' || run.status === 'queued';
}
