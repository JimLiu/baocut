import type { DriverId, ImportableSession } from '@baocut/protocol';
import { IMPORT_COPY as I } from '../components/agent-import/import-copy.ts';
import { agoLabel, shortenPath } from './format.ts';

/*
 * 导入 Claude Code / Codex 的本机会话（产品设计 §3.1「导入外部会话」，原型 model-agent-import.js）里界面要算的东西：
 * 列表的筛选、每行下面那一行、读自哪里。落在哪、导入过没有由 Runtime 算（`agents.listImportable`）。
 */

/** Agent 的名字：探测结果里有就用它，没有时用内置的。 */
export function sourceName(driverId: DriverId, probed?: string | null): string {
  if (probed) return probed;
  return driverId === 'claude' ? 'Claude Code' : driverId === 'codex' ? 'Codex' : driverId;
}

/** 列表上面那一行写的出处。 */
export function sourceWhere(driverId: DriverId): string {
  return driverId === 'codex' ? I.whereCodex : I.whereClaude;
}

/** 列表：只列选中的那一家，搜第一句与目录（不分大小写），最近的在前。 */
export function filterImportable(
  list: readonly ImportableSession[],
  options: { driverId: DriverId | null; query: string },
): ImportableSession[] {
  const q = options.query.trim().toLowerCase();
  return list
    .filter((s) => !options.driverId || s.driverId === options.driverId)
    .filter((s) => !q || s.title.toLowerCase().includes(q) || (s.cwd ?? '').toLowerCase().includes(q))
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 每行下面的一行：目录 · 多久前 · 几轮（不知道几轮时不写）· 已导入。 */
export function importMeta(session: ImportableSession, now = Date.now()): string {
  return [
    session.cwd ? shortenPath(session.cwd) : I.noFolder,
    agoLabel(session.updatedAt, now),
    session.turns ? I.turns(session.turns) : null,
    session.importedAs ? I.imported : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
