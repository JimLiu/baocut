import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { RuntimeSupervisor } from './runtime-supervisor.ts';

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

it.each([true, false])('passes historical detection intent to the spawned Runtime: %s', async (enabled) => {
  vi.stubEnv('BAOCUT_LEGACY_AUTO_DETECT', '');
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(os.tmpdir(), 'desktop-development-home') });
  mocks.readDiscovery.mockResolvedValueOnce(null).mockResolvedValue({ pid: 123, endpoint: 'ws://127.0.0.1:1', token: 'fixture-token' });
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough() });
    setImmediate(() => child.stdout.write('{"type":"ready"}\n'));
    return child;
  });
  const supervisor = new RuntimeSupervisor({
    home,
    legacyAutoDetect: enabled,
    script: '/fixture/runtime.js',
    allowedOrigins: [],
    echoLogs: false,
    credentialStore: 'file',
    resources: null,
    downloadsDir: null,
    systemLanguages: () => ['en'],
  });
  await supervisor.connection();
  const options = mocks.spawn.mock.calls[0]![2];
  expect(options.env.BAOCUT_HOME).toBe(home.root);
  expect(options.env.BAOCUT_LEGACY_AUTO_DETECT).toBe(enabled ? '1' : '');
});
