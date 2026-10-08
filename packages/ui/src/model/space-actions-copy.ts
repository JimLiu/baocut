import { defineMessages, type SpaceReference } from '@baocut/protocol';
import { zhHans } from './space-actions-copy.zh-Hans.ts';
import { zhHant } from './space-actions-copy.zh-Hant.ts';
import { ja } from './space-actions-copy.ja.ts';
import { ko } from './space-actions-copy.ko.ts';
import { es } from './space-actions-copy.es.ts';
import { fr } from './space-actions-copy.fr.ts';
import { de } from './space-actions-copy.de.ts';
import { nl } from './space-actions-copy.nl.ts';
import { ptBR } from './space-actions-copy.pt-BR.ts';
import { it } from './space-actions-copy.it.ts';
import { ru } from './space-actions-copy.ru.ts';
import { pl } from './space-actions-copy.pl.ts';
import { tr } from './space-actions-copy.tr.ts';
import { vi } from './space-actions-copy.vi.ts';

/** Space 条目动作的文案（model/space-actions.ts；译文在 `space-actions-copy.<语言>.ts`）。 */
const en = {
  edit: {
    video: 'Open video',
    'source-video': 'Edit in the source video',
    'new-video': 'New video from this asset',
    text: 'Edit text',
    version: 'Save a copy and edit',
  },
  trashed: 'Restore this item from the Trash first',
  editGenerating: 'Still generating; you can edit it when it’s done',
  editMissing: 'File not found; reconnect it before editing',
  editFailed: 'Generation failed; there’s no file to edit',
  editPackage: 'Video packages (portable packages) can’t be edited',
  editText: 'Saving a new version of the text isn’t available here yet; continue in a session and let the Agent change it',
  editVersion: 'Manual edits to images, audio and templates aren’t available yet; continue in a session and let the Agent change it',
  newVideoOutside: 'This file isn’t in a project or session folder, so it can’t be used for a new video yet',
  packageGenerating: 'Still exporting; you can open it when it’s done',
  packageMissing: 'Can’t find this file',
  packageFailed: 'Export failed; there’s no package to open',
  packageOutside: 'This package isn’t in a project or session folder, so it can’t be opened yet',
  continueTrashed: 'Restore this item from the Trash before bringing it into a session',
  purgeGenerating: 'The task is still running; cancel it on the Tasks page first',
  purgeNotTrashed: 'Move it to the Trash first, then delete it from the Trash',
  referenceKind: {
    'video-asset': 'Video asset',
    job: 'Running task',
    unverified: 'Can’t confirm',
    'user-file': 'Other files in the video folder',
  } satisfies Record<SpaceReference['kind'], string>,
  importAllFailed: (count: number, error: string) => `None of the ${count} files were imported: ${error}`,
  importFailed: (error: string) => `Not imported: ${error}`,
  imported: (count: number) => `Imported ${count} ${count === 1 ? 'asset' : 'assets'}`,
  copiedAll: 'copied into the project’s imports/',
  copiedSome: (count: number) => `${count} copied into the project’s imports/`,
  notImported: (count: number) => `${count} not imported`,
  /** 随消息带上的条目：`names` 是前两个名字，`total` 是总数。 */
  references: (names: readonly string[], total: number) => {
    const quoted = names.map((name) => `“${name}”`).join(', ');
    return total > names.length ? `Space items ${quoted} and ${total - names.length} more` : `Space ${total === 1 ? 'item' : 'items'} ${quoted}`;
  },
  referenceOutput: 'Output',
};
export type SpaceActionsMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
