import type { JobsFfmpegMessages } from './ffmpeg.ts';

export const fr: JobsFfmpegMessages = {
  notFound: (p: { command: string; remedy: string }) => `Impossible de trouver ${p.command} : ${p.remedy}`,
  ffmpegBroken: "ffmpeg ne fonctionne pas correctement",
  probeFailed: (p: { file: string }) => `ffprobe ne peut pas lire ${p.file}`,
  exited: (p: { code: number | null }) => `ffmpeg s’est arrêté avec ${p.code}`,
};
