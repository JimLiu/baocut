import type { JobsSpeechDocumentMessages } from './speech-document.ts';

export const ru: JobsSpeechDocumentMessages = {
  documentName: 'Расшифровка',
  speakerName: (p: { n: number }) => `Говорящий ${p.n}`,
};
