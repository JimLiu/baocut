import type { CaptionTracksMessages } from './caption-tracks.ts';

export const ko: CaptionTracksMessages = {
  translation: '번역',
  original: '원문',
  withName: (label: string, name: string) => `${label}(${name})`,
};
