import { pluralForm } from '@baocut/protocol';
import type { SpaceSearchMessages } from './space-search.ts';

export const ru: SpaceSearchMessages = {
  documentKind: { speech: "Расшифровка", caption: "Субтитры", translation: "Перевод", chapter: "Глава" },
  pendingVideos: (count: number) => pluralForm('ru', count, { one: `Индекс содержимого ${count} видео ещё обновляется; в результатах могут отсутствовать видео или быть устаревшие данные`, few: `Индекс содержимого ${count} видео ещё обновляется; в результатах могут отсутствовать видео или быть устаревшие данные`, many: `Индекс содержимого ${count} видео ещё обновляется; в результатах могут отсутствовать видео или быть устаревшие данные`, other: `Индекс содержимого ${count} видео ещё обновляется; в результатах могут отсутствовать видео или быть устаревшие данные` }),
  indexUpdating: "Индекс содержимого обновляется; результаты могут быть устаревшими",
  truncated: (count: number) => `Слишком много совпадений; показаны только первые ${count}`,
  notes: (notes: readonly string[]) => `${notes.join("; ")}.`,
  sourceTime: (clock: string) => `Время материала ${clock}`,
};
