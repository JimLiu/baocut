import type { VideoCardsMessages } from './video-cards-copy.ts';

export const tr: VideoCardsMessages = {
  earlier: (count) => `${count} önceki öğe`,
  pending: (count) => `${count} öğe ilgilenmenizi gerektiriyor`,
  earlierWithPending: (count,pending) => `${count} önceki öğe, ${pending} öğe ilgilenmenizi gerektiriyor`,
  earlierList: "Önceki öğeler",
};
