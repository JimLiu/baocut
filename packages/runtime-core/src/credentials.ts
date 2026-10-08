import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '@baocut/harness';
import {
  FileCredentialStore,
  KeychainCredentialStore,
  migrateFileCredentials,
  type CredentialHelperCommand,
  type CredentialStore,
  type CredentialStoreKind,
  type RuntimeHome,
} from '@baocut/runtime-storage';
import { findBundledBinary } from '@baocut/process-host';

/**
 * 凭据存储的装配（架构设计 §6.8）。后端由构建类型决定：开发版本是 `<home>/store/model-credentials.json`，
 * 正式版本是系统的安全存储（经 `credential-helper`）。在线 Provider 的密钥与节点的令牌共用同一个实例。
 */

/**
 * 找凭据助手：`BAOCUT_CREDENTIAL_HELPER` 环境变量；随应用分发的原生程序目录（`BAOCUT_BIN_DIR`、打包后的 `<resources>/bin`）；
 * 开发时从本模块往上找 cargo 产物目录里的 `{release,debug}/credential-helper`。都没有时 null。
 */
export function resolveCredentialHelperCommand(env: NodeJS.ProcessEnv = process.env): CredentialHelperCommand | null {
  if (env.BAOCUT_CREDENTIAL_HELPER) return { command: env.BAOCUT_CREDENTIAL_HELPER };
  const built = findBundledBinary('credential-helper', path.dirname(fileURLToPath(import.meta.url)), env);
  return built ? { command: built } : null;
}

export interface CredentialStoreOptions {
  /** 用哪种后端（默认 `file`），或者直接给一个实例（测试）。 */
  kind?: CredentialStoreKind | CredentialStore;
  /** 钥匙串后端的助手命令。不给时按 `resolveCredentialHelperCommand()` 找；null 表示没有助手（每个操作都报告不可用）。 */
  helper?: CredentialHelperCommand | null;
  /** 钥匙串后端一个操作的期限。 */
  timeoutMs?: number;
}

/**
 * 打开凭据存储。钥匙串后端先把明文文件里遗留的密钥迁进去（§6.8）：迁不进去时留在文件里、记日志，但从不读那个文件，
 * Provider 与节点如实报告凭据不可用。
 */
export async function openCredentialStore(home: RuntimeHome, log: Logger, options: CredentialStoreOptions = {}): Promise<CredentialStore> {
  const kind = options.kind ?? 'file';
  if (typeof kind !== 'string') return kind;
  const file = new FileCredentialStore(home.modelCredentialsFile);
  if (kind === 'file') return file;
  const scoped = log.child('credentials');
  const helper = options.helper !== undefined ? options.helper : resolveCredentialHelperCommand();
  if (!helper) scoped.error('Credential helper not found: secrets and node tokens are unavailable');
  const keychain = new KeychainCredentialStore({ helper, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });
  await migrateFileCredentials(file, keychain, scoped);
  return keychain;
}
