import { pluralForm } from '@baocut/protocol';
import type { VideoInfoMessages } from './video-info-copy.ts';

export const ru: VideoInfoMessages = {
  section: { media: "Источник и медиа", source: "Сведения об источнике" },
  speakers: (count: number) => pluralForm('ru', count, { one: `${count} говорящий`, few: `${count} говорящих`, many: `${count} говорящих`, other: `${count} говорящего` }),
  chapters: (count: number) => pluralForm('ru', count, { one: `${count} глава`, few: `${count} главы`, many: `${count} глав`, other: `${count} главы` }),
  paragraphs: (count: number) => pluralForm('ru', count, { one: `${count} абзац`, few: `${count} абзаца`, many: `${count} абзацев`, other: `${count} абзаца` }),
  list: (names: readonly string[]) => names.join(", "),
  sourceKind: {
    'link-import': "Импортировано по URL",
    'user-import': "Локальный файл",
    generated: "Создано",
    library: "Пользовательская библиотека",
  },
  row: {
    contents: "Содержимое",
    translation: "Перевод",
    location: "Расположение",
    media: "Медиа",
    transcript: "Расшифровка",
    channel: "Канал",
    published: "Опубликовано",
    platform: "Платформа",
    mediaId: "ID видео",
    url: "Ссылка",
  },
};
