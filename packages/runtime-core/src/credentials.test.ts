import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BaoCutClient, applyModelsEvent } from '@baocut/client';
import { fakeOpenAiHandler, startFakeProviderServer, type FakeProviderServer } from '@baocut/providers/testing';
import type { ModelsSnapshot, ProviderCapabilityView } from '@baocut/protocol';
import {
  CredentialStoreError,
  KeychainCredentialStore,
  ReadOnlyCredentialStore,
  resolveRuntimeHome,
  type CredentialHelperCommand,
  type CredentialStore,
  type RuntimeHome,
} from '@baocut/runtime-storage';
import { FAKE_CREDENTIAL_HELPER } from '@baocut/runtime-storage/testing';
import { openLinkedCredentialStore } from './credentials.ts';
import { startRuntime, type RunningRuntime } from './runtime.ts';

/**
 * 凭据存储的两个后端经 Runtime 的行为（架构设计 §6.8）。钥匙串后端只用假的助手（`FAKE_CREDENTIAL_HELPER`，存在临时目录），
 * 从不访问系统的钥匙串；密钥是测试里编的字符串。
 */

const OPENAI_KEY = 'sk-test-ONLY-credentials-0123456789';
const GOOGLE_KEY = 'AIzaTESTONLY-credentials-abcdefghij';
const NODE_TOKEN = 'c_legacy.node-token-secret-0123456789';
const SECRETS = [OPENAI_KEY, GOOGLE_KEY, NODE_TOKEN];

async function until<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface Side {
  dir: string;
  home: RuntimeHome;
  helperDir: string;
  runtime: RunningRuntime;
  client: BaoCutClient;
  received: unknown[];
  models(): ModelsSnapshot | null;
}

/** 之前版本留下的明文：模型密钥文件（第 1 版）、启用了的 openai，以及 nodes.json 里的令牌。 */
async function writeLegacyHome(home: RuntimeHome): Promise<void> {
  await fs.mkdir(path.dirname(home.modelCredentialsFile), { recursive: true });
  await fs.writeFile(
    home.modelServicesFile,
    JSON.stringify({ formatVersion: 1, providers: { openai: { enabled: true, enabledAt: '2026-01-01T00:00:00.000Z' } }, defaults: {} }),
  );
  await fs.writeFile(home.modelCredentialsFile, JSON.stringify({ formatVersion: 1, credentials: { openai: OPENAI_KEY } }), { mode: 0o600 });
  await fs.writeFile(
    home.nodesFile,
    JSON.stringify({
      formatVersion: 1,
      clientId: 'c_legacy',
      nodes: [{ nodeId: 'node_old', alias: 'Old', name: 'Old', host: '127.0.0.1', port: 9, token: NODE_TOKEN, pairedAt: 't' }],
    }),
    { mode: 0o600 },
  );
}

async function startSide(options: { helper: 'fake' | null; openai?: FakeProviderServer }): Promise<Side> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-credentials-rt-'));
  const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
  const helperDir = path.join(dir, 'helper');
  await fs.mkdir(helperDir, { recursive: true });
  await writeLegacyHome(home);
  const helper: CredentialHelperCommand | null =
    options.helper === 'fake' ? { command: process.execPath, args: [FAKE_CREDENTIAL_HELPER, helperDir] } : null;
  const runtime = await startRuntime({
    home,
    drivers: () => [],
    watchSpace: false,
    engineHost: null,
    modelWorker: null,
    initiator: { discoverer: null },
    credentials: 'keychain',
    credentialHelper: helper,
    online: { ...(options.openai ? { baseUrls: { openai: `${options.openai.origin}/v1` } } : {}), http: { backoffMs: () => 10 } },
  });
  const { endpoint, token } = runtime.discovery;
  const client = new BaoCutClient({
    resolve: async () => ({ endpoint, token }),
    client: { kind: 'desktop', name: 'test', version: '0' },
    reconnect: false,
  });
  await client.connect();
  const received: unknown[] = [];
  let models: ModelsSnapshot | null = null;
  client.subscribeModels({
    snapshot: (snapshot) => {
      received.push(snapshot);
      models = snapshot;
    },
    event: (event) => {
      received.push(event);
      models = applyModelsEvent(models!, event);
    },
  });
  await until(() => models);
  return { dir, home, helperDir, runtime, client, received, models: () => models };
}

/** Home 里所有文件的内容（日志、配置、任务账本），用来确认密钥没有落盘。 */
async function homeText(home: RuntimeHome): Promise<string> {
  const parts: string[] = [];
  for (const entry of await fs.readdir(home.root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    parts.push(await fs.readFile(path.join(entry.parentPath, entry.name), 'utf8').catch(() => ''));
  }
  return parts.join('\n');
}

const openaiView = (models: ModelsSnapshot | null): ProviderCapabilityView | undefined =>
  models?.capabilities.transcribe.providers.find((p) => p.providerId === 'openai');

describe('凭据存储（经 Runtime）', () => {
  let side: Side | undefined;
  let openai: FakeProviderServer | undefined;

  afterEach(async () => {
    side?.client.close();
    await side?.runtime.close();
    await openai?.close();
    if (side) await fs.rm(side.dir, { recursive: true, force: true });
    side = openai = undefined;
  });

  it('钥匙串后端：启动时迁走明文文件里的密钥与节点令牌；之后的读写都经助手，密钥不进文件、日志、事件与助手的参数', async () => {
    openai = await startFakeProviderServer(fakeOpenAiHandler());
    side = await startSide({ helper: 'fake', openai });
    const items = async () => JSON.parse(await fs.readFile(path.join(side!.helperDir, 'items.json'), 'utf8')) as Record<string, string>;

    // 迁移：模型密钥与节点令牌进了「钥匙串」，明文文件删掉，nodes.json 里没有令牌了；第 1 版的模型配置换成第 2 版，
    // 密钥成了账号 main（新键 provider:openai/main，旧键删掉，§6.8）。
    expect(await items()).toEqual({ 'provider:openai/main': OPENAI_KEY, 'node:node_old': NODE_TOKEN });
    const services = JSON.parse(await fs.readFile(side.home.modelServicesFile, 'utf8'));
    expect(services.formatVersion).toBe(2);
    expect(services.providers.openai.accounts).toEqual([
      expect.objectContaining({ accountId: 'main', label: null, masked: `${OPENAI_KEY.slice(0, 3)}…${OPENAI_KEY.slice(-4)}`, enabled: true }),
    ]);
    await expect(fs.stat(side.home.modelCredentialsFile)).rejects.toThrow();
    expect(JSON.parse(await fs.readFile(side.home.nodesFile, 'utf8')).nodes[0]).not.toHaveProperty('token');
    expect(await side.runtime.initiator.store.token('node_old')).toBe(NODE_TOKEN);

    // 迁过来的密钥照常可用：视图报告「已设置」，验证用的就是它。
    expect(openaiView(side.models())).toMatchObject({ available: true, config: { credential: 'set' } });
    await side.client.request('models.configure', { providerId: 'openai', verify: true });
    expect(openai.requests.at(-1)?.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);

    // 新设的密钥写进「钥匙串」，不写文件；删除自定义端点时删掉它的密钥。
    await side.client.request('models.configure', { providerId: 'google', enabled: true, credential: GOOGLE_KEY });
    await side.client.request('models.configure', {
      providerId: 'custom:box',
      enabled: true,
      endpoint: 'http://127.0.0.1:9/v1',
      credential: 'box-key-secret',
      models: [{ modelId: 'whisper' }],
    });
    expect(await items()).toMatchObject({ 'provider:google/main': GOOGLE_KEY, 'provider:custom:box/main': 'box-key-secret' });
    await side.client.request('models.removeProvider', { providerId: 'custom:box' });
    expect(await items()).not.toHaveProperty('provider:custom:box/main');
    await expect(fs.stat(side.home.modelCredentialsFile)).rejects.toThrow();

    // 删除节点时删掉它的令牌。
    await side.client.request('nodes.remove', { nodeId: 'node_old' });
    expect(await items()).not.toHaveProperty('node:node_old');

    await until(() => side!.received.length >= 3);
    const calls = await fs.readFile(path.join(side.helperDir, 'calls.jsonl'), 'utf8');
    for (const secret of [...SECRETS, 'box-key-secret']) {
      expect(JSON.stringify(side.received)).not.toContain(secret);
      expect(await homeText(side.home)).not.toContain(secret);
      // 助手的调用记录里有命令行参数：密钥不在里面（记录本身不含请求体）。
      expect(calls).not.toContain(secret);
    }
    expect(calls).not.toContain('"secretInEnv":true');
  });

  it('钥匙串不可用（助手缺失）：不回退到明文文件；Provider 报告凭据不可用并带原因；改密钥以 CREDENTIAL_UNAVAILABLE 拒绝', async () => {
    side = await startSide({ helper: null });
    const before = await fs.readFile(side.home.modelCredentialsFile, 'utf8');

    // 明文文件原样保留（下次助手可用时再迁），但不拿来用。
    expect(await fs.readFile(side.home.modelCredentialsFile, 'utf8')).toBe(before);
    const view = openaiView(side.models());
    expect(view).toMatchObject({ available: false, unavailableReason: 'missing-credential', config: { credential: 'missing' } });
    expect(view?.detail).toContain('凭据不可用');
    expect(view?.detail).toContain('凭据助手');

    const failure = await side.client
      .request('models.configure', { providerId: 'openai', credential: 'sk-new-secret-never-stored' })
      .catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: 'conflict', details: { code: 'CREDENTIAL_UNAVAILABLE', reason: 'unavailable' } });
    expect(JSON.stringify(failure)).not.toContain('sk-new-secret-never-stored');
    // 验证也不拿明文文件里的密钥去用。
    await expect(side.client.request('models.configure', { providerId: 'openai', verify: true })).rejects.toMatchObject({
      details: { code: 'CREDENTIAL_UNAVAILABLE' },
    });
    expect(await fs.readFile(side.home.modelCredentialsFile, 'utf8')).toBe(before);

    // 节点：旧令牌留在 nodes.json 里等迁移，但读不到；删除节点以 CREDENTIAL_UNAVAILABLE 拒绝。
    await expect(side.runtime.initiator.store.token('node_old')).rejects.toMatchObject({ code: 'unavailable' });
    expect(JSON.parse(await fs.readFile(side.home.nodesFile, 'utf8')).nodes[0].token).toBe(NODE_TOKEN);
    await expect(side.client.request('nodes.remove', { nodeId: 'node_old' })).rejects.toMatchObject({
      details: { code: 'CREDENTIAL_UNAVAILABLE' },
    });

    const log = await fs.readFile(path.join(side.home.logsDir, 'runtime.log'), 'utf8');
    expect(log).toContain('凭据助手');
    for (const secret of [...SECRETS, 'sk-new-secret-never-stored']) {
      expect(log).not.toContain(secret);
      expect(JSON.stringify(side.received)).not.toContain(secret);
    }
  });
});

describe('链接账号（CLI 独立使用与发布 §7.1）', () => {
  const inner = (kind: 'file' | 'keychain'): CredentialStore & { calls: string[] } => {
    const calls: string[] = [];
    return {
      kind,
      calls,
      get: async (key) => (calls.push(`get ${key}`), 'secret'),
      has: async (key) => (calls.push(`has ${key}`), true),
      set: async (key) => void calls.push(`set ${key}`),
      delete: async (key) => void calls.push(`delete ${key}`),
    };
  };

  it('只读存放：本 Home 用钥匙串时包住它；用文件时只认 BAOCUT_CREDENTIAL_HELPER；set 与 delete 不碰底下的存放', async () => {
    const keychain = inner('keychain');
    const linked = openLinkedCredentialStore(keychain, {});
    expect(linked).toBeInstanceOf(ReadOnlyCredentialStore);
    expect(linked?.kind).toBe('keychain');
    expect(await linked!.get('provider:openai/main')).toBe('secret');
    expect(await linked!.has('provider:openai/main')).toBe(true);
    await expect(linked!.set('provider:openai/main', 'x')).rejects.toBeInstanceOf(CredentialStoreError);
    await expect(linked!.delete('provider:openai/main')).rejects.toMatchObject({ code: 'unsupported' });
    expect(keychain.calls).toEqual(['get provider:openai/main', 'has provider:openai/main']);
    // 文件后端（源码 Runtime）：没有 App 的助手时没有只读存放；有时经它只读地取（不用仓库里 cargo 编的助手）。
    expect(openLinkedCredentialStore(inner('file'), {})).toBeNull();
    const viaHelper = openLinkedCredentialStore(inner('file'), { BAOCUT_CREDENTIAL_HELPER: '/Applications/BaoCut.app/Contents/Resources/bin/credential-helper' });
    expect(viaHelper).toBeInstanceOf(ReadOnlyCredentialStore);
    expect(viaHelper?.kind).toBe('keychain');
  });

  let dir: string | undefined;
  let runtime: RunningRuntime | undefined;
  let client: BaoCutClient | undefined;
  let openai: FakeProviderServer | undefined;
  afterEach(async () => {
    client?.close();
    await runtime?.close();
    await openai?.close();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = runtime = client = openai = undefined;
  });

  it('文件后端的 Runtime 经只读助手链接另一个 Home 的账号：调用用来源的密钥；改以 ACCOUNT_LINKED 拒绝；移除不碰来源的条目', async () => {
    openai = await startFakeProviderServer(fakeOpenAiHandler());
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-credentials-link-'));
    const source = path.join(dir, 'source');
    const helperDir = path.join(dir, 'helper');
    await fs.mkdir(path.join(source, 'store'), { recursive: true });
    await fs.mkdir(helperDir, { recursive: true });
    // 来源：App 的 Home，密钥在「钥匙串」（假助手的 items.json）里，没有 model-credentials.json。
    const masked = `${OPENAI_KEY.slice(0, 3)}…${OPENAI_KEY.slice(-4)}`;
    await fs.writeFile(
      path.join(source, 'store', 'model-services.json'),
      JSON.stringify({
        formatVersion: 2,
        providers: {
          openai: {
            enabled: true,
            enabledAt: '2026-11-01T00:00:00.000Z',
            accounts: [{ accountId: 'main', label: 'App key', masked, enabled: true, addedAt: '2026-11-01T00:00:00.000Z', status: { state: 'ok' } }],
          },
        },
        defaults: {},
        parameters: {},
      }),
    );
    await fs.writeFile(path.join(helperDir, 'items.json'), JSON.stringify({ 'provider:openai/main': OPENAI_KEY }));
    const home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
    runtime = await startRuntime({
      home,
      drivers: () => [],
      watchSpace: false,
      engineHost: null,
      modelWorker: null,
      initiator: { discoverer: null },
      linkedCredentials: new ReadOnlyCredentialStore(
        new KeychainCredentialStore({ helper: { command: process.execPath, args: [FAKE_CREDENTIAL_HELPER, helperDir] } }),
      ),
      online: { baseUrls: { openai: `${openai.origin}/v1` }, http: { backoffMs: () => 10 } },
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({ resolve: async () => ({ endpoint, token }), client: { kind: 'cli', name: 'test', version: '0' }, reconnect: false });
    await client.connect();

    const result = await client.request('models.linkAccounts', { home: source });
    expect(result.linked).toEqual([{ providerId: 'openai', accountId: 'main', sourceAccountId: 'main', created: true }]);
    expect(result.providers[0]?.config).toMatchObject({
      enabled: true,
      credential: 'set',
      accounts: [{ accountId: 'main', label: 'App key', masked, linked: { home: source } }],
    });
    // 调用用来源的密钥。
    await client.request('models.configure', { providerId: 'openai', verify: true });
    expect(openai.requests.at(-1)?.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    await expect(client.request('models.updateAccount', { providerId: 'openai', accountId: 'main', credential: 'sk-new-never-stored-0000' })).rejects.toMatchObject({
      code: 'conflict',
      details: { code: 'ACCOUNT_LINKED', home: source },
    });
    await expect(client.request('models.linkAccounts', { home: home.root })).rejects.toMatchObject({ details: { code: 'LINK_SOURCE_UNSUPPORTED' } });
    await expect(client.request('models.linkAccounts', { home: 'relative/home' })).rejects.toMatchObject({ code: 'invalid-request' });

    // 移除只解除链接：来源的条目还在，助手只被调过 get 与 has。
    const removed = await client.request('models.removeAccount', { providerId: 'openai', accountId: 'main' });
    expect(removed.provider.config).toMatchObject({ credential: 'missing', accounts: [] });
    expect(JSON.parse(await fs.readFile(path.join(helperDir, 'items.json'), 'utf8'))).toEqual({ 'provider:openai/main': OPENAI_KEY });
    const ops = (await fs.readFile(path.join(helperDir, 'calls.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as { op: string }).op);
    expect(new Set(ops)).toEqual(new Set(['has', 'get']));
    expect(await homeText(home)).not.toContain(OPENAI_KEY);
  });
});

