import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic } from './json-file.ts';
import { quarantineFile } from './jsonl-file.ts';

/**
 * 整文件 JSON 的 Store 读文件的统一规则（架构设计 §5.2）。
 *
 * - 文件不在：`missing`。空文件（或只有空白）：`empty`，按不在处理，记一条 warn，不改名（没有可留的内容）。
 * - 读不了（权限、是目录等文件系统错误）：原样抛出，不当作坏文件。
 * - 不是 JSON、顶层不是对象，或 `recognize` 认不出：改名保留（`<文件>.corrupt-<时间>`，`quarantineFile`），记 warn，
 *   `quarantined`，调用方从空（默认值）开始。
 * - 版本字段高于已知（更新的 BaoCut 写下的）：记 warn，`newer-version`，按空处理但**不改名**；`JsonStoreFile` 之后不再写这个文件，
 *   免得降级运行时覆盖掉新版本的数据。版本检查在形状检查之前：新版本的文件形状不同，也不能被当成坏文件改名。
 * - `quarantine: false`（凭据与授权这类不能静默丢的）：认不出时不改名，返回 `unrecognized`，由调用方让启动失败或进入降级状态。
 */

/** Store 用的最小日志接口；Harness 的 `Logger` 在结构上满足它。 */
export interface StoreLog {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
}

export interface StoreOptions {
  log?: StoreLog;
}

export interface StoreFileVersion {
  /** 版本字段名，例如 `schemaVersion`、`formatVersion`。 */
  key: string;
  /** 这一版认识的最高版本。 */
  known: number;
  /** 把字段值换成版本号；缺省只认数字。认不出时 null（交给 `recognize` 判断）。 */
  parse?: (value: unknown) => number | null;
}

export interface ReadStoreFileOptions<T> {
  log?: StoreLog | undefined;
  /** 缺省 `{ key: 'schemaVersion', known: 1 }`；null 表示文件没有版本字段。 */
  version?: StoreFileVersion | null;
  /** 顶层对象 → 值；认不出时 null。 */
  recognize: (raw: Record<string, unknown>) => T | null;
  /** 缺省 true：认不出时改名保留。false 时不改名，返回 `unrecognized`。 */
  quarantine?: boolean;
}

export type StoreFileRead<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing' | 'empty' | 'unrecognized'; value: null }
  | { status: 'quarantined'; value: null; renamedTo: string }
  | { status: 'newer-version'; value: null; version: number };

export async function readJsonOrQuarantine<T>(file: string, options: ReadStoreFileOptions<T>): Promise<StoreFileRead<T>> {
  const name = path.basename(file);
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing', value: null };
    throw error;
  }
  if (text.trim() === '') {
    options.log?.warn('Store file is empty; starting from defaults', { file: name });
    return { status: 'empty', value: null };
  }
  const unrecognized = async (reason: string): Promise<StoreFileRead<T>> => {
    if (options.quarantine === false) {
      options.log?.warn('Store file is unrecognized; left in place', { file: name, reason });
      return { status: 'unrecognized', value: null };
    }
    const renamedTo = await quarantineFile(file);
    options.log?.warn('Unrecognized store file renamed; starting from defaults', { file: name, reason, renamedTo: path.basename(renamedTo) });
    return { status: 'quarantined', value: null, renamedTo };
  };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return unrecognized('not-json');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return unrecognized('not-an-object');
  const record = raw as Record<string, unknown>;
  const version = options.version === undefined ? { key: 'schemaVersion', known: 1 } : options.version;
  if (version) {
    const value = record[version.key];
    const parsed = version.parse ? version.parse(value) : typeof value === 'number' && Number.isFinite(value) ? value : null;
    if (parsed !== null && parsed > version.known) {
      options.log?.warn('Store file was written by a newer version; ignored and left untouched', {
        file: name,
        version: parsed,
        known: version.known,
      });
      return { status: 'newer-version', value: null, version: parsed };
    }
  }
  const value = options.recognize(record);
  if (value === null) return unrecognized('unrecognized-shape');
  return { status: 'ok', value };
}

/**
 * 一个整文件 JSON 的 Store 文件：按上面的规则读；读到更新版本的文件之后进入只读，之后的写入跳过（改动只留在内存里，
 * 记一次 warn），文件保持原样。
 */
export class JsonStoreFile {
  readonly file: string;
  readonly #log: StoreLog | undefined;
  #readOnly = false;
  #warned = false;

  constructor(file: string, log?: StoreLog) {
    this.file = file;
    this.#log = log;
  }

  /** 读到了更新版本写下的文件（或读不了而按空处理）：不再写它。 */
  get readOnly(): boolean {
    return this.#readOnly;
  }

  /**
   * `tolerateReadErrors`：文件系统读不了（权限等）时不抛出，记 warn、按空处理并进入只读（读不到的文件不覆盖）。
   * 给不拦住 Runtime 启动的偏好与缓存用。
   */
  async read<T>(options: Omit<ReadStoreFileOptions<T>, 'log'> & { tolerateReadErrors?: boolean }): Promise<StoreFileRead<T>> {
    this.#warned = false;
    let result: StoreFileRead<T>;
    try {
      result = await readJsonOrQuarantine(this.file, { ...options, log: this.#log });
    } catch (error) {
      if (!options.tolerateReadErrors) throw error;
      this.#log?.warn('Store file could not be read; starting from defaults', {
        file: path.basename(this.file),
        code: (error as NodeJS.ErrnoException).code ?? String(error),
      });
      this.#readOnly = true;
      return { status: 'unrecognized', value: null };
    }
    this.#readOnly = result.status === 'newer-version';
    return result;
  }

  async write(value: unknown, options: { mode?: number; durable?: boolean } = {}): Promise<void> {
    if (this.#readOnly) {
      if (!this.#warned) {
        this.#warned = true;
        this.#log?.warn('Store file was not loaded (newer version or unreadable); changes are kept in memory only', { file: path.basename(this.file) });
      }
      return;
    }
    await writeJsonAtomic(this.file, value, options);
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
