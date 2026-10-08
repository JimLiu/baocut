import type { JobsSpeechDocumentMessages } from './speech-document.ts';

export const pl: JobsSpeechDocumentMessages = {
  documentName: 'Transkrypcja',
  speakerName: (p: { n: number }) => `Mówca ${p.n}`,
};
