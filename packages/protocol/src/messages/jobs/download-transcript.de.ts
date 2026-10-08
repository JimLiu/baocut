import type { JobsDownloadTranscriptMessages } from './download-transcript.ts';

export const de: JobsDownloadTranscriptMessages = {
  fileTranscribeUnavailable: "Dateitranskription ist nicht verfügbar",
  notCompleted: "Transkription nicht abgeschlossen; die Videodatei wurde beibehalten",
  resultMissing: "Transkriptionsergebnis nicht gefunden",
  tooManySameName: (p: { name: string }) => `Zu viele Dateien mit gleichem Namen im Ergebnisordner: ${p.name}`,
};
