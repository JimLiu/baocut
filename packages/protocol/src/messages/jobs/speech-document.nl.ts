import type { JobsSpeechDocumentMessages } from './speech-document.ts';

export const nl: JobsSpeechDocumentMessages = {
  documentName: "Transcript",
  speakerName: (p: { n: number }) => `Spreker ${p.n}`,
};
