import type { NewFlowMessages } from './new-flow.ts';

export const zhHant: NewFlowMessages = {
  bilibili: '嗶哩嗶哩',
  directLink: '直接連結',
  webPage: '網頁',
  videoLink: (site: string) => `${site} 影片連結`,
  into: (name: string) => `翻譯成${/^[A-Za-z0-9]/.test(name) ? ' ' : ''}${name}`,
  translated: (language: string) => `翻譯完成 · ${language}${/[A-Za-z0-9]$/.test(language) ? ' ' : ''}字幕已加到畫面上`,
};
