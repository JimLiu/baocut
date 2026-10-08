import type { JobsSpeechDocumentMessages } from './speech-document.ts';

export const vi: JobsSpeechDocumentMessages = {
  documentName: 'Bản chép lời',
  speakerName: (p: { n: number }) => `Người nói ${p.n}`,
};
