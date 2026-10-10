import { defineMessages, type SpaceEntryKind, type SpaceEntryStatus } from '@baocut/protocol';
import { zhHans } from './space-copy.zh-Hans.ts';
import { zhHant } from './space-copy.zh-Hant.ts';
import { ja } from './space-copy.ja.ts';
import { ko } from './space-copy.ko.ts';
import { es } from './space-copy.es.ts';
import { fr } from './space-copy.fr.ts';
import { de } from './space-copy.de.ts';
import { nl } from './space-copy.nl.ts';
import { ptBR } from './space-copy.pt-BR.ts';
import { it } from './space-copy.it.ts';
import { ru } from './space-copy.ru.ts';
import { pl } from './space-copy.pl.ts';
import { tr } from './space-copy.tr.ts';
import { vi } from './space-copy.vi.ts';

/** Space 列表区的文案（model/space.ts；译文在 `space-copy.<语言>.ts`）。 */
const en = {
  kind: {
    video: 'Video',
    export: 'Export',
    'video-file': 'Video asset',
    image: 'Image',
    audio: 'Audio',
    subtitle: 'Subtitles',
    document: 'Document',
    package: 'Video package',
    template: 'Template',
  } satisfies Record<SpaceEntryKind, string>,
  categoryAll: 'All',
  favorite: 'Favorites',
  trash: 'Trash',
  sort: { created: 'Date created', updated: 'Date updated', recent: 'Recent activity', name: 'Name', kind: 'Type' },
  status: {
    generating: 'Generating',
    candidate: 'Candidate',
    applied: 'Applied',
    published: 'Published',
    'source-changed': 'Source changed',
    missing: 'Missing',
    failed: 'Failed',
  } satisfies Record<SpaceEntryStatus, string>,
  statusAny: 'All statuses',
  statusNone: 'No status',
  noProject: 'Not in a project',
  removedProject: 'Removed project',
  conversation: (title: string) => `Session “${title}”`,
  /** 卡片「N 个文件」的明细里的一项：类型与个数。 */
  kindCount: (kind: string, n: number) => `${kind} ${n}`,
  /** 只靠名下文件对上搜索或筛选时写是哪个文件：`n` 是对上的文件数。 */
  foundFiles: (name: string, n: number) => (n === 1 ? `Found: ${name}` : `Found: ${name} and ${n - 1} more`),
  /** 视频自己没有状态时替名下文件说话：一个文件写类型与状态，几个文件写个数与状态。 */
  fileStatus: (kind: string, status: string) => `${kind}: ${status}`,
  filesStatus: (n: number, status: string) => `${n} ${n === 1 ? 'file' : 'files'}: ${status}`,
};
export type SpaceMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
