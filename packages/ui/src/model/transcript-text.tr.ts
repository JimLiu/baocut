import type { TranscriptTextMessages } from './transcript-text.ts';

export const tr: TranscriptTextMessages = {
  speakerHead: (speaker: string) => `${speaker}:`,
  receipt: (paragraphs: number, amount: string) => `${paragraphs} paragraf · ${amount}`,
  characters: (n: number) => `${n} karakter`,
  words: (n: number) => `${n} sözcük`,
};
