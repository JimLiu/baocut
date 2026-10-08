import type { CaptionTracksMessages } from './caption-tracks.ts';

export const tr: CaptionTracksMessages = {
  translation: "Çeviri",
  original: "Özgün",
  withName: (label: string, name: string) => `${label} (${name})`,
};
