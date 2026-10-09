import { pluralForm } from '@baocut/protocol';
import type { TranscriptTextMessages } from './transcript-text.ts';

export const pl: TranscriptTextMessages = {
  receipt: (paragraphs: number, amount: string) => `${pluralForm('pl', paragraphs, { one: `${paragraphs} akapit`, few: `${paragraphs} akapity`, many: `${paragraphs} akapitów`, other: `${paragraphs} akapitu` })} · ${amount}`,
  characters: (n: number) => pluralForm('pl', n, { one: `${n} znak`, few: `${n} znaki`, many: `${n} znaków`, other: `${n} znaku` }),
  words: (n: number) => pluralForm('pl', n, { one: `${n} słowo`, few: `${n} słowa`, many: `${n} słów`, other: `${n} słowa` }),
};
