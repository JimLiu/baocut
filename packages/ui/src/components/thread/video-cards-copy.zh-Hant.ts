import type { VideoCardsMessages } from './video-cards-copy.ts';

export const zhHant: VideoCardsMessages = {
  earlier: (count: number) => `之前的 ${count} 項`,
  pending: (count: number) => `${count} 項待處理`,
  earlierWithPending: (count: number, pending: number) => `之前的 ${count} 項，${pending} 項待處理`,
  earlierList: '之前的項目',
};
