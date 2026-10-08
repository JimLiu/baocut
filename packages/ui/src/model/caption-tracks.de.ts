import type { CaptionTracksMessages } from './caption-tracks.ts';

export const de: CaptionTracksMessages = {
  translation: "Übersetzung",
  original: "Original",
  withName: (label: string, name: string) => `${label} (${name})`,
};
