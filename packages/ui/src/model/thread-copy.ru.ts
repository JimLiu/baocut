import { pluralForm } from '@baocut/protocol';
import type { ThreadMessages } from './thread-copy.ts';

export const ru: ThreadMessages = {
  videoTools: {
    videos_list: "Показать список видео",
    videos_create: "Новое видео",
    videos_inspect: "Прочитать видео",
    edits_apply: "Редактировать видео",
    edits_undo: "Отменить правки",
  },
  toolTitle: (action: string, label: string) => `${action}: ${label}`,
  steps: { command: "Выполнить команду", read: "Прочитать файл", edit: "Изменить файл", search: "Поиск", other: "Другой инструмент" },
  phrase: {
    command: "выполнены команды",
    read: (count: number) => pluralForm('ru', count, { one: `прочитан ${count} файл`, few: `прочитано ${count} файла`, many: `прочитано ${count} файлов`, other: `прочитано ${count} файла` }),
    edit: (count: number) => pluralForm('ru', count, { one: `изменён ${count} файл`, few: `изменено ${count} файла`, many: `изменено ${count} файлов`, other: `изменено ${count} файла` }),
    search: "выполнен поиск",
    video: (count: number) => pluralForm('ru', count, { one: `записана ${count} правка видео`, few: `записаны ${count} правки видео`, many: `записано ${count} правок видео`, other: `записано ${count} правки видео` }),
    tool: "вызваны инструменты",
  },
  summary: (phrases: readonly string[]) => {
    const text = phrases.join(", ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  },
  thinking: "Рассуждение",
  stepsFallback: "Шаги",
};
