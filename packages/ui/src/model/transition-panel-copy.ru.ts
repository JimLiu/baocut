import type { TransitionPanelMessages } from './transition-panel-copy.ts';

export const ru: TransitionPanelMessages = {
  slot: { in: "Появление", out: "Исчезновение" },
  choice: {
    none: "Нет",
    dissolve: "Растворение",
    wipe: "Вытеснение",
    slide: "Выезд",
    zoom: "Масштабирование",
    'dip-to-color': "Переход через цвет",
    push: "Вытеснение",
  },
  direction: { right: "Справа", left: "Слева", down: "Снизу", up: "Сверху" },
  easing: { linear: "Линейно", 'ease-in': "Плавно в начале", 'ease-out': "Плавно в конце", 'ease-in-out': "Плавно в начале и в конце" },
};
