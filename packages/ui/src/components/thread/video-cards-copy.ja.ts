import type { VideoCardsMessages } from './video-cards-copy.ts';

export const ja: VideoCardsMessages = {
  earlier: (count: number) => `以前の ${count} 件`,
  pending: (count: number) => `${count} 件が要対応`,
  earlierWithPending: (count: number, pending: number) => `以前の ${count} 件、うち ${pending} 件が要対応`,
  earlierList: '以前の項目',
};
