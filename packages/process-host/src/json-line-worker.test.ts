import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  JsonLineWorker,
  WorkerExitedError,
  WorkerRequestError,
  WorkerSpawnError,
  WorkerTimeoutError,
  type WorkerEvent,
} from './json-line-worker.ts';

/** 一个用 Node 写的小子进程：echo、error、event、hang、spam-stderr、exit。 */
const SCRIPT = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
rl.on('line', (line) => {
  const { id, method, params } = JSON.parse(line);
  if (method === 'echo') send({ id, result: params });
  else if (method === 'error') send({ id, error: { code: 'BAD', message: 'nope', retryable: true, details: { x: 1 } } });
  else if (method === 'event') { send({ event: 'tick', params: { n: 1 } }); send({ event: 'tick', params: { n: 2 } }); send({ id, result: {} }); }
  else if (method === 'spam') { process.stderr.write('x'.repeat(params.bytes) + 'TAIL'); send({ id, result: {} }); }
  else if (method === 'exit') { send({ id, result: { bye: true } }); process.exit(params.code); }
  // hang: 不回应
});
rl.on('close', () => process.exit(0));
`;

describe('JsonLineWorker', () => {
  let dir: string;
  let script: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-ph-'));
    script = path.join(dir, 'child.cjs');
    await fs.writeFile(script, SCRIPT);
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const start = () => JsonLineWorker.start({ command: process.execPath, args: [script] });

  it('请求与响应、错误体、事件按行顺序到达', async () => {
    const worker = await start();
    expect(worker.pid).toBeGreaterThan(0);
    expect(await worker.request('echo', { a: 1 })).toEqual({ a: 1 });
    const error = await worker.request('error', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorkerRequestError);
    expect((error as WorkerRequestError).body).toEqual({ code: 'BAD', message: 'nope', retryable: true, details: { x: 1 } });
    const events: WorkerEvent[] = [];
    worker.onEvent((event) => events.push(event));
    await worker.request('event', {});
    expect(events).toEqual([
      { event: 'tick', params: { n: 1 } },
      { event: 'tick', params: { n: 2 } },
    ]);
    const exit = await worker.close();
    expect(exit.expected).toBe(true);
    expect(worker.alive).toBe(false);
  });

  it('超时只拒绝这一个请求；子进程退出拒绝在途请求并通知 onExit', async () => {
    const worker = await start();
    await expect(worker.request('hang', {}, { timeoutMs: 50 })).rejects.toBeInstanceOf(WorkerTimeoutError);
    const pending = worker.request('hang', {});
    const exits: unknown[] = [];
    worker.onExit((exit) => exits.push(exit));
    // 退出之前写出的响应不会丢。
    expect(await worker.request('exit', { code: 3 })).toEqual({ bye: true });
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorkerExitedError);
    expect(exits).toEqual([{ code: 3, signal: null, expected: false }]);
    await expect(worker.request('echo', {})).rejects.toBeInstanceOf(WorkerExitedError);
  });

  it('kill 立即结束，标为预期的退出', async () => {
    const worker = await start();
    const pending = worker.request('hang', {});
    const exit = await worker.kill();
    expect(exit).toMatchObject({ signal: 'SIGKILL', expected: true });
    await expect(pending).rejects.toBeInstanceOf(WorkerExitedError);
  });

  it('stderr 只保留尾部', async () => {
    const worker = await JsonLineWorker.start({ command: process.execPath, args: [script], stderrLimitBytes: 1024 });
    await worker.request('spam', { bytes: 100_000 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const tail = worker.stderrTail();
    expect(tail.length).toBeLessThanOrEqual(1024);
    expect(tail.endsWith('TAIL')).toBe(true);
    await worker.close();
  });

  it('可执行文件不存在时启动失败', async () => {
    await expect(JsonLineWorker.start({ command: path.join(dir, 'missing') })).rejects.toBeInstanceOf(WorkerSpawnError);
  });
});
