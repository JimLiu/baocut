import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CredentialStoreError, FileCredentialStore, ReadOnlyCredentialStore, type CredentialStore } from '@baocut/runtime-storage';
import { ModelServiceStore, maskCredential, type ModelServiceStorePaths } from './model-service-store.ts';

const KEY = 'sk-test-ONLY-FOR-TESTS-store-0123456789';

describe('ModelServiceStore', () => {
  let dir: string;
  let paths: ModelServiceStorePaths;
  let credentialsFile: string;
  /** 每次打开用一个新的文件后端：重开时从文件读。 */
  const open = () => ModelServiceStore.open(paths, new FileCredentialStore(credentialsFile));

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-model-store-'));
    paths = { modelServicesFile: path.join(dir, 'store', 'model-services.json') };
    credentialsFile = path.join(dir, 'store', 'model-credentials.json');
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('没有文件时从空配置开始，不落盘；第一次修改才写，两份文件都是 0600，密钥只在密钥文件里', async () => {
    const store = await open();
    expect(store.providerIds()).toEqual([]);
    expect(store.getDefault('transcribe')).toBeNull();
    await expect(fs.stat(paths.modelServicesFile)).rejects.toThrow();

    await store.updateProvider('openai', { enabled: true, credential: KEY }, () => '2026-10-03T00:00:00.000Z');
    for (const file of [paths.modelServicesFile, credentialsFile]) {
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    }
    const services = await fs.readFile(paths.modelServicesFile, 'utf8');
    expect(services).not.toContain(KEY);
    expect(JSON.parse(services)).toEqual({
      formatVersion: 2,
      providers: {
        openai: {
          enabled: true,
          enabledAt: '2026-10-03T00:00:00.000Z',
          accounts: [
            {
              accountId: 'main',
              label: null,
              masked: 'sk-…6789',
              enabled: true,
              addedAt: '2026-10-03T00:00:00.000Z',
              status: { state: 'unknown' },
            },
          ],
        },
      },
      defaults: {},
      parameters: {},
    });
    expect(JSON.parse(await fs.readFile(credentialsFile, 'utf8'))).toEqual({
      formatVersion: 2,
      credentials: { 'provider:openai/main': KEY },
    });
    // 临时文件加改名：不留下中间文件。
    expect((await fs.readdir(path.dirname(paths.modelServicesFile))).sort()).toEqual(['model-credentials.json', 'model-services.json']);
  });

  it('只有 Codex 生图默认开启；不落盘、不设置生图默认值，保存的关闭选择优先', async () => {
    const store = await open();
    expect(store.configView('agent:codex')).toMatchObject({ enabled: true, enabledAt: null });
    expect(store.configView('agent:other').enabled).toBe(false);
    expect(store.configView('agent:claude').enabled).toBe(false);
    expect(store.configView('openai').enabled).toBe(false);
    expect(store.getDefault('generateImage')).toBeNull();
    await expect(fs.stat(paths.modelServicesFile)).rejects.toThrow();
    await store.updateProvider('agent:codex', { enabled: false });
    const reopened = await open();
    expect(reopened.configView('agent:codex')).toMatchObject({ enabled: false, enabledAt: null });
    await reopened.updateProvider('agent:codex', { enabled: true }, () => 't1');
    expect((await open()).configView('agent:codex')).toMatchObject({ enabled: true, enabledAt: 't1' });
  });

  it('只读视图从不回显密钥；enabledAt 在重复启用时不变，停用时清空', async () => {
    const store = await open();
    await store.updateProvider('openai', { enabled: true, credential: KEY }, () => 't1');
    await store.updateProvider('openai', { enabled: true }, () => 't2');
    const account = {
      accountId: 'main',
      label: null,
      masked: 'sk-…6789',
      enabled: true,
      addedAt: 't1',
      credential: 'set',
      status: { state: 'unknown' },
    };
    expect(store.configView('openai')).toEqual({ enabled: true, enabledAt: 't1', credential: 'set', accounts: [account] });
    expect(JSON.stringify(store.configView('openai'))).not.toContain(KEY);
    expect(JSON.stringify(store.provider('openai'))).not.toContain(KEY);
    expect(await store.credential('openai')).toBe(KEY);
    expect((await open()).configView('openai').credential).toBe('set');
    await store.updateProvider('openai', { enabled: false });
    expect(store.configView('openai')).toEqual({ enabled: false, enabledAt: null, credential: 'set', accounts: [account] });
    // `credential: null`（`models.configure` 的写法）删掉第一个账号。
    await store.updateProvider('openai', { credential: null, endpoint: 'http://127.0.0.1:9/v1' });
    expect(store.configView('openai')).toEqual({
      enabled: false,
      enabledAt: null,
      credential: 'missing',
      accounts: [],
      endpoint: 'http://127.0.0.1:9/v1',
    });
    expect(JSON.parse(await fs.readFile(credentialsFile, 'utf8'))).toEqual({ formatVersion: 2, credentials: {} });
    await store.updateProvider('openai', { endpoint: null });
    expect(store.configView('openai').endpoint).toBeUndefined();
  });

  it('自定义端点的声明模型与默认值在重开后还在；删除 Provider 时默认值保留', async () => {
    const store = await open();
    await store.updateProvider('custom:box', {
      enabled: true,
      endpoint: 'http://127.0.0.1:8000/v1',
      label: '工作站',
      models: [{ modelId: 'whisper-large', maxInputBytes: 1000 }],
    });
    await store.setDefault('transcribe', { providerId: 'custom:box', modelId: 'whisper-large' });
    const reopened = await open();
    expect(reopened.provider('custom:box')).toMatchObject({ label: '工作站', models: [{ modelId: 'whisper-large', maxInputBytes: 1000 }] });
    expect(reopened.getDefault('transcribe')).toEqual({ providerId: 'custom:box', modelId: 'whisper-large' });

    expect(await reopened.removeProvider('custom:box')).toBe(true);
    expect(await reopened.removeProvider('custom:box')).toBe(false);
    expect(reopened.providerIds()).toEqual([]);
    expect(reopened.getDefault('transcribe')).toEqual({ providerId: 'custom:box', modelId: 'whisper-large' });
    await reopened.setDefault('transcribe', null);
    expect((await open()).getDefault('transcribe')).toBeNull();
  });

  it('认不出的条目丢掉；凭据文件坏了时打开照样成功，Provider 报告凭据不可用', async () => {
    await fs.mkdir(path.dirname(paths.modelServicesFile), { recursive: true });
    await fs.writeFile(
      paths.modelServicesFile,
      JSON.stringify({
        formatVersion: 1,
        providers: { ok: { enabled: true, enabledAt: 't' }, bad: { enabled: 'yes' } },
        defaults: { transcribe: { providerId: 'ok' }, generateImage: { providerId: 'ok', modelId: 'm' } },
      }),
    );
    await fs.writeFile(credentialsFile, '{not json');
    const store = await open();
    expect(store.providerIds()).toEqual(['ok']);
    expect(store.getDefault('transcribe')).toBeNull();
    expect(store.getDefault('generateImage')).toEqual({ providerId: 'ok', modelId: 'm' });
    expect(store.hasCredential('ok')).toBe(false);
    expect(store.credentialProblem('ok')).not.toBeNull();
    // 凭据文件原样留着。
    expect(await fs.readFile(credentialsFile, 'utf8')).toBe('{not json');
  });

  it('配置文件不是 JSON：改名保留、从空开始；更新版本写下的：不改名，修改也不覆盖它', async () => {
    await fs.mkdir(path.dirname(paths.modelServicesFile), { recursive: true });
    await fs.writeFile(paths.modelServicesFile, '{ not json');
    expect((await open()).providerIds()).toEqual([]);
    const names = await fs.readdir(path.dirname(paths.modelServicesFile));
    expect(names.some((n) => n.startsWith(`${path.basename(paths.modelServicesFile)}.corrupt-`))).toBe(true);

    const text = JSON.stringify({ formatVersion: 3, providers: { openai: { enabled: true } } });
    await fs.writeFile(paths.modelServicesFile, text);
    const store = await open();
    expect(store.providerIds()).toEqual([]);
    await store.setDefault('transcribe', null);
    expect(await fs.readFile(paths.modelServicesFile, 'utf8')).toBe(text);
  });

  it('之前版本的密钥文件（formatVersion 1，键是 providerId）照原样读出；迁成账号 main，写第 2 版的配置，再删旧键', async () => {
    await fs.mkdir(path.dirname(credentialsFile), { recursive: true });
    await fs.writeFile(
      paths.modelServicesFile,
      JSON.stringify({
        formatVersion: 1,
        providers: {
          openai: { enabled: true, enabledAt: 't' },
          'custom:box': { enabled: true, enabledAt: 't', endpoint: 'http://x' },
          google: { enabled: false, enabledAt: null },
        },
        defaults: {},
      }),
    );
    await fs.writeFile(credentialsFile, JSON.stringify({ formatVersion: 1, credentials: { openai: KEY, 'custom:box': 'box-key' } }), {
      mode: 0o600,
    });
    const store = await open();
    expect(store.configView('openai')).toMatchObject({ credential: 'set', accounts: [{ accountId: 'main', masked: 'sk-…6789' }] });
    expect(store.configView('custom:box')).toMatchObject({ credential: 'set', accounts: [{ accountId: 'main', masked: '••••••••' }] });
    // 没有凭据的 Provider 不建账号。
    expect(store.configView('google')).toMatchObject({ credential: 'missing', accounts: [] });
    expect(await store.credential('openai')).toBe(KEY);
    expect(await store.credential('custom:box')).toBe('box-key');
    expect(JSON.parse(await fs.readFile(credentialsFile, 'utf8'))).toEqual({
      formatVersion: 2,
      credentials: { 'provider:custom:box/main': 'box-key', 'provider:openai/main': KEY },
    });
    const written = JSON.parse(await fs.readFile(paths.modelServicesFile, 'utf8'));
    expect(written.formatVersion).toBe(2);
    expect(written.providers.openai).not.toHaveProperty('legacyCredential');
    expect(JSON.stringify(written)).not.toContain(KEY);
    // 再开一次结果相同（迁移只做一次）。
    const reopened = await open();
    expect(reopened.configView('openai').accounts).toHaveLength(1);
    expect(await reopened.credential('openai')).toBe(KEY);
  });

  it('迁移中途停下（写了新键、第 1 版的配置还在）：再开一次结果相同，不重复建账号', async () => {
    await fs.mkdir(path.dirname(credentialsFile), { recursive: true });
    const v1 = JSON.stringify({ formatVersion: 1, providers: { openai: { enabled: true, enabledAt: 't' } }, defaults: {} });
    await fs.writeFile(paths.modelServicesFile, v1);
    await fs.writeFile(
      credentialsFile,
      JSON.stringify({ formatVersion: 2, credentials: { 'provider:openai': KEY, 'provider:openai/main': KEY } }),
      { mode: 0o600 },
    );
    const store = await open();
    expect(store.configView('openai').accounts).toEqual([expect.objectContaining({ accountId: 'main' })]);
    expect(JSON.parse(await fs.readFile(credentialsFile, 'utf8')).credentials).toEqual({ 'provider:openai/main': KEY });
  });

  it('迁移时凭据存储读不了：报告原因、不当作没有密钥；下次打开（可用了）再迁', async () => {
    await fs.mkdir(path.dirname(credentialsFile), { recursive: true });
    await fs.writeFile(
      paths.modelServicesFile,
      JSON.stringify({ formatVersion: 1, providers: { openai: { enabled: true, enabledAt: 't' } }, defaults: {} }),
    );
    const items = new Map<string, string>([['provider:openai', KEY]]);
    let broken = true;
    const keychain: CredentialStore = {
      kind: 'keychain',
      get: async (key) => {
        if (broken) throw new CredentialStoreError('denied', '用户拒绝了钥匙串的访问');
        return items.get(key) ?? null;
      },
      set: async (key, value) => {
        if (broken) throw new CredentialStoreError('denied', '用户拒绝了钥匙串的访问');
        items.set(key, value);
      },
      delete: async (key) => {
        if (broken) throw new CredentialStoreError('denied', '用户拒绝了钥匙串的访问');
        items.delete(key);
      },
      has: async (key) => {
        if (broken) throw new CredentialStoreError('denied', '用户拒绝了钥匙串的访问');
        return items.has(key);
      },
    };
    const first = await ModelServiceStore.open(paths, keychain);
    expect(first.configView('openai')).toMatchObject({ credential: 'missing', accounts: [] });
    expect(first.credentialProblem('openai')).toContain('用户拒绝');
    expect([...items.keys()]).toEqual(['provider:openai']);

    broken = false;
    const second = await ModelServiceStore.open(paths, keychain);
    expect(second.credentialProblem('openai')).toBeNull();
    expect(second.configView('openai')).toMatchObject({ credential: 'set', accounts: [{ accountId: 'main' }] });
    expect(Object.fromEntries(items)).toEqual({ 'provider:openai/main': KEY });
    expect(JSON.parse(await fs.readFile(paths.modelServicesFile, 'utf8')).formatVersion).toBe(2);
  });

  it('账号：加、改、排序、删；一次调用用第一个启用且有密钥的账号；状态只记录、不换账号', async () => {
    const store = await open();
    const changes: number[] = [];
    store.onAccountChange(() => changes.push(1));
    const a = await store.addAccount('deepseek', { credential: 'sk-first-0000aaaa' }, () => 't1');
    const b = await store.addAccount('deepseek', { credential: 'sk-second-1111bbbb', label: '备用' }, () => 't2');
    expect(a).toBe('main');
    expect(b).toMatch(/^[0-9a-f]{8}$/);
    expect(store.configView('deepseek').accounts?.map((x) => [x.accountId, x.label, x.masked])).toEqual([
      ['main', null, 'sk-…aaaa'],
      [b, '备用', 'sk-…bbbb'],
    ]);
    expect(await store.resolveCredential('deepseek')).toEqual({ accountId: 'main', secret: 'sk-first-0000aaaa' });

    // 停用第一个：用第二个。调整顺序：第二个在前。
    await store.updateAccount('deepseek', 'main', { enabled: false });
    expect((await store.resolveCredential('deepseek'))?.accountId).toBe(b);
    await store.updateAccount('deepseek', 'main', { enabled: true });
    await store.arrangeAccounts('deepseek', [b, 'main']);
    expect((await store.resolveCredential('deepseek'))?.accountId).toBe(b);
    await expect(store.arrangeAccounts('deepseek', [b])).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(store.updateAccount('deepseek', 'nope', { label: 'x' })).rejects.toMatchObject({
      code: 'not-found',
      details: { code: 'ACCOUNT_NOT_FOUND', providerId: 'deepseek', accountId: 'nope' },
    });

    // 状态只记录最近一次结果：限速之后照样用它（不换账号）。
    store.recordAccountResult('deepseek', b, '2026-10-06T00:00:00.000Z', {
      state: 'rate-limited',
      at: '2026-10-06T00:00:00.000Z',
      until: '2026-10-06T00:01:00.000Z',
    });
    expect(changes).toHaveLength(1);
    expect(store.configView('deepseek').accounts?.[0]).toMatchObject({
      accountId: b,
      lastUsedAt: '2026-10-06T00:00:00.000Z',
      status: { state: 'rate-limited', until: '2026-10-06T00:01:00.000Z' },
    });
    expect((await store.resolveCredential('deepseek'))?.accountId).toBe(b);
    // 换密钥：状态回到 unknown，掩码重算。
    await store.updateAccount('deepseek', b, { credential: 'sk-third-2222cccc' });
    expect(store.configView('deepseek').accounts?.[0]).toMatchObject({ masked: 'sk-…cccc', status: { state: 'unknown' } });
    await store.flush();
    expect(await fs.readFile(paths.modelServicesFile, 'utf8')).not.toContain('sk-third-2222cccc');

    // 删掉全部账号：Provider 还在，只是没有密钥。
    await store.removeAccount('deepseek', b);
    await store.removeAccount('deepseek', 'main');
    expect(store.configView('deepseek')).toMatchObject({ credential: 'missing', accounts: [] });
    expect(JSON.parse(await fs.readFile(credentialsFile, 'utf8')).credentials).toEqual({});
  });

  it('掩码：前 3 + … + 后 4；8 个字符以内全是 •', () => {
    expect(maskCredential('sk-abcdefghij1234')).toBe('sk-…1234');
    expect(maskCredential('12345678')).toBe('••••••••');
    expect(maskCredential('abc')).toBe('••••••••');
  });

  it('凭据存储不可用：打开照常，视图报告原因；改密钥与删除以 CREDENTIAL_UNAVAILABLE 拒绝、配置不变；错误里没有密钥', async () => {
    await (await open()).updateProvider('openai', { enabled: true, credential: KEY });
    const broken: CredentialStore = {
      kind: 'keychain',
      get: async () => {
        throw new CredentialStoreError('denied', '用户拒绝了钥匙串的访问');
      },
      set: async () => {
        throw new CredentialStoreError('denied', '用户拒绝了钥匙串的访问');
      },
      delete: async () => {
        throw new CredentialStoreError('unavailable', '凭据助手程序缺失');
      },
      has: async () => {
        throw new CredentialStoreError('unavailable', '凭据助手程序缺失');
      },
    };
    const store = await ModelServiceStore.open(paths, broken);
    expect(store.providerIds()).toEqual(['openai']);
    expect(store.hasCredential('openai')).toBe(false);
    expect(store.credentialProblem('openai')).toContain('凭据助手程序缺失');
    await expect(store.credential('openai')).rejects.toBeInstanceOf(CredentialStoreError);
    expect(store.credentialProblem('openai')).toContain('用户拒绝');

    const NEW_KEY = 'sk-new-secret-should-not-leak';
    const failure = await store.updateProvider('openai', { enabled: false, credential: NEW_KEY }).catch((e: unknown) => e);
    expect(failure).toMatchObject({
      code: 'conflict',
      details: { code: 'CREDENTIAL_UNAVAILABLE', reason: 'denied', providerId: 'openai' },
    });
    expect(JSON.stringify(failure)).not.toContain(NEW_KEY);
    expect((failure as Error).message).not.toContain(NEW_KEY);
    expect(store.configView('openai').enabled).toBe(true);
    await expect(store.removeProvider('openai')).rejects.toMatchObject({
      details: { code: 'CREDENTIAL_UNAVAILABLE', reason: 'unavailable' },
    });
    expect(store.providerIds()).toEqual(['openai']);
    // 不回退：明文文件里的密钥还在，但这个存储读不到它。
    expect(JSON.parse(await fs.readFile(credentialsFile, 'utf8')).credentials['provider:openai/main']).toBe(KEY);
  });

  it('删除 Provider 时删除它全部账号的密钥', async () => {
    const store = await open();
    await store.updateProvider('custom:box', { enabled: true, endpoint: 'http://x', credential: 'box-key' });
    await store.addAccount('custom:box', { credential: 'box-key-2' });
    expect(await store.removeProvider('custom:box')).toBe(true);
    expect(JSON.parse(await fs.readFile(credentialsFile, 'utf8')).credentials).toEqual({});
  });
});

/** 内存里的「钥匙串」：记下每次调用（键，不含密钥）。 */
function memoryKeychain(items: Record<string, string> = {}) {
  const map = new Map(Object.entries(items));
  const calls: string[] = [];
  let failure: CredentialStoreError | null = null;
  const store: CredentialStore = {
    kind: 'keychain',
    get: async (key) => {
      calls.push(`get ${key}`);
      if (failure) throw failure;
      return map.get(key) ?? null;
    },
    has: async (key) => {
      calls.push(`has ${key}`);
      if (failure) throw failure;
      return map.has(key);
    },
    set: async (key, value) => {
      calls.push(`set ${key}`);
      map.set(key, value);
    },
    delete: async (key) => {
      calls.push(`delete ${key}`);
      map.delete(key);
    },
  };
  return { store, map, calls, fail: (error: CredentialStoreError | null) => (failure = error) };
}

describe('ModelServiceStore：链接账号（CLI 独立使用与发布 §7.1）', () => {
  const OPENAI_KEY = 'sk-test-ONLY-linked-openai-0000aaaa';
  const WORK_KEY = 'sk-test-ONLY-linked-work-1111bbbb';
  const DEEPSEEK_KEY = 'sk-test-ONLY-linked-deepseek-2222cccc';
  const OWN_KEY = 'sk-test-ONLY-own-openai-3333dddd';
  let dir: string;
  let source: string;
  let paths: ModelServiceStorePaths;
  let credentialsFile: string;
  let keychain: ReturnType<typeof memoryKeychain>;
  let workId: string;
  /** 来源 Home 里的配置（用钥匙串存密钥，没有 model-credentials.json）。 */
  let origin: ModelServiceStore;
  const open = (linked: CredentialStore | null = new ReadOnlyCredentialStore(keychain.store)) =>
    ModelServiceStore.open(paths, new FileCredentialStore(credentialsFile), undefined, { linked });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-model-store-link-'));
    source = path.join(dir, 'source');
    paths = { modelServicesFile: path.join(dir, 'home', 'store', 'model-services.json') };
    credentialsFile = path.join(dir, 'home', 'store', 'model-credentials.json');
    keychain = memoryKeychain();
    origin = await ModelServiceStore.open({ modelServicesFile: path.join(source, 'store', 'model-services.json') }, keychain.store);
    await origin.updateProvider('openai', { enabled: true, credential: OPENAI_KEY }, () => 't0');
    workId = await origin.addAccount('openai', { credential: WORK_KEY, label: 'work' }, () => 't0');
    await origin.updateProvider('deepseek', { enabled: true, credential: DEEPSEEK_KEY }, () => 't0');
    await origin.flush();
    keychain.calls.length = 0;
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('只登记描述、不抄密钥；调用经只读存放取；改以 ACCOUNT_LINKED 拒绝；移除只解除链接，来源的密钥还在', async () => {
    const store = await open();
    await store.addAccount('openai', { credential: OWN_KEY }, () => 't1');
    const linked = await store.linkAccounts(source, {}, () => 't2');
    // openai 的 main 在这边已经有了：另起一个 id；其余沿用来源的 id。
    expect(linked).toEqual([
      { providerId: 'openai', accountId: expect.not.stringMatching(/^main$/), sourceAccountId: 'main', created: true },
      { providerId: 'openai', accountId: workId, sourceAccountId: workId, created: true },
      { providerId: 'deepseek', accountId: 'main', sourceAccountId: 'main', created: true },
    ]);
    // 本 Home 没配置过的服务商连同开关一起建。
    expect(store.configView('deepseek')).toMatchObject({
      enabled: true,
      enabledAt: 't2',
      credential: 'set',
      accounts: [{ accountId: 'main', masked: maskCredential(DEEPSEEK_KEY), enabled: true, credential: 'set', linked: { home: source } }],
    });
    expect(store.configView('openai').accounts?.map((a) => [a.label ?? a.masked, a.linked?.home ?? null])).toEqual([
      [maskCredential(OWN_KEY), null],
      [maskCredential(OPENAI_KEY), source],
      ['work', source],
    ]);
    expect(await store.resolveCredential('deepseek')).toEqual({ accountId: 'main', secret: DEEPSEEK_KEY });
    expect(await store.accountCredential('openai', workId)).toBe(WORK_KEY);
    await store.flush();
    const files = [await fs.readFile(paths.modelServicesFile, 'utf8'), await fs.readFile(credentialsFile, 'utf8')].join('\n');
    for (const secret of [OPENAI_KEY, WORK_KEY, DEEPSEEK_KEY]) expect(files).not.toContain(secret);

    // 改描述、密钥或开关都拒绝；只排序可以。
    for (const patch of [{ label: 'x' }, { credential: 'sk-new-ONLY-0000zzzz' }, { enabled: false }, { region: null }]) {
      await expect(store.updateAccount('deepseek', 'main', patch)).rejects.toMatchObject({
        code: 'conflict',
        details: { code: 'ACCOUNT_LINKED', providerId: 'deepseek', accountId: 'main', home: source },
      });
    }
    await expect(store.updateProvider('deepseek', { credential: 'sk-new-ONLY-0000zzzz' })).rejects.toMatchObject({
      details: { code: 'ACCOUNT_LINKED' },
    });
    const openaiIds = store.configView('openai').accounts!.map((a) => a.accountId);
    await store.arrangeAccounts('openai', [workId, ...openaiIds.filter((id) => id !== workId)]);
    expect((await store.resolveCredential('openai'))?.secret).toBe(WORK_KEY);

    // 移除：只删这边的登记，从不调来源的 set / delete。
    await store.removeAccount('openai', workId);
    await store.removeAccount('deepseek', 'main');
    expect(store.configView('deepseek')).toMatchObject({ credential: 'missing', accounts: [] });
    expect(keychain.calls.filter((call) => !/^(get|has) /.test(call))).toEqual([]);
    expect(keychain.map.get('provider:deepseek/main')).toBe(DEEPSEEK_KEY);
    expect(keychain.map.get(`provider:openai/${workId}`)).toBe(WORK_KEY);
    // 移除 Provider 也一样：自己的账号删密钥，链接的不碰。
    expect(await store.removeProvider('openai')).toBe(true);
    expect(keychain.map.get('provider:openai/main')).toBe(OPENAI_KEY);
    expect(JSON.parse(await fs.readFile(credentialsFile, 'utf8')).credentials).toEqual({});
  });

  it('再链接一次只刷新描述；按服务商与账号筛选；没匹配上时 not-found；重开后还是链接账号', async () => {
    const store = await open();
    expect(await store.linkAccounts(source, { providerId: 'openai', accountId: workId })).toEqual([
      { providerId: 'openai', accountId: workId, sourceAccountId: workId, created: true },
    ]);
    expect((await store.linkAccounts(source, { providerId: 'openai' })).map((item) => [item.sourceAccountId, item.created])).toEqual([
      ['main', true],
      [workId, false],
    ]);
    expect(store.configView('openai').accounts).toHaveLength(2);
    await expect(store.linkAccounts(source, { providerId: 'gemini' })).rejects.toMatchObject({
      code: 'not-found',
      details: { code: 'ACCOUNT_NOT_FOUND', home: source, providerId: 'gemini' },
    });
    await store.flush();
    const reopened = await open();
    // 先链接的在前（按链接的先后加在最后）。
    expect(reopened.configView('openai').accounts?.map((a) => [a.accountId, a.linked?.home, a.credential])).toEqual([
      [workId, source, 'set'],
      ['main', source, 'set'],
    ]);
    expect(await reopened.resolveCredential('openai')).toEqual({ accountId: workId, secret: WORK_KEY });
  });

  it('来源不能链接：同一个 Home、用文件存密钥、没有配置时 LINK_SOURCE_UNSUPPORTED；只看文件在不在', async () => {
    const store = await open();
    const home = path.dirname(path.dirname(paths.modelServicesFile));
    await fs.mkdir(path.join(home, 'store'), { recursive: true });
    await expect(store.linkAccounts(home)).rejects.toMatchObject({ code: 'conflict', details: { code: 'LINK_SOURCE_UNSUPPORTED' } });
    const fileBacked = path.join(dir, 'file-backed');
    await fs.mkdir(path.join(fileBacked, 'store'), { recursive: true });
    await fs.copyFile(path.join(source, 'store', 'model-services.json'), path.join(fileBacked, 'store', 'model-services.json'));
    await fs.writeFile(path.join(fileBacked, 'store', 'model-credentials.json'), 'not even json');
    await expect(store.linkAccounts(fileBacked)).rejects.toMatchObject({ details: { code: 'LINK_SOURCE_UNSUPPORTED', home: fileBacked } });
    await expect(store.linkAccounts(path.join(dir, 'nothing-here'))).rejects.toMatchObject({ details: { code: 'LINK_SOURCE_UNSUPPORTED' } });
    expect(store.providerIds()).toEqual([]);
  });

  it('跟着来源走：改名照着改；来源里删了、读不了或没有只读存放时报不可用并写明来源；回到来源后重新可用', async () => {
    const store = await open();
    let notified = 0;
    store.onAccountChange(() => notified++);
    await store.linkAccounts(source);
    await origin.updateAccount('openai', workId, { label: 'renamed-work' });
    await origin.flush();
    expect(store.configView('openai').accounts?.find((a) => a.accountId === workId)?.label).toBe('renamed-work');

    // 来源里删了：这边的登记还在，但没有密钥，原因写明来源。
    await origin.removeAccount('deepseek', 'main');
    await origin.flush();
    expect(store.configView('deepseek')).toMatchObject({ credential: 'missing', accounts: [{ accountId: 'main', credential: 'missing' }] });
    expect(store.credentialProblem('deepseek')).toContain(source);
    expect(await store.resolveCredential('deepseek')).toBeNull();

    // 来源又有了：后台重查，有密钥后通知重算视图。
    await origin.updateProvider('deepseek', { credential: DEEPSEEK_KEY });
    await origin.flush();
    expect(store.configView('deepseek').accounts?.[0]?.masked).toBe(maskCredential(DEEPSEEK_KEY));
    for (let i = 0; i < 100 && !store.hasCredential('deepseek'); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(store.hasCredential('deepseek')).toBe(true);
    expect(notified).toBeGreaterThan(0);

    // 只读存放报错：跳过它，原因里有来源与错误。
    keychain.fail(new CredentialStoreError('denied', 'keychain access denied'));
    expect(await store.resolveCredential('deepseek')).toBeNull();
    expect(store.credentialProblem('deepseek')).toContain('keychain access denied');
    keychain.fail(null);
    await store.flush();

    // 没有只读存放（源码 Runtime 找不到 App 的助手）：链接账号都报不可用。
    const blind = await open(null);
    expect(blind.configView('openai')).toMatchObject({ credential: 'missing' });
    expect(blind.credentialProblem('openai')).toContain(source);
    expect(await blind.resolveCredential('openai')).toBeNull();
  });
});

