import type { CaptionTracksMessages } from './caption-tracks.ts';

export const zhHans: CaptionTracksMessages = {
  translation: '译文',
  original: '原文',
  withName: (label: string, name: string) => `${label}（${name}）`,
};
