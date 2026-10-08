import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * `<runtime-home>/cache/` 的总大小上限（架构设计 §5.1「派生缓存」）。缓存里的东西都能删掉后重建，但没有人清，
 * 素材分析（波形、缩略图、帧）与播放转码会一直涨。超过上限时按修改时间从旧到新删文件，降到上限的 `targetRatio`（默认 90%）。
 *
 * 不删的：
 * - `content-index/`：跨视频检索的 SQLite 库（`index.db` 与 `-wal`、`-shm`）。运行中删掉会弄坏打开着的库；它自己在启动时清理
 *   遗留的临时文件（§5.11）。
 * - `baocut-composition-host/`：代码画面宿主的脚本，活着的宿主进程正在用它，很小。
 * - 修改时间在宽限期（1 小时）内的临时文件（名字含 `.tmp`）：正在写的转码与分析结果。
 *
 * 这些文件仍然计入总大小（上限是整个目录的），只是不在可删的候选里。删空的子目录（修改时间超过宽限期的）一并删掉。
 */

/** `cache/` 下不参与淘汰的顶层子目录。 */
export const CACHE_PROTECTED_DIRS: readonly string[] = ['content-index', 'baocut-composition-host'];

const TEMPORARY_GRACE_MS = 60 * 60 * 1000;

export interface CacheTrimOptions {
  /** 上限，字节。 */
  maxBytes: number;
  /** 超限时降到上限的多少（0–1），默认 0.9。 */
  targetRatio?: number;
  /** 不参与淘汰的顶层子目录名，默认 `CACHE_PROTECTED_DIRS`。 */
  protectedDirs?: readonly string[];
  now?: number;
}

export interface CacheTrimResult {
  /** 清理前的总大小（含受保护的文件）。 */
  totalBytes: number;
  /** 受保护的文件的大小。 */
  protectedBytes: number;
  removed: number;
  removedBytes: number;
  /** 删不掉的文件数（被占用、没有权限）。 */
  failed: number;
  /** 清理后的总大小。 */
  remainingBytes: number;
}

interface CacheFile {
  file: string;
  size: number;
  mtimeMs: number;
}

/** 把 `dir` 降到上限之内。目录不存在时什么也不做。 */
export async function trimCache(dir: string, options: CacheTrimOptions): Promise<CacheTrimResult> {
  const now = options.now ?? Date.now();
  const protectedDirs = new Set(options.protectedDirs ?? CACHE_PROTECTED_DIRS);
  const candidates: CacheFile[] = [];
  const dirs: { dir: string; mtimeMs: number }[] = [];
  let totalBytes = 0;
  let protectedBytes = 0;

  const walk = async (current: string, isProtected: boolean): Promise<void> => {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        const nested = isProtected || (current === dir && protectedDirs.has(entry.name));
        await walk(file, nested);
        if (!nested) {
          const stat = await fs.lstat(file).catch(() => null);
          if (stat) dirs.push({ dir: file, mtimeMs: stat.mtimeMs });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.lstat(file).catch(() => null);
      if (!stat?.isFile()) continue;
      totalBytes += stat.size;
      const inFlight = entry.name.includes('.tmp') && stat.mtimeMs > now - TEMPORARY_GRACE_MS;
      if (isProtected || inFlight) protectedBytes += stat.size;
      else candidates.push({ file, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  };
  await walk(dir, false);

  const result: CacheTrimResult = { totalBytes, protectedBytes, removed: 0, removedBytes: 0, failed: 0, remainingBytes: totalBytes };
  if (totalBytes <= options.maxBytes) return result;

  const target = Math.floor(options.maxBytes * (options.targetRatio ?? 0.9));
  candidates.sort((a, b) => a.mtimeMs - b.mtimeMs || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  let remaining = totalBytes;
  for (const candidate of candidates) {
    if (remaining <= target) break;
    try {
      await fs.unlink(candidate.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') result.failed++;
      continue;
    }
    remaining -= candidate.size;
    result.removed++;
    result.removedBytes += candidate.size;
  }
  result.remainingBytes = remaining;

  // 删空了的子目录（深的在前）；刚建的留着，写入方可能正要往里放文件。
  if (result.removed > 0) {
    for (const entry of dirs.sort((a, b) => b.dir.length - a.dir.length)) {
      if (entry.mtimeMs > now - TEMPORARY_GRACE_MS) continue;
      await fs.rmdir(entry.dir).catch(() => {});
    }
  }
  return result;
}
