import { CredentialStoreError, type CredentialStore } from './credential-store.ts';

/**
 * 只读的凭据存放（CLI 独立使用与发布 §7.1）：链接账号的密钥属于另一个 Runtime Home，这边只能 `get` 与 `has`。`set` 与 `delete`
 * 一律拒绝，不碰底下的存放；模型服务配置在调用之前就以 `ACCOUNT_LINKED` 拒绝，走到这里说明有遗漏。
 */
export class ReadOnlyCredentialStore implements CredentialStore {
  readonly #inner: CredentialStore;

  constructor(inner: CredentialStore) {
    this.#inner = inner;
  }

  get kind() {
    return this.#inner.kind;
  }

  get(key: string): Promise<string | null> {
    return this.#inner.get(key);
  }

  has(key: string): Promise<boolean> {
    return this.#inner.has(key);
  }

  set(): Promise<void> {
    return Promise.reject(new CredentialStoreError('unsupported', 'Linked credentials are read-only'));
  }

  delete(): Promise<void> {
    return Promise.reject(new CredentialStoreError('unsupported', 'Linked credentials are read-only'));
  }
}
