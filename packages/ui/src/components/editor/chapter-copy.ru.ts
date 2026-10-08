import { pluralForm } from '@baocut/protocol';
import type { ChapterMessages } from './chapter-copy.ts';

export const ru: ChapterMessages = {
  band: "Главы",
  prev: "Предыдущая глава",
  next: "Следующая глава",
  noChapters: "Глав пока нет",

  gap: "Нет главы",
  beforeFirst: "До первой главы",
  add: "Добавить главу у курсора воспроизведения",
  rename: "Переименовать…",
  remove: "Удалить эту главу",
  menuLabel: (title: string) => `Глава «${title}»`,
  gapMenuLabel: "Полоса глав",

  segmentLabel: (title: string, range: string) => `${title}, ${range}, нажмите для перехода к началу`,
  dragHint: "Перетащите для перемещения начала главы",

  addTitle: "Добавить главу",
  renameTitle: "Переименовать главу",
  titleLabel: "Название",
  addAt: (time: string) => `Начинается в ${time} и продолжается до следующей главы`,
  confirmAdd: "Добавить",
  confirmRename: "Переименовать",
  cancel: "Отмена",
  refusal: {
    exists: "У курсора воспроизведения уже есть глава",
    beyond: "Курсор воспроизведения в конце; здесь нельзя добавить главу",
    blank: "Заголовок не может быть пустым",
  },

  labels: { add: "Добавить главу", rename: "Переименовать главу", remove: "Удалить главу", move: "Переместить начало главы" },
  added: (title: string) => `Добавлена глава «${title}»`,
  renamed: (title: string) => `Переименовано в «${title}»`,
  removed: (title: string) => `Удалена глава «${title}»`,
  undo: "Отменить",

  clickRename: "Нажмите для переименования",
  jump: "Перейти к началу главы",
  paragraphs: (n: number) => pluralForm('ru', n, { one: `${n} абзац`, few: `${n} абзаца`, many: `${n} абзацев`, other: `${n} абзаца` }),
  empty: "В этой главе пока нет абзацев",
};
