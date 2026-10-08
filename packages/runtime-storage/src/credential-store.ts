import { RuntimeStorageCredentials as SC } from '@baocut/protocol/messages/runtime-storage';
import type { Localized } from '@baocut/protocol';
/**
 * 凭据的存放（架构设计 §6.8）：在线 Provider 的 API key 与已配对节点的令牌都经这个接口读写。
 *
 * - key 是带命名空间的稳定字符串：`provider:<providerId>`（如 `provider:openai`、`provider:custom:<slug>`）、
 *   `node:<nodeId>`。接口不提供列出全部密钥的方法。
 * - 两个后端由构建类型决定：开发版本是本机文件（`FileCredentialStore`），正式版本是系统的安全存储
 *   （`KeychainCredentialStore`，首版只有 macOS 钥匙串）。后端不可用时如实报错，不悄悄换成另一个后端。
 * - 错误是封闭集合，信息里不含密钥。
 */
export interface CredentialStore {
  readonly kind: CredentialStoreKind;
  /** 没有这个 key 时 null。 */
  get(key: string): Promise<string | null>;
  /** 新增或替换。密钥不能为空。 */
  set(key: string, secret: string): Promise<void>;
  /** 没有这个 key 时什么也不做。 */
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

export type CredentialStoreKind = 'file' | 'keychain';

/**
 * 读写凭据失败的原因：
 * - `denied`：用户或系统拒绝了访问；
 * - `unavailable`：存放此刻不可用（助手程序缺失或启动不了、钥匙串被锁、超时）；
 * - `unsupported`：这个平台没有实现；
 * - `internal`：其他错误（响应不合规、文件读写失败）。
 *
 * 「没有这个 key」不是错误：`get` 返回 null，`delete` 照常完成。
 */
export type CredentialErrorCode = 'denied' | 'unavailable' | 'unsupported' | 'internal';

export class CredentialStoreError extends Error {
  readonly code: CredentialErrorCode;

  constructor(code: CredentialErrorCode, message: string) {
    super(message);
    this.name = 'CredentialStoreError';
    this.code = code;
  }
}

const REASONS: Record<CredentialErrorCode, () => Localized> = {
  denied: () => SC.denied(),
  unavailable: () => SC.unavailable(),
  unsupported: () => SC.unsupported(),
  internal: () => SC.internal(),
};

/** 给人看的一句原因（不含密钥），用于 Provider 的不可用说明与网关错误。 */
export function credentialProblem(error: unknown): { code: CredentialErrorCode; message: string } {
  if (error instanceof CredentialStoreError) return { code: error.code, message: SC.problem({ reason: REASONS[error.code](), message: error.message }).text };
  return { code: 'internal', message: REASONS.internal().text };
}

const KEY_PATTERN = /^(provider|node):[^\s\p{Cc}]{1,256}$/u;

export function providerCredentialKey(providerId: string): string {
  return `provider:${providerId}`;
}

export function nodeCredentialKey(nodeId: string): string {
  return `node:${nodeId}`;
}

/** 校验 key 与密钥的形状；不合规是调用方的错误。 */
export function checkCredentialKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new TypeError(`Invalid credential key: ${JSON.stringify(key.slice(0, 80))}`);
}

export function checkCredentialSecret(secret: string): void {
  if (typeof secret !== 'string' || secret === '') throw new TypeError('Credential secret must not be empty');
}
