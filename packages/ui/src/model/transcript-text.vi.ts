import type { TranscriptTextMessages } from './transcript-text.ts';

export const vi: TranscriptTextMessages = {
  speakerHead: (speaker: string) => `${speaker}:`,
  receipt: (paragraphs: number, amount: string) => `${paragraphs} đoạn · ${amount}`,
  characters: (n: number) => `${n} ký tự`,
  words: (n: number) => `${n} từ`,
};
