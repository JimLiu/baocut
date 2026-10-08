import type { VideoCardsMessages } from './video-cards-copy.ts';

export const ru: VideoCardsMessages = {
  earlier: (count: number) => `Ранее: ${count}`,
  pending: (count: number) => `Требуют внимания: ${count}`,
  earlierWithPending: (count: number, pending: number) => `Ранее: ${count}, требуют внимания: ${pending}`,
  earlierList: 'Предыдущие элементы',
};
