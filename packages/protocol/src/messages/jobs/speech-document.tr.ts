import type { JobsSpeechDocumentMessages } from './speech-document.ts';

export const tr: JobsSpeechDocumentMessages = {
  documentName: 'Döküm',
  speakerName: (p: { n: number }) => `Konuşmacı ${p.n}`,
};
