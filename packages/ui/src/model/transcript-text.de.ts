import { pluralForm } from '@baocut/protocol';
import type { TranscriptTextMessages } from './transcript-text.ts';

export const de: TranscriptTextMessages = {
  speakerHead: (speaker: string) => `${speaker}:`,
  receipt: (paragraphs: number, amount: string) => `${paragraphs} ${pluralForm('de', paragraphs, { one: "Absatz", other: "Absätze" })} · ${amount}`,
  characters: (n: number) => `${n} ${pluralForm('de', n, { one: "Zeichen", other: "Zeichen" })}`,
  words: (n: number) => `${n} ${pluralForm('de', n, { one: "Wort", other: "Wörter" })}`,
};
