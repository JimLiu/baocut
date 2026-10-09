import { pluralForm } from '@baocut/protocol';
import type { TranscriptTextMessages } from './transcript-text.ts';

export const nl: TranscriptTextMessages = {
  receipt: (paragraphs: number, amount: string) => `${paragraphs} ${pluralForm('nl', paragraphs, { one: "alinea", other: "alinea’s" })} · ${amount}`,
  characters: (n: number) => `${n} ${pluralForm('nl', n, { one: "teken", other: "tekens" })}`,
  words: (n: number) => `${n} ${pluralForm('nl', n, { one: "woord", other: "woorden" })}`,
};
