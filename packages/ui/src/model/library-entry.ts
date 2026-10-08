import { defineMessages, type LibraryEntrySummary, type LibraryName } from '@baocut/protocol';
import { zhHans } from './library-entry.zh-Hans.ts';
import { zhHant } from './library-entry.zh-Hant.ts';
import { ja } from './library-entry.ja.ts';
import { ko } from './library-entry.ko.ts';
import { es } from './library-entry.es.ts';
import { fr } from './library-entry.fr.ts';
import { de } from './library-entry.de.ts';
import { nl } from './library-entry.nl.ts';
import { ptBR } from './library-entry.pt-BR.ts';
import { it } from './library-entry.it.ts';
import { ru } from './library-entry.ru.ts';
import { pl } from './library-entry.pl.ts';
import { tr } from './library-entry.tr.ts';
import { vi } from './library-entry.vi.ts';

const en = {
  versionConflict: 'This entry was just changed somewhere else, so your edit wasn’t saved. The latest version has been reloaded. Please make your change again.',
  /** `action` 是调用方给的动作短语（英文用小写动词短语，例如 `rename`）。 */
  failed: (action: string, message: string) => `Couldn’t ${action}: ${message}`,
};
export type LibraryEntryMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 用户库（架构设计 §5.9）条目的小算子：术语表与品牌库两处共用。
 */

/** 条目在缓存里的键：同一个版本的内容不会再变。 */
export function entryKey(entry: { library: LibraryName; id: string; version: number }): string {
  return `${entry.library}/${entry.id}@${entry.version}`;
}

function detailsCode(error: unknown): string | null {
  const details = (error as { details?: unknown } | null)?.details;
  return details && typeof details === 'object' && typeof (details as { code?: unknown }).code === 'string'
    ? (details as { code: string }).code
    : null;
}

/** 别处（另一个窗口、智能体、CLI）先改了这一条：`library.put` 带的 `expectedVersion` 不是当前版本。 */
export function isVersionConflict(error: unknown): boolean {
  return detailsCode(error) === 'LIBRARY_VERSION_CONFLICT';
}

/** 版本冲突时给用户的话：说清楚发生了什么、接下来界面会怎么做。 */
export const versionConflictText = (): string => M.versionConflict;

/** 失败时的提示：`没能<做什么>：<原因>`；冲突时换成上面那句。 */
export function libraryErrorText(action: string, error: unknown): string {
  if (isVersionConflict(error)) return versionConflictText();
  const message = error instanceof Error ? error.message : String(error);
  return M.failed(action, message);
}

/** 摘要比手上那份新：主题送来了更新的版本。 */
export function isNewer(summary: Pick<LibraryEntrySummary, 'version'> | undefined, version: number): boolean {
  return !!summary && summary.version > version;
}
