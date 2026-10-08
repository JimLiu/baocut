import type { VideoCardsMessages } from './video-cards-copy.ts';

export const ko: VideoCardsMessages = {
  earlier: (count: number) => `이전 항목 ${count}개`,
  pending: (count: number) => `${count}개 확인 필요`,
  earlierWithPending: (count: number, pending: number) => `이전 항목 ${count}개, ${pending}개 확인 필요`,
  earlierList: '이전 항목',
};
