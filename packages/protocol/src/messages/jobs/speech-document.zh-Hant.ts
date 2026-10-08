import type { JobsSpeechDocumentMessages } from './speech-document.ts';

export const zhHant: JobsSpeechDocumentMessages = {
  documentName: '逐字稿',
  speakerName: (p: { n: number }) => `說話者 ${p.n}`,
};
