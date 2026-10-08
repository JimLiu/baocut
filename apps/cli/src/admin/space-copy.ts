import { defineMessages } from '@baocut/protocol';
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** 管理桶 `baocut space …` 的文案（英文是键与类型的来源，译文在 `space-copy.<语言>.ts`）。 */
const en = {
  help: `Usage:
  baocut space rescan              Scan the source folders again
  baocut space rebuild             Rebuild the Space catalog from the source folders and records;
                                   the content index rereads all videos in the background
  baocut space trash|restore <entry id>
                                   Move to the Trash / restore from the Trash (files aren't touched;
                                   for video entries the video folder moves into / out of the Trash)
  baocut space purge <entry id>    Permanently delete an entry in the Trash; not deleted while
                                   a video or task still uses it, and the references are listed
  baocut space delete-video <entry id>
                                   Delete a video: moves the video folder to the Trash, restorable within
                                   the retention period; original files of linked assets aren't touched
  baocut space continue <entry id> [--conversation <session id>]
                                   Continue a session from an entry: a reference (identifiers and metadata only) goes with
                                   the next message; without a session, one is picked based on where the entry is, or created`,
  usage: [
    'Usage: baocut space rescan | rebuild | trash <entry id> | restore <entry id> | purge <entry id> | delete-video <entry id>',
    '       baocut space continue <entry id> [--conversation <session id>]',
  ].join('\n'),
  entryUsage: (action: string) => `Usage: baocut space ${action} <entry id>`,
  continueUsage: 'Usage: baocut space continue <entry id> [--conversation <session id>]',
  flagNotAccepted: (action: string, key: string) => `baocut space ${action} doesn't accept --${key}`,
  rescanStarted: 'Rescan started',
  rebuilt: (entries: number, pendingVideos: number) =>
    `Rebuilt the catalog: ${plural(entries, 'entry', 'entries')}; the content index is rereading ${plural(pendingVideos, 'video', 'videos')} in the background, so search results are incomplete until it finishes`,
  purgeBlocked: (id: string) => `${id} is still used by a video or task; not deleted`,
  movedToTrash: (id: string, name: string) => `Moved to Trash: ${id}  ${name}`,
  restoredFromTrash: (id: string, name: string) => `Restored from Trash: ${id}  ${name}`,
  purged: (id: string) => `Permanently deleted ${id}`,
  notPurged: (id: string) => `Didn't delete ${id}: it's still referenced`,
  videoTrashed: (name: string, entryId: string, retentionDays: number | null) =>
    `Moved video "${name}" to the Trash: ${entryId} (restore with baocut space restore ${entryId}${retentionDays === null ? '' : `; deleted for good after ${plural(retentionDays, 'day', 'days')}`})`,
  relatedKept: (n: number) => `${plural(n, 'entry', 'entries')} exported or generated from it stay where they are`,
  continued: (created: boolean, id: string, cwd: string) => `${created ? 'Created session' : 'Using session'} ${id}  working folder ${cwd}`,
  referenceNext: (name: string, id: string) =>
    `A reference to entry "${name}" will go with the next message: baocut chat "…" --conversation ${id}`,
};

export type SpaceMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
