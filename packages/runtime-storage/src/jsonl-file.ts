import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { syncDir } from './json-file.ts';

/**
 * 只追加的 JSONL 文件：一行一个 JSON 值，第一行是文件头。给按条记账、每次只改几条的账本用（任务与应用两本账，
 * 架构设计 §7.3）：追加几行就 fsync，不再整文件重写；行数多了由调用方整份压缩成新文件。
 *
 * - `appendJsonl`：追加若干行并 fsync 文件；文件是新建的（或空的）先写文件头，并 fsync 目录。
 * - `readJsonl`：读出各行；末尾被截断的残行（崩溃）与认不出的行跳过并计数；第一行认不出时整个文件算坏的。
 * - `compactJsonl`：把文件头与全部行写到临时文件、fsync、改名替换、再 fsync 目录。
 *
 * 三者都不排队：同一个文件的追加与压缩由调用方放在同一条串行写链上。macOS 上 Node 的 fsync 不是 `F_FULLFSYNC`。
 *
 * `durable: false`（缺省 true）：追加与压缩都不 fsync 文件与目录，给不要求断电后也在的数据用（会话记录，§3.10）。
 */

export interface JsonlWriteOptions {
  header: unknown;
  mode?: number;
  /** 缺省 true：fsync 文件，新建或改名时再 fsync 目录。false 时都不做。 */
  durable?: boolean;
}

export interface JsonlReadResult {
  /** 第一行（文件头）；空文件时 null。 */
  header: unknown;
  /** 文件头之后能解析的各行，按文件里的顺序。 */
  rows: unknown[];
  /** 跳过的行数（不含末尾的残行）。 */
  skipped: number;
  /** 最后一行没有换行结尾（崩溃时写了一半）：解析不了时跳过，解析得了也照收。 */
  truncatedTail: boolean;
  /** 文件头之后的行数（含跳过的与残行），供调用方判断何时压缩。 */
  lines: number;
  bytes: number;
}

export class JsonlCorruptError extends Error {
  readonly file: string;

  constructor(file: string) {
    super(`Unrecognized JSONL file: ${file}`);
    this.name = 'JsonlCorruptError';
    this.file = file;
  }
}

/** 文件不在时 null；第一行（文件头）不是 JSON 时抛 `JsonlCorruptError`。 */
export async function readJsonl(file: string): Promise<JsonlReadResult | null> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const bytes = Buffer.byteLength(text);
  if (text.length === 0) return { header: null, rows: [], skipped: 0, truncatedTail: false, lines: 0, bytes };
  const truncatedTail = !text.endsWith('\n');
  const parts = text.split('\n');
  if (!truncatedTail) parts.pop();
  // 整个文件只有半行：第一次追加（文件头与第一行一起写）时崩溃，或者正好读在那次写入中间。按空文件处理。
  if (truncatedTail && parts.length === 1) return { header: null, rows: [], skipped: 0, truncatedTail, lines: 0, bytes };
  let header: unknown;
  try {
    header = JSON.parse(parts[0]!);
  } catch {
    throw new JsonlCorruptError(file);
  }
  const rows: unknown[] = [];
  let skipped = 0;
  for (let i = 1; i < parts.length; i++) {
    const line = parts[i]!;
    const tail = truncatedTail && i === parts.length - 1;
    try {
      if (line.trim() === '') throw new Error('empty line');
      rows.push(JSON.parse(line));
    } catch {
      if (!tail) skipped++;
    }
  }
  return { header, rows, skipped, truncatedTail, lines: parts.length - 1, bytes };
}

/**
 * 追加若干行（已经序列化、不含换行）并 fsync。文件不在或是空的时先写 `header`，并 fsync 目录（让新建的文件落盘）。
 * 文件末尾没有换行（上次写了一半）时先补一个换行，新行不会接在残行后面。返回写入的字节数。
 */
export async function appendJsonl(file: string, rows: readonly string[], options: JsonlWriteOptions): Promise<number> {
  const durable = options.durable ?? true;
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  // `a+`：写入总在末尾，还能读最后一个字节。
  const handle = await fs.open(file, 'a+', options.mode ?? 0o644);
  let created = false;
  let written: number;
  try {
    const { size } = await handle.stat();
    let text = '';
    if (size === 0) {
      created = true;
      text = `${JSON.stringify(options.header)}\n`;
    } else {
      const last = Buffer.alloc(1);
      await handle.read(last, 0, 1, size - 1);
      if (last[0] !== 0x0a) text = '\n';
    }
    for (const row of rows) text += `${row}\n`;
    written = Buffer.byteLength(text);
    await handle.writeFile(text);
    if (durable) await handle.sync();
  } finally {
    await handle.close().catch(() => {});
  }
  if (created && durable) await syncDir(dir);
  return written;
}

/** 原子地把文件换成文件头加这些行：临时文件写完 fsync，改名，再 fsync 目录。返回新文件的字节数。 */
export async function compactJsonl(file: string, rows: readonly string[], options: JsonlWriteOptions): Promise<number> {
  const durable = options.durable ?? true;
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  let text = `${JSON.stringify(options.header)}\n`;
  for (const row of rows) text += `${row}\n`;
  const handle = await fs.open(tmp, 'w', options.mode ?? 0o644);
  try {
    await handle.writeFile(text);
    if (durable) await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
  await handle.close();
  await fs.rename(tmp, file).catch(async (error: unknown) => {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  });
  if (durable) await syncDir(dir);
  return Buffer.byteLength(text);
}

/** 认不出的文件改名保留（`<文件>.corrupt-<时间>`），不静默覆盖。返回改名后的路径。 */
export async function quarantineFile(file: string): Promise<string> {
  const to = `${file}.corrupt-${Date.now()}`;
  await fs.rename(file, to).catch(() => {});
  return to;
}
