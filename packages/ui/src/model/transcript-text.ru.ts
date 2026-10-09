import { pluralForm } from '@baocut/protocol';
import type { TranscriptTextMessages } from './transcript-text.ts';

export const ru: TranscriptTextMessages = {
  receipt: (paragraphs: number, amount: string) => `${pluralForm('ru', paragraphs, { one: `${paragraphs} абзац`, few: `${paragraphs} абзаца`, many: `${paragraphs} абзацев`, other: `${paragraphs} абзаца` })} · ${amount}`,
  characters: (n: number) => pluralForm('ru', n, { one: `${n} символ`, few: `${n} символа`, many: `${n} символов`, other: `${n} символа` }),
  words: (n: number) => pluralForm('ru', n, { one: `${n} слово`, few: `${n} слова`, many: `${n} слов`, other: `${n} слова` }),
};
