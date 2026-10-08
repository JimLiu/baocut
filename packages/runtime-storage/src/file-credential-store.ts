import fs from 'node:fs/promises';
import {
  CredentialStoreError,
  checkCredentialKey,
  checkCredentialSecret,
  providerCredentialKey,
  type CredentialStore,
} from './credential-store.ts';
import { readJson, writeJsonAtomic } from './json-file.ts';
import { RuntimeStorageCredentials as SC } from '@baocut/protocol/messages/runtime-storage';

/**
 * 开发版本的凭据存放（架构设计 §6.8）：`<home>/store/model-credentials.json`，0600，临时文件加改名写入。
 *
 * - 文件是 `{ formatVersion: 2, credentials: { "<key>": "<密钥>" } }`，key 带命名空间（`provider:openai`、`node:<nodeId>`）。
 * - 之前的版本写的是 `{ formatVersion: 1, credentials: { "<providerId>": "<密钥>" } }`：照原样读入，每个 providerId 当作
 *   `provider:<providerId>`；下一次写入时换成新格式。
 * - 第一次操作时读文件，之后内存里的状态是权威、文件是它的快照；写入串行。文件不存在或认不出时从空开始。
 */
export class FileCredentialStore implements CredentialStore {
  readonly kind = 'file' as const;
  readonly file: string;
  #entries: Map<string, string> | null = null;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  get(key: string): Promise<string | null> {
    checkCredentialKey(key);
    return this.#serial(async (entries) => entries.get(key) ?? null);
  }

  has(key: string): Promise<boolean> {
    checkCredentialKey(key);
    return this.#serial(async (entries) => entries.has(key));
  }

  set(key: string, secret: string): Promise<void> {
    checkCredentialKey(key);
    checkCredentialSecret(secret);
    return this.#serial(async (entries) => {
      // 先写文件再改内存：写不进去时两边都不变。
      await this.#write(new Map(entries).set(key, secret));
      entries.set(key, secret);
    });
  }

  delete(key: string): Promise<void> {
    checkCredentialKey(key);
    return this.#serial(async (entries) => {
      if (!entries.has(key)) return;
      const next = new Map(entries);
      next.delete(key);
      await this.#write(next);
      entries.delete(key);
    });
  }

  /** 文件里有哪些 key（不含密钥）。只给迁移用，不在 `CredentialStore` 接口上。 */
  keys(): Promise<string[]> {
    return this.#serial(async (entries) => [...entries.keys()]);
  }

  /** 已经没有密钥时删掉文件（迁移到钥匙串之后）。还有密钥时什么也不做。 */
  removeIfEmpty(): Promise<boolean> {
    return this.#serial(async (entries) => {
      if (entries.size > 0) return false;
      await fs.rm(this.file, { force: true });
      return true;
    });
  }

  #serial<T>(run: (entries: Map<string, string>) => Promise<T>): Promise<T> {
    const next = this.#chain.then(async () => run(await this.#load()));
    this.#chain = next.catch(() => {});
    return next;
  }

  async #load(): Promise<Map<string, string>> {
    if (!this.#entries) this.#entries = parse(await readJson<unknown>(this.file).catch(() => null));
    return this.#entries;
  }

  async #write(entries: Map<string, string>): Promise<void> {
    const credentials = Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    try {
      await writeJsonAtomic(this.file, { formatVersion: 2, credentials }, { mode: 0o600 });
      // umask 可能放宽了新文件的权限：改名之后再收紧一次。
      await fs.chmod(this.file, 0o600);
    } catch (error) {
      // 文件系统的错误信息只有路径与原因，没有密钥。
      throw new CredentialStoreError('internal', SC.fileWriteFailed({ code: (error as NodeJS.ErrnoException).code ?? 'unknown' }).text);
    }
  }
}

function parse(value: unknown): Map<string, string> {
  const entries = new Map<string, string>();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return entries;
  const { formatVersion, credentials } = value as { formatVersion?: unknown; credentials?: unknown };
  if ((formatVersion !== 1 && formatVersion !== 2) || typeof credentials !== 'object' || credentials === null) return entries;
  for (const [id, secret] of Object.entries(credentials as Record<string, unknown>)) {
    if (typeof secret !== 'string' || !secret) continue;
    // 第 1 版的键是不带命名空间的 providerId。
    const key = formatVersion === 1 ? providerCredentialKey(id) : id;
    try {
      checkCredentialKey(key);
    } catch {
      continue;
    }
    entries.set(key, secret);
  }
  return entries;
}
