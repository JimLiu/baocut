import { execFile, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { macCommandScript, openSystemTerminal, posixTerminalScript, shellQuote, type SpawnProcess } from './system-terminal.ts';

/**
 * 系统终端启动器：spawn 与平台都是注入的，测试里不真的打开终端。
 * 生成的 `.command` 脚本用 `sh` 实际跑一遍（`SHELL` 指向 `true`，末尾的 `exec` 立刻结束），核对自删与转义。
 */

const run = promisify(execFile);

interface Call {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
}

/** 假的 spawn：记下调用，按 `behave` 决定这个进程是起来了、退出了，还是没找到。 */
function fakeSpawn(behave: (command: string) => { exit?: number; error?: boolean; spawn?: boolean }) {
  const calls: Call[] = [];
  const spawnFn: SpawnProcess = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter() as ChildProcess;
    (child as unknown as { unref: () => void }).unref = () => {};
    const plan = behave(command);
    setTimeout(() => {
      if (plan.error) child.emit('error', new Error(`spawn ${command} ENOENT`));
      else {
        if (plan.spawn !== false) child.emit('spawn');
        if (plan.exit !== undefined) child.emit('exit', plan.exit, null);
      }
    }, 1);
    return child;
  };
  return { calls, spawn: spawnFn };
}

describe('openSystemTerminal', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-terminal-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('macOS：写 0o700 的 .command 脚本，用 open 打开', async () => {
    const fake = fakeSpawn(() => ({ exit: 0 }));
    const result = await openSystemTerminal('brew upgrade codex', { platform: 'darwin', spawn: fake.spawn, tmpDir: dir });
    expect(result).toEqual({ status: 'opened', detail: null });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.command).toBe('open');
    const file = fake.calls[0]!.args[0]!;
    expect(path.dirname(file)).toBe(dir);
    expect(file).toMatch(/baocut-[0-9a-f]+\.command$/);
    const stat = await fs.stat(file);
    expect(stat.mode & 0o777).toBe(0o700);
    const script = await fs.readFile(file, 'utf8');
    expect(script.split('\n')).toEqual([
      '#!/bin/sh',
      'rm -f "$0"',
      'cd "$HOME" 2>/dev/null',
      'clear',
      `printf '%s\\n' 'BaoCut：运行 brew upgrade codex'`,
      'brew upgrade codex',
      'exec "${SHELL:-/bin/zsh}" -l',
      '',
    ]);
  });

  it('macOS：脚本运行后删掉自己，提示行原样打印（单引号等特殊字符已转义）', async () => {
    const command = `echo "it's \\$HOME" && echo done`;
    const fake = fakeSpawn(() => ({ exit: 0 }));
    await openSystemTerminal(command, { platform: 'darwin', spawn: fake.spawn, tmpDir: dir });
    const file = fake.calls[0]!.args[0]!;
    const { stdout } = await run('sh', [file], { env: { ...process.env, SHELL: '/usr/bin/true', TERM: 'dumb', HOME: dir } });
    const lines = stdout.split('\n').filter((line) => line && !line.includes('\x1b'));
    expect(lines).toEqual([`BaoCut：运行 ${command}`, `it's $HOME`, 'done']);
    await expect(fs.access(file)).rejects.toThrow();
  });

  it('macOS：open 失败时删掉脚本，返回 unsupported', async () => {
    const failed = fakeSpawn(() => ({ exit: 1 }));
    expect(await openSystemTerminal('codex login', { platform: 'darwin', spawn: failed.spawn, tmpDir: dir })).toMatchObject({ status: 'unsupported' });
    const missing = fakeSpawn(() => ({ error: true }));
    expect(await openSystemTerminal('codex login', { platform: 'darwin', spawn: missing.spawn, tmpDir: dir })).toMatchObject({ status: 'unsupported' });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('Windows：cmd.exe /c start "" cmd.exe /k <命令>', async () => {
    const fake = fakeSpawn(() => ({ exit: 0 }));
    expect(await openSystemTerminal('npm install -g @openai/codex', { platform: 'win32', spawn: fake.spawn })).toEqual({ status: 'opened', detail: null });
    expect(fake.calls[0]).toMatchObject({
      command: 'cmd.exe',
      args: ['/c', 'start', '""', 'cmd.exe', '/k', 'npm install -g @openai/codex'],
      options: { windowsVerbatimArguments: true },
    });
  });

  it('Linux：按顺序找第一个在 PATH 上的终端，起不来就试下一个', async () => {
    const fake = fakeSpawn((command) => (command === 'gnome-terminal' ? { error: true } : { spawn: true }));
    const available = async (program: string) => program === 'gnome-terminal' || program === 'xterm';
    const result = await openSystemTerminal('codex login', { platform: 'linux', spawn: fake.spawn, available });
    expect(result).toEqual({ status: 'opened', detail: null });
    expect(fake.calls.map((call) => call.command)).toEqual(['gnome-terminal', 'xterm']);
    expect(fake.calls[0]!.args).toEqual(['--', 'sh', '-c', posixTerminalScript('codex login')]);
    expect(fake.calls[1]!.args).toEqual(['-e', 'sh', '-c', posixTerminalScript('codex login')]);
  });

  it('Linux：没有终端程序时 unsupported，不 spawn', async () => {
    const fake = fakeSpawn(() => ({ spawn: true }));
    const result = await openSystemTerminal('claude', { platform: 'linux', spawn: fake.spawn, available: async () => false });
    expect(result).toEqual({ status: 'unsupported', detail: 'No terminal program found' });
    expect(fake.calls).toEqual([]);
  });

  it('其他平台 unsupported；多行命令直接拒绝', async () => {
    const fake = fakeSpawn(() => ({ exit: 0 }));
    expect(await openSystemTerminal('claude', { platform: 'aix', spawn: fake.spawn })).toMatchObject({ status: 'unsupported' });
    await expect(openSystemTerminal('claude\nrm -rf ~', { platform: 'darwin', spawn: fake.spawn, tmpDir: dir })).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });

  it('shellQuote 与脚本内容', async () => {
    expect(shellQuote(`a'b`)).toBe(`'a'\\''b'`);
    expect(macCommandScript('claude')).toContain(`printf '%s\\n' 'BaoCut：运行 claude'\nclaude\n`);
    const { stdout } = await run('sh', ['-c', `printf '%s' ${shellQuote(`$(id) \`x\` 'q' "d"`)}`]);
    expect(stdout).toBe(`$(id) \`x\` 'q' "d"`);
  });
});
