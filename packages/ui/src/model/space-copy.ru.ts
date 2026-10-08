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
  sort: { recent: "Недавняя активность", name: "Название", kind: "Тип" },
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
};
