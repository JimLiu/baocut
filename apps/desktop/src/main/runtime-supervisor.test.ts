import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { M } from './main-copy.ts';
import { RuntimeSupervisor } from './runtime-supervisor.ts';
import { STOP_MESSAGE } from './stop-child.ts';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), readDiscovery: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('@baocut/runtime-storage', async (original) => ({
  ...(await original<typeof import('@baocut/runtime-storage')>()),
  readDiscovery: mocks.readDiscovery,
  isProcessAlive: () => true,
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

const DISCOVERY = { pid: 123, endpoint: 'ws://127.0.0.1:1', token: 'fixture-token' };

function supervisorFor(home: RuntimeHome, legacyAutoDetect = false) {
  return new RuntimeSupervisor({
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

/** 报告就绪的 Runtime 子进程；收到停止消息就退出。 */
function fakeRuntime() {
  const received: unknown[] = [];
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null,
    connected: true,
    send(message: unknown, callback: (error: Error | null) => void) {
      received.push(message);
      callback(null);
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
