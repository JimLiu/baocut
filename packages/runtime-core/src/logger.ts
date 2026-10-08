import fs from 'node:fs';
import path from 'node:path';
import type { Writable } from 'node:stream';
import type { Logger } from '@baocut/harness';

type Level = 'debug' | 'info' | 'warn' | 'error';

export interface FileLoggerOptions {
  file: string;
  /** 同时写到 stderr（开发时用）。写不出去（终端关了是 EIO，管道断了是 EPIPE）就不再回显，只写文件。 */
  echo?: boolean;
  /** 回显写到哪里，默认 `process.stderr`；测试注入。 */
  echoStream?: Writable;
  level?: Level;
}

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface ClosableLogger extends Logger {
  close(): Promise<void>;
}

/** 一行一条 JSON 的日志，写在 Runtime Home 的 logs/ 下（架构设计 §12.6）。 */
export function createFileLogger(options: FileLoggerOptions): ClosableLogger {
  fs.mkdirSync(path.dirname(options.file), { recursive: true });
  const stream = fs.createWriteStream(options.file, { flags: 'a', mode: 0o600 });
  const min = ORDER[options.level ?? 'info'];

  const line = (level: Level, scope: string, message: string, fields?: Record<string, unknown>) =>
    `${JSON.stringify({ t: new Date().toISOString(), level, scope, message, ...fields })}\n`;

  // 回显的写入失败是异步报的：先回调，再在流上发 'error'。没人接的 'error' 会成为未捕获的异常，Runtime 的入口把它记进
  // 日志，日志又回显、又失败，就成了打满磁盘的死循环。所以这里接住它，第一次失败就停止回显（以后不再写这个流）。
  const echoStream = options.echo ? (options.echoStream ?? process.stderr) : null;
  let echoing = echoStream !== null;
  const stopEcho = (error: unknown) => {
    if (!echoing) return;
    echoing = false;
    const code = (error as NodeJS.ErrnoException | null)?.code ?? String(error);
    stream.write(line('warn', 'runtime', 'Log echo stopped: stderr is not writable', { code }));
  };
  echoStream?.on('error', stopEcho);

  const write = (scope: string, level: Level, message: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < min) return;
    stream.write(line(level, scope, message, fields));
    if (!echoing) return;
    try {
      echoStream!.write(`[${level}] ${scope}: ${message}${fields ? ` ${JSON.stringify(fields)}` : ''}\n`, (error) => {
        if (error) stopEcho(error);
      });
    } catch (error) {
      stopEcho(error);
    }
  };

  const make = (scope: string): Logger => ({
    debug: (m, f) => write(scope, 'debug', m, f),
    info: (m, f) => write(scope, 'info', m, f),
    warn: (m, f) => write(scope, 'warn', m, f),
    error: (m, f) => write(scope, 'error', m, f),
    child: (sub) => make(`${scope}.${sub}`),
  });

  return {
    ...make('runtime'),
    close: () =>
      new Promise((resolve) => {
        echoing = false;
        echoStream?.off('error', stopEcho);
        stream.end(resolve);
      }),
  };
}
