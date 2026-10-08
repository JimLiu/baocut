import type { JobsDownloadTranscriptMessages } from './download-transcript.ts';

export const fr: JobsDownloadTranscriptMessages = {
  fileTranscribeUnavailable: "Transcription de fichier indisponible",
  notCompleted: "La transcription n’a pas abouti ; le fichier vidéo a été conservé",
  resultMissing: "Résultat de transcription introuvable",
  tooManySameName: (p: { name: string }) => `Trop de fichiers du même nom dans le dossier de sortie : ${p.name}`,
};
