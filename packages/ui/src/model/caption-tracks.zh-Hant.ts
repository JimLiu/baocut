import type { CaptionTracksMessages } from './caption-tracks.ts';

export const zhHant: CaptionTracksMessages = {
  translation: '譯文',
  original: '原文',
  withName: (label: string, name: string) => `${label}（${name}）`,
};
