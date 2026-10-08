#!/usr/bin/env node
import { adminBucket } from './admin/index.ts';
import { runCli } from './cli.ts';

/**
 * `baocut` 的入口：派生命令（目录里的工具，Agent 面设计 §5）与管理桶（`admin/`，§7）都在 `runCli` 里分派，
 * 这里只接上进程。命令一览见 `baocut --help`。
 */

// 输出接到提前关掉的管道（`baocut spec | head`）时安静退出。
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(process.exitCode ?? 0);
  throw error;
});
process.exitCode = await runCli(process.argv.slice(2), adminBucket);
