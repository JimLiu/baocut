import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 原子写：先写同目录的临时文件再 rename，崩溃时不会留下半个 JSON。
 *
 * `durable`：临时文件 fsync 之后再 rename，rename 之后再 fsync 所在目录——兑现时内容与改名都已经交给了磁盘，
 * 断电之后读到的是这次写入或更早的完整版本，不会回到更早。只给任务、应用与授权三本账用（架构设计 §7.3、§7.8）：
 * 每次多两次 fsync。macOS 上 Node 的 fsync 不是 `F_FULLFSYNC`，不保证磁盘自己的写缓存也清空。
 */
export async function writeJsonAtomic(file: string, value: unknown, options: { mode?: number; durable?: boolean } = {}): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (!options.durable) {
    await fs.writeFile(tmp, text, { mode: options.mode ?? 0o644 });
    await fs.rename(tmp, file);
    return;
  }
  const handle = await fs.open(tmp, 'w', options.mode ?? 0o644);
  try {
    await handle.writeFile(text);
    await handle.sync();
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
  await syncDir(dir);
}

/** fsync 一个目录（让其中的 rename 落盘）。不支持打开或同步目录的平台（Windows）上跳过。 */
async function syncDir(dir: string): Promise<void> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(dir, 'r');
  } catch (error) {
    if (UNSUPPORTED.has((error as NodeJS.ErrnoException).code ?? '')) return;
    throw error;
  }
  try {
    await handle.sync();
  } catch (error) {
    if (!UNSUPPORTED.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
  } finally {
    await handle.close().catch(() => {});
  }
}

const UNSUPPORTED = new Set(['EISDIR', 'EPERM', 'EINVAL', 'EACCES', 'ENOTSUP']);

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
