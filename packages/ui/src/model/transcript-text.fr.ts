import type { TranscriptTextMessages } from './transcript-text.ts';
import { pluralForm } from '@baocut/protocol';

export const fr: TranscriptTextMessages = {
  speakerHead: (speaker) => `${speaker} :`, receipt: (paragraphs, amount) => `${paragraphs} ${pluralForm('fr', paragraphs, { one: 'paragraphe', other: 'paragraphes' })} · ${amount}`,
  characters: (n) => `${n} ${pluralForm('fr', n, { one: 'caractère', other: 'caractères' })}`, words: (n) => `${n} ${pluralForm('fr', n, { one: 'mot', other: 'mots' })}`,
};
