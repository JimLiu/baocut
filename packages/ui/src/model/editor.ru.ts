import type { EditorMessages } from './editor.ts';

export const ru: EditorMessages = {
  trackKind: { visual: "Визуальная", audio: "Аудио", subtitle: "Субтитры" },
  counter: "Счётчик",
  text: "Текст",
  shape: "Форма",
  composition: "Композиция",
  caption: "Субтитры",
  asset: "Материал",

  elements: {
    sticker: "наклейка",
    placeholder: "Заполнитель",
    whiteboard: "Доска",
    progress: "Индикатор выполнения",
    visualizer: "Звуковая волна",
    confetti: "Конфетти",
    draw: "Рисуется",
  },
  seconds: (value: string) => `${value} с`,
};
