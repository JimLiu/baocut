import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NodeStore, loadShareFile } from '@baocut/nodes';
import { FileCredentialStore, readJson, resolveRuntimeHome, writeJsonAtomic } from '@baocut/runtime-storage';
import { importLegacyNodes, importLegacyServices } from './legacy-upgrade-services.ts';
import { readLegacySource } from './legacy-upgrade-sources.ts';
import { ServiceConfigStore } from './services/service-config-store.ts';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-legacy-services-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

async function fixture() {
  const root = path.join(dir, 'old');
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'new') });
  await writeJsonAtomic(path.join(root, 'config.json'), { values: {
    'worker.name': 'Studio', 'worker.tasks.asr': false, 'worker.tasks.export': true,
    'remote.nodes.studio.nodeId': 'old-node', 'remote.nodes.studio.name': 'Remote Studio',
    'remote.nodes.studio.url': 'http://[::1]:9876', 'remote.nodes.studio.addedAt': '2026-01-01T00:00:00Z',
    'remote.default': 'studio',
  } });
  await writeJsonAtomic(path.join(root, 'runtime', 'services.json'), {
    mcp: { on: true, autoStart: true, port: 24351 },
    web: { on: true, autoStart: false, port: 24320 },
    remoteCompute: { share: { on: true, name: 'Old name' }, useNodes: { nodes: ['studio'] } },
  });
  await writeJsonAtomic(path.join(root, 'integrations-policy.json'), { access: 'auto', projects: [], off: [] });
  await writeJsonAtomic(path.join(root, 'worker', 'identity.json'), { nodeId: 'local-node' });
  await writeJsonAtomic(path.join(root, 'worker', 'worker.json'), { url: 'http://127.0.0.1:9988', adminToken: 'never-copy' });
  await writeJsonAtomic(path.join(root, 'worker', 'clients.json'), { clients: [{ tokenHash: 'old-hash' }] });
  await writeJsonAtomic(path.join(root, 'secrets.json'), { 'remote-old-node': { fields: { apiKey: 'bcw_fixture-token' } } });
  return { root, home, source: (await readLegacySource(root, process.platform, { discoverProjects: false }))! };
}

it('maps v2 services before startup, retains permission levels and imports only supported sharing capabilities', async () => {
  const { home, source } = await fixture();
  const unsupported = await importLegacyServices(home, source);
  const store = new ServiceConfigStore(home.servicesFile);
  await store.load();
  expect(store.get('mcp')).toMatchObject({ autostart: true, port: 24351, policy: { level: 'auto', videos: 'all' }, clients: [] });
  expect(store.get('web')).toMatchObject({ autostart: false, port: 24320 });
  expect(await loadShareFile(home.nodeShareFile)).toMatchObject({
    enabled: true, nodeId: 'local-node', name: 'Studio', port: 9988, clients: [],
    capabilities: { transcribe: { enabled: false } },
  });
  expect(unsupported).toContain('service:node-client-repairing');
  expect(unsupported).toContain('setting:worker.tasks.export');
  expect(JSON.stringify(await readJson(home.nodeShareFile))).not.toContain('never-copy');
  if (process.platform !== 'win32') expect((await fs.stat(home.servicesFile)).mode & 0o777).toBe(0o600);
});

it('keeps restricted project scopes and disabled tools closed instead of widening access', async () => {
  const { root, home, source } = await fixture();
  await writeJsonAtomic(path.join(root, 'integrations-policy.json'), { access: 'auto', projects: ['/old/private'], off: ['edit'] });
  expect(await importLegacyServices(home, source)).toEqual(expect.arrayContaining(['service:mcp-project-scope', 'service:mcp-disabled-tools']));
  const store = new ServiceConfigStore(home.servicesFile);
  await store.load();
  expect(store.get('mcp').policy).toEqual({ videos: { ids: [] }, level: 'read' });
});

it('preserves existing service entries, issued clients and sharing state while adding an absent Web entry', async () => {
  const { home, source } = await fixture();
  const store = new ServiceConfigStore(home.servicesFile);
  await store.load();
  await store.update('mcp', { autostart: false, port: 50000, policy: { videos: { ids: ['current'] }, level: 'read' } });
  const client = await store.createClient('mcp', 'Current client');
  await writeJsonAtomic(home.nodeShareFile, { custom: 'untouched' });
  const before = await fs.readFile(home.nodeShareFile, 'utf8');
  await importLegacyServices(home, source);
  await store.load();
  expect(store.get('mcp')).toMatchObject({ autostart: false, port: 50000, policy: { videos: { ids: ['current'] }, level: 'read' } });
  expect(store.verify('mcp', client.token)?.name).toBe('Current client');
  expect(store.get('web').port).toBe(24320);
  expect(await fs.readFile(home.nodeShareFile, 'utf8')).toBe(before);
});

it('falls back to early desktop Web preferences when runtime service fields are absent', async () => {
  const { root, home, source } = await fixture();
  await fs.rm(path.join(root, 'runtime', 'services.json'));
  source.preferences = { serveEnabled: true, servePort: 34567 };
  await importLegacyServices(home, source);
  const store = new ServiceConfigStore(home.servicesFile);
  await store.load();
  expect(store.get('web')).toMatchObject({ autostart: true, port: 34567 });
});

it('imports node addresses, aliases and credentials without contacting nodes', async () => {
  const { root, home, source } = await fixture();
  const original = await fs.readFile(path.join(root, 'secrets.json'), 'utf8');
  const credentials = new FileCredentialStore(home.modelCredentialsFile);
  const store = await NodeStore.open(home.nodesFile, credentials);
  const keychain = vi.fn();
  const result = await importLegacyNodes(source, store, { allowKeychain: false, keychain });
  expect(result.pending).toEqual([]);
  expect(store.list()).toEqual([{ nodeId: 'old-node', alias: 'studio', name: 'Remote Studio', host: '::1', port: 9876, pairedAt: '2026-01-01T00:00:00Z' }]);
  expect(await store.token('old-node')).toBe('bcw_fixture-token');
  expect(keychain).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain('bcw_fixture-token');
  expect(await fs.readFile(home.nodesFile, 'utf8')).not.toContain('bcw_fixture-token');
  expect(await fs.readFile(path.join(root, 'secrets.json'), 'utf8')).toBe(original);
  await store.upsert({ nodeId: 'old-node', alias: 'renamed', name: 'Current', host: 'current', port: 1234, token: 'current-token' });
  await importLegacyNodes(source, store, { allowKeychain: false });
  expect(store.get('old-node')?.host).toBe('current');
  expect(await store.token('old-node')).toBe('current-token');
  await store.remove('old-node');
  const afterRemoval = await importLegacyNodes(source, store, { allowKeychain: false, completed: result.done });
  expect(afterRemoval.pending).toEqual([]);
  expect(store.list()).toEqual([]);
});

it('defers inaccessible remote credentials and retries successfully through the Windows reader', async () => {
  const { root, home, source } = await fixture();
  await fs.rm(path.join(root, 'secrets.json'));
  const store = await NodeStore.open(home.nodesFile, new FileCredentialStore(home.modelCredentialsFile));
  const windowsCredential = vi.fn(async (): Promise<Record<string, any> | null> => { throw new Error('secret-do-not-log'); });
  const first = await importLegacyNodes(source, store, { platform: 'win32', windowsCredential });
  expect(first.pending).toEqual(['node:studio']);
  expect(JSON.stringify(first)).not.toContain('secret-do-not-log');
  expect(store.list()).toEqual([]);
  windowsCredential.mockImplementation(async () => ({ fields: { apiKey: 'bcw_windows-fixture' } }));
  expect((await importLegacyNodes(source, store, { platform: 'win32', windowsCredential })).pending).toEqual([]);
  expect(await store.token('old-node')).toBe('bcw_windows-fixture');
});
