import fs from 'node:fs/promises';
import path from 'node:path';
import type { ModelSelfTestResult } from '@baocut/protocol';

/**
 * 安装记录（架构设计 §6.3）：`<models-root>/.bcut-installs.json`，记下用户装过哪些模型包与它们最近一次自检的结果。
 *
 * 共享组件的引用由它算出：一个组件的持有者是用到它的、记录在案或文件齐全的模型包。删除模型包时只删没有别的持有者的
 * 组件。记录与模型文件放在一起：移动模型目录（`models.setDir`）时合并进新目录，引用跟着走。文件坏了按空记录处理（引用退回到
 * 「文件齐全的模型包」）。
 */

export const INSTALL_RECORD_FILE = '.bcut-installs.json';

export interface InstallRecordEntry {
  installedAt: string;
  selfTest?: ModelSelfTestResult;
}

export interface InstallRecord {
  format_version: 1;
  bundles: Record<string, InstallRecordEntry>;
}

const queues = new Map<string, Promise<unknown>>();

export async function readInstallRecord(root: string): Promise<InstallRecord> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(root, INSTALL_RECORD_FILE), 'utf8')) as Partial<InstallRecord>;
    if (raw.format_version === 1 && typeof raw.bundles === 'object' && raw.bundles !== null && !Array.isArray(raw.bundles)) {
      return { format_version: 1, bundles: raw.bundles };
    }
  } catch {
    // 没有或坏了：空记录。
  }
  return { format_version: 1, bundles: {} };
}

/** 读改写，同一个根串行执行；写临时文件再改名。 */
export function updateInstallRecord(root: string, change: (record: InstallRecord) => void): Promise<InstallRecord> {
  const previous = queues.get(root) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const record = await readInstallRecord(root);
      change(record);
      await fs.mkdir(root, { recursive: true });
      const file = path.join(root, INSTALL_RECORD_FILE);
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`);
      await fs.rename(tmp, file);
      return record;
    });
  queues.set(root, next);
  const done = () => {
    if (queues.get(root) === next) queues.delete(root);
  };
  next.then(done, done);
  return next;
}
