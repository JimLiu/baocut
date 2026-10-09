import type { TranscriptTextMessages } from './transcript-text.ts';

export const ja: TranscriptTextMessages = {
  receipt: (paragraphs: number, amount: string) => `${paragraphs} 段落 · ${amount}`,
  characters: (n: number) => `${n} 文字`,
  words: (n: number) => `${n} 語`,
};
