import type { JobsSpeechDocumentMessages } from './speech-document.ts';

export const ja: JobsSpeechDocumentMessages = {
  documentName: '文字起こし',
  speakerName: (p: { n: number }) => `話者 ${p.n}`,
};
