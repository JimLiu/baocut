import { spawn, type StdioOptions } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stopChild } from './stop-child.ts';

/** 起一个 Node 子进程跑 `source`；`ipc` 为 true 时带 IPC 通道（与主进程起 Runtime 一样）。等它报告就绪再返回。 */
async function child(source: string, ipc: boolean) {
  const stdio: StdioOptions = ['ignore', 'pipe', 'ignore', ...(ipc ? (['ipc'] as const) : [])];
  const proc = spawn(process.execPath, ['-e', `${source}; setInterval(() => {}, 1000); process.stdout.write('ready\\n');`], { stdio });
  await new Promise<void>((resolve) => proc.stdout!.once('data', () => resolve()));
  return proc;
}

describe('stopChild', () => {
  it('asks the child to stop over IPC and waits for it to exit on its own', async () => {
    const proc = await child(`process.on('message', (m) => m.type === 'stop' && setTimeout(() => process.exit(7), 50))`, true);
    expect(await stopChild(proc, 5_000)).toBe('exited');
    expect(proc.exitCode).toBe(7);
  });

  it('kills a child that ignores the request once the grace period ends', async () => {
    const proc = await child(`process.on('message', () => {})`, true);
    const started = performance.now();
    expect(await stopChild(proc, 200)).toBe('killed');
    expect(performance.now() - started).toBeGreaterThanOrEqual(190);
  });

  it('falls back to SIGTERM without an IPC channel', async () => {
    const proc = await child(`process.on('SIGTERM', () => process.exit(0))`, false);
    expect(await stopChild(proc, 5_000)).toBe('exited');
  });

  it('returns at once for a child that already exited', async () => {
    const proc = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    await new Promise((resolve) => proc.once('exit', resolve));
    expect(await stopChild(proc, 5_000)).toBe('exited');
  });
});
