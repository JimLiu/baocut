import type { TranscriptTextMessages } from './transcript-text.ts';
import { pluralForm } from '@baocut/protocol';
export const es: TranscriptTextMessages = {
  receipt: (paragraphs: number, amount: string) => `${paragraphs} ${pluralForm('es', paragraphs, { one: 'párrafo', other: 'párrafos' })} · ${amount}`,
  characters: (n: number) => `${n} ${pluralForm('es', n, { one: 'carácter', other: 'caracteres' })}`,
  words: (n: number) => `${n} ${pluralForm('es', n, { one: 'palabra', other: 'palabras' })}`,
};
