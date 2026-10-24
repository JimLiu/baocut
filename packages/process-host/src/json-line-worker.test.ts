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

describe('JsonLineWorker authenticated socket', () => {
  const socketScript = `
    const net = require('node:net');
    const readline = require('node:readline');
    process.stdin.destroy(); // GUI startup has made stdin unusable.
    if (process.env.FATAL_START) { process.stderr.write('fatal startup diagnostic\\n'); process.exit(7); }
    if (process.env.NO_CONNECT) setInterval(() => {}, 1000);
    else {
      const connect = () => {
        const socket = net.connect(Number(process.env.BAOCUT_WORKER_PORT), '127.0.0.1');
        socket.on('error', () => {});
        socket.on('connect', () => {
          socket.write(JSON.stringify({ token: process.env.BAD_TOKEN ? 'wrong' : process.env.BAOCUT_WORKER_TOKEN }) + '\\n');
          const lines = readline.createInterface({ input: socket });
          lines.on('line', line => {
            const { id, method, params } = JSON.parse(line);
            if (method === 'disconnect') socket.destroy();
            else if (method === 'reset') socket.resetAndDestroy();
            else if (method === 'exit') { socket.end(JSON.stringify({ id, result: { bye: true } }) + '\\n', () => process.exit(3)); }
            else if (method === 'hang') {}
            else if (method === 'error') socket.write(JSON.stringify({ id, error: { code: 'BAD', message: 'nope' } }) + '\\n');
            else if (method === 'event') {
              socket.write(JSON.stringify({ event: 'tick', params }) + '\\n');
              socket.write(JSON.stringify({ id, result: params }) + '\\n');
            } else socket.write(JSON.stringify({ id, result: params }) + '\\n');
          });
          if (process.env.IGNORE_CLOSE) lines.on('close', () => setInterval(() => {}, 1000));
          else lines.on('close', () => process.exit(0));
        });
      };
      connect();
    }
  `;
  const start = (env: NodeJS.ProcessEnv = {}, timeoutMs = 5000) => JsonLineWorker.start({
    command: process.execPath, args: ['-e', socketScript], env: { ...process.env, ...env }, socket: { timeoutMs },
  });

  it('round-trips concurrent requests, errors and events after stdin is closed', async () => {
    const worker = await start();
    try {
      expect(await Promise.all([worker.request('echo', { n: 1 }), worker.request('echo', { n: 2 })])).toEqual([{ n: 1 }, { n: 2 }]);
      await expect(worker.request('error', {})).rejects.toBeInstanceOf(WorkerRequestError);
      const events: WorkerEvent[] = [];
      worker.onEvent(event => events.push(event));
      await worker.request('event', { n: 3 });
      expect(events).toEqual([{ event: 'tick', params: { n: 3 } }]);
      await expect(worker.request('hang', {}, { timeoutMs: 20 })).rejects.toBeInstanceOf(WorkerTimeoutError);
    } finally { expect(await worker.close()).toMatchObject({ code: 0, expected: true }); }
  });

  it('rejects an incorrect token and cleans up a worker that never connects', async () => {
    for (const env of [{ BAD_TOKEN: '1' }, { NO_CONNECT: '1' }]) {
      await expect(start(env, 500)).rejects.toBeInstanceOf(WorkerSpawnError);
    }
    await expect(JsonLineWorker.start({ command: path.join(os.tmpdir(), 'missing-worker'), socket: { timeoutMs: 1000 } }))
      .rejects.toBeInstanceOf(WorkerSpawnError);
  });

  it('preserves startup stderr in the spawn error and log callback before authentication', async () => {
    const logs: string[] = [];
    const error = await JsonLineWorker.start({
      command: process.execPath, args: ['-e', socketScript],
      env: { ...process.env, FATAL_START: '1' }, socket: { timeoutMs: 5000 },
      onStderrLine: line => logs.push(line),
    }).catch(error => error);
    expect(error).toBeInstanceOf(WorkerSpawnError);
    expect((error as WorkerSpawnError).stderr).toContain('fatal startup diagnostic');
    expect(logs).toEqual(['fatal startup diagnostic']);
  });

  it('rejects pending requests on disconnect and terminates a stuck child', async () => {
    const worker = await start({ IGNORE_CLOSE: '1' });
    const pending = worker.request('disconnect', {}).catch(error => error);
    expect(await pending).toBeInstanceOf(WorkerExitedError);
    expect(worker.alive).toBe(false);
    expect((await worker.exited).expected).toBe(false);
  });

  it('bounds graceful shutdown even when the child ignores EOF', async () => {
    const worker = await start({ IGNORE_CLOSE: '1' });
    expect(await worker.close(30)).toMatchObject({ expected: true });
    expect(worker.alive).toBe(false);
  });

  it('turns a TCP reset into a worker exit instead of an unhandled readline error', async () => {
    const worker = await start({ IGNORE_CLOSE: '1' });
    await expect(worker.request('reset', {})).rejects.toBeInstanceOf(WorkerExitedError);
    expect(worker.alive).toBe(false);
  });

  it('drains the last socket response before rejecting other pending calls on exit', async () => {
    const worker = await start();
    const pending = worker.request('hang', {}).catch(error => error);
    expect(await worker.request('exit', {})).toEqual({ bye: true });
    expect(await pending).toBeInstanceOf(WorkerExitedError);
    expect(await worker.exited).toMatchObject({ expected: false });
  });
});
