import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { ModelServiceStore } from '@baocut/models';
import { FileCredentialStore, SettingsStore, readJson, resolveRuntimeHome, writeJsonAtomic } from '@baocut/runtime-storage';
import { LegacyUpgrade } from './legacy-upgrade.ts';
import { legacyRoots, readLegacySource } from './legacy-upgrade-sources.ts';
import { importLegacyCloud } from './legacy-upgrade-cloud.ts';
import { importLegacySettings } from './legacy-upgrade-settings.ts';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-upgrade-test-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const secret = 'sk-fixture-legacy-key-123456';
async function setup() {
  const root = path.join(dir, 'legacy');
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'new') });
  const log = silentLogger;
  await writeJsonAtomic(path.join(root, 'config.json'), {
    values: { 'models.dir': path.join(dir, 'models'), 'download.dir': path.join(dir, 'downloads') },
  });
  await writeJsonAtomic(path.join(root, 'app-v2-settings.json'), { language: 'ja', appAutoUpdate: false });
  await writeJsonAtomic(path.join(root, 'secrets.json'), { openai: { fields: { apiKey: secret } } });
  await writeJsonAtomic(path.join(root, 'projects', 'old', 'doc.json'), { words: [] });
  const models = await ModelServiceStore.open(home, new FileCredentialStore(home.modelCredentialsFile));
  const openProject = vi.fn(async () => {});
  return { root, home, log, models, openProject, deps: { models, engine: '/fixture/engine', openProject, env: async () => ({}) } };
}
async function finish(upgrade: LegacyUpgrade) {
  await vi.waitFor(() => expect(upgrade.active).toBe(false));
}

describe('legacy startup upgrade', () => {
  it('isolates custom homes and discovers platform-specific roots', () => {
    expect(legacyRoots({ BAOCUT_HOME: '/test' }, 'darwin', '/user')).toEqual([]);
    expect(legacyRoots({ BAOCUT_HOME: '/user/.baocut' }, 'darwin', '/user')).toEqual(legacyRoots({}, 'darwin', '/user'));
    expect(legacyRoots({ APPDATA: 'C:\\Users\\Jim\\AppData\\Roaming' }, 'win32', 'C:\\Users\\Jim')).toEqual([
      'C:\\Users\\Jim\\AppData\\Roaming\\bcut',
      'C:\\Users\\Jim\\AppData\\Roaming\\BaoCut',
    ]);
    expect(legacyRoots({}, 'linux', '/user')).toEqual(['/user/.config/bcut']);
    expect(legacyRoots({}, 'darwin', '/user')).toContain('/user/Library/Application Support/BaoCut/cli');
    expect(legacyRoots({ BAOCUT_HOME: '/test', BAOCUT_LEGACY_ROOT: '/old' }, 'darwin', '/user')).toEqual(['/old']);
  });
  it.skipIf(process.platform === 'win32')('imports settings, secrets and projects once, leaving source bytes untouched', async () => {
    const s = await setup();
    const original = await fs.readFile(path.join(s.root, 'secrets.json'), 'utf8');
    const importProject = vi.fn(async (_request: { version: number }) => {});
    const options = { ...s, roots: [s.root], v1Preferences: null, importProject, platform: 'darwin' as const };
    const first = new LegacyUpgrade(options);
    await first.prepare();
    first.start(s.deps);
    await finish(first);
    const settings = new SettingsStore(s.home.settingsFile);
    await settings.load();
    expect(settings.get('models.dir')).toBe(path.join(dir, 'models'));
    expect(settings.get('downloads.directory')).toBe(path.join(dir, 'downloads'));
    expect(settings.get('ui.language')).toBe('ja');
    expect(settings.get('updates.autoDownload')).toBe(false);
    expect(await s.models.credential('openai')).toBe(secret);
    expect(importProject).toHaveBeenCalledTimes(1);
    expect(importProject.mock.calls[0]?.[0]).toMatchObject({ version: 1 });
    const marker = await fs.readFile(path.join(s.home.root, 'store', 'legacy-upgrade.json'), 'utf8');
    expect(marker).not.toContain(secret);
    expect(marker).toContain('"complete": true');
    expect(await fs.readFile(path.join(s.root, 'secrets.json'), 'utf8')).toBe(original);
    await settings.set({ 'downloads.directory': null });
    const again = new LegacyUpgrade(options);
    await again.prepare();
    again.start(s.deps);
    await finish(again);
    expect(importProject).toHaveBeenCalledTimes(1);
    await settings.load();
    expect(settings.get('downloads.directory')).toBeNull();
  });
  it.skipIf(process.platform === 'win32')('retries only failures and preserves existing settings and credentials', async () => {
    const s = await setup();
    const settings = new SettingsStore(s.home.settingsFile);
    await settings.load();
    await settings.set({ 'models.dir': '/current/models' });
    await s.models.updateProvider('openai', { credential: 'current-key', enabled: false });
    await writeJsonAtomic(path.join(s.root, 'projects', 'v2', 'project.json'), { title: 'v2' });
    let fail = true;
    const importProject = vi.fn(async (request: { version: number }) => {
      if (request.version === 1 && fail) throw new Error('failure');
    });
    const options = { ...s, roots: [s.root], v1Preferences: null, importProject, platform: 'darwin' as const };
    const first = new LegacyUpgrade(options);
    await first.prepare();
    first.start(s.deps);
    await finish(first);
    expect(importProject).toHaveBeenCalledTimes(2);
    const markerFile = path.join(s.home.root, 'store', 'legacy-upgrade.json');
    expect((await readJson<any>(markerFile)).sources[s.root].complete).toBeUndefined();
    fail = false;
    const again = new LegacyUpgrade(options);
    await again.prepare();
    again.start(s.deps);
    await finish(again);
    expect(importProject).toHaveBeenCalledTimes(3);
    await settings.load();
    expect(settings.get('models.dir')).toBe('/current/models');
    expect(await s.models.accountCredential('openai', 'main')).toBe('current-key');
    expect(s.models.provider('openai')?.enabled).toBe(false);
    expect((await readJson<any>(markerFile)).sources[s.root].complete).toBe(true);
  });
  it('discovers external registry paths, configured roots and v2 over archived v1', async () => {
    const s = await setup();
    const external = path.join(dir, 'external');
    await writeJsonAtomic(path.join(external, 'project.json'), { title: 'outside' });
    await writeJsonAtomic(path.join(s.root, 'projects.json'), { projects: [{ id: 'outside', path: external }] });
    const source = await readLegacySource(s.root);
    expect(source?.projects.map((p) => p.path)).toContain(external);
  });
  it('maps v1 paths and locale without overriding v2 values', async () => {
    const s = await setup();
    const settings = new SettingsStore(s.home.settingsFile);
    await settings.load();
    const source = (await readLegacySource(s.root))!;
    source.config = {};
    source.preferences = {};
    await importLegacySettings(settings, source, { 'vk-models-dir': '~/models', 'vk-url-savedir': '/old/downloads', 'vk-lang': 'zh-TW' });
    expect(settings.get('ui.language')).toBe('zh-Hant');
    expect(settings.get('models.dir')).toBe(path.join(os.homedir(), 'models'));
  });
  it('reads the old macOS vault, defers denied credentials, and never leaks secrets', async () => {
    const s = await setup();
    await fs.rm(path.join(s.root, 'secrets.json'));
    await writeJsonAtomic(path.join(s.root, 'key-masks.json'), { keys: { openai: {}, anthropic: {} } });
    const source = (await readLegacySource(s.root))!;
    const checkpoint = vi.fn(async () => {});
    const keychain = vi.fn(async (_service: string, account: string) => {
      if (account === '__provider-vault-v1') return { providers: { openai: { fields: { apiKey: secret } } } };
      throw new Error(secret);
    });
    const result = await importLegacyCloud(source, s.models, [], checkpoint, { platform: 'darwin', keychain });
    expect(result.done).toEqual(['openai']);
    expect(result.pending).toEqual(['anthropic']);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(await s.models.credential('openai')).toBe(secret);
  });
});

it('reads TOML settings with JSON taking precedence', async () => {
  const s = await setup();
  await fs.writeFile(
    path.join(s.root, 'config.toml'),
    '[models]\ndir = "/toml/models"\n[download]\ndir = "/toml/downloads"\n[llm]\ndefault = "provider:openai/gpt-fixture"\n',
  );
  const source = (await readLegacySource(s.root))!;
  expect(source.config['models.dir']).toBe(path.join(dir, 'models'));
  expect(source.config['llm.default']).toBe('provider:openai/gpt-fixture');
});

it('imports a custom cloud endpoint and the default model without making API calls', async () => {
  const s = await setup();
  const source = (await readLegacySource(s.root))!;
  source.config['llm.providers.acme.baseUrl'] = 'http://127.0.0.1:9999/v1';
  source.config['llm.default'] = 'provider:acme/my-model · legacy label';
  source.cloud.providers = [{ id: 'acme', sdk: 'OpenAiCompatible', name: 'My endpoint', models: [{ id: 'my-model', kind: 'llm' }] }];
  await writeJsonAtomic(path.join(s.root, 'secrets.json'), { acme: { fields: { apiKey: secret } } });
  const result = await importLegacyCloud(source, s.models, [], async () => {}, { allowKeychain: false });
  expect(result.pending).toEqual([]);
  expect(s.models.provider('custom:acme')?.endpoint).toBe('http://127.0.0.1:9999/v1');
  expect(s.models.getDefault('generateText')).toEqual({ providerId: 'custom:acme', modelId: 'my-model' });
});

it.skipIf(
  !existsSync(process.env.BAOCUT_ENGINE_HOST ?? path.resolve(`target/debug/engine-host${process.platform === 'win32' ? '.exe' : ''}`)),
)(
  'wires startup migration into the real Runtime and reopens without reimporting',
  async () => {
    const { startRuntime } = await import('./runtime.ts');
    const { root, home } = await setup();
    await fs.rm(path.join(root, 'projects'), { recursive: true });
    await writeJsonAtomic(path.join(root, 'projects', 'blank', 'project.json'), { formatVersion: '0.1', title: 'Imported title' });
    vi.stubEnv('BAOCUT_LEGACY_ROOT', root);
    vi.stubEnv('BAOCUT_HOME', home.root);
    const engine = process.env.BAOCUT_ENGINE_HOST ?? path.resolve(`target/debug/engine-host${process.platform === 'win32' ? '.exe' : ''}`);
    await fs.access(engine);
    for (let i = 0; i < 2; i++) {
      const runtime = await startRuntime({ home, drivers: () => [], modelWorker: null, engineHost: engine, watchSpace: false });
      try {
        await vi.waitFor(
          async () => {
            const marker = await readJson<any>(path.join(home.root, 'store', 'legacy-upgrade.json'));
            expect(marker.sources[root].complete).toBe(true);
          },
          { timeout: 15_000 },
        );
        expect(runtime.harness.listProjects()).toHaveLength(1);
        expect(runtime.harness.listProjects()[0]?.name).toBe('Imported title');
        expect(runtime.settings.store.get('models.dir')).toBe(path.join(dir, 'models'));
      } finally {
        await runtime.close();
      }
    }
  },
  30_000,
);

it.skipIf(process.platform === 'win32')('cancels an in-flight import without recording completion', async () => {
  const s = await setup();
  let entered = false;
  const upgrade = new LegacyUpgrade({
    ...s,
    roots: [s.root],
    v1Preferences: null,
    platform: 'darwin',
    importProject: async (_request, signal) => {
      entered = true;
      await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    },
  });
  await upgrade.prepare();
  upgrade.start(s.deps);
  await vi.waitFor(() => expect(entered).toBe(true));
  await upgrade.stop();
  const marker = await readJson<any>(path.join(s.home.root, 'store', 'legacy-upgrade.json'));
  expect(marker.sources[s.root].complete).toBeUndefined();
  expect(s.openProject).not.toHaveBeenCalled();
});

it.skipIf(
  !existsSync(process.env.BAOCUT_ENGINE_HOST ?? path.resolve(`target/debug/engine-host${process.platform === 'win32' ? '.exe' : ''}`)),
)(
  'keeps missing-media imports uncommitted so restored media can retry',
  async () => {
    const { runProjectImport } = await import('./legacy-upgrade.ts');
    const source = path.join(dir, 'missing-media');
    const media = path.join(source, 'source.wav');
    await writeJsonAtomic(path.join(source, 'project.json'), {
      formatVersion: '0.1',
      title: 'Missing',
      media: { path: media, kind: 'audio', duration: 1 },
    });
    const request = {
      source,
      version: 2 as const,
      entry: {},
      target: path.join(dir, 'imported'),
      engine: process.env.BAOCUT_ENGINE_HOST ?? path.resolve(`target/debug/engine-host${process.platform === 'win32' ? '.exe' : ''}`),
    };
    await expect(runProjectImport(request, process.env, new AbortController().signal)).rejects.toThrow();
    expect(existsSync(path.join(request.target, 'video', 'video.db'))).toBe(false);
    const wav = Buffer.alloc(44 + 32000);
    wav.write('RIFF');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(32000, 40);
    await fs.writeFile(media, wav);
    await runProjectImport(request, process.env, new AbortController().signal);
    expect(existsSync(path.join(request.target, 'video', 'video.db'))).toBe(true);
  },
  30_000,
);

it('detects legacy data in the default desktop development home without a legacy-root override', async () => {
  vi.spyOn(os, 'homedir').mockReturnValue(dir);
  vi.stubEnv('BAOCUT_HOME', path.join(dir, 'repo', '.dev', 'baocut-home'));
  vi.stubEnv('BAOCUT_LEGACY_ROOT', '');
  vi.stubEnv('BAOCUT_LEGACY_AUTO_DETECT', '1');
  const root = path.join(dir, 'Library', 'Application Support', 'BaoCut');
  const modelsDir = path.join(dir, 'old-models');
  await writeJsonAtomic(path.join(root, 'config.json'), { values: { 'models.dir': modelsDir } });
  await writeJsonAtomic(path.join(root, 'projects', 'v2.bcut', 'project.json'), { title: 'Old project' });
  const home = resolveRuntimeHome(process.env);
  const models = await ModelServiceStore.open(home, new FileCredentialStore(home.modelCredentialsFile));
  const importProject = vi.fn(async () => {});
  for (let i = 0; i < 2; i++) {
    const upgrade = new LegacyUpgrade({ home, log: silentLogger, platform: 'darwin', importProject, allowKeychain: false });
    await upgrade.prepare();
    upgrade.start({ models, engine: 'fixture-engine', openProject: async () => {}, env: async () => ({}) });
    await finish(upgrade);
    const settings = new SettingsStore(home.settingsFile);
    await settings.load();
    expect(settings.get('models.dir')).toBe(modelsDir);
  }
  expect(importProject).toHaveBeenCalledTimes(1);
});

it('keeps an explicit sandbox isolated without the desktop opt-in', () => {
  expect(legacyRoots({ BAOCUT_HOME: '/sandbox' }, 'darwin', '/user')).toEqual([]);
  expect(legacyRoots({ BAOCUT_HOME: '/repo/.dev/baocut-home', BAOCUT_LEGACY_AUTO_DETECT: '1' }, 'darwin', '/user')).toContain(
    '/user/Library/Application Support/BaoCut',
  );
  expect(
    legacyRoots(
      { BAOCUT_HOME: 'D:\\repo\\.dev\\baocut-home', BAOCUT_LEGACY_AUTO_DETECT: '1', APPDATA: 'C:\\Users\\Jim\\AppData\\Roaming' },
      'win32',
      'C:\\Users\\Jim',
    ),
  ).toContain('C:\\Users\\Jim\\AppData\\Roaming\\bcut');
});

it('does not read the project registry or enumerate projects before Runtime readiness', async () => {
  const s = await setup();
  await writeJsonAtomic(path.join(s.root, 'projects', 'old', 'project.json'), { title: 'V2 fixture' });
  await fs.writeFile(path.join(s.root, 'projects.json'), 'invalid JSON that must only be read in background');
  const scan = vi.spyOn(fs, 'readdir');
  const upgrade = new LegacyUpgrade({
    ...s,
    roots: [s.root],
    platform: process.platform,
    v1Preferences: null,
    importProject: async () => {},
  });
  await upgrade.prepare();
  expect(scan).not.toHaveBeenCalled();
  const settings = new SettingsStore(s.home.settingsFile);
  await settings.load();
  expect(settings.get('models.dir')).toBe(path.join(dir, 'models'));
  upgrade.start(s.deps);
  await finish(upgrade);
  const marker = await readJson<any>(path.join(s.home.root, 'store', 'legacy-upgrade.json'));
  expect(marker.sources[s.root].pending).toContain('project-discovery-unavailable');
  expect(marker.complete).toBeUndefined();
});

it('a complete migration reads only its marker, even if old data is changed or corrupted later', async () => {
  const s = await setup();
  await writeJsonAtomic(path.join(s.root, 'projects', 'old', 'project.json'), { title: 'V2 fixture' });
  const missingRoot = path.join(dir, 'never-installed');
  const options = { ...s, roots: [s.root, missingRoot], platform: process.platform, v1Preferences: null, importProject: async () => {} };
  const first = new LegacyUpgrade(options);
  await first.prepare();
  first.start(s.deps);
  await finish(first);
  const markerFile = path.join(s.home.root, 'store', 'legacy-upgrade.json');
  expect((await readJson<any>(markerFile)).complete).toBe(true);
  await fs.writeFile(path.join(s.root, 'config.json'), 'broken old configuration');
  const read = vi.spyOn(fs, 'readFile');
  const scan = vi.spyOn(fs, 'readdir');
  const stat = vi.spyOn(fs, 'stat');
  const again = new LegacyUpgrade(options);
  await again.prepare();
  again.start(s.deps);
  await finish(again);
  expect(read.mock.calls.map(([file]) => String(file))).toEqual([markerFile]);
  expect(scan).not.toHaveBeenCalled();
  expect(stat).not.toHaveBeenCalled();
});

it('retries the cached inventory and does not launch importers for still-missing media', async () => {
  const s = await setup();
  await writeJsonAtomic(path.join(s.root, 'projects', 'old', 'project.json'), { title: 'V2 fixture' });
  const missing = path.join(dir, 'offline.wav');
  const importProject = vi.fn(async (request: { target: string }) => {
    if (!existsSync(missing)) {
      await writeJsonAtomic(path.join(request.target, 'import-report.json'), { assets: { missing: [missing] } });
      throw new Error('offline');
    }
  });
  const options = { ...s, roots: [s.root], platform: process.platform, v1Preferences: null, importProject };
  const run = async () => {
    const upgrade = new LegacyUpgrade(options);
    await upgrade.prepare();
    upgrade.start(s.deps);
    await finish(upgrade);
  };
  await run();
  expect(importProject).toHaveBeenCalledTimes(1);
  const scan = vi.spyOn(fs, 'readdir');
  await fs.writeFile(path.join(s.root, 'projects.json'), 'must not reread a discovered registry');
  await run();
  expect(importProject).toHaveBeenCalledTimes(1);
  expect(scan).not.toHaveBeenCalled();
  await fs.writeFile(missing, 'restored');
  await run();
  expect(importProject).toHaveBeenCalledTimes(2);
});

it('waits for user jobs and can stop promptly without starting project discovery', async () => {
  const s = await setup();
  await writeJsonAtomic(path.join(s.root, 'projects', 'old', 'project.json'), { title: 'V2 fixture' });
  const scan = vi.spyOn(fs, 'readdir');
  const importProject = vi.fn(async () => {});
  const upgrade = new LegacyUpgrade({ ...s, roots: [s.root], platform: process.platform, v1Preferences: null, importProject });
  await upgrade.prepare();
  upgrade.start({ ...s.deps, isBusy: () => true });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(scan).not.toHaveBeenCalled();
  expect(importProject).not.toHaveBeenCalled();
  await upgrade.stop();
  expect(upgrade.active).toBe(false);
});
