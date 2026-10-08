import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient, applyAgentSetupEvent } from '@baocut/client';
import type { AgentDriver, AgentSession } from '@baocut/harness';
import { RpcError, newId, type AgentSetupRun, type AgentSetupSnapshot, type DriverProbe } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { fakeProbe, until } from './agent-tools/testing/fake-agent.ts';
import { startRuntime, type RunningRuntime } from './runtime.ts';

/**
 * 端到端（架构设计 §12.9）：真实的 Runtime、网关与客户端，Driver 的探测结果换成假的。
 * 安装命令指向临时目录里的小脚本（输出几行后按场景 0 / 非 0 退出），不碰 brew、npm、curl 与网络；
 * 系统终端换成记录调用的假实现，不真的打开终端。
 */

class SetupDriver implements AgentDriver {
  readonly id = 'codex' as const;
  readonly dir: string;
  probes = 0;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** 版本从临时目录里的标记文件读：安装脚本写了它，重新探测就能看到新版本。 */
  async probe(): Promise<DriverProbe> {
    this.probes++;
    const version = await fs.readFile(path.join(this.dir, 'version'), 'utf8').catch(() => null);
    const script = (name: string) => `sh ${path.join(this.dir, name)}`;
    return {
      ...fakeProbe(),
      version: version?.trim() ?? null,
      loginCommand: 'fake login',
      install: [
        { kind: 'brew', label: 'Homebrew', needs: 'Homebrew', command: script('install-ok.sh'), upgrade: script('upgrade-fail.sh') },
        { kind: 'npm', label: 'npm', needs: 'Node.js', command: script('slow.sh'), upgrade: script('slow.sh') },
        { kind: 'script', label: '官方脚本', needs: null, command: 'curl -fsSL https://example.invalid/install.sh | bash', upgrade: 'fake update' },
      ],
    };
  }

  async createSession(): Promise<AgentSession> {
    throw new Error('这个测试不开会话');
  }
}

describe('Agent 的安装、升级与登录（假 Driver）', () => {
  let dir: string;
  let runtime: RunningRuntime;
  let driver: SetupDriver;
  let client: BaoCutClient;
  let terminal: string[];
  let terminalStatus: 'opened' | 'unsupported';
  let mirror: AgentSetupSnapshot;
  let stop: () => void;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-setup-'));
    await fs.writeFile(path.join(dir, 'install-ok.sh'), `echo "==> 下载"\necho "警告" >&2\necho 2.0.0 > "${path.join(dir, 'version')}"\necho "==> 完成"\nexit 0\n`);
    await fs.writeFile(path.join(dir, 'upgrade-fail.sh'), `echo "Password:"\necho "sudo: a terminal is required" >&2\nexit 7\n`);
    await fs.writeFile(path.join(dir, 'slow.sh'), `echo start\nsleep 30\necho never\n`);
    driver = new SetupDriver(dir);
    terminal = [];
    terminalStatus = 'opened';
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') }),
      drivers: () => [driver],
      watchSpace: false,
      engineHost: null,
      modelWorker: null,
      agentSetup: {
        env: async () => ({ PATH: process.env.PATH }),
        openTerminal: async (command) => {
          terminal.push(command);
          return { status: terminalStatus, detail: terminalStatus === 'opened' ? null : '测试' };
        },
        flushMs: 10,
      },
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({ resolve: async () => ({ endpoint, token }), client: { kind: 'desktop', name: 'test', version: '0' }, reconnect: false });
    await client.connect();
    mirror = { runs: [] };
    stop = client.subscribeAgentSetup({
      snapshot: (snapshot) => (mirror = snapshot),
      event: (event) => (mirror = applyAgentSetupEvent(mirror, event)),
    });
  });

  afterEach(async () => {
    stop();
    client.close();
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function rejection(promise: Promise<unknown>): Promise<RpcError> {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RpcError);
    return error as RpcError;
  }

  /** 「重新检测」：强制探测，探完才返回（§3.11），之后的 `agents.list` 就是新结果。 */
  async function detect() {
    await client.request('agents.detect', { driverId: 'codex' });
  }

  /** 等镜像里这次运行到终态。 */
  function finished(runId: string): Promise<AgentSetupRun> {
    return until(() => {
      const run = mirror.runs.find((r) => r.runId === runId);
      return run && run.state !== 'running' ? run : null;
    });
  }

  it('安装成功：输出逐行送达，退出码 0，结束前重新探测，agents.list 是新版本', async () => {
    expect((await client.request('agents.list', {})).drivers[0]!.version).toBeNull();
    const probesBefore = driver.probes;
    const { run } = await client.request('agents.runSetup', { driverId: 'codex', action: 'install', kind: 'brew', commandId: newId('cmd') });
    expect(run).toMatchObject({ state: 'running', command: `sh ${path.join(dir, 'install-ok.sh')}`, action: 'install', kind: 'brew' });
    const done = await finished(run.runId);
    expect(done).toMatchObject({ state: 'completed', exitCode: 0, error: null });
    expect(done.output.filter((line) => line.startsWith('==>'))).toEqual(['==> 下载', '==> 完成']);
    expect(done.output).toContain('警告');
    expect(driver.probes).toBeGreaterThan(probesBefore);
    // 收到终态时缓存已经是新的探测结果。
    expect((await client.request('agents.list', {})).drivers[0]!.version).toBe('2.0.0');
  });

  it('升级失败：非 0 退出码与输出（含 stderr）', async () => {
    const { run } = await client.request('agents.runSetup', { driverId: 'codex', action: 'upgrade', kind: 'brew', commandId: newId('cmd') });
    expect(run.command).toBe(`sh ${path.join(dir, 'upgrade-fail.sh')}`);
    const done = await finished(run.runId);
    expect(done).toMatchObject({ state: 'failed', exitCode: 7 });
    expect([...done.output].sort()).toEqual(['Password:', 'sudo: a terminal is required']);
  });

  it('取消：运行中的命令被结束，状态为 cancelled；同一个 Agent 运行中再起一次为 busy；同一个 commandId 返回同一次', async () => {
    const commandId = newId('cmd');
    const { run } = await client.request('agents.runSetup', { driverId: 'codex', action: 'install', kind: 'npm', commandId });
    await until(() => mirror.runs.find((r) => r.runId === run.runId)?.output.includes('start'));
    const again = await client.request('agents.runSetup', { driverId: 'codex', action: 'install', kind: 'npm', commandId });
    expect(again.run.runId).toBe(run.runId);
    expect((await rejection(client.request('agents.runSetup', { driverId: 'codex', action: 'install', kind: 'brew', commandId: newId('cmd') }))).code).toBe('busy');
    expect(await client.request('agents.cancelSetup', { runId: run.runId })).toEqual({ status: 'requested' });
    const done = await finished(run.runId);
    expect(done.state).toBe('cancelled');
    expect(done.output).not.toContain('never');
    expect(await client.request('agents.cancelSetup', { runId: run.runId })).toEqual({ status: 'not-running' });
    expect((await rejection(client.request('agents.cancelSetup', { runId: 'setup_nope' }))).code).toBe('not-found');
  });

  it('script 类、探测里没有的方式、参数里夹带命令：都拒绝，不运行', async () => {
    const script = await rejection(client.request('agents.runSetup', { driverId: 'codex', action: 'install', kind: 'script', commandId: newId('cmd') }));
    expect(script.code).toBe('invalid-request');
    // 只注册了 codex。
    expect((await rejection(client.request('agents.runSetup', { driverId: 'claude', action: 'install', kind: 'brew', commandId: newId('cmd') }))).code).toBe(
      'driver-unavailable',
    );
    const unknownKind = await rejection(
      client.request('agents.runSetup', { driverId: 'codex', action: 'install', kind: 'pip' as 'brew', commandId: newId('cmd') }),
    );
    expect(unknownKind.code).toBe('invalid-request');
    const smuggled = await rejection(
      client.request('agents.runSetup', {
        driverId: 'codex',
        action: 'install',
        kind: 'brew',
        commandId: newId('cmd'),
        command: 'rm -rf ~',
      } as never),
    );
    expect(smuggled.code).toBe('invalid-request');
    expect(mirror.runs).toEqual([]);
  });

  it('探测结果里没有这种方式时 invalid-request', async () => {
    const original = driver.probe.bind(driver);
    driver.probe = async () => ({ ...(await original()), install: [] });
    await detect();
    const error = await rejection(client.request('agents.runSetup', { driverId: 'codex', action: 'upgrade', kind: 'brew', commandId: newId('cmd') }));
    expect(error.code).toBe('invalid-request');
  });

  it('openTerminal：登录用 loginCommand，安装与升级按 kind 取命令（script 类也可以），打不开时 unsupported 并带回命令', async () => {
    expect(await client.request('agents.openTerminal', { driverId: 'codex', action: 'login' })).toEqual({ status: 'opened', command: 'fake login' });
    expect(await client.request('agents.openTerminal', { driverId: 'codex', action: 'install', kind: 'script' })).toEqual({
      status: 'opened',
      command: 'curl -fsSL https://example.invalid/install.sh | bash',
    });
    expect(await client.request('agents.openTerminal', { driverId: 'codex', action: 'upgrade', kind: 'brew' })).toMatchObject({ status: 'opened' });
    expect(terminal).toEqual(['fake login', 'curl -fsSL https://example.invalid/install.sh | bash', `sh ${path.join(dir, 'upgrade-fail.sh')}`]);

    terminalStatus = 'unsupported';
    expect(await client.request('agents.openTerminal', { driverId: 'codex', action: 'login' })).toEqual({ status: 'unsupported', command: 'fake login' });

    expect((await rejection(client.request('agents.openTerminal', { driverId: 'codex', action: 'upgrade' }))).code).toBe('invalid-request');
    const original = driver.probe.bind(driver);
    driver.probe = async () => ({ ...(await original()), loginCommand: null });
    await detect();
    expect((await rejection(client.request('agents.openTerminal', { driverId: 'codex', action: 'login' }))).code).toBe('invalid-request');
  });

  it('Runtime 停止时结束还在运行的命令', async () => {
    const { run } = await client.request('agents.runSetup', { driverId: 'codex', action: 'upgrade', kind: 'npm', commandId: newId('cmd') });
    await until(() => mirror.runs.find((r) => r.runId === run.runId)?.output.includes('start'));
    const started = Date.now();
    await runtime.close();
    expect(Date.now() - started).toBeLessThan(6000);
  });
});
