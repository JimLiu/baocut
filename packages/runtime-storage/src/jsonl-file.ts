import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * JSON Lines 小工具：一行一个 JSON 值。不 fsync——用它的数据（会话记录）不要求断电后也在。
 */

function toText(values: readonly unknown[]): string {
  return values.map((value) => `${JSON.stringify(value)}\n`).join('');
}

/** 把若干值各写成一行，一次追加到文件末尾（文件不存在时创建）。返回写下的字节数。 */
export async function appendJsonl(file: string, values: readonly unknown[]): Promise<number> {
  if (values.length === 0) return 0;
  const text = toText(values);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, text, 'utf8');
  return Buffer.byteLength(text);
}

/** 原子替换：先写同目录的临时文件再 rename。返回写下的字节数。 */
export async function writeJsonlAtomic(file: string, values: readonly unknown[]): Promise<number> {
  const text = toText(values);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
  return Buffer.byteLength(text);
}

export interface JsonlRead {
  /** 解析成功的行，按文件顺序。 */
  values: unknown[];
  /** 解析不了的行（行号从 1 起）。只有末尾残行是预期内的：追加到一半时进程退出。 */
  bad: { line: number; tail: boolean }[];
  /** 非空行数。 */
  lines: number;
  bytes: number;
}

/** 读整个文件；文件不存在时返回 null。解析不了的行跳过，在 `bad` 里报告。 */
export async function readJsonl(file: string): Promise<JsonlRead | null> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const raw = text.split('\n');
  let last = raw.length - 1;
  while (last >= 0 && raw[last]!.trim() === '') last--;
  const result: JsonlRead = { values: [], bad: [], lines: 0, bytes: Buffer.byteLength(text) };
  for (let i = 0; i <= last; i++) {
    const line = raw[i]!;
    if (line.trim() === '') continue;
    result.lines++;
    try {
      result.values.push(JSON.parse(line));
    } catch {
      result.bad.push({ line: i + 1, tail: i === last });
    }
  }
  return result;
}
