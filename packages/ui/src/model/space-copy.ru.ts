import { pluralForm } from '@baocut/protocol';
import type { SpaceMessages } from './space-copy.ts';

export const ru: SpaceMessages = {
  kind: {
    video: "Видео",
    export: "Экспорт",
    'video-file': "Видеоматериал",
    image: "Изображение",
    audio: "Аудио",
    subtitle: "Субтитры",
    document: "Документ",
    package: "Пакет видео",
    template: "Шаблон",
  },
  categoryAll: "Все",
  favorite: "Избранное",
  trash: "Корзина",
  sort: { created: 'Дата создания', updated: 'Дата обновления', recent: "Недавняя активность", name: "Название", kind: "Тип" },
  status: {
    generating: "Генерация",
    candidate: "Вариант",
    applied: "Применено",
    published: "Опубликовано",
    'source-changed': "Источник изменён",
    missing: "Отсутствует",
    failed: "Ошибка",
  },
  statusAny: "Все статусы",
  statusNone: "Без статуса",
  noProject: "Вне проекта",
  removedProject: "Удалённый проект",
  conversation: (title: string) => `Сессия «${title}»`,
  kindCount: (kind: string, n: number) => `${kind} ${n}`,
  foundFiles: (name: string, n: number) => (n === 1 ? `Найдено: ${name}` : `Найдено: ${name} и ещё ${n - 1}`),
  fileStatus: (kind: string, status: string) => `${kind}: ${status}`,
  filesStatus: (n: number, status: string) =>
    `${pluralForm('ru', n, { one: `${n} файл`, few: `${n} файла`, many: `${n} файлов`, other: `${n} файла` })}: ${status}`,
};
