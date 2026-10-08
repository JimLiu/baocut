import { pluralForm } from '@baocut/protocol';
import type { EditorOpsMessages } from './editor-ops.ts';

const FILES = (n: number) => pluralForm('pl', n, { one: `${n} plik`, few: `${n} pliki`, many: `${n} plików`, other: `${n} pliku` });
const SENTENCES = (n: number) => pluralForm('pl', n, { one: `${n} zdanie`, few: `${n} zdania`, many: `${n} zdań`, other: `${n} zdania` });
const DUB_STATUS = {"failed": "Nie zsyntetyzowano", "needs-fit": "Za długie", "stale": "Tłumaczenie nieaktualne", "draft": "Nie umieszczono"} as const;
const STATUS_COUNT = {"failed": "nie zsyntetyzowano", "needs-fit": "za długie", "stale": "z nieaktualnym tłumaczeniem", "draft": "nie umieszczono"} as const;

export const pl: EditorOpsMessages = {
  dubStatus: DUB_STATUS,
  dubStatusCount: (n, status) => `${SENTENCES(n)}: ${STATUS_COUNT[status]}`,
  stemVocals: "Oddzielony głos",
  stemBackground: "Oddzielone tło",
  background: "Tło",
  sentenceN: (n: number) => `Zdanie ${n}`,
  dub: "Dubbing",
  files: FILES,
  sentences: SENTENCES,
  muted: (n: number) => `Wyciszone: ${SENTENCES(n)}`,
  dubTitle: (language: string | null) => `Dubbing · ${language ?? 'Nieznany język'}`,
  aside: (groups: number, files: number) => groups ? `${pluralForm('pl', groups, { one: `${groups} grupa dubbingu`, few: `${groups} grupy dubbingu`, many: `${groups} grup dubbingu`, other: `${groups} grupy dubbingu` })} · ${FILES(files)}` : FILES(files),
};
