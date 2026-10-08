import { pluralForm } from '@baocut/protocol';
import type { EditorOpsMessages } from './editor-ops.ts';

const FILES = (n: number) => pluralForm('ru', n, { one: `${n} файл`, few: `${n} файла`, many: `${n} файлов`, other: `${n} файла` });
const SENTENCES = (n: number) => pluralForm('ru', n, { one: `${n} предложение`, few: `${n} предложения`, many: `${n} предложений`, other: `${n} предложения` });
const DUB_STATUS = {"failed": "Не синтезировано", "needs-fit": "Слишком длинно", "stale": "Перевод устарел", "draft": "Не размещено"} as const;
const STATUS_COUNT = {"failed": "не синтезировано", "needs-fit": "слишком длинно", "stale": "с устаревшим переводом", "draft": "не размещено"} as const;

export const ru: EditorOpsMessages = {
  dubStatus: DUB_STATUS,
  dubStatusCount: (n, status) => `${SENTENCES(n)}: ${STATUS_COUNT[status]}`,
  stemVocals: "Отделённый голос",
  stemBackground: "Отделённый фон",
  background: "Фон",
  sentenceN: (n: number) => `Предложение ${n}`,
  dub: "Озвучка",
  files: FILES,
  sentences: SENTENCES,
  muted: (n: number) => `Без звука: ${SENTENCES(n)}`,
  dubTitle: (language: string | null) => `Озвучка · ${language ?? 'Неизвестный язык'}`,
  aside: (groups: number, files: number) => groups ? `${pluralForm('ru', groups, { one: `${groups} группа озвучки`, few: `${groups} группы озвучки`, many: `${groups} групп озвучки`, other: `${groups} группы озвучки` })} · ${FILES(files)}` : FILES(files),
};
