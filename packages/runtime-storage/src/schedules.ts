import {
  AGENT_MODES,
  isDriverId,
  SCHEDULE_LIMITS,
  type Schedule,
  type ScheduleCadence,
  type SchedulePauseReason,
  type ScheduleRun,
  type ScheduleRunStatus,
  type ScheduleStatus,
} from '@baocut/protocol';
import { JsonStoreFile, type StoreOptions } from './store-file.ts';

interface SchedulesFile {
  schemaVersion: 1;
  schedules: Schedule[];
}

/**
 * 定时任务（产品设计 §6.1「定时任务」，`ScheduleService` 的持久层）：整份读进内存，改一次写一次；写串行，后一次覆盖前一次。
 * 认不出的条目丢掉、坏掉的字段按默认值处理，不让一个手改坏的文件拦住 Runtime 启动；整个文件不是 JSON 时改名保留、取空列表，
 * 更新版本写下的不改写（`store-file.ts`）。
 */
export class ScheduleStore {
  readonly #file: JsonStoreFile;
  #saving: Promise<void> = Promise.resolve();

  constructor(file: string, options: StoreOptions = {}) {
    this.#file = new JsonStoreFile(file, options.log);
  }

  async load(): Promise<Schedule[]> {
    const { value } = await this.#file.read({ recognize: (raw) => raw as Partial<SchedulesFile>, tolerateReadErrors: true });
    const list = Array.isArray(value?.schedules) ? value.schedules : [];
    return list.flatMap((raw) => {
      const schedule = normalizeSchedule(raw);
      return schedule ? [schedule] : [];
    });
  }

  /** 把整份列表落盘。 */
  save(schedules: readonly Schedule[]): Promise<void> {
    const snapshot: SchedulesFile = { schemaVersion: 1, schedules: structuredClone([...schedules]) };
    this.#saving = this.#saving.catch(() => {}).then(() => this.#file.write(snapshot));
    return this.#saving;
  }

  flush(): Promise<void> {
    return this.#saving.catch(() => {});
  }
}

const STATUSES: readonly ScheduleStatus[] = ['active', 'paused', 'completed'];
const PAUSE_REASONS: readonly SchedulePauseReason[] = ['conversation-archived', 'conversation-deleted', 'project-removed'];
const RUN_STATUSES: readonly ScheduleRunStatus[] = ['running', 'queued', 'done', 'failed', 'skipped', 'missed'];

const str = (v: unknown): v is string => typeof v === 'string';
const strOrNull = (v: unknown): string | null => (str(v) && v ? v : null);
const time = (v: unknown): v is string => str(v) && !Number.isNaN(Date.parse(v));

function normalizeCadence(raw: unknown): ScheduleCadence | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (c.type === 'hourly' && Number.isInteger(c.minute)) return { type: 'hourly', minute: c.minute as number };
  if (c.type === 'daily' && str(c.time)) return { type: 'daily', time: c.time };
  if (c.type === 'weekly' && str(c.time) && Array.isArray(c.days)) {
    return { type: 'weekly', days: c.days.filter((d): d is number => Number.isInteger(d)), time: c.time };
  }
  if (c.type === 'cron' && str(c.expr)) return { type: 'cron', expr: c.expr };
  return null;
}

function normalizeRun(raw: unknown): ScheduleRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!str(r.id) || !RUN_STATUSES.includes(r.status as ScheduleRunStatus) || !time(r.at)) return null;
  return {
    id: r.id,
    status: r.status as ScheduleRunStatus,
    at: r.at,
    startedAt: time(r.startedAt) ? r.startedAt : null,
    endedAt: time(r.endedAt) ? r.endedAt : null,
    conversationId: strOrNull(r.conversationId),
    taskId: strOrNull(r.taskId),
    ...(Number.isInteger(r.count) ? { count: r.count as number } : {}),
    ...(r.manual === true ? { manual: true } : {}),
    error: strOrNull(r.error),
    ...(r.errorRef && typeof r.errorRef === 'object' ? { errorRef: r.errorRef as ScheduleRun['errorRef'] } : {}),
  };
}

function normalizeSchedule(raw: unknown): Schedule | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const cadence = normalizeCadence(s.cadence);
  const agent = (s.agent && typeof s.agent === 'object' ? s.agent : {}) as Record<string, unknown>;
  if (!str(s.id) || !str(s.prompt) || !cadence || !str(s.conversationId) || !isDriverId(agent.driverId)) return null;
  const status = STATUSES.includes(s.status as ScheduleStatus) ? (s.status as ScheduleStatus) : 'paused';
  const now = new Date().toISOString();
  return {
    id: s.id,
    name: str(s.name) ? s.name : '',
    prompt: s.prompt,
    cadence,
    conversationId: s.conversationId,
    target: s.target === 'new' && str(s.projectId) ? 'new' : 'conversation',
    projectId: strOrNull(s.projectId),
    agent: {
      driverId: agent.driverId,
      model: strOrNull(agent.model),
      effort: strOrNull(agent.effort),
      accessMode: AGENT_MODES.includes(agent.accessMode as never) ? (agent.accessMode as Schedule['agent']['accessMode']) : null,
    },
    maxRuns: Number.isInteger(s.maxRuns) && (s.maxRuns as number) >= 1 ? (s.maxRuns as number) : null,
    runCount: Number.isInteger(s.runCount) && (s.runCount as number) >= 0 ? (s.runCount as number) : 0,
    status,
    pauseReason:
      status === 'paused' && PAUSE_REASONS.includes(s.pauseReason as SchedulePauseReason) ? (s.pauseReason as SchedulePauseReason) : null,
    nextAt: time(s.nextAt) ? s.nextAt : null,
    createdAt: time(s.createdAt) ? s.createdAt : now,
    updatedAt: time(s.updatedAt) ? s.updatedAt : now,
    runs: (Array.isArray(s.runs) ? s.runs : [])
      .flatMap((r) => {
        const run = normalizeRun(r);
        return run ? [run] : [];
      })
      .slice(0, SCHEDULE_LIMITS.runs),
  };
}
