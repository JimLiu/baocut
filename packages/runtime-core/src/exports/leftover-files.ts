import fs from 'node:fs/promises';
import path from 'node:path';
import type { JobRecord } from '@baocut/protocol';
import type { Logger } from '@baocut/harness';
import { activeImportStaging, isImportStagingName } from '../videos/package-import.ts';
import { isHiddenTempOf } from './export-publish.ts';

/**
 * 启动时清理上次被强杀留下的残留（架构设计 §5.8）：
 *
 * - 导出的隐藏临时文件：只看 Ledger 里还在、已经结束的导出任务记下的目标目录与输出文件名，只删名字是
 *   `.<输出文件名>.<8 位十六进制>.tmp` 的普通文件。排队、运行中的导出用到的（目录，文件名）不碰；Ledger 里已经剪掉的导出
 *   留下的临时文件找不到，不删。
 * - 打开便携包的暂存目录：只在来源目录（项目目录、没有项目的会话的工作目录）的第一层找名字是 `.baocut-import-<8 位十六进制>`
 *   的目录，跳过这个进程里进行中的打开用着的。
 *
 * 两种都只删修改时间早于 `minAgeMs`（默认 1 小时）的：刚开始的导出与打开（包括别的进程里的）不会被删。用 `lstat` 判断种类，
 * 符号链接一律不碰，不往下找别的目录；用户自己的文件名字对不上，不会被删。失败只记日志，不影响启动。
 */

export const LEFTOVER_MIN_AGE_MS = 60 * 60 * 1000;

export interface LeftoverSweepOptions {
  /** Ledger 里的任务。 */
  jobs: () => readonly JobRecord[];
  /** 来源目录。 */
  sourceRoots: () => readonly string[];
  log: Logger;
  minAgeMs?: number;
  now?: () => number;
}

export interface LeftoverSweepResult {
  removed: string[];
}

const ACTIVE = new Set(['queued', 'running']);

export async function sweepLeftovers(options: LeftoverSweepOptions): Promise<LeftoverSweepResult> {
  const cutoff = (options.now?.() ?? Date.now()) - (options.minAgeMs ?? LEFTOVER_MIN_AGE_MS);
  const log = options.log.child('leftovers');
  const removed: string[] = [];
  const old = (stat: { mtimeMs: number }) => stat.mtimeMs < cutoff;

  // 导出：目标目录 → 结束了的导出的输出文件名；进行中的导出用着的文件名不算。
  const finished = new Map<string, Set<string>>();
  const busy = new Map<string, Set<string>>();
  for (const job of options.jobs()) {
    const destination = job.export?.destination;
    if (!destination) continue;
    const into = ACTIVE.has(job.state) ? busy : finished;
    const names = into.get(destination.dir) ?? new Set<string>();
    for (const file of destination.files) names.add(file);
    into.set(destination.dir, names);
  }
  for (const [dir, names] of finished) {
    const inUse = busy.get(dir) ?? new Set<string>();
    const candidates = [...names].filter((name) => !inUse.has(name));
    if (candidates.length === 0) continue;
    for (const name of await readNames(dir)) {
      if (!candidates.some((fileName) => isHiddenTempOf(name, fileName))) continue;
      const file = path.join(dir, name);
      const stat = await fs.lstat(file).catch(() => null);
      if (!stat?.isFile() || !old(stat)) continue;
      if (
        await fs.rm(file).then(
          () => true,
          (error) => (log.warn('Failed to remove leftover export temp file', { file, error: String(error) }), false),
        )
      )
        removed.push(file);
    }
  }

  // 打开便携包：来源目录第一层的暂存目录。
  const active = activeImportStaging();
  const roots = new Set<string>();
  for (const root of options.sourceRoots()) roots.add(await fs.realpath(root).catch(() => root));
  for (const root of roots) {
    for (const name of await readNames(root)) {
      if (!isImportStagingName(name)) continue;
      const dir = path.join(root, name);
      if (active.has(dir)) continue;
      const stat = await fs.lstat(dir).catch(() => null);
      if (!stat?.isDirectory() || !old(stat)) continue;
      if (
        await fs.rm(dir, { recursive: true }).then(
          () => true,
          (error) => (log.warn('Failed to remove leftover package import staging folder', { dir, error: String(error) }), false),
        )
      )
        removed.push(dir);
    }
  }

  if (removed.length > 0) log.info('Removed leftover temp files and staging folders', { count: removed.length });
  return { removed };
}

async function readNames(dir: string): Promise<string[]> {
  return fs.readdir(dir).catch(() => []);
}
