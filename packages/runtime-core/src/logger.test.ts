import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileLogger } from './logger.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function logFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-logger-'));
  dirs.push(dir);
  return path.join(dir, 'logs', 'runtime.log');
}

async function readLines(file: string) {
  return (await fs.readFile(file, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { level: string; message: string; code?: string });
}

/**
 * 像终端关掉后的 `process.stderr`：每次写都失败，先回调、再在流上发 'error'，流也不会因此销毁（以后每次写还是失败）。
 * 没人接 'error' 时 `emit` 抛出，成为测试里的未捕获异常。
 */
function brokenStderr(code: string) {
  const writes: string[] = [];
  const stream = Object.assign(new EventEmitter(), {
    write(chunk: string, callback?: (error?: Error | null) => void) {
      writes.push(chunk);
      const error = Object.assign(new Error(`write ${code}`), { code, syscall: 'write' });
      process.nextTick(() => {
        callback?.(error);
        stream.emit('error', error);
      });
      return false;
    },
  });
  return { stream: stream as unknown as Writable, writes, emitter: stream };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('createFileLogger 的回显', () => {
  it.each(['EIO', 'EPIPE'])('stderr 写失败（%s）后不再回显，日志照常写进文件', async (code) => {
    const file = await logFile();
    const { stream, writes } = brokenStderr(code);
    const log = createFileLogger({ file, echo: true, echoStream: stream });
    log.info('first');
    await tick();
    // 失败之后（Runtime 的入口会把未捕获的异常这样记下来）：只进文件，不再碰 stderr，不会一条接一条地失败下去。
    for (let i = 0; i < 100; i += 1) log.error('Uncaught exception', { error: `write ${code}` });
    log.child('jobs').warn('later');
    await tick();
    await log.close();

    expect(writes).toHaveLength(1);
    const lines = await readLines(file);
    expect(lines.map((line) => line.message)).toEqual([
      'first',
      'Log echo stopped: stderr is not writable',
      ...Array<string>(100).fill('Uncaught exception'),
      'later',
    ]);
    expect(lines[1]).toMatchObject({ level: 'warn', code });
  });

  it('写入同步抛错也停止回显', async () => {
    const file = await logFile();
    const writes: string[] = [];
    const stream = Object.assign(new EventEmitter(), {
      write(chunk: string) {
        writes.push(chunk);
        throw Object.assign(new Error('write EIO'), { code: 'EIO' });
      },
    }) as unknown as Writable;
    const log = createFileLogger({ file, echo: true, echoStream: stream });
    log.info('first');
    log.info('second');
    await log.close();

    expect(writes).toHaveLength(1);
    expect((await readLines(file)).map((line) => line.message)).toEqual([
      'first',
      'Log echo stopped: stderr is not writable',
      'second',
    ]);
  });

  it('写得出去时照常回显；关闭后摘掉错误监听', async () => {
    const file = await logFile();
    const writes: string[] = [];
    const emitter = Object.assign(new EventEmitter(), {
      write(chunk: string, callback?: (error?: Error | null) => void) {
        writes.push(chunk);
        process.nextTick(() => callback?.(null));
        return true;
      },
    });
    const log = createFileLogger({ file, echo: true, echoStream: emitter as unknown as Writable });
    expect(emitter.listenerCount('error')).toBe(1);
    log.info('hello', { n: 1 });
    log.debug('below level');
    await tick();
    await log.close();

    expect(writes).toEqual(['[info] runtime: hello {"n":1}\n']);
    expect(emitter.listenerCount('error')).toBe(0);
  });

  it('不回显时不碰 stderr', async () => {
    const file = await logFile();
    const { stream, writes, emitter } = brokenStderr('EIO');
    const log = createFileLogger({ file, echo: false, echoStream: stream });
    log.info('only file');
    await log.close();

    expect(writes).toHaveLength(0);
    expect(emitter.listenerCount('error')).toBe(0);
    expect((await readLines(file)).map((line) => line.message)).toEqual(['only file']);
  });
});
