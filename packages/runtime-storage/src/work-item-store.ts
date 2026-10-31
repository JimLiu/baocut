import fs from 'node:fs/promises';
import path from 'node:path';
import type { Id, ThreadReport, WorkItem, WorkItemTransition } from '@baocut/protocol';
import { assertSafePathSegment } from './channel-files.ts';
import { JsonlCorruptError, appendJsonl, compactJsonl, quarantineFile, readJsonl } from './jsonl-file.ts';
import type { StoreLog, StoreOptions } from './store-file.ts';

/** 任务日志的文件头（第一行）。 */
export const WORK_ITEM_LOG_HEADER = { op: 'header', formatVersion: 1 } as const;

/**
 * 任务日志 `<channelId>.jsonl` 的行（文件头之后），按顺序重放（Bot 技术方案 §5.3）：
 * `snapshot` 是压缩后的基线；`item` 按 id 替换或追加；`report` 按 id 替换或追加；`transition` 追加；
 * `removed` 删掉任务以及它的报告与转换记录。
 */
export type WorkItemLogLine =
  | { op: 'snapshot'; items: WorkItem[]; reports: ThreadReport[]; transitions: WorkItemTransition[] }
  | { op: 'item'; item: WorkItem }
  | { op: 'report'; report: ThreadReport }
  | { op: 'transition'; transition: WorkItemTransition }
  | { op: 'removed'; workItemId: Id };

/** 一个频道的任务日志重放后的样子。 */
export interface WorkItemLog {
  /** 按第一次出现的顺序。 */
  items: WorkItem[];
  reports: ThreadReport[];
  /** 按写入顺序（旧的在前）；只含快照里保留的与之后追加的，归档的不在这里。 */
  transitions: WorkItemTransition[];
  /**
   * 文件没有完整读进来：认不出改名保留后从空开始、更新版本写下的（只读）、有残行或坏行被跳过。这时任务可能缺了几条，
   * 调用方不能拿「找不到任务」当作任务不存在（例如把它的线程当孤儿收掉）。
   */
  degraded: boolean;
}

const SAVE_DELAY_MS = 150;
/** 压缩阈值同会话日志：行数超过 `存活条数 × 4 + 64`，或字节超过 `存活字节 × 4 + 256 KB`。 */
const COMPACT_LINE_FACTOR = 4;
const COMPACT_LINE_SLACK = 64;
const COMPACT_BYTE_FACTOR = 4;
const COMPACT_BYTE_SLACK = 256 * 1024;
/** 压缩时每条任务在快照里保留的最近转换记录数；更早的移到 `<channelId>.transitions.jsonl`。 */
export const TRANSITIONS_KEPT_PER_ITEM = 100;
/** 已解决超过这么久的任务在压缩时只留摘要字段。 */
const SUMMARIZE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** 一个频道落盘后的样子（重放文件得到的镜像），加上文件的行数与字节数。 */
interface ChannelState {
  items: Map<Id, WorkItem>;
  reports: Map<Id, ThreadReport>;
  transitions: WorkItemTransition[];
  /** 存活条目写成 JSON 的字节数，按条增量维护（压缩阈值用，不必每次写入都把全部条目序列化一遍）。 */
  itemBytes: Map<Id, number>;
  reportBytes: Map<Id, number>;
  transitionBytes: number;
  /** 文件头之后的行数与整个文件的字节数。 */
  lines: number;
  bytes: number;
  /** 文件末尾有残行、有坏行，或上次写入失败（镜像可能比文件超前）：下次写入整份重写。 */
  needsCompact: boolean;
  /** 更新版本写下的文件：不改写。 */
  readOnly: boolean;
  /** 读入时丢了东西（见 `WorkItemLog.degraded`）。整个进程期间不变，压缩之后也不清。 */
  degraded: boolean;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

/**
 * Bot 模式的任务日志（Bot 技术方案 §5.3），每个频道一份只追加的 JSONL，格式照 `ConversationStore`。
 *
 * - 同步写：`putItem(..., { sync: true })`、`appendReport`、`appendTransition`、`removeItem` 追加并 fsync 后才兑现，
 *   调用方在兑现之后才投递报告或发事件。同步写先带上这个频道挂起的去抖行，文件里的先后与调用的先后一致。
 * - 去抖写：`putItem(..., { sync: false })` 150 ms 合并，同一条任务只写最后一版；兑现于那次写入完成（失败记 warn，不拒绝）。
 * - 膨胀到阈值时整份写成文件头加一行快照，原子替换；每条任务只留最近 100 条转换记录，更早的追加到
 *   `<channelId>.transitions.jsonl`（先归档再替换：中途崩溃只会在归档里多出重复，不会丢）；已解决超过 30 天的任务只留摘要。
 *
 * Store 不做业务校验，只管把行写下去、读回来。同一个频道的写入走一条串行写链。
 */
export class WorkItemStore {
  readonly #dir: string;
  readonly #log: StoreLog | undefined;
  readonly #states = new Map<Id, Promise<ChannelState>>();
  readonly #writes = new Map<Id, Promise<void>>();
  /** 去抖中的任务（按 id 只留最后一版），以及等它们落盘的兑现。 */
  readonly #pending = new Map<Id, Map<Id, WorkItem>>();
  readonly #pendingDone = new Map<Id, Deferred>();
  readonly #timers = new Map<Id, ReturnType<typeof setTimeout>>();

  constructor(dir: string, options: StoreOptions = {}) {
    this.#dir = dir;
    this.#log = options.log;
  }

  /** 读出频道的任务、报告与转换记录。已经在内存里时先等挂起的写入落盘。 */
  async load(channelId: Id): Promise<WorkItemLog> {
    assertSafePathSegment(channelId, 'channel id');
    await this.#flushChannel(channelId);
    const state = await this.#state(channelId);
    return structuredClone({ items: [...state.items.values()], reports: [...state.reports.values()], transitions: state.transitions, degraded: state.degraded });
  }

  async putItem(channelId: Id, item: WorkItem, options: { sync: boolean }): Promise<void> {
    assertSafePathSegment(channelId, 'channel id');
    if (options.sync) {
      this.#pending.get(channelId)?.delete(item.id);
      return this.#enqueueSync(channelId, { op: 'item', item: structuredClone(item) });
    }
    let pending = this.#pending.get(channelId);
    if (!pending) this.#pending.set(channelId, (pending = new Map()));
    pending.set(item.id, structuredClone(item));
    let done = this.#pendingDone.get(channelId);
    if (!done) this.#pendingDone.set(channelId, (done = deferred()));
    if (!this.#timers.has(channelId)) {
      this.#timers.set(
        channelId,
        setTimeout(() => {
          this.#timers.delete(channelId);
          void this.#flushPending(channelId);
        }, SAVE_DELAY_MS),
      );
    }
    return done.promise;
  }

  async appendReport(channelId: Id, report: ThreadReport): Promise<void> {
    assertSafePathSegment(channelId, 'channel id');
    return this.#enqueueSync(channelId, { op: 'report', report: structuredClone(report) });
  }

  async appendTransition(channelId: Id, transition: WorkItemTransition): Promise<void> {
    assertSafePathSegment(channelId, 'channel id');
    return this.#enqueueSync(channelId, { op: 'transition', transition: structuredClone(transition) });
  }

  async removeItem(channelId: Id, workItemId: Id): Promise<void> {
    assertSafePathSegment(channelId, 'channel id');
    this.#pending.get(channelId)?.delete(workItemId);
    return this.#enqueueSync(channelId, { op: 'removed', workItemId });
  }

  /** 立即压缩一个频道的日志（不论阈值）。 */
  async compact(channelId: Id): Promise<void> {
    assertSafePathSegment(channelId, 'channel id');
    const lines = this.#drain(channelId);
    return this.#enqueue(channelId, lines.lines, lines.done, true);
  }

  /** 删掉频道的日志与转换归档。挂起的去抖行丢掉。 */
  async deleteChannel(channelId: Id): Promise<void> {
    assertSafePathSegment(channelId, 'channel id');
    const timer = this.#timers.get(channelId);
    if (timer) clearTimeout(timer);
    this.#timers.delete(channelId);
    this.#pending.delete(channelId);
    this.#pendingDone.get(channelId)?.resolve();
    this.#pendingDone.delete(channelId);
    await this.#writes.get(channelId)?.catch(() => {});
    this.#states.delete(channelId);
    await fs.rm(this.#file(channelId), { force: true });
    await fs.rm(this.#archiveFile(channelId), { force: true });
  }

  /** 写下所有挂起的去抖行，并等全部写入完成。 */
  async flush(): Promise<void> {
    const channels = new Set([...this.#pending.keys(), ...this.#writes.keys()]);
    await Promise.all([...channels].map((id) => this.#flushChannel(id)));
  }

  #file(channelId: Id): string {
    return path.join(this.#dir, `${channelId}.jsonl`);
  }

  #archiveFile(channelId: Id): string {
    return path.join(this.#dir, `${channelId}.transitions.jsonl`);
  }

  async #flushChannel(channelId: Id): Promise<void> {
    await this.#flushPending(channelId);
    await this.#writes.get(channelId)?.catch(() => {});
  }

  #flushPending(channelId: Id): Promise<void> {
    const { lines, done } = this.#drain(channelId);
    if (lines.length === 0) return Promise.resolve();
    return this.#enqueue(channelId, lines, done).catch((error: unknown) => {
      this.#log?.warn('Work item log write failed', { channelId, reason: reasonOf(error) });
    });
  }

  /** 取走挂起的去抖行（按任务第一次挂起的顺序），停掉计时器。 */
  #drain(channelId: Id): { lines: WorkItemLogLine[]; done: Deferred | undefined } {
    const timer = this.#timers.get(channelId);
    if (timer) clearTimeout(timer);
    this.#timers.delete(channelId);
    const pending = this.#pending.get(channelId);
    this.#pending.delete(channelId);
    const done = this.#pendingDone.get(channelId);
    this.#pendingDone.delete(channelId);
    const lines: WorkItemLogLine[] = pending ? [...pending.values()].map((item) => ({ op: 'item', item })) : [];
    return { lines, done };
  }

  #enqueueSync(channelId: Id, line: WorkItemLogLine): Promise<void> {
    const { lines, done } = this.#drain(channelId);
    lines.push(line);
    return this.#enqueue(channelId, lines, done);
  }

  /** 排到频道写链末尾。`done`（去抖行的兑现）不论成败都兑现。 */
  #enqueue(channelId: Id, lines: WorkItemLogLine[], done: Deferred | undefined, forceCompact = false): Promise<void> {
    const previous = this.#writes.get(channelId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const state = await this.#state(channelId);
        await this.#write(channelId, state, lines, forceCompact);
      });
    this.#writes.set(channelId, next);
    const settle = (): void => {
      done?.resolve();
      if (this.#writes.get(channelId) === next) this.#writes.delete(channelId);
    };
    next.then(settle, settle);
    return next;
  }

  #state(channelId: Id): Promise<ChannelState> {
    let state = this.#states.get(channelId);
    if (!state) {
      state = this.#read(channelId);
      this.#states.set(channelId, state);
      state.catch(() => {
        if (this.#states.get(channelId) === state) this.#states.delete(channelId);
      });
    }
    return state;
  }

  async #read(channelId: Id): Promise<ChannelState> {
    const file = this.#file(channelId);
    const name = path.basename(file);
    const state = emptyState();
    let read: Awaited<ReturnType<typeof readJsonl>>;
    try {
      read = await readJsonl(file);
    } catch (error) {
      if (!(error instanceof JsonlCorruptError)) throw error;
      const renamedTo = await quarantineFile(file);
      this.#log?.warn('Unrecognized work item log renamed; starting empty', { file: name, renamedTo: path.basename(renamedTo) });
      state.degraded = true;
      return state;
    }
    if (!read || read.header === null) return state;
    const header = read.header as { op?: unknown; formatVersion?: unknown };
    if (header?.op !== 'header' || typeof header.formatVersion !== 'number') {
      const renamedTo = await quarantineFile(file);
      this.#log?.warn('Unrecognized work item log renamed; starting empty', { file: name, renamedTo: path.basename(renamedTo) });
      state.degraded = true;
      return state;
    }
    if (header.formatVersion > WORK_ITEM_LOG_HEADER.formatVersion) {
      this.#log?.warn('Work item log was written by a newer version; ignored and left untouched', { file: name, formatVersion: header.formatVersion });
      state.readOnly = true;
      state.degraded = true;
      return state;
    }
    for (const row of read.rows) applyLine(state, row);
    state.lines = read.lines;
    state.bytes = read.bytes;
    if (read.truncatedTail) this.#log?.warn('Work item log ends with a partial line; skipped it', { file: name });
    if (read.skipped > 0) this.#log?.warn('Work item log has unreadable lines; skipped them', { file: name, count: read.skipped });
    state.needsCompact = read.truncatedTail || read.skipped > 0;
    state.degraded = state.needsCompact;
    return state;
  }

  async #write(channelId: Id, state: ChannelState, lines: WorkItemLogLine[], forceCompact: boolean): Promise<void> {
    if (state.readOnly) {
      if (lines.length > 0) this.#log?.warn('Work item log was not loaded (newer version); changes are not saved', { channelId });
      return;
    }
    if (lines.length === 0 && !forceCompact) return;
    const rows = lines.map((line) => JSON.stringify(line));
    for (const line of lines) applyLine(state, line);
    const added = rows.reduce((sum, row) => sum + Buffer.byteLength(row) + 1, 0);
    const { count, bytes } = liveSize(state);
    const totalLines = state.lines + rows.length;
    const totalBytes = state.bytes + added;
    const tooLong = totalLines > count * COMPACT_LINE_FACTOR + COMPACT_LINE_SLACK;
    const tooBig = totalBytes > bytes * COMPACT_BYTE_FACTOR + COMPACT_BYTE_SLACK;
    try {
      if (forceCompact || state.needsCompact || tooLong || tooBig) {
        await this.#compact(channelId, state);
        return;
      }
      const written = await appendJsonl(this.#file(channelId), rows, { header: WORK_ITEM_LOG_HEADER });
      state.lines = totalLines;
      state.bytes += written;
    } catch (error) {
      // 镜像已经超前于文件：下次写入整份重写。
      state.needsCompact = true;
      throw error;
    }
  }

  async #compact(channelId: Id, state: ChannelState): Promise<void> {
    const cutoff = Date.now() - SUMMARIZE_AFTER_MS;
    for (const [id, item] of state.items) {
      const at = item.status === 'resolved' && item.resolution ? Date.parse(item.resolution.at) : Number.NaN;
      if (Number.isFinite(at) && at < cutoff) state.items.set(id, summarizeItem(item));
    }
    // 从新往旧数，每条任务留最近的 TRANSITIONS_KEPT_PER_ITEM 条。
    const seen = new Map<Id, number>();
    const keep: WorkItemTransition[] = [];
    const archive: WorkItemTransition[] = [];
    for (let i = state.transitions.length - 1; i >= 0; i--) {
      const t = state.transitions[i]!;
      const n = (seen.get(t.workItemId) ?? 0) + 1;
      seen.set(t.workItemId, n);
      (n <= TRANSITIONS_KEPT_PER_ITEM ? keep : archive).push(t);
    }
    keep.reverse();
    archive.reverse();
    if (archive.length > 0) {
      await appendJsonl(
        this.#archiveFile(channelId),
        archive.map((transition) => JSON.stringify({ op: 'transition', transition })),
        { header: WORK_ITEM_LOG_HEADER },
      );
    }
    state.transitions = keep;
    recount(state);
    const snapshot: WorkItemLogLine = {
      op: 'snapshot',
      items: [...state.items.values()],
      reports: [...state.reports.values()],
      transitions: keep,
    };
    state.bytes = await compactJsonl(this.#file(channelId), [JSON.stringify(snapshot)], { header: WORK_ITEM_LOG_HEADER });
    state.lines = 1;
    state.needsCompact = false;
  }
}

function emptyState(): ChannelState {
  return {
    items: new Map(),
    reports: new Map(),
    transitions: [],
    itemBytes: new Map(),
    reportBytes: new Map(),
    transitionBytes: 0,
    lines: 0,
    bytes: 0,
    needsCompact: false,
    readOnly: false,
    degraded: false,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasId = (v: unknown): v is { id: string } => isObject(v) && typeof v.id === 'string';
const isTransition = (v: unknown): v is WorkItemTransition => isObject(v) && typeof v.workItemId === 'string';

/** 把一行重放到镜像上；认不出的行（未知的 op、缺字段）跳过。 */
function applyLine(state: ChannelState, raw: unknown): void {
  if (!isObject(raw)) return;
  switch (raw.op) {
    case 'snapshot': {
      state.items = new Map();
      state.reports = new Map();
      for (const item of Array.isArray(raw.items) ? raw.items : []) if (hasId(item)) state.items.set(item.id, item as WorkItem);
      for (const report of Array.isArray(raw.reports) ? raw.reports : []) if (hasId(report)) state.reports.set(report.id, report as ThreadReport);
      state.transitions = (Array.isArray(raw.transitions) ? raw.transitions : []).filter(isTransition);
      recount(state);
      return;
    }
    case 'item':
      if (!hasId(raw.item)) return;
      state.items.set(raw.item.id, raw.item as WorkItem);
      state.itemBytes.set(raw.item.id, sizeOf(raw.item));
      return;
    case 'report':
      if (!hasId(raw.report)) return;
      state.reports.set(raw.report.id, raw.report as ThreadReport);
      state.reportBytes.set(raw.report.id, sizeOf(raw.report));
      return;
    case 'transition':
      if (!isTransition(raw.transition)) return;
      state.transitions.push(raw.transition);
      state.transitionBytes += sizeOf(raw.transition);
      return;
    case 'removed': {
      const id = raw.workItemId;
      if (typeof id !== 'string') return;
      state.items.delete(id);
      for (const [reportId, report] of state.reports) if (report.workItemId === id) state.reports.delete(reportId);
      state.transitions = state.transitions.filter((t) => t.workItemId !== id);
      recount(state);
      return;
    }
    default:
      return;
  }
}

function sizeOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

/** 从头重算存活条目的字节数（快照、删除与压缩之后）。 */
function recount(state: ChannelState): void {
  state.itemBytes = new Map([...state.items].map(([id, item]) => [id, sizeOf(item)]));
  state.reportBytes = new Map([...state.reports].map(([id, report]) => [id, sizeOf(report)]));
  state.transitionBytes = state.transitions.reduce((sum, t) => sum + sizeOf(t), 0);
}

/** 存活的条数与它们写成快照时大约的字节数。 */
function liveSize(state: ChannelState): { count: number; bytes: number } {
  let bytes = state.transitionBytes;
  for (const n of state.itemBytes.values()) bytes += n;
  for (const n of state.reportBytes.values()) bytes += n;
  return { count: state.items.size + state.reports.size + state.transitions.length, bytes };
}

/**
 * 已解决很久的任务只留摘要：标识、标题、状态、解决方式与结果、线程、时间。必填的枚举（标题归属、负责人、优先级）与来源照留；
 * `files` 也留下，删除任务记录时只认这份清单（Bot 技术方案 §5.4）。其余字段清空。
 */
export function summarizeItem(item: WorkItem): WorkItem {
  return {
    id: item.id,
    channelId: item.channelId,
    title: item.title,
    titleBy: item.titleBy,
    description: '',
    owner: item.owner,
    status: item.status,
    active: null,
    resolution: item.resolution,
    priority: item.priority,
    dueOn: null,
    eventOn: null,
    startAt: null,
    steps: [],
    finishedSteps: [],
    updates: [],
    outcome: item.outcome,
    question: null,
    resources: [],
    outputs: [],
    dependsOn: [],
    overrides: null,
    baseVersions: [],
    lastProgressAt: null,
    budgetWarnedAt: null,
    files: item.files,
    suggestion: null,
    source: item.source,
    threadId: item.threadId,
    threadStarts: item.threadStarts,
    lastReportId: null,
    deferredStop: null,
    beforeInput: null,
    reminded: [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
