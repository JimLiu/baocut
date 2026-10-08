import type { JobsDownloadTranscriptMessages } from './download-transcript.ts';

export const pl: JobsDownloadTranscriptMessages = {
  fileTranscribeUnavailable: 'Transkrypcja pliku jest niedostępna',
  notCompleted: 'Transkrypcja nie została ukończona; zachowano plik wideo',
  resultMissing: 'Nie można znaleźć wyniku transkrypcji',
  tooManySameName: (p: { name: string }) => `Zbyt wiele plików o tej samej nazwie w folderze wyników: ${p.name}`,
};
