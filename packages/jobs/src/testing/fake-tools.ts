import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 假的 yt-dlp 脚本（`fake-yt-dlp.ts`）的绝对路径。 */
export const FAKE_YT_DLP = fileURLToPath(new URL('./fake-yt-dlp.ts', import.meta.url));

export interface FakeYtDlp {
  /** 可执行的包装（`<dir>/yt-dlp`）。 */
  command: string;
  /** 每次调用追加一行 `{ argv }`。 */
  log: string;
  /** 读出记下的调用。 */
  calls(): Promise<Array<{ argv?: string[]; resumedFrom?: number }>>;
}

/**
 * 在 `dir` 里写一个名为 `yt-dlp` 的可执行包装：用当前的 Node 运行假脚本，日志写在 `dir` 里。
 * 包装里写的是绝对路径，不依赖 PATH：测试可以把 PATH 设成只含这个目录（或空目录），系统里真实的 yt-dlp 不会被用到。
 */
export async function writeFakeYtDlp(dir: string, options: { version?: string; name?: string } = {}): Promise<FakeYtDlp> {
  await fs.mkdir(dir, { recursive: true });
  const command = path.join(dir, options.name ?? 'yt-dlp');
  const log = path.join(dir, 'argv.log');
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const lines = [
    '#!/bin/sh',
    `export FAKE_YTDLP_LOG=${quote(log)}`,
    ...(options.version ? [`export FAKE_YTDLP_VERSION=${quote(options.version)}`] : []),
    `exec ${quote(process.execPath)} ${quote(FAKE_YT_DLP)} "$@"`,
    '',
  ];
  await fs.writeFile(command, lines.join('\n'), { mode: 0o755 });
  return {
    command,
    log,
    async calls() {
      const text = await fs.readFile(log, 'utf8').catch(() => '');
      return text
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { argv?: string[]; resumedFrom?: number });
    },
  };
}
