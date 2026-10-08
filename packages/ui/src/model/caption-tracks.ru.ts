import type { CaptionTracksMessages } from './caption-tracks.ts';

export const ru: CaptionTracksMessages = {
  translation: 'Перевод',
  original: 'Оригинал',
  withName: (label: string, name: string) => `${label} (${name})`,
};
