import { credentialProblem, type CredentialErrorCode, type CredentialStore } from './credential-store.ts';
import type { FileCredentialStore } from './file-credential-store.ts';

/** 迁移用到的日志接口；Harness 的 `Logger` 在结构上满足它。字段里只有 key，没有密钥。 */
export interface CredentialMigrationLog {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
}

export interface CredentialMigrationResult {
  migrated: string[];
  failed: { key: string; code: CredentialErrorCode }[];
}

/**
 * 切到系统的安全存储时（架构设计 §6.8）：把明文文件里的密钥逐个写进 `to`，写成功的从文件里删掉；全部迁走后删除文件。
 * 部分失败时，没迁走的留在文件里，下次启动再试；文件里的密钥不会被 `to` 读到（不回退到明文）。日志只记 key 与原因。
 */
export async function migrateFileCredentials(
  from: FileCredentialStore,
  to: CredentialStore,
  log?: CredentialMigrationLog,
): Promise<CredentialMigrationResult> {
  const result: CredentialMigrationResult = { migrated: [], failed: [] };
  const keys = await from.keys();
  // 没有可迁的密钥（没有文件，或文件认不出）：什么也不动。
  if (keys.length === 0) return result;
  for (const key of keys) {
    try {
      const secret = await from.get(key);
      if (secret !== null) await to.set(key, secret);
      await from.delete(key);
      result.migrated.push(key);
    } catch (error) {
      const { code, message } = credentialProblem(error);
      result.failed.push({ key, code });
      log?.warn('Credential was not migrated to secure storage; left in the original file', { key, code, reason: message });
    }
  }
  if (result.failed.length === 0) await from.removeIfEmpty();
  if (result.migrated.length > 0) log?.info('Migrated credentials to secure storage', { keys: result.migrated });
  return result;
}
