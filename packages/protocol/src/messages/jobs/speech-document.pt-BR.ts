import type { JobsSpeechDocumentMessages } from './speech-document.ts';

export const ptBR: JobsSpeechDocumentMessages = {
  documentName: "Transcrição",
  speakerName: (p: { n: number }) => `Falante ${p.n}`,
};
