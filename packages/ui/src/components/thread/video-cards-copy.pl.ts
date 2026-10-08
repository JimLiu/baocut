import type { VideoCardsMessages } from './video-cards-copy.ts';

export const pl: VideoCardsMessages = {
  earlier: (count: number) => `Wcześniej: ${count}`,
  pending: (count: number) => `Wymagają uwagi: ${count}`,
  earlierWithPending: (count: number, pending: number) => `Wcześniej: ${count}, wymagają uwagi: ${pending}`,
  earlierList: 'Wcześniejsze elementy',
};
