import type { CaptionTracksMessages } from './caption-tracks.ts';

export const it: CaptionTracksMessages = {
  translation: "Traduzione",
  original: "Originale",
  withName: (label: string, name: string) => `${label} (${name})`,
};
