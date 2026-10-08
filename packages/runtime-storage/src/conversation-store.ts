import fs from 'node:fs/promises';
import path from 'node:path';
import type { CheckResult, Conversation, DriverId, Id, Seq, TaskContract, TimelineItem } from '@baocut/protocol';
import { readJson } from './json-file.ts';
import { appendJsonl, readJsonl, writeJsonlAtomic } from './jsonl-file.ts';

/**
 * 会话的持久形态（Runtime Store，架构设计 §3.10）。
 *
 * `agent.persistence` 是 Driver 给出的原生恢复句柄（例如 Codex 的 threadId）；
 * Runtime 只保存、不解释它。
 */
export interface ConversationRecord {
  schemaVersion: 1;
  conversation: Conversation;
  items: TimelineItem[];
  seq: Seq;
  agent: { driverId: DriverId; persistence: unknown };
  /**
   * 任务合同（架构设计 §3.2），按任务：全部修订（旧的在前，只追加）与验收检查的结果。0.x 早先写下的记录没有，
   * 读入时为它的任务补上默认合同，不升记录版本。
   */
  tasks?: Record<Id, TaskContractLog>;
}

/** 一个任务的合同修订与检查结果。 */
export interface TaskContractLog {
  revisions: TaskContract[];
  checkResults: CheckResult[];
}

/**
 * 会话日志 `<id>.jsonl` 的行。第一行总是 `snapshot`（完整记录，压缩后的基线）；之后的行按顺序重放：
 * `item` 按 `item.id` 原地替换或追加到末尾，`meta` 替换给出的字段，`tasks` 按 taskId 整体替换。
 */
export type ConversationLogLine =
  | ({ op: 'snapshot' } & ConversationRecord)
  | { op: 'item'; item: TimelineItem }
  | {
      op: 'meta';
      conversation?: Conversation;
      seq?: Seq;
      agent?: ConversationRecord['agent'];
      tasks?: Record<Id, TaskContractLog>;
    };

export interface ConversationStoreLog {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
}

export interface ConversationStoreOptions {
  log?: ConversationStoreLog;
}

const SAVE_DELAY_MS = 150;
/** 行数超过 `活的条目数 × 倍数 + 余量` 时压缩。 */
const COMPACT_LINE_FACTOR = 4;
const COMPACT_LINE_SLACK = 64;
/** 字节超过 `活的记录字节 × 倍数 + 余量` 时压缩（流式回复每次都写整条 item，字节涨得比行数快）。 */
const COMPACT_BYTE_FACTOR = 4;
const COMPACT_BYTE_SLACK = 256 * 1024;

/** 上次落盘的样子：逐项的 JSON 串，用来只写变化的行。 */
interface Persisted {
  conversation: string;
  seq: string;
  agent: string;
  items: Map<Id, string>;
  /** 落盘的 item 顺序；新 item 只能追加在末尾。 */
  order: Id[];
  tasks: Map<Id, string>;
  /** 文件现有的非空行数与字节数。 */
  lines: number;
  bytes: number;
}

/**
 * 内存为主、写后落盘。每个会话一个追加写的 JSONL 日志：150ms 合并窗口到期时只追加变化了的条目与元数据，
 * 日志膨胀到阈值时把完整记录写成单行快照原子替换（压缩）。追加与压缩走同一个会话的串行写链；
 * 停止时 `flush()` 等所有挂起的写入完成（架构设计 §2.4「持久化任务…」一步）。
 */
export class ConversationStore {
  readonly #dir: string;
  readonly #log: ConversationStoreLog | undefined;
  readonly #records = new Map<Id, ConversationRecord>();
  readonly #persisted = new Map<Id, Persisted>();
  readonly #timers = new Map<Id, ReturnType<typeof setTimeout>>();
  readonly #writes = new Map<Id, Promise<void>>();

  constructor(dir: string, options: ConversationStoreOptions = {}) {
    this.#dir = dir;
    this.#log = options.log;
  }

  async load(): Promise<ConversationRecord[]> {
    await fs.mkdir(this.#dir, { recursive: true });
    const names = new Set(await fs.readdir(this.#dir));
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      try {
        await this.#loadLog(path.join(this.#dir, name));
      } catch (error) {
        this.#log?.warn('Conversation log could not be read; skipped', { file: name, reason: reasonOf(error) });
      }
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      if (names.has(`${id}.jsonl`)) {
        this.#log?.warn('Legacy conversation file ignored: a conversation log with the same name exists', { file: name });
        continue;
      }
      try {
        await this.#migrate(path.join(this.#dir, name));
      } catch (error) {
        this.#log?.warn('Legacy conversation file could not be migrated; left in place', { file: name, reason: reasonOf(error) });
      }
    }
    return [...this.#records.values()];
  }

  list(): ConversationRecord[] {
    return [...this.#records.values()];
  }

  get(id: Id): ConversationRecord | undefined {
    return this.#records.get(id);
  }

  put(record: ConversationRecord): void {
    this.#records.set(record.conversation.id, record);
    this.markDirty(record.conversation.id);
  }

  markDirty(id: Id): void {
    if (this.#timers.has(id)) return;
    this.#timers.set(
      id,
      setTimeout(() => {
        this.#timers.delete(id);
        void this.#save(id);
      }, SAVE_DELAY_MS),
    );
  }

  async delete(id: Id): Promise<void> {
    const timer = this.#timers.get(id);
    if (timer) clearTimeout(timer);
    this.#timers.delete(id);
    this.#records.delete(id);
    await this.#writes.get(id)?.catch(() => {});
    this.#persisted.delete(id);
    await fs.rm(this.#file(id), { force: true });
    await fs.rm(path.join(this.#dir, `${id}.json`), { force: true });
  }

  async flush(): Promise<void> {
    for (const [id, timer] of this.#timers) {
      clearTimeout(timer);
      this.#timers.delete(id);
      void this.#save(id);
    }
    await Promise.all(this.#writes.values());
  }

  #file(id: Id): string {
    return path.join(this.#dir, `${id}.jsonl`);
  }

  async #loadLog(file: string): Promise<void> {
    const read = await readJsonl(file);
    if (!read) return;
    const name = path.basename(file);
    const [first, ...rest] = read.values;
    const firstIsBad = read.bad.length > 0 && read.bad[0]!.line === 1;
    if (firstIsBad || !isSnapshot(first)) {
      const target = `${file}.corrupt-${timestamp()}`;
      await fs.rename(file, target);
      this.#log?.warn('Unrecognized conversation log renamed and skipped', { file: name, renamedTo: path.basename(target) });
      return;
    }
    const { op: _op, ...record } = first;
    if (record.schemaVersion !== 1) {
      this.#log?.warn('Conversation log has an unknown schema version; skipped', { file: name, schemaVersion: record.schemaVersion });
      return;
    }
    for (const bad of read.bad) {
      if (bad.tail) this.#log?.warn('Conversation log ends with a partial line; skipped it', { file: name, line: bad.line });
      else this.#log?.warn('Conversation log has an unreadable line; skipped it', { file: name, line: bad.line });
    }
    const index = new Map(record.items.map((item, i) => [item.id, i]));
    for (const line of rest as ConversationLogLine[]) {
      if (line?.op === 'item' && line.item?.id) {
        const at = index.get(line.item.id);
        if (at === undefined) {
          index.set(line.item.id, record.items.length);
          record.items.push(line.item);
        } else record.items[at] = line.item;
      } else if (line?.op === 'meta') {
        if (line.conversation) record.conversation = line.conversation;
        if (line.seq !== undefined) record.seq = line.seq;
        if (line.agent) record.agent = line.agent;
        if (line.tasks) record.tasks = { ...record.tasks, ...line.tasks };
      } else if (line?.op === 'snapshot') {
        this.#log?.warn('Conversation log has a snapshot after the first line; ignored it', { file: name });
      }
    }
    const id = record.conversation.id;
    this.#records.set(id, record);
    // 末尾有残行时不记落盘副本：下次保存写快照整份替换，免得新行接在残行后面一起读不出来。
    if (!read.bad.some((bad) => bad.tail)) this.#persisted.set(id, { ...persistedOf(record), lines: read.lines, bytes: read.bytes });
  }

  /** 旧格式 `<id>.json`（整份记录）：写成 `<id>.jsonl` 的快照行，再把旧文件改名为 `.json.migrated`。 */
  async #migrate(file: string): Promise<void> {
    const name = path.basename(file);
    const record = await readJson<ConversationRecord>(file);
    if (!record) return;
    if (record.schemaVersion !== 1) {
      this.#log?.warn('Legacy conversation file has an unknown schema version; left in place', {
        file: name,
        schemaVersion: (record as { schemaVersion?: unknown }).schemaVersion,
      });
      return;
    }
    const id = record.conversation.id;
    const bytes = await writeJsonlAtomic(this.#file(id), [{ op: 'snapshot', ...record }]);
    await fs.rename(file, `${file}.migrated`);
    this.#records.set(id, record);
    this.#persisted.set(id, { ...persistedOf(record), lines: 1, bytes });
    this.#log?.info('Migrated legacy conversation file to a conversation log', { file: name });
  }

  #save(id: Id): Promise<void> {
    const previous = this.#writes.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.#write(id));
    this.#writes.set(id, next);
    const settle = (): void => {
      if (this.#writes.get(id) === next) this.#writes.delete(id);
    };
    next.then(settle, (error: unknown) => {
      settle();
      this.#log?.warn('Conversation log write failed', { conversationId: id, reason: reasonOf(error) });
    });
    return next;
  }

  async #write(id: Id): Promise<void> {
    const record = this.#records.get(id);
    if (!record) return;
    const now = persistedOf(record);
    const before = this.#persisted.get(id);
    const lines = before ? diff(before, now, record) : null;
    if (lines && lines.length === 0) return;
    const liveBytes = liveSize(now);
    const live = now.items.size + now.tasks.size;
    if (lines && before) {
      const addedBytes = lines.reduce((sum, line) => sum + Buffer.byteLength(JSON.stringify(line)) + 1, 0);
      const totalLines = before.lines + lines.length;
      const totalBytes = before.bytes + addedBytes;
      const tooLong = totalLines > live * COMPACT_LINE_FACTOR + COMPACT_LINE_SLACK;
      const tooBig = totalBytes > liveBytes * COMPACT_BYTE_FACTOR + COMPACT_BYTE_SLACK;
      if (!tooLong && !tooBig) {
        const written = await appendJsonl(this.#file(id), lines);
        this.#persisted.set(id, { ...now, lines: totalLines, bytes: before.bytes + written });
        return;
      }
    }
    // 新会话、顺序变了（删除或插队）、或日志太长：整份记录写成一行快照，原子替换。
    const bytes = await writeJsonlAtomic(this.#file(id), [{ op: 'snapshot', ...record }]);
    this.#persisted.set(id, { ...now, lines: 1, bytes });
  }
}

function isSnapshot(value: unknown): value is { op: 'snapshot' } & ConversationRecord {
  if (!value || typeof value !== 'object') return false;
  const line = value as Partial<ConversationLogLine & ConversationRecord>;
  return line.op === 'snapshot' && !!line.conversation && typeof line.conversation.id === 'string' && Array.isArray(line.items);
}

function persistedOf(record: ConversationRecord): Omit<Persisted, 'lines' | 'bytes'> {
  const items = new Map<Id, string>();
  for (const item of record.items) items.set(item.id, JSON.stringify(item));
  const tasks = new Map<Id, string>();
  for (const [taskId, log] of Object.entries(record.tasks ?? {})) tasks.set(taskId, JSON.stringify(log));
  return {
    conversation: JSON.stringify(record.conversation),
    seq: JSON.stringify(record.seq),
    agent: JSON.stringify(record.agent),
    items,
    order: record.items.map((item) => item.id),
    tasks,
  };
}

/**
 * 上次落盘到现在要追加的行；返回 null 表示追加重放不出现在的样子（item 被删或换了顺序、任务被删、
 * 记录有了重复的 item id），要写快照。
 */
function diff(before: Persisted, now: Omit<Persisted, 'lines' | 'bytes'>, record: ConversationRecord): ConversationLogLine[] | null {
  if (now.order.length < before.order.length || now.items.size !== now.order.length) return null;
  for (let i = 0; i < before.order.length; i++) if (now.order[i] !== before.order[i]) return null;
  for (const taskId of before.tasks.keys()) if (!now.tasks.has(taskId)) return null;

  const lines: ConversationLogLine[] = [];
  const meta: Extract<ConversationLogLine, { op: 'meta' }> = { op: 'meta' };
  if (now.conversation !== before.conversation) meta.conversation = record.conversation;
  if (now.seq !== before.seq) meta.seq = record.seq;
  if (now.agent !== before.agent) meta.agent = record.agent;
  for (const [taskId, text] of now.tasks) {
    if (before.tasks.get(taskId) === text) continue;
    (meta.tasks ??= {})[taskId] = record.tasks![taskId]!;
  }
  for (const item of record.items) {
    if (before.items.get(item.id) !== now.items.get(item.id)) lines.push({ op: 'item', item });
  }
  if (Object.keys(meta).length > 1) lines.push(meta);
  return lines;
}

function liveSize(now: Omit<Persisted, 'lines' | 'bytes'>): number {
  let bytes = Buffer.byteLength(now.conversation) + Buffer.byteLength(now.seq) + Buffer.byteLength(now.agent);
  for (const text of now.items.values()) bytes += Buffer.byteLength(text);
  for (const text of now.tasks.values()) bytes += Buffer.byteLength(text);
  return bytes;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
