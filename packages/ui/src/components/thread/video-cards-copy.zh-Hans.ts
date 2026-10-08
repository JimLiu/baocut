import type { VideoCardsMessages } from './video-cards-copy.ts';

export const zhHans: VideoCardsMessages = {
  earlier: (count: number) => `之前的 ${count} 项`,
  pending: (count: number) => `${count} 项待处理`,
  earlierWithPending: (count: number, pending: number) => `之前的 ${count} 项，${pending} 项待处理`,
  earlierList: '之前的活',
};
