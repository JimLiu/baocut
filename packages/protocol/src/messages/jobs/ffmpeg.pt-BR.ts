import type { JobsFfmpegMessages } from './ffmpeg.ts';

export const ptBR: JobsFfmpegMessages = {
  notFound: (p: { command: string; remedy: string }) => `Não foi possível encontrar ${p.command}: ${p.remedy}`,
  ffmpegBroken: "ffmpeg não está funcionando corretamente",
  probeFailed: (p: { file: string }) => `ffprobe não consegue ler ${p.file}`,
  exited: (p: { code: number | null }) => `ffmpeg saiu com ${p.code}`,
};
