import fs from 'node:fs/promises';
import {
  JsonlCorruptError,
  appendJsonl,
  compactJsonl,
  quarantineFile,
  readJson,
  readJsonl,
} from '@baocut/runtime-storage';
import { silentLog, type JobsLogger } from './jobs-logger.ts';

/**
 * 按条记账的 JSONL 日志（任务与应用两本账共用，架构设计 §7.3）。
 *
 * 文件第一行是 `{"op":"header","formatVersion":2}`，之后每行一个操作：`{"op":"put", ...记录}` 写入或替换一条，
 * `{"op":"remove","<键名>":"<键>"}` 删掉一条。读的时候按顺序重放。每次追加都 fsync（崩溃安全的顺序靠它）。
 *
 * 日志记住上次排进写链的每条记录（序列化后的行），只追加变化了的；行数超过存活记录的 `ratio` 倍（且不少于
 * `minLines`），或字节数超过 `maxBytes`（且超过存活记录的两倍）时，把存活记录整份压缩成新文件。追加与压缩在同一条
 * 串行写链上；压缩用写的那一刻最新的存活记录，之后排着的追加重放时是幂等的。写失败之后下一次写整份压缩。
 *
 * 读：末尾被截断的残行（崩溃）与认不出的行跳过并记日志，下一次写整份压缩把它们清掉；整个文件认不出时改名保留
 * `.corrupt-<时间>`、从空开始。`.jsonl` 不在而旧的整文件 JSON（`legacy`）在时，导入它、写成 `.jsonl` 之后把旧文件
 * 改名为 `.migrated`。
 */

export const JOURNAL_HEADER = { op: 'header', formatVersion: 2 } as const;

export interface JournalCompaction {
  /** 行数超过存活记录数的这么多倍时压缩。 */
  ratio: number;
  /** 行数不到这么多时不按倍数压缩（记录很少时不必频繁重写）。 */
  minLines: number;
  /** 文件超过这么多字节（且超过存活记录的两倍）时压缩。 */
  maxBytes: number;
}

export const DEFAULT_COMPACTION: JournalCompaction = { ratio: 4, minLines: 256, maxBytes: 8 * 1024 * 1024 };

/** 两本账的构造选项。 */
export interface LedgerOptions {
  log?: JobsLogger | undefined;
  /** 压缩的阈值（测试用）。 */
  compaction?: Partial<JournalCompaction> | undefined;
}

export interface RecordJournalOptions {
  file: string;
  /** 删除行里键的字段名（`jobId`、`applicationId`）。 */
  keyField: string;
  /** 一条记录的键；不是合法记录时 null。 */
  key(value: unknown): string | null;
  /** 写入一条已经存在的记录时把它移到最后（应用账本「旧的在前」）；否则留在原位（任务账本按创建先后）。 */
  moveOnPut: boolean;
  /** 旧格式：整文件 JSON，`records` 从中取出记录数组，认不出时 null。 */
  legacy?: { file: string; records(data: unknown): unknown[] | null } | undefined;
  /** 写链上每一步执行前问一次；false 时这一步不写（故障注入模拟崩溃）。 */
  writable?: (() => boolean) | undefined;
  compaction?: Partial<JournalCompaction> | undefined;
  log?: JobsLogger | undefined;
}

export class RecordJournal {
  readonly file: string;
  readonly #options: RecordJournalOptions;
  readonly #compaction: JournalCompaction;
  readonly #log: JobsLogger;
  /** 键 → 最近排进写链的 put 行，按记录的顺序。 */
  #live = new Map<string, string>();
  #chain: Promise<void> = Promise.resolve();
  #lines = 0;
  #bytes = 0;
  /** 下一次写整份压缩（读到残行、写失败、刚从坏文件里恢复）。 */
  #compactNext = false;

  constructor(options: RecordJournalOptions) {
    this.file = options.file;
    this.#options = options;
    this.#compaction = { ...DEFAULT_COMPACTION, ...options.compaction };
    this.#log = options.log ?? silentLog;
  }

  /** 读出全部存活的记录（按重放后的顺序），并记住它们作为之后比较的基准。 */
  async load(): Promise<unknown[]> {
    await this.#chain;
    this.#live = new Map();
    this.#lines = 0;
    this.#bytes = 0;
    this.#compactNext = false;
    let data: Awaited<ReturnType<typeof readJsonl>>;
    try {
      data = await readJsonl(this.file);
    } catch (error) {
      if (!(error instanceof JsonlCorruptError)) throw error;
      return this.#quarantine();
    }
    if (data === null) return this.#migrate();
    if (data.header === null) {
      // 只有半行（写文件头时崩溃）：下一次写整份重写，不在残行后面追加。
      if (data.truncatedTail) this.#compactNext = true;
      return [];
    }
    if (!isHeader(data.header)) return this.#quarantine();
    const records = new Map<string, Record<string, unknown>>();
    let skipped = data.skipped;
    for (const row of data.rows) {
      if (!isObject(row)) {
        skipped++;
        continue;
      }
      if (row.op === 'put') {
        const key = this.#options.key(row);
        if (key === null) {
          skipped++;
          continue;
        }
        const { op: _op, ...record } = row;
        if (this.#options.moveOnPut) records.delete(key);
        records.set(key, record);
      } else if (row.op === 'remove' && typeof row[this.#options.keyField] === 'string') {
        records.delete(row[this.#options.keyField] as string);
      } else {
        skipped++;
      }
    }
    for (const [key, record] of records) this.#live.set(key, putLine(record));
    this.#lines = data.lines;
    this.#bytes = data.bytes;
    if (data.truncatedTail || skipped > 0) {
      this.#compactNext = true;
      this.#log.warn('Skipped unreadable ledger lines', { file: this.file, skipped, truncatedTail: data.truncatedTail });
    }
    return [...records.values()];
  }

  /** 换成这份完整快照：只追加变化了的记录与删掉的键。没有变化时不写，返回之前排着的写入。 */
  replace(records: Iterable<readonly [string, unknown]>): Promise<void> {
    const next = new Map<string, string>();
    const rows: string[] = [];
    for (const [key, record] of records) {
      const line = putLine(record);
      next.set(key, line);
      if (this.#live.get(key) !== line) rows.push(line);
    }
    for (const key of this.#live.keys()) if (!next.has(key)) rows.push(this.#removeLine(key));
    this.#live = next;
    return this.#enqueue(rows);
  }

  /** 写入一条。 */
  put(key: string, record: unknown): Promise<void> {
    const line = putLine(record);
    if (this.#options.moveOnPut) this.#live.delete(key);
    this.#live.set(key, line);
    return this.#enqueue([line]);
  }

  /** 删掉这些键（不在的忽略）。 */
  remove(keys: Iterable<string>): Promise<void> {
    const rows: string[] = [];
    for (const key of keys) if (this.#live.delete(key)) rows.push(this.#removeLine(key));
    return this.#enqueue(rows);
  }

  /** 等所有排队的写入完成。 */
  flush(): Promise<void> {
    return this.#chain;
  }

  #enqueue(rows: string[]): Promise<void> {
    if (rows.length === 0) return this.#chain;
    const next = this.#chain.then(() => this.#step(rows));
    this.#chain = next.catch(() => {});
    return next;
  }

  async #step(rows: string[]): Promise<void> {
    if (this.#options.writable && !this.#options.writable()) return;
    try {
      if (this.#shouldCompact(rows)) await this.#compact();
      else {
        this.#bytes += await appendJsonl(this.file, rows, { header: JOURNAL_HEADER });
        this.#lines += rows.length;
      }
    } catch (error) {
      this.#compactNext = true;
      throw error;
    }
  }

  #shouldCompact(rows: string[]): boolean {
    if (this.#compactNext) return true;
    const { ratio, minLines, maxBytes } = this.#compaction;
    const lines = this.#lines + rows.length;
    if (lines > Math.max(ratio * this.#live.size, minLines)) return true;
    let bytes = this.#bytes;
    for (const row of rows) bytes += row.length + 1;
    if (bytes <= maxBytes) return false;
    let live = 0;
    for (const line of this.#live.values()) live += line.length + 1;
    return bytes > 2 * live;
  }

  async #compact(): Promise<void> {
    const rows = [...this.#live.values()];
    this.#bytes = await compactJsonl(this.file, rows, { header: JOURNAL_HEADER });
    this.#lines = rows.length;
    this.#compactNext = false;
  }

  async #quarantine(): Promise<unknown[]> {
    const quarantined = await quarantineFile(this.file);
    this.#log.warn('Unrecognized ledger file, starting empty', { file: this.file, quarantined });
    return [];
  }

  /** `.jsonl` 不在：有旧的整文件 JSON 就导入，先把 `.jsonl` 写好再把旧文件改名为 `.migrated`。 */
  async #migrate(): Promise<unknown[]> {
    const legacy = this.#options.legacy;
    if (!legacy) return [];
    let data: unknown;
    try {
      data = await readJson(legacy.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== undefined) throw error;
      const quarantined = await quarantineFile(legacy.file);
      this.#log.warn('Unrecognized legacy ledger file, starting empty', { file: legacy.file, quarantined });
      return [];
    }
    if (data === null) return [];
    const list = legacy.records(data);
    if (list === null) {
      const quarantined = await quarantineFile(legacy.file);
      this.#log.warn('Unrecognized legacy ledger file, starting empty', { file: legacy.file, quarantined });
      return [];
    }
    const records: unknown[] = [];
    for (const record of list) {
      const key = this.#options.key(record);
      if (key === null) continue;
      if (this.#options.moveOnPut) this.#live.delete(key);
      this.#live.set(key, putLine(record));
    }
    for (const line of this.#live.values()) {
      const { op: _op, ...record } = JSON.parse(line) as Record<string, unknown>;
      records.push(record);
    }
    await this.#compact();
    await fs.rename(legacy.file, `${legacy.file}.migrated`);
    this.#log.info('Migrated ledger to JSONL', { from: legacy.file, to: this.file, records: records.length });
    return records;
  }

  #removeLine(key: string): string {
    return JSON.stringify({ op: 'remove', [this.#options.keyField]: key });
  }
}

function putLine(record: unknown): string {
  return JSON.stringify({ op: 'put', ...(record as object) });
}

function isHeader(value: unknown): boolean {
  return isObject(value) && value.op === 'header' && value.formatVersion === 2;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
