import type { TranscriptTextMessages } from './transcript-text.ts';

export const ko: TranscriptTextMessages = {
  speakerHead: (speaker: string) => `${speaker}:`,
  receipt: (paragraphs: number, amount: string) => `문단 ${paragraphs}개 · ${amount}`,
  characters: (n: number) => `${n}자`,
  words: (n: number) => `${n}단어`,
};
