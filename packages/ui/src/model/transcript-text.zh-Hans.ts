import type { TranscriptTextMessages } from './transcript-text.ts';

export const zhHans: TranscriptTextMessages = {
  receipt: (paragraphs: number, amount: string) => `${paragraphs} 段 · ${amount}`,
  characters: (n: number) => `${n} 字`,
  words: (n: number) => `${n} 词`,
};
