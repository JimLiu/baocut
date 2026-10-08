import type { JobsSpeechDocumentMessages } from './speech-document.ts';

export const ko: JobsSpeechDocumentMessages = {
  documentName: '전사본',
  speakerName: (p: { n: number }) => `화자 ${p.n}`,
};
