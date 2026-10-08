import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localizeText, RpcError, setLocale } from '@baocut/protocol';
import { credentialProblem, CredentialStoreError } from './credential-store.ts';
import { GrantStore } from './grant-store.ts';
import { decodeGlossaryMarkdown } from './library/glossary-markdown.ts';

/** 界面语言是英文时，存储层写给人看的文字是英文；落盘的、Runtime 写成的授权目的带消息引用。 */
describe('runtime-storage 的英文文案', () => {
  let dir: string;

  beforeEach(async () => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-storage-en-'));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('凭据问题的说明', () => {
    expect(credentialProblem(new CredentialStoreError('denied', 'nope')).message).toBe('Access denied: nope');
  });

  it('授权：错误带引用；默认授权的目的带引用，切回中文后能重新生成', async () => {
    const store = await GrantStore.open(path.join(dir, 'grants.json'));
    let caught: unknown;
    try {
      store.update({ grantId: 'grant_missing' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RpcError);
    expect((caught as RpcError).message).toBe('No such grant');
    expect((caught as RpcError).messageRef?.key).toBe('runtimeStorageGrants.grantNotFound');

    const grant = store.ensureProviderGrant({ recipient: 'openai', dataKinds: ['transcript'], enabledAt: '2026-01-01T00:00:00.000Z', label: 'OpenAI' })!;
    expect(grant.purpose).toBe('Issued by default when OpenAI was turned on');
    expect(grant.purposeRef?.key).toBe('runtimeStorageGrants.providerGrantPurpose');
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
    expect(localizeText(grant.purpose, grant.purposeRef)).toBe('启用 OpenAI 时默认发放');
  });

  it('术语表文件的格式错误', () => {
    let caught: unknown;
    try {
      decodeGlossaryMarkdown('no front matter');
    } catch (error) {
      caught = error;
    }
    expect((caught as RpcError).message).toBe('A glossary file must start with front matter (lines wrapped in ---)');
    expect((caught as RpcError).messageRef?.key).toBe('runtimeStorageLibrary.glossaryNoFrontMatter');
  });
});
