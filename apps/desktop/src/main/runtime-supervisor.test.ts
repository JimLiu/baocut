import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { M } from './main-copy.ts';
import type { FoundRuntimeProbe } from './found-runtime.ts';
import { RuntimeSupervisor, type RuntimeSupervisorOptions } from './runtime-supervisor.ts';
import { STOP_MESSAGE } from './stop-child.ts';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), readDiscovery: vi.fn(), isDiscoveryLive: vi.fn(), isRecordedProcessAlive: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('@baocut/runtime-storage', async (original) => ({
  ...(await original<typeof import('@baocut/runtime-storage')>()),
  readDiscovery: mocks.readDiscovery,
  isDiscoveryLive: mocks.isDiscoveryLive,
  isRecordedProcessAlive: mocks.isRecordedProcessAlive,
}));
beforeEach(() => {
  mocks.isDiscoveryLive.mockResolvedValue(true);
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

const DISCOVERY = { pid: 123, endpoint: 'ws://127.0.0.1:1', token: 'fixture-token' };

function supervisorFor(home: RuntimeHome, legacyAutoDetect = false, extra: Partial<RuntimeSupervisorOptions> = {}) {
  return new RuntimeSupervisor({
    ...extra,
    home,
    legacyAutoDetect,
    script: '/fixture/runtime.js',
    allowedOrigins: [],
    echoLogs: false,
    credentialStore: 'file',
    resources: null,
    downloadsDir: null,
    documentsDir: null,
    systemLanguages: () => ['en'],
  });
}

/** 报告就绪的 Runtime 子进程；收到停止消息就退出，别的消息按 `replies` 回答（没有的不回）。 */
function fakeRuntime(replies: Record<string, object> = {}) {
  const received: unknown[] = [];
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null,
    connected: true,
    send(message: { type: string }, callback: (error: Error | null) => void) {
      received.push(message);
      callback(null);
      const reply = replies[message.type];
      if (reply) setImmediate(() => child.emit('message', reply));
      if (message.type !== STOP_MESSAGE.type) return true;
      setImmediate(() => {
        child.exitCode = 0;
        child.connected = false;
        child.emit('exit', 0, null);
      });
      return true;
    },
    kill: vi.fn(),
  });
  setImmediate(() => child.stdout.write('{"type":"ready"}\n'));
  return { child, received };
}

it.each([true, false].flatMap((enabled) => [
  {},
  { BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-development-home') },
  { BAOCUT_PROJECTS_DIR: path.join(os.tmpdir(), 'desktop-custom-projects') },
].map((env) => ({ enabled, env }))))('passes home paths and historical detection intent: $enabled, $env', async ({ enabled, env }) => {
  vi.stubEnv('BAOCUT_LEGACY_AUTO_DETECT', '');
  const home = resolveRuntimeHome(env);
  mocks.readDiscovery.mockResolvedValueOnce(null).mockResolvedValue(DISCOVERY);
  mocks.spawn.mockImplementation(() => fakeRuntime().child);
  const supervisor = supervisorFor(home, enabled);
  await supervisor.connection();
  const options = mocks.spawn.mock.calls[0]![2];
  expect(options.env.BAOCUT_HOME).toBe(home.root);
  expect(options.env.BAOCUT_PROJECTS_DIR).toBe(home.projectsDir);
  expect(resolveRuntimeHome(options.env).projectsDir).toBe(home.projectsDir);
  expect(options.env.BAOCUT_LEGACY_AUTO_DETECT).toBe(enabled ? '1' : '');
});

it('starts a new Runtime when the discovery file points at one that is gone', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-stale-home') });
  // 重启前留下的发现文件：PID 被别的进程复用，端点没有人监听。
  const stale = { pid: 898, endpoint: 'ws://127.0.0.1:2', token: 'stale-token' };
  mocks.readDiscovery.mockResolvedValueOnce(stale).mockResolvedValue(DISCOVERY);
  mocks.isDiscoveryLive.mockImplementation(async (discovery: { pid: number }) => discovery.pid !== stale.pid);
  mocks.spawn.mockImplementation(() => fakeRuntime().child);
  const supervisor = supervisorFor(home);
  await expect(supervisor.connection()).resolves.toEqual({ endpoint: DISCOVERY.endpoint, token: DISCOVERY.token });
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
});

it('reports a failure instead of returning a dead endpoint when the new Runtime defers to it', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-stale-home') });
  const stale = { pid: 898, endpoint: 'ws://127.0.0.1:2', token: 'stale-token' };
  mocks.readDiscovery.mockResolvedValue(stale);
  mocks.isDiscoveryLive.mockResolvedValue(false);
  // 退出码 3：新 Runtime 认为实例锁还被占着。
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough() });
    setImmediate(() => child.emit('exit', 3, null));
    return child;
  });
  await expect(supervisorFor(home).connection()).rejects.toThrow(M.runtimeNoDiscovery);
});

it('does not start another Runtime once quitting has begun', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-quit-home') });
  const runtime = fakeRuntime();
  mocks.spawn.mockReturnValueOnce(runtime.child);
  mocks.readDiscovery.mockResolvedValueOnce(null).mockResolvedValueOnce(DISCOVERY);
  const supervisor = supervisorFor(home);
  await expect(supervisor.connection()).resolves.toEqual({ endpoint: DISCOVERY.endpoint, token: DISCOVERY.token });

  await supervisor.stop();
  expect(runtime.received).toEqual([STOP_MESSAGE]);
  // 自己的 Runtime 停了、发现文件没了；窗口还开着，界面按重连退避再来要连接。
  mocks.readDiscovery.mockResolvedValue(null);
  await expect(supervisor.connection()).rejects.toThrow(M.runtimeQuitting);
  await expect(supervisor.connection()).rejects.toThrow(M.runtimeQuitting);
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
});

it('does not start a Runtime when quitting begins while the discovery file is being read', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-quit-home') });
  let finishRead!: (value: null) => void;
  mocks.readDiscovery.mockReturnValueOnce(new Promise((resolve) => (finishRead = resolve)));
  const supervisor = supervisorFor(home);
  const pending = supervisor.connection();
  await supervisor.stop();
  finishRead(null);
  await expect(pending).rejects.toThrow(M.runtimeQuitting);
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it('does not start a Runtime after quitting even when it used someone else’s Runtime', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-quit-home') });
  mocks.readDiscovery.mockResolvedValueOnce(DISCOVERY).mockResolvedValue(null);
  const supervisor = supervisorFor(home);
  await supervisor.connection();
  await supervisor.stop();
  await expect(supervisor.connection()).rejects.toThrow(M.runtimeQuitting);
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it('asks its own Runtime about running work and leaves it running in the background on request', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-quit-home') });
  const remote = [{ kind: 'transcribe', provider: 'OpenAI' }, { kind: null, provider: 'Codex', step: { label: 'Translate' } }];
  const runtime = fakeRuntime({ status: { type: 'status', jobs: 1, tasks: 2, remote: [...remote, { kind: 3 }] }, detach: { type: 'detached' } });
  mocks.spawn.mockReturnValueOnce(runtime.child);
  mocks.readDiscovery.mockResolvedValueOnce(null).mockResolvedValue(DISCOVERY);
  const supervisor = supervisorFor(home);
  await supervisor.connection();

  // 认不得的远端调用丢掉。
  await expect(supervisor.activeWork()).resolves.toEqual({ jobs: 1, tasks: 2, remote });
  await supervisor.detach();
  await supervisor.stop();
  // 放手之后不再请它停，也不再拉起新的。
  expect(runtime.received).toEqual([{ type: 'status' }, { type: 'detach' }]);
  await expect(supervisor.connection()).rejects.toThrow(M.runtimeQuitting);
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
});

it('knows no running work for someone else’s Runtime or one that does not answer', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-quit-home') });
  mocks.readDiscovery.mockResolvedValue(DISCOVERY);
  const foreign = supervisorFor(home);
  await foreign.connection();
  await expect(foreign.activeWork()).resolves.toBeNull();

  const runtime = fakeRuntime();
  mocks.spawn.mockReturnValueOnce(runtime.child);
  mocks.readDiscovery.mockReset().mockResolvedValueOnce(null).mockResolvedValue(DISCOVERY);
  const silent = supervisorFor(home);
  await silent.connection();
  await expect(silent.activeWork(10)).resolves.toBeNull();
  await silent.stop();
  expect(runtime.received).toEqual([{ type: 'status' }, STOP_MESSAGE]);
});

it('tells its own Runtime when the Bot background service is resident, also one started later', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-resident-home') });
  // Before any Runtime: remembered, sent once it is up.
  const runtime = fakeRuntime();
  mocks.spawn.mockReturnValueOnce(runtime.child);
  mocks.readDiscovery.mockResolvedValueOnce(null).mockResolvedValue(DISCOVERY);
  const supervisor = supervisorFor(home);
  supervisor.setResident(true);
  expect(supervisor.resident).toBe(true);
  await supervisor.connection();
  expect(runtime.received).toEqual([{ type: 'resident', on: true }]);
  supervisor.setResident(false);
  expect(runtime.received).toEqual([{ type: 'resident', on: true }, { type: 'resident', on: false }]);
  await supervisor.stop();

  // Someone else's Runtime has no channel: nothing to send, no error.
  mocks.readDiscovery.mockReset().mockResolvedValue(DISCOVERY);
  const foreign = supervisorFor(home);
  await foreign.connection();
  expect(() => foreign.setResident(true)).not.toThrow();
});

// ---- 同一个 Home 上版本不同的 Runtime（CLI 独立使用与发布 §4.2、§4.3）----

const OWN = { runtimeVersion: '0.5.0', protocolVersion: '0.6', interfaceVersion: '2', build: 'new1234' };
const IDENTITY = { own: OWN, entry: '/Applications/BaoCut.app' };
const IDLE = { connections: { desktop: 0, cli: 0, agent: 0 }, activeJobs: 0 };
const OLD_CLI = { ...DISCOVERY, pid: 456, startedAt: '2026-11-08T00:00:00.000Z', ...OWN, build: 'old1234', launchedBy: 'cli', entry: IDENTITY.entry };
const OWN_DISCOVERY = { ...DISCOVERY, endpoint: 'ws://127.0.0.1:3', token: 'own-token' };

function fakeProbe(overrides: Partial<FoundRuntimeProbe> = {}) {
  return {
    activity: vi.fn<FoundRuntimeProbe['activity']>().mockResolvedValue(IDLE),
    mismatch: vi.fn<FoundRuntimeProbe['mismatch']>().mockResolvedValue({ activeJobs: null, activity: null }),
    signal: vi.fn<FoundRuntimeProbe['signal']>().mockReturnValue(true),
    stop: vi.fn<FoundRuntimeProbe['stop']>().mockResolvedValue(true),
    ...overrides,
  };
}

it('reuses a Runtime of the same version without asking it anything', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-reuse-home') });
  mocks.readDiscovery.mockResolvedValue({ ...OLD_CLI, build: OWN.build });
  const probe = fakeProbe();
  await expect(supervisorFor(home, false, { identity: IDENTITY, probe }).connection()).resolves.toEqual({ endpoint: DISCOVERY.endpoint, token: DISCOVERY.token });
  expect(probe.activity).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it('replaces an idle CLI Runtime of another build with its own', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-replace-home') });
  // 请它停下后它很快退出；之后发现文件指向自己拉起的那个。
  mocks.readDiscovery.mockResolvedValueOnce(OLD_CLI).mockResolvedValue(OWN_DISCOVERY);
  mocks.isRecordedProcessAlive.mockReturnValueOnce(true).mockReturnValue(false);
  mocks.spawn.mockImplementation(() => fakeRuntime().child);
  const probe = fakeProbe();
  await expect(supervisorFor(home, false, { identity: IDENTITY, probe }).connection()).resolves.toEqual({
    endpoint: OWN_DISCOVERY.endpoint,
    token: OWN_DISCOVERY.token,
  });
  expect(probe.stop).toHaveBeenCalledWith({ endpoint: OLD_CLI.endpoint, token: OLD_CLI.token });
  expect(mocks.isRecordedProcessAlive).toHaveBeenCalledWith(OLD_CLI.pid, OLD_CLI.startedAt);
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
});

it('uses a busy CLI Runtime of another version for now and replaces it once it is idle', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-until-idle-home') });
  mocks.readDiscovery.mockResolvedValue(OLD_CLI);
  mocks.isRecordedProcessAlive.mockReturnValue(false);
  mocks.spawn.mockImplementation(() => {
    mocks.readDiscovery.mockResolvedValue(OWN_DISCOVERY);
    return fakeRuntime().child;
  });
  const probe = fakeProbe({ activity: vi.fn<FoundRuntimeProbe['activity']>().mockResolvedValueOnce({ ...IDLE, activeJobs: 1 }).mockResolvedValue(IDLE) });
  const supervisor = supervisorFor(home, false, { identity: IDENTITY, probe, recheckMs: 5 });
  await expect(supervisor.connection()).resolves.toEqual({ endpoint: OLD_CLI.endpoint, token: OLD_CLI.token });
  expect(probe.stop).not.toHaveBeenCalled();
  // 到点再看：没有任务了，请它停下、拉起自己的；界面断线后来要连接，拿到的是新的。
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
  await expect(supervisor.connection()).resolves.toEqual({ endpoint: OWN_DISCOVERY.endpoint, token: OWN_DISCOVERY.token });
  expect(probe.stop).toHaveBeenCalledTimes(1);
  await supervisor.stop();
});

it('keeps using a Runtime the app did not replace when it refuses to stop', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-refused-home') });
  mocks.readDiscovery.mockResolvedValue(OLD_CLI);
  const probe = fakeProbe({ stop: vi.fn<FoundRuntimeProbe['stop']>().mockResolvedValue(false) });
  const supervisor = supervisorFor(home, false, { identity: IDENTITY, probe, recheckMs: 60_000 });
  await expect(supervisor.connection()).resolves.toEqual({ endpoint: OLD_CLI.endpoint, token: OLD_CLI.token });
  expect(mocks.spawn).not.toHaveBeenCalled();
  await supervisor.stop();
});

it('waits for a CLI Runtime with another protocol version instead of connecting', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-wait-home') });
  const older = { ...OLD_CLI, protocolVersion: '0.5', runtimeVersion: '0.4.0' };
  mocks.readDiscovery.mockResolvedValue(older);
  const probe = fakeProbe({
    mismatch: vi.fn<FoundRuntimeProbe['mismatch']>().mockResolvedValue({ activeJobs: 2, activity: { ...IDLE, activeJobs: 2 } }),
  });
  const supervisor = supervisorFor(home, false, { identity: IDENTITY, probe });
  await expect(supervisor.connection()).rejects.toThrow(M.runtimeOlderCliBusy('0.4.0', 2));
  expect(probe.activity).not.toHaveBeenCalled();
  expect(probe.stop).not.toHaveBeenCalled();
  expect(probe.signal).not.toHaveBeenCalled();
  // 它做完、空闲退出了：下一次要连接时拉起自己的。
  mocks.readDiscovery.mockResolvedValueOnce(null).mockResolvedValue(OWN_DISCOVERY);
  mocks.spawn.mockImplementation(() => fakeRuntime().child);
  await expect(supervisor.connection()).resolves.toEqual({ endpoint: OWN_DISCOVERY.endpoint, token: OWN_DISCOVERY.token });
  await supervisor.stop();
});

it('signals an idle CLI Runtime with another protocol version to stop and starts its own (CLI standalone §4.3)', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-mismatch-replace-home') });
  const older = { ...OLD_CLI, protocolVersion: '0.5', runtimeVersion: '0.4.0' };
  mocks.readDiscovery.mockResolvedValueOnce(older).mockResolvedValue(OWN_DISCOVERY);
  mocks.isRecordedProcessAlive.mockReturnValueOnce(true).mockReturnValue(false);
  mocks.spawn.mockImplementation(() => fakeRuntime().child);
  // 握手的拒绝里只有桌面端的连接（界面连过它）：不算在用。
  const probe = fakeProbe({
    mismatch: vi.fn<FoundRuntimeProbe['mismatch']>().mockResolvedValue({ activeJobs: 0, activity: { ...IDLE, connections: { ...IDLE.connections, desktop: 1 } } }),
  });
  const supervisor = supervisorFor(home, false, { identity: IDENTITY, probe });
  await expect(supervisor.connection()).resolves.toEqual({ endpoint: OWN_DISCOVERY.endpoint, token: OWN_DISCOVERY.token });
  expect(probe.signal).toHaveBeenCalledWith(older.pid, older.startedAt);
  expect(probe.stop).not.toHaveBeenCalled();
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  await supervisor.stop();
});

it('does not stop a CLI Runtime with another protocol version that another CLI still uses, nor report it as 0 tasks', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-mismatch-busy-home') });
  mocks.readDiscovery.mockResolvedValue({ ...OLD_CLI, protocolVersion: '0.5', runtimeVersion: '0.4.0' });
  const mismatch = vi.fn<FoundRuntimeProbe['mismatch']>().mockResolvedValue({ activeJobs: 0, activity: { ...IDLE, connections: { ...IDLE.connections, cli: 1 } } });
  const probe = fakeProbe({ mismatch });
  const supervisor = supervisorFor(home, false, { identity: IDENTITY, probe });
  await expect(supervisor.connection()).rejects.toThrow(M.runtimeOlderCliBusy('0.4.0', null));
  // 问不到忙闲（旧版没报）时也不停。
  mismatch.mockResolvedValue({ activeJobs: null, activity: null });
  await expect(supervisor.connection()).rejects.toThrow(M.runtimeOlderCliBusy('0.4.0', null));
  expect(probe.signal).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it('hands a Runtime with another protocol version that the CLI did not launch to the interface as before', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-incompatible-home') });
  mocks.readDiscovery.mockResolvedValue({ ...OLD_CLI, protocolVersion: '0.5', launchedBy: null });
  const probe = fakeProbe();
  await expect(supervisorFor(home, false, { identity: IDENTITY, probe }).connection()).resolves.toEqual({ endpoint: OLD_CLI.endpoint, token: OLD_CLI.token });
  expect(probe.stop).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it('before an update, stops an idle CLI Runtime started from this app and leaves others alone', async () => {
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-update-home') });
  mocks.isRecordedProcessAlive.mockReturnValue(false);
  const probe = fakeProbe();
  mocks.readDiscovery.mockResolvedValue({ ...OLD_CLI, build: OWN.build });
  await expect(supervisorFor(home, false, { identity: IDENTITY, probe }).releaseForUpdate()).resolves.toBe(true);
  expect(probe.stop).toHaveBeenCalledTimes(1);

  // 别处的安装、桌面端拉起的、没有 Runtime：不涉及。
  for (const found of [{ ...OLD_CLI, entry: '/Users/me/BaoCut-cli' }, { ...OLD_CLI, launchedBy: null }, null]) {
    mocks.readDiscovery.mockResolvedValue(found);
    await expect(supervisorFor(home, false, { identity: IDENTITY, probe }).releaseForUpdate()).resolves.toBeNull();
  }
  expect(probe.stop).toHaveBeenCalledTimes(1);

  // 它有任务或别的连接，不答应：照旧安装。
  mocks.readDiscovery.mockResolvedValue({ ...OLD_CLI, build: OWN.build });
  const refusing = fakeProbe({ stop: vi.fn<FoundRuntimeProbe['stop']>().mockResolvedValue(false) });
  await expect(supervisorFor(home, false, { identity: IDENTITY, probe: refusing }).releaseForUpdate()).resolves.toBe(false);
});

