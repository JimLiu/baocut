import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '@baocut/harness';

type Level = 'debug' | 'info' | 'warn' | 'error';

export interface FileLoggerOptions {
  file: string;
  /** 同时写到 stderr（开发时用）。 */
  echo?: boolean;
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

  const write = (scope: string, level: Level, message: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < min) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, scope, message, ...fields });
    stream.write(`${line}\n`);
    if (options.echo) process.stderr.write(`[${level}] ${scope}: ${message}${fields ? ` ${JSON.stringify(fields)}` : ''}\n`);
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
    close: () => new Promise((resolve) => stream.end(resolve)),
  };
}
