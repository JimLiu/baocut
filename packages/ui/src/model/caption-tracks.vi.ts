import type { CaptionTracksMessages } from './caption-tracks.ts';

export const vi: CaptionTracksMessages = {
  translation: "Bản dịch",
  original: "Bản gốc",
  withName: (label: string, name: string) => `${label} (${name})`,
};
