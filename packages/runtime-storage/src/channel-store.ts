import {
  AGENT_MODES,
  BOT_LIMITS,
  DEFAULT_BOT_SETTINGS,
  isDriverId,
  type AgentMode,
  type BotSettings,
  type Channel,
  type ChannelKind,
  type ChannelLimits,
  type Id,
  type Money,
} from '@baocut/protocol';
import { JsonStoreFile, isPlainObject, type StoreOptions } from './store-file.ts';

/** `store/channels.json` 的形状（Bot 技术方案 §5.1）。 */
interface ChannelsFile {
  schemaVersion: 1;
  channels: Channel[];
  settings: BotSettings;
  /** `channels/USER.md` 的版本号，写入时校验。 */
  userMemoryVersion: number;
}

/**
 * Bot 模式的频道列表、Bot 设置与用户级记忆的版本号（Bot 技术方案 §5.2）。频道只有几十个，沿用 `ScheduleStore` 的写法：
 * 整份读进内存，每次改动更新内存再整文件写一次；写串行，原子替换（`JsonStoreFile`）。
 *
 * 读入时宽容：认不出的频道丢掉，缺的字段按默认值补；设置合并在 `DEFAULT_BOT_SETTINGS` 之上。整个文件不是 JSON 时改名保留、
 * 从空开始；更新版本写下的不改写。
 *
 * `withLock` 是一把异步锁，给调用方做「先查后建」（`channels.ensureMain`）这类要原子的读改写。Store 自己的写入不拿这把锁，
 * 在锁里调用 `put` 等不会死锁。
 */
export class ChannelStore {
  readonly #file: JsonStoreFile;
  readonly #channels = new Map<Id, Channel>();
  #settings: BotSettings = structuredClone(DEFAULT_BOT_SETTINGS);
  #userMemoryVersion = 0;
  #degraded = false;
  #saving: Promise<void> = Promise.resolve();
  #lock: Promise<void> = Promise.resolve();

  constructor(file: string, options: StoreOptions = {}) {
    this.#file = new JsonStoreFile(file, options.log);
  }

  async load(): Promise<void> {
    const read = await this.#file.read({ recognize: (raw) => raw as Partial<ChannelsFile>, tolerateReadErrors: true });
    const value = read.value;
    this.#channels.clear();
    const rows = Array.isArray(value?.channels) ? value.channels : [];
    let dropped = 0;
    for (const raw of rows) {
      const channel = normalizeChannel(raw);
      if (channel && !this.#channels.has(channel.id)) this.#channels.set(channel.id, channel);
      else if (!channel) dropped++;
    }
    this.#degraded = (read.status !== 'ok' && read.status !== 'missing') || this.#file.readOnly || dropped > 0;
    this.#settings = normalizeSettings(value?.settings);
    this.#userMemoryVersion = nonNegativeInt(value?.userMemoryVersion) ?? 0;
  }

  list(): Channel[] {
    return [...this.#channels.values()].map((channel) => structuredClone(channel));
  }

  get(id: Id): Channel | undefined {
    const channel = this.#channels.get(id);
    return channel ? structuredClone(channel) : undefined;
  }

  settings(): BotSettings {
    return structuredClone(this.#settings);
  }

  userMemoryVersion(): number {
    return this.#userMemoryVersion;
  }

  /**
   * 上次 `load` 没有把文件完整读进来：读不了、认不出（改名保留后从空开始）、更新版本写下的（只读），或有认不出的频道被丢掉。
   * 这时频道列表可能缺了几个，调用方不能拿「找不到频道」当作频道不存在。
   */
  get degraded(): boolean {
    return this.#degraded;
  }

  put(channel: Channel): Promise<void> {
    this.#channels.set(channel.id, structuredClone(channel));
    return this.#save();
  }

  remove(id: Id): Promise<void> {
    this.#channels.delete(id);
    return this.#save();
  }

  setSettings(settings: BotSettings): Promise<void> {
    this.#settings = structuredClone(settings);
    return this.#save();
  }

  setUserMemoryVersion(version: number): Promise<void> {
    this.#userMemoryVersion = version;
    return this.#save();
  }

  /** 串行执行 `fn`：前一个持锁者结束（成功或失败）后才开始。 */
  withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#lock.then(fn);
    this.#lock = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  flush(): Promise<void> {
    return this.#saving.catch(() => {});
  }

  /** 拍下此刻的内存状态，排到写链末尾；返回这一次写入。 */
  #save(): Promise<void> {
    const snapshot: ChannelsFile = {
      schemaVersion: 1,
      channels: structuredClone([...this.#channels.values()]),
      settings: structuredClone(this.#settings),
      userMemoryVersion: this.#userMemoryVersion,
    };
    const next = this.#saving.catch(() => {}).then(() => this.#file.write(snapshot));
    this.#saving = next;
    return next;
  }
}

const KINDS: readonly ChannelKind[] = ['main', 'topic'];

const str = (v: unknown): v is string => typeof v === 'string';
const strOrNull = (v: unknown): string | null => (str(v) && v ? v : null);
const time = (v: unknown): v is string => str(v) && !Number.isNaN(Date.parse(v));
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

function nonNegativeInt(v: unknown): number | null {
  return Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null;
}

function positiveInt(v: unknown): number | null {
  return Number.isInteger(v) && (v as number) >= 1 ? (v as number) : null;
}

function agentMode(v: unknown): AgentMode | null {
  return AGENT_MODES.includes(v as AgentMode) ? (v as AgentMode) : null;
}

function money(v: unknown): Money | null {
  if (!isPlainObject(v) || !str(v.amount) || !str(v.currency)) return null;
  return { amount: v.amount, currency: v.currency };
}

function normalizeLimits(v: unknown): ChannelLimits {
  const raw = isPlainObject(v) ? v : {};
  return {
    concurrentThreads: positiveInt(raw.concurrentThreads) ?? BOT_LIMITS.concurrentThreads,
    dailyBudget: money(raw.dailyBudget),
    monthlyBudget: money(raw.monthlyBudget),
  };
}

function normalizeLastSeen(v: unknown): Channel['lastSeen'] {
  if (!isPlainObject(v) || !time(v.at)) return null;
  return { at: v.at, itemId: strOrNull(v.itemId) };
}

/** 认不出（没有 id、频道对话或 Driver）时 null；其余字段缺了或坏了按默认值补。 */
function normalizeChannel(raw: unknown): Channel | null {
  if (!isPlainObject(raw)) return null;
  const c = raw;
  if (!str(c.id) || !c.id || !str(c.conversationId) || !c.conversationId || !isDriverId(c.driverId)) return null;
  const now = new Date().toISOString();
  const createdAt = time(c.createdAt) ? c.createdAt : now;
  const archived = bool(c.archived, false);
  return {
    id: c.id,
    kind: KINDS.includes(c.kind as ChannelKind) ? (c.kind as ChannelKind) : 'topic',
    name: str(c.name) ? c.name : '',
    purpose: str(c.purpose) ? c.purpose : '',
    conversationId: c.conversationId,
    driverId: c.driverId,
    model: strOrNull(c.model),
    effort: strOrNull(c.effort),
    defaultAccessMode: agentMode(c.defaultAccessMode),
    maxAccessMode: agentMode(c.maxAccessMode),
    templateId: strOrNull(c.templateId),
    pinned: bool(c.pinned, false),
    archived,
    archivedAt: archived && time(c.archivedAt) ? c.archivedAt : null,
    limits: normalizeLimits(c.limits),
    outputLanguage: strOrNull(c.outputLanguage),
    private: bool(c.private, false),
    muted: bool(c.muted, false),
    stallMinutes: positiveInt(c.stallMinutes),
    lastSeen: normalizeLastSeen(c.lastSeen),
    memoryVersion: nonNegativeInt(c.memoryVersion) ?? 0,
    seedPending: strOrNull(c.seedPending),
    unwantedKinds: Array.isArray(c.unwantedKinds) ? c.unwantedKinds.filter((k): k is string => str(k) && k !== '') : [],
    createdAt,
    updatedAt: time(c.updatedAt) ? c.updatedAt : createdAt,
  };
}

/** 设置逐项合并在默认值之上：类型不对的字段用默认值。 */
function normalizeSettings(v: unknown): BotSettings {
  const d = DEFAULT_BOT_SETTINGS;
  if (!isPlainObject(v)) return structuredClone(d);
  const quiet = isPlainObject(v.quietHours) ? v.quietHours : {};
  return {
    timeZone: v.timeZone === null ? null : str(v.timeZone) && v.timeZone ? v.timeZone : d.timeZone,
    quietHours: {
      start: str(quiet.start) ? quiet.start : d.quietHours.start,
      end: str(quiet.end) ? quiet.end : d.quietHours.end,
      enabled: bool(quiet.enabled, d.quietHours.enabled),
    },
    stallMinutes: positiveInt(v.stallMinutes) ?? d.stallMinutes,
    maxConcurrentThreads: positiveInt(v.maxConcurrentThreads) ?? d.maxConcurrentThreads,
    background: bool(v.background, d.background),
    openAtLogin: bool(v.openAtLogin, d.openAtLogin),
    automationPaused: bool(v.automationPaused, d.automationPaused),
  };
}
