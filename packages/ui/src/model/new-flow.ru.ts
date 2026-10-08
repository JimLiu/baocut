import type { NewFlowMessages } from './new-flow.ts';

export const ru: NewFlowMessages = {
  bilibili: "Bilibili",
  directLink: "Прямая ссылка",
  webPage: "Веб-страница",
  videoLink: (site: string) => `${site} — ссылка на видео`,
  into: (name: string) => `Перевести на ${name}`,
  translated: (language: string) => `Перевод готов · ${language} — субтитры добавлены в видео`,
};
