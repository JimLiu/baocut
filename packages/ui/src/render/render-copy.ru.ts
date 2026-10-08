import type { RenderMessages } from './render-copy.ts';

export const ru: RenderMessages = {
  confetti: {
    shapes: {
      rect: "Бумага",
      strip: "Полоска",
      circle: "Точка",
      ellipse: "Эллипс",
      triangle: "Треугольник",
      diamond: "Ромб",
      star: "Звезда",
      starlet: "Четырёхлучевая звезда",
      sparkle: "Блёстка",
      heart: "Сердце",
      petal: "Лепесток",
      ribbon: "Лента",
    },
    styles: {
      'rainbow-paper': "Радужная бумага",
      'pastel-fall': "Пастельное падение",
      'neon-streamers': "Неоновые ленты",
      'golden-starburst': "Золотая вспышка",
      'festival-fireworks': "Праздничный фейерверк",
      'hearts-petals': "Сердца и лепестки",
      'party-cannons': "Праздничные пушки",
      'curling-ribbons': "Вьющиеся ленты",
      'geometric-pop': "Геометрический взрыв",
      'champagne-sparkle': "Искры шампанского",
    },
  },
  fonts: {
    tableFailed: (status) => `Не удалось получить таблицу шрифта: ${status}`,
    tableLength: (expected, got) => `Неверная длина таблицы шрифта: ожидалось ${expected} байт, получено ${got}`,
    localMissing: (family) => `Локальный шрифт ${family} больше недоступен`,
    notFound: (name) => `Шрифт ${name} не найден. Сначала выполните npm run build:wasm`,
    unreadable: (name, status) => `Не удалось прочитать шрифт ${name} (${status})`,
    unreadableUrl: (url) => `Не удалось прочитать шрифт: ${url}`,
  },
  planner: {
    wasmMissing: "WASM предпросмотра недоступен. Сначала выполните npm run build:wasm",
    reloading: "Планировщик кадров перезагружается",
    crashed: (message) => `Ошибка планировщика кадров, перезагрузка: ${message}`,
    reloadFailed: "Не удалось перезагрузить планировщик кадров",
  },
};
