import type { CaptionTracksMessages } from './caption-tracks.ts';

export const ja: CaptionTracksMessages = {
  translation: '翻訳',
  original: '原文',
  withName: (label: string, name: string) => `${label}（${name}）`,
};
