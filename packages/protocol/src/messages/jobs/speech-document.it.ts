import type { JobsSpeechDocumentMessages } from './speech-document.ts';

export const it: JobsSpeechDocumentMessages = {
  documentName: "Trascrizione",
  speakerName: (p: { n: number }) => `Parlante ${p.n}`,
};
