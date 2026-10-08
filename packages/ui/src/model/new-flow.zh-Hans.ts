import type { NewFlowMessages } from './new-flow.ts';

export const zhHans: NewFlowMessages = {
  bilibili: '哔哩哔哩',
  directLink: '直链',
  webPage: '网页',
  videoLink: (site: string) => `${site} 视频链接`,
  into: (name: string) => `翻译成${/^[A-Za-z]/.test(name) ? ' ' : ''}${name}`,
  translated: (language: string) => `翻译完成 · ${language}字幕已放到画面上`,
};
