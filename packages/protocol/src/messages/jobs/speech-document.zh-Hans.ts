import type { JobsSpeechDocumentMessages } from './speech-document.ts';

export const zhHans: JobsSpeechDocumentMessages = {
  documentName: '转写',
  speakerName: (p: { n: number }) => `说话人 ${p.n}`,
};
