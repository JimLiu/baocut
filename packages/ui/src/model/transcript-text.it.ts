import type { TranscriptTextMessages } from './transcript-text.ts';
import { pluralForm } from '@baocut/protocol';

export const it: TranscriptTextMessages = {
  speakerHead: (speaker: string) => `${speaker}:`,
  receipt: (paragraphs: number, amount: string) => `${pluralForm('it', paragraphs, { one: `${paragraphs} paragrafo`, other: `${paragraphs} paragrafi` })} · ${amount}`,
  characters: (n: number) => pluralForm('it', n, { one: `${n} carattere`, other: `${n} caratteri` }),
  words: (n: number) => pluralForm('it', n, { one: `${n} parola`, other: `${n} parole` }),
};
