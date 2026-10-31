import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Id } from '@baocut/protocol';

/**
 * 频道目录（Bot 技术方案 §5.1、§5.4）：
 *
 * ```text
 * <channelsDir>/<channelId>/
 *   MEMORY.md                           频道记忆
 *   files/                              频道文件目录：协调者与线程的 cwd
 *     .threads/<threadId>/working-notes.md  线程工作笔记：放在 cwd 里，智能体的沙箱不用额外放行就能写
 *   relays.jsonl                        转述索引：引用的消息 → 任务与投递
 *   make-runs.jsonl                     Make 的运行记录，只留最近 50 条
 * <channelsDir>/USER.md                 用户级记忆
 * ```
 *
 * 这里只管路径与读写；版本校验、大小上限与敏感内容校验在调用方（`channels.writeMemory` 等）。频道 id 与线程 id 都要是
 * 安全的单段路径，不然抛错，不让它们跳出频道目录。
 */

const MEMORY_FILE = 'MEMORY.md';
const USER_MEMORY_FILE = 'USER.md';
const RELAYS_FILE = 'relays.jsonl';
const MAKE_RUNS_FILE = 'make-runs.jsonl';
/** Make 的运行记录只留最近这么多条。 */
export const MAKE_RUNS_KEPT = 50;

export interface RelayIndexRow {
  citedMessageId: Id;
  workItemId: Id;
  deliveryId: Id;
}

/** 单段路径名：非空、不含路径分隔符、不是 `.` 或 `..`、不含 NUL。不合格时抛错。 */
export function assertSafePathSegment(value: string, what: string): void {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('..') ||
    value.includes('\0')
  ) {
    throw new Error(`Unsafe ${what}: ${JSON.stringify(value)}`);
  }
}

export class ChannelFiles {
  readonly #root: string;
  /** 每个文件一条串行写链：同一个文件的追加与重写不交错。 */
  readonly #writes = new Map<string, Promise<void>>();

  constructor(channelsDir: string) {
    this.#root = channelsDir;
  }

  dir(channelId: Id): string {
    assertSafePathSegment(channelId, 'channel id');
    return path.join(this.#root, channelId);
  }

  filesDir(channelId: Id): string {
    return path.join(this.dir(channelId), 'files');
  }

  notesPath(channelId: Id, threadId: Id): string {
    assertSafePathSegment(threadId, 'thread id');
    return path.join(this.filesDir(channelId), '.threads', threadId, 'working-notes.md');
  }

  async ensure(channelId: Id): Promise<{ dir: string; filesDir: string }> {
    const dir = this.dir(channelId);
    const filesDir = this.filesDir(channelId);
    await fs.mkdir(filesDir, { recursive: true });
    return { dir, filesDir };
  }

  /** 建好工作笔记所在的目录，返回笔记的路径（文件本身由线程写）。 */
  async ensureNotes(channelId: Id, threadId: Id): Promise<string> {
    const file = this.notesPath(channelId, threadId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    return file;
  }

  async readMemory(channelId: Id): Promise<string> {
    return readText(path.join(this.dir(channelId), MEMORY_FILE));
  }

  async writeMemory(channelId: Id, content: string): Promise<void> {
    const file = path.join(this.dir(channelId), MEMORY_FILE);
    return this.#serial(file, () => writeTextAtomic(file, content));
  }

  async readUserMemory(): Promise<string> {
    return readText(path.join(this.#root, USER_MEMORY_FILE));
  }

  async writeUserMemory(content: string): Promise<void> {
    const file = path.join(this.#root, USER_MEMORY_FILE);
    return this.#serial(file, () => writeTextAtomic(file, content));
  }

  async appendRelayIndex(channelId: Id, row: RelayIndexRow): Promise<void> {
    const file = path.join(this.dir(channelId), RELAYS_FILE);
    const line = JSON.stringify({ citedMessageId: row.citedMessageId, workItemId: row.workItemId, deliveryId: row.deliveryId });
    return this.#serial(file, async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await appendLine(file, line);
    });
  }

  async readRelayIndex(channelId: Id): Promise<RelayIndexRow[]> {
    const rows = await readLines(path.join(this.dir(channelId), RELAYS_FILE));
    return rows.flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return [];
      const r = raw as Record<string, unknown>;
      if (typeof r.citedMessageId !== 'string' || typeof r.workItemId !== 'string' || typeof r.deliveryId !== 'string') return [];
      return [{ citedMessageId: r.citedMessageId, workItemId: r.workItemId, deliveryId: r.deliveryId }];
    });
  }

  /** 追加一条运行记录；超过 `MAKE_RUNS_KEPT` 条时原子重写成最近的这么多条。 */
  async appendMakeRun(channelId: Id, run: unknown): Promise<void> {
    const file = path.join(this.dir(channelId), MAKE_RUNS_FILE);
    const line = JSON.stringify(run);
    return this.#serial(file, async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const runs = (await readLines(file)).map((r) => JSON.stringify(r));
      runs.push(line);
      if (runs.length <= MAKE_RUNS_KEPT) {
        await appendLine(file, line);
        return;
      }
      await writeTextAtomic(file, `${runs.slice(-MAKE_RUNS_KEPT).join('\n')}\n`);
    });
  }

  async readMakeRuns(channelId: Id): Promise<unknown[]> {
    return readLines(path.join(this.dir(channelId), MAKE_RUNS_FILE));
  }

  /**
   * 排队任务开工时要带的东西（简报、引用、文件归属），按任务存一份 JSON：Runtime 重启后排到它时照样带上。内容是 Runtime 自己
   * 写的，读出来不认识的形状当没有。
   */
  writeQueued(channelId: Id, workItemId: Id, payload: unknown): Promise<void> {
    return this.#writeJson(this.#itemFile(channelId, 'queued', workItemId), payload);
  }

  readQueued(channelId: Id, workItemId: Id): Promise<unknown> {
    return this.#readJson(this.#itemFile(channelId, 'queued', workItemId));
  }

  removeQueued(channelId: Id, workItemId: Id): Promise<void> {
    return this.#removeFile(this.#itemFile(channelId, 'queued', workItemId));
  }

  /** 等用户在场再投的那一份（Driver 不能逐次审批、无人在场起不了的回合）：重启后点「继续」照样投原来那份。 */
  writeHeld(channelId: Id, workItemId: Id, payload: unknown): Promise<void> {
    return this.#writeJson(this.#itemFile(channelId, 'held', workItemId), payload);
  }

  readHeld(channelId: Id, workItemId: Id): Promise<unknown> {
    return this.#readJson(this.#itemFile(channelId, 'held', workItemId));
  }

  removeHeld(channelId: Id, workItemId: Id): Promise<void> {
    return this.#removeFile(this.#itemFile(channelId, 'held', workItemId));
  }

  #writeJson(file: string, payload: unknown): Promise<void> {
    return this.#serial(file, async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await writeTextAtomic(file, JSON.stringify(payload));
    });
  }

  async #readJson(file: string): Promise<unknown> {
    const text = await readText(file);
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  #removeFile(file: string): Promise<void> {
    return this.#serial(file, () => fs.rm(file, { force: true }));
  }

  #itemFile(channelId: Id, kind: 'queued' | 'held', workItemId: Id): string {
    assertSafePathSegment(workItemId, 'work item id');
    return path.join(this.dir(channelId), kind, `${workItemId}.json`);
  }

  /** 删掉整个频道目录（频道文件、记忆、工作笔记都在里面）。 */
  async remove(channelId: Id): Promise<void> {
    const dir = this.dir(channelId);
    const prefix = `${dir}${path.sep}`;
    await Promise.all([...this.#writes].filter(([file]) => file.startsWith(prefix)).map(([, p]) => p.catch(() => {})));
    await fs.rm(dir, { recursive: true, force: true });
  }

  #serial(file: string, fn: () => Promise<void>): Promise<void> {
    const next = (this.#writes.get(file) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.#writes.set(file, next);
    const settle = (): void => {
      if (this.#writes.get(file) === next) this.#writes.delete(file);
    };
    next.then(settle, settle);
    return next;
  }
}

async function readText(file: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

/** 先写同目录的临时文件再改名，崩溃时不会留下半个文件。 */
async function writeTextAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

/** 追加一行；文件末尾没有换行（上次写了一半）时先补一个，新行不接在残行后面。 */
async function appendLine(file: string, line: string): Promise<void> {
  const handle = await fs.open(file, 'a+');
  try {
    const { size } = await handle.stat();
    let prefix = '';
    if (size > 0) {
      const last = Buffer.alloc(1);
      await handle.read(last, 0, 1, size - 1);
      if (last[0] !== 0x0a) prefix = '\n';
    }
    await handle.writeFile(`${prefix}${line}\n`);
  } finally {
    await handle.close().catch(() => {});
  }
}

/** 没有文件头的 JSONL：每行一个值；解析不了的行（崩溃留下的残行、手改坏的行）跳过。 */
async function readLines(file: string): Promise<unknown[]> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const rows: unknown[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // 残行或坏行：跳过。
    }
  }
  return rows;
}
