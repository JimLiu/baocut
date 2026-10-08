import type { NewFlowMessages } from './new-flow.ts';

const gap = (name: string) => (/[A-Za-z0-9]$/.test(name) ? ' ' : '');

export const ja: NewFlowMessages = {
  bilibili: 'ビリビリ動画',
  directLink: '直接リンク',
  webPage: 'Web ページ',
  videoLink: (site: string) => `${site} の動画リンク`,
  into: (name: string) => `${name}${gap(name)}に翻訳`,
  translated: (language: string) => `翻訳完了 · ${language}${gap(language)}の字幕を動画に配置しました`,
};
