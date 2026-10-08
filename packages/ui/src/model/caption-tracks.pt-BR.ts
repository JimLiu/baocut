import type { CaptionTracksMessages } from './caption-tracks.ts';

export const ptBR: CaptionTracksMessages = {
  translation: "Tradução",
  original: "Original",
  withName: (label: string, name: string) => `${label} (${name})`,
};
