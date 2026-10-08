import { importLegacySettings } from './legacy-upgrade-settings.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ModelServiceStore } from '@baocut/models';
import { FileCredentialStore, SettingsStore, readJson, resolveRuntimeHome, writeJsonAtomic } from '@baocut/runtime-storage';
import { silentLogger } from '@baocut/harness';
import { legacyPath, legacyProjectVersion, legacyRoots, readLegacySource } from './legacy-upgrade-sources.ts';
import { importLegacyCloud } from './legacy-upgrade-cloud.ts';
import { LegacyUpgrade } from './legacy-upgrade.ts';
import { readLegacyWindowsCredential } from './legacy-upgrade-windows.ts';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-win-upgrade-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
const KEY = 'fixture-windows-api-key';

it('uses Windows drive, UNC and custom-root semantics on every test host', () => {
  const user = 'C:\\Users\\Jim';
  const env = { APPDATA: user + '\\AppData\\Roaming', BAOCUT_HOME: 'c:\\users\\jim\\.baocut' };
  expect(legacyRoots(env, 'win32', user)).toEqual([env.APPDATA + '\\bcut', env.APPDATA + '\\BaoCut']);
  expect(legacyRoots({ ...env, BAOCUT_HOME: 'D:\\sandbox' }, 'win32', user)).toEqual([]);
  expect(legacyRoots({ ...env, BAOCUT_LEGACY_ROOT: 'D:\\Old BaoCut' }, 'win32', user)).toEqual(['D:\\Old BaoCut']);
  expect(legacyRoots({}, 'win32', user)).toEqual([]);
  expect(legacyPath('D:\\Video projects', 'C:\\data', user, 'win32')).toBe('D:\\Video projects');
  expect(legacyPath('\\\\nas\\media\\clips', 'C:\\data', user, 'win32')).toBe('\\\\nas\\media\\clips');
  expect(legacyPath('~\\Models', 'C:\\data', user, 'win32')).toBe(user + '\\Models');
  expect(legacyPath('media\\source.wav', 'D:\\project', user, 'win32')).toBe('D:\\project\\media\\source.wav');
});

it('discovers Windows v2 projects and never routes doc.json to the v1 adapter', async () => {
  const root = path.join(dir, 'bcut');
  const v2 = path.join(root, 'projects', 'v2.bcut');
  const v1 = path.join(root, 'projects', 'not-a-windows-project');
  await writeJsonAtomic(path.join(v2, 'project.json'), { title: 'Windows project' });
  await writeJsonAtomic(path.join(v2, 'doc.json'), { words: [] });
  await writeJsonAtomic(path.join(v1, 'doc.json'), { words: [] });
  expect(await legacyProjectVersion(v1, 'win32')).toBeNull();
  expect(await legacyProjectVersion(v1, 'darwin')).toBe(1);
  expect(await legacyProjectVersion(v2, 'win32')).toBe(2);
  const source = await readLegacySource(root, 'win32');
  expect(source?.projects.map((p) => p.path)).toEqual([v2]);
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'new') });
  const models = await ModelServiceStore.open(home, new FileCredentialStore(home.modelCredentialsFile));
  const importProject = vi.fn(async () => {});
  const openProject = vi.fn(async () => {});
  for (let i = 0; i < 2; i++) {
    const upgrade = new LegacyUpgrade({ home, log: silentLogger, roots: [root], platform: 'win32', importProject });
    await upgrade.prepare();
    upgrade.start({ models, engine: 'engine-host.exe', openProject, env: async () => ({}) });
    await vi.waitFor(() => expect(upgrade.active).toBe(false));
  }
  expect(importProject).toHaveBeenCalledTimes(1);
  expect(importProject).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }), expect.any(AbortSignal));
  expect((await readJson<any>(path.join(home.root, 'store', 'legacy-upgrade.json'))).sources[root].complete).toBe(true);
});

it('migrates v2 Credential Manager keys, defers failures, and preserves existing v3 accounts', async () => {
  const root = path.join(dir, 'bcut');
  await writeJsonAtomic(path.join(root, 'key-masks.json'), { keys: { openai: {}, anthropic: {}, gemini: {} } });
  const source = (await readLegacySource(root, 'win32'))!;
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'new') });
  const models = await ModelServiceStore.open(home, new FileCredentialStore(home.modelCredentialsFile));
  await models.updateProvider('google', { enabled: false, credential: 'newer-key' });
  const windowsCredential = vi.fn(async (provider: string) => {
    if (provider === 'anthropic') throw new Error('denied: ' + KEY);
    return { fields: { apiKey: KEY } };
  });
  const keychain = vi.fn(async () => {
    throw new Error('macOS reader must not run');
  });
  const done: string[] = [];
  const result = await importLegacyCloud(
    source,
    models,
    [],
    async (id) => {
      done.push(id);
    },
    { platform: 'win32', windowsCredential, keychain },
  );
  expect(result.pending).toEqual(['anthropic']);
  expect(result.done).toEqual(['openai', 'gemini']);
  expect(await models.credential('openai')).toBe(KEY);
  expect(await models.accountCredential('google', 'main')).toBe('newer-key');
  expect(keychain).not.toHaveBeenCalled();
  expect(windowsCredential).not.toHaveBeenCalledWith('gemini');
  expect(JSON.stringify(result)).not.toContain(KEY);
  windowsCredential.mockResolvedValue({ fields: { apiKey: 'fixed-key' } });
  await importLegacyCloud(source, models, done, async () => {}, { platform: 'win32', windowsCredential });
  expect(await models.credential('anthropic')).toBe('fixed-key');
});

it('uses the helper stdin protocol and sanitizes rejected or malformed secret responses', async () => {
  const helper = path.join(dir, 'helper.cjs');
  await fs.writeFile(
    helper,
    `process.stdin.once('data', (input) => {
    const request = JSON.parse(input);
    if (request.op !== 'legacy-get' || request.key !== 'openai' || process.argv.length !== 3) process.exit(2);
    process.stdout.write(process.argv[2]);
  });`,
  );
  const run = (response: unknown) =>
    readLegacyWindowsCredential('openai', { command: process.execPath, args: [helper, JSON.stringify(response)] });
  expect(await run({ ok: true, secret: JSON.stringify({ fields: { apiKey: KEY } }) })).toEqual({ fields: { apiKey: KEY } });
  expect(await run({ ok: false, error: 'not-found' })).toBeNull();
  await expect(run({ ok: false, error: 'denied', message: KEY })).rejects.toThrow('legacy-credential-unavailable');
  await expect(run({ ok: true, secret: KEY })).rejects.toThrow('legacy-credential-unavailable');
});

it('preserves Windows model directories and UNC download directories through settings validation', async () => {
  const file = path.join(dir, 'settings.json');
  const store = new SettingsStore(file);
  await store.load();
  const source = {
    root: 'C:\\Users\\Jim\\AppData\\Roaming\\bcut',
    config: { 'models.dir': 'D:\\Model cache', 'download.dir': '\\\\nas\\media\\Exports' },
    preferences: {},
    cloud: {},
    projects: [],
  };
  await importLegacySettings(store, source, {}, 'win32');
  await store.load();
  expect(store.get('models.dir')).toBe('D:\\Model cache');
  expect(store.get('downloads.directory')).toBe('\\\\nas\\media\\Exports');
  await expect(store.set({ 'downloads.directory': '\\\\nas' })).rejects.toThrow();
});

it('imports the v2 download folder, but leaves the old default ~/Downloads to the host Downloads folder', async () => {
  const cases: [NodeJS.Platform, string, string, string | null][] = [
    ['win32', 'C:\\Users\\Jim', 'D:\\Videos\\Downie', 'D:\\Videos\\Downie'],
    ['win32', 'C:\\Users\\Jim', '~/Downloads', null],
    ['win32', 'C:\\Users\\Jim', 'c:\\users\\jim\\downloads\\', null],
    ['darwin', '/Users/jim', '/Volumes/ExtremeSSD/Downie', '/Volumes/ExtremeSSD/Downie'],
    ['darwin', '/Users/jim', '~/Downloads', null],
    ['darwin', '/Users/jim', '/Users/jim/Downloads/', null],
    ['darwin', '/Users/jim', '~/Downloads/BaoCut', '/Users/jim/Downloads/BaoCut'],
  ];
  for (const [index, [platform, home, saved, expected]] of cases.entries()) {
    const store = new SettingsStore(path.join(dir, `settings-${index}.json`));
    await store.load();
    const root = platform === 'win32' ? `${home}\\AppData\\Roaming\\BaoCut` : `${home}/Library/Application Support/BaoCut`;
    const source = { root, config: {}, preferences: { 'vk-url-savedir': saved }, cloud: {}, projects: [] };
    const imported = await importLegacySettings(store, source, {}, platform, home);
    await store.load();
    expect(store.get('downloads.directory'), `${platform} ${saved}`).toBe(expected);
    expect(imported.includes('downloads.directory')).toBe(expected !== null);
  }
});
