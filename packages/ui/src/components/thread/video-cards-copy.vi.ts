import type { VideoCardsMessages } from './video-cards-copy.ts';

export const vi: VideoCardsMessages = {
 earlier: (count) => `${count} mục trước`, pending: (count) => `${count} mục cần chú ý`, earlierWithPending: (count, pending) => `${count} mục trước, ${pending} mục cần chú ý`, earlierList: 'Mục trước',
};
