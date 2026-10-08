import fs from 'node:fs/promises';
import type { RuntimeDiscovery } from '@baocut/protocol';
import type { RuntimeHome } from './home.ts';
import { readJson, writeJsonAtomic } from './json-file.ts';

/**
 * 发现信息与实例锁（架构设计 §2.2）。
 *
 * 发现文件里有连接令牌，只给当前用户读写（0600）。读到发现文件不代表 Runtime 可用：
 * 调用方还要验证进程存活并完成握手。
 */
export async function writeDiscovery(home: RuntimeHome, discovery: RuntimeDiscovery): Promise<void> {
  await writeJsonAtomic(home.discoveryFile, discovery, { mode: 0o600 });
}

export async function readDiscovery(home: RuntimeHome): Promise<RuntimeDiscovery | null> {
  return readJson<RuntimeDiscovery>(home.discoveryFile);
}

export async function removeDiscovery(home: RuntimeHome, instanceId: string): Promise<void> {
  const current = await readDiscovery(home).catch(() => null);
  if (current && current.instanceId !== instanceId) return;
  await fs.rm(home.discoveryFile, { force: true });
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface LockRecord {
  pid: number;
  instanceId: string;
  acquiredAt: string;
}

export type LockResult = { ok: true } | { ok: false; holder: LockRecord };

/**
 * 取得实例锁。锁文件记录持有者 PID；持有者已退出时才接管（不因为「看起来过期」就抢）。
 */
export async function acquireInstanceLock(home: RuntimeHome, instanceId: string): Promise<LockResult> {
  await fs.mkdir(home.root, { recursive: true });
  const record: LockRecord = { pid: process.pid, instanceId, acquiredAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fs.writeFile(home.lockFile, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
      return { ok: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = await readJson<LockRecord>(home.lockFile).catch(() => null);
      if (holder && isProcessAlive(holder.pid)) return { ok: false, holder };
      await fs.rm(home.lockFile, { force: true });
    }
  }
  const holder = await readJson<LockRecord>(home.lockFile);
  return holder ? { ok: false, holder } : { ok: true };
}

export async function releaseInstanceLock(home: RuntimeHome, instanceId: string): Promise<void> {
  const holder = await readJson<LockRecord>(home.lockFile).catch(() => null);
  if (holder?.instanceId === instanceId) await fs.rm(home.lockFile, { force: true });
}
