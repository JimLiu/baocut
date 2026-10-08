import type { CaptionTracksMessages } from './caption-tracks.ts';

export const pl: CaptionTracksMessages = {
  translation: 'Tłumaczenie',
  original: 'Oryginał',
  withName: (label: string, name: string) => `${label} (${name})`,
};
