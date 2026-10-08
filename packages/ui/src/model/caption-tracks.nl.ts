import type { CaptionTracksMessages } from './caption-tracks.ts';

export const nl: CaptionTracksMessages = {
  translation: "Vertaling",
  original: "Origineel",
  withName: (label: string, name: string) => `${label} (${name})`,
};
