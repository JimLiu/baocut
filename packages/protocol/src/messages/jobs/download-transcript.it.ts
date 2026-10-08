import type { JobsDownloadTranscriptMessages } from './download-transcript.ts';

export const it: JobsDownloadTranscriptMessages = {
  fileTranscribeUnavailable: "La trascrizione di file non è disponibile",
  notCompleted: "La trascrizione non è stata completata; il file video è stato conservato",
  resultMissing: "Impossibile trovare il risultato della trascrizione",
  tooManySameName: (p: { name: string }) => `Troppi file con lo stesso nome nella cartella dei risultati: ${p.name}`,
};
