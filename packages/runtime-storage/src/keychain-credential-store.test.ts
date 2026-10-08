import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CredentialStoreError } from './credential-store.ts';
import { FileCredentialStore } from './file-credential-store.ts';
import { FAKE_CREDENTIAL_HELPER } from './testing/index.ts';
import { KeychainCredentialStore } from './keychain-credential-store.ts';
import { migrateFileCredentials } from './credential-migration.ts';

/** 这些测试只用假的助手（`testing/fake-credential-helper.ts`），不访问系统的钥匙串。 */

const SECRET = 'sk-test-ONLY-keychain-0123456789';

describe('KeychainCredentialStore（假助手）', () => {
  let dir: string;
  let store: KeychainCredentialStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-keychain-'));
    store = new KeychainCredentialStore({ helper: { command: process.execPath, args: [FAKE_CREDENTIAL_HELPER, dir] } });
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const control = (value: object) => fs.writeFile(path.join(dir, 'control.json'), JSON.stringify(value));
  const calls = async () =>
    (await fs.readFile(path.join(dir, 'calls.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { argv: string[]; op: string; key: string; secretInEnv: boolean });
  const failureOf = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error('应当失败');
      },
      (error: unknown) => error as CredentialStoreError,
    );

  it('四种操作；没有的 key：get 为 null、delete 照常完成', async () => {
    expect(await store.has('provider:openai')).toBe(false);
    expect(await store.get('provider:openai')).toBeNull();
    await store.delete('provider:openai');
    await store.set('provider:openai', SECRET);
    expect(await store.has('provider:openai')).toBe(true);
    expect(await store.get('provider:openai')).toBe(SECRET);
    await store.set('provider:openai', `${SECRET}-2`);
    expect(await store.get('provider:openai')).toBe(`${SECRET}-2`);
    await store.delete('provider:openai');
    expect(await store.has('provider:openai')).toBe(false);
    expect((await calls()).map((c) => c.op)).toEqual(['has', 'get', 'delete', 'set', 'has', 'get', 'set', 'get', 'delete', 'has']);
  });

  it('密钥只经 stdin：不出现在助手的命令行参数与环境变量里', async () => {
    await store.set('node:node_1', SECRET);
    await store.get('node:node_1');
    for (const call of await calls()) {
      expect(call.argv.join(' ')).not.toContain(SECRET);
      expect(call.secretInEnv).toBe(false);
    }
  });

  it.each(['denied', 'unavailable', 'unsupported', 'internal'] as const)(
    '助手报告 %s：映射成同名的错误码，信息里去掉了密钥',
    async (code) => {
      await control({ fail: { set: code, get: code, has: code, delete: code } });
      for (const run of [
        () => store.set('provider:openai', SECRET),
        () => store.get('provider:openai'),
        () => store.has('provider:openai'),
      ]) {
        const error = await failureOf(run());
        expect(error).toBeInstanceOf(CredentialStoreError);
        expect(error.code).toBe(code);
        expect(error.message).not.toContain(SECRET);
        expect(JSON.stringify(error)).not.toContain(SECRET);
      }
      expect((await failureOf(store.delete('provider:openai'))).code).toBe(code);
    },
  );

  it('不认识的错误码与不合规的响应：internal', async () => {
    await control({ fail: { has: 'exploded' } });
    expect((await failureOf(store.has('provider:openai'))).code).toBe('internal');
    await control({ mode: 'garbage' });
    expect((await failureOf(store.get('provider:openai'))).code).toBe('internal');
    // `has` 与 `set` 不应该收到 not-found。
    await control({ fail: { has: 'not-found' } });
    expect((await failureOf(store.has('provider:openai'))).code).toBe('internal');
  });

  it('助手缺失、没有回应就退出、超时：unavailable', async () => {
    const missing = new KeychainCredentialStore({ helper: { command: path.join(dir, 'no-such-helper') } });
    const notFound = await failureOf(missing.get('provider:openai'));
    expect(notFound.code).toBe('unavailable');
    expect(notFound.message).toContain('缺失');

    const none = new KeychainCredentialStore({ helper: null });
    expect((await failureOf(none.has('provider:openai'))).code).toBe('unavailable');

    await control({ mode: 'silent' });
    expect((await failureOf(store.get('provider:openai'))).code).toBe('unavailable');

    await control({ mode: 'hang' });
    const slow = new KeychainCredentialStore({
      helper: { command: process.execPath, args: [FAKE_CREDENTIAL_HELPER, dir] },
      timeoutMs: 500,
    });
    const timedOut = await failureOf(slow.set('provider:openai', SECRET));
    expect(timedOut.code).toBe('unavailable');
    expect(timedOut.message).not.toContain(SECRET);
  });

  it('操作串行：并发的写入按顺序完成', async () => {
    await Promise.all(['a', 'b', 'c'].map((x) => store.set(`node:${x}`, `t-${x}`)));
    expect(await store.get('node:b')).toBe('t-b');
    expect((await calls()).map((c) => c.key)).toEqual(['node:a', 'node:b', 'node:c', 'node:b']);
  });
});

describe('migrateFileCredentials', () => {
  let dir: string;
  let helperDir: string;
  let file: string;
  let keychain: KeychainCredentialStore;
  const lines: string[] = [];
  const log = {
    info: (message: string, fields?: object) => lines.push(`${message} ${JSON.stringify(fields)}`),
    warn: (message: string, fields?: object) => lines.push(`${message} ${JSON.stringify(fields)}`),
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-migrate-'));
    helperDir = path.join(dir, 'helper');
    await fs.mkdir(helperDir);
    file = path.join(dir, 'store', 'model-credentials.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    // 之前版本的文件：键是 providerId。
    await fs.writeFile(file, JSON.stringify({ formatVersion: 1, credentials: { openai: `${SECRET}-openai`, google: `${SECRET}-google` } }));
    keychain = new KeychainCredentialStore({ helper: { command: process.execPath, args: [FAKE_CREDENTIAL_HELPER, helperDir] } });
    lines.length = 0;
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('全部成功：逐个写进钥匙串，删除明文文件', async () => {
    const result = await migrateFileCredentials(new FileCredentialStore(file), keychain, log);
    expect(result.failed).toEqual([]);
    expect(result.migrated.sort()).toEqual(['provider:google', 'provider:openai']);
    expect(await keychain.get('provider:openai')).toBe(`${SECRET}-openai`);
    expect(await keychain.get('provider:google')).toBe(`${SECRET}-google`);
    await expect(fs.stat(file)).rejects.toThrow();
    expect(lines.join('\n')).not.toContain(SECRET);
  });

  it('部分失败：迁走的从文件里删掉，没迁走的留下；日志只有 key 与原因；下次启动再迁', async () => {
    await fs.writeFile(path.join(helperDir, 'control.json'), JSON.stringify({ failKeys: { 'provider:google': 'denied' } }));
    const result = await migrateFileCredentials(new FileCredentialStore(file), keychain, log);
    expect(result).toEqual({ migrated: ['provider:openai'], failed: [{ key: 'provider:google', code: 'denied' }] });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
      formatVersion: 2,
      credentials: { 'provider:google': `${SECRET}-google` },
    });
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    const logged = lines.join('\n');
    expect(logged).toContain('provider:google');
    expect(logged).not.toContain(SECRET);

    await fs.rm(path.join(helperDir, 'control.json'));
    // 不回退：钥匙串后端读不到留在文件里的密钥。
    expect(await keychain.get('provider:google')).toBeNull();
    const again = await migrateFileCredentials(new FileCredentialStore(file), keychain, log);
    expect(again).toEqual({ migrated: ['provider:google'], failed: [] });
    await expect(fs.stat(file)).rejects.toThrow();
  });

  it('钥匙串不可用：文件原样保留，什么也没迁', async () => {
    const before = await fs.readFile(file, 'utf8');
    const result = await migrateFileCredentials(new FileCredentialStore(file), new KeychainCredentialStore({ helper: null }), log);
    expect(result.migrated).toEqual([]);
    expect(result.failed.map((f) => f.code)).toEqual(['unavailable', 'unavailable']);
    // 内容不变（键的格式也没被改写）。
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    expect(lines.join('\n')).not.toContain(SECRET);
  });

  it('没有明文文件：什么也不做', async () => {
    await fs.rm(file);
    expect(await migrateFileCredentials(new FileCredentialStore(file), keychain, log)).toEqual({ migrated: [], failed: [] });
  });
});
