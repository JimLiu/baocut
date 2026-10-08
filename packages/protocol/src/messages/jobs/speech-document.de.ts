import type { JobsSpeechDocumentMessages } from './speech-document.ts';

export const de: JobsSpeechDocumentMessages = {
  documentName: "Transkript",
  speakerName: (p: { n: number }) => `Sprecher ${p.n}`,
};
