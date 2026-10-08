import type { JobsDownloadTranscriptMessages } from './download-transcript.ts';

export const ptBR: JobsDownloadTranscriptMessages = {
  fileTranscribeUnavailable: "A transcrição de arquivos não está disponível",
  notCompleted: "A transcrição não foi concluída; o arquivo de vídeo foi mantido",
  resultMissing: "Não foi possível encontrar o resultado da transcrição",
  tooManySameName: (p: { name: string }) => `Há arquivos demais com o mesmo nome na pasta de resultados: ${p.name}`,
};
