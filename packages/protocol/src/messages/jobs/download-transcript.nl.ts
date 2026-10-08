import type { JobsDownloadTranscriptMessages } from './download-transcript.ts';

export const nl: JobsDownloadTranscriptMessages = {
  fileTranscribeUnavailable: "Bestandstranscriptie is niet beschikbaar",
  notCompleted: "Transcriptie niet voltooid; het videobestand is behouden",
  resultMissing: "Kan het transcriptieresultaat niet vinden",
  tooManySameName: (p: { name: string }) => `Te veel bestanden met dezelfde naam in de uitvoermap: ${p.name}`,
};
