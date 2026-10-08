import type { JobsSpeechDocumentMessages } from './speech-document.ts';

export const fr: JobsSpeechDocumentMessages = {
  documentName: "Transcription",
  speakerName: (p: { n: number }) => `Le locuteur ${p.n}`,
};
