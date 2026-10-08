import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { until } from '../agent-tools/testing/fake-agent.ts';
import { CommandOutput, runCommand } from './tool-command.ts';

/** 代用户执行命令（架构设计 §12.9）：输出的整理与截断、退出码、停止时连同子进程一起结束、超时、不能启动。 */

describe('命令输出', () => {
  it('合并换行写法，\\r 改写的进度行只留最后一次，去掉终端颜色；只数写完的行', () => {
    const out = new CommandOutput(1000);
    out.push('==> \x1b[1;32mUpgrading\x1b[0m\r\n');
    out.push('progress 10%\rprogress 50%');
    expect(out.text).toBe('==> Upgrading\nprogress 50%');
    expect(out.lines).toBe(1);
    out.push('\r');
    out.push('\n');
    out.push('done');
    expect(out.text).toBe('==> Upgrading\nprogress 50%\ndone');
    expect(out.lines).toBe(2);
    out.push('\rdone!\n');
    expect(out.text).toBe('==> Upgrading\nprogress 50%\ndone!\n');
    expect(out.lines).toBe(3);
  });

  it('超过上限时按整行截掉前面的', () => {
    const out = new CommandOutput(20);
    for (let i = 0; i < 10; i++) out.push(`line ${i}\n`);
    expect(out.truncated).toBe(true);
    expect(out.text).toBe('line 8\nline 9\n');
    expect(out.lines).toBe(10);
    out.push('x'.repeat(50));
    expect(out.text).toBe('x'.repeat(20));
  });
});

describe('执行命令', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-tool-command-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function script(name: string, body: string): Promise<string> {
    const file = path.join(dir, name);
    await fs.writeFile(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
  }

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it.skipIf(process.platform === 'win32')('退出码与标准输出、标准错误', async () => {
    const file = await script('ok', 'echo out; echo err >&2; exit 3');
    let text = '';
    const outcome = await runCommand([file, 'a b'], {
      env: {},
      signal: new AbortController().signal,
      timeoutMs: 10_000,
      onOutput: (chunk) => (text += chunk),
    });
    expect(outcome).toEqual({ kind: 'exited', exitCode: 3 });
    expect(text).toContain('out\n');
    expect(text).toContain('err\n');
  });

  it.skipIf(process.platform === 'win32')('停止时连同它派生的进程一起结束', async () => {
    const pids = path.join(dir, 'pids');
    const file = await script('slow', `echo $$ > '${pids}'; /bin/sleep 30 & echo $! >> '${pids}'; echo started; wait`);
    const controller = new AbortController();
    let text = '';
    const running = runCommand([file], { env: {}, signal: controller.signal, timeoutMs: 60_000, onOutput: (c) => (text += c) });
    await until(() => text.includes('started'));
    const [shell, sleep] = (await fs.readFile(pids, 'utf8')).trim().split('\n').map(Number);
    controller.abort();
    expect(await running).toEqual({ kind: 'aborted' });
    await until(() => !alive(shell!) && !alive(sleep!));
  });

  it.skipIf(process.platform === 'win32')('超时与不能启动', async () => {
    const file = await script('hang', '/bin/sleep 30');
    const signal = new AbortController().signal;
    expect(await runCommand([file], { env: {}, signal, timeoutMs: 100, killGraceMs: 100, onOutput: () => {} })).toEqual({ kind: 'timed-out' });
    expect(await runCommand([path.join(dir, 'missing')], { env: {}, signal, timeoutMs: 1000, onOutput: () => {} })).toEqual({
      kind: 'failed-to-start',
      reason: 'ENOENT',
    });
  });

  it('Windows：不建进程组，停止时用 taskkill /T /F 结束整棵进程树', async () => {
    const calls: { command: string; args: readonly string[]; options: SpawnOptions }[] = [];
    const child = Object.assign(new EventEmitter(), { pid: 77, stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true }) as unknown as ChildProcess;
    const spawnFn = (command: string, args: readonly string[], options: SpawnOptions) => {
      calls.push({ command, args, options });
      if (calls.length === 1) return child;
      // taskkill 结束了整棵树。
      setTimeout(() => child.emit('close', 1, null), 1);
      return new EventEmitter() as ChildProcess;
    };
    const controller = new AbortController();
    const running = runCommand(['C:\\yt\\yt-dlp.exe', '-U'], { env: {}, signal: controller.signal, timeoutMs: 60_000, onOutput: () => {}, platform: 'win32', spawn: spawnFn });
    controller.abort();
    expect(await running).toEqual({ kind: 'aborted' });
    expect(calls[0]!.options.detached).toBe(false);
    expect(calls[1]!.command).toMatch(/[\\/]System32[\\/]taskkill\.exe$/);
    expect(calls[1]!.args).toEqual(['/PID', '77', '/T', '/F']);
  });
});
