import type { JobsFfmpegMessages } from './ffmpeg.ts';

export const it: JobsFfmpegMessages = {
  notFound: (p: { command: string; remedy: string }) => `Impossibile trovare ${p.command}: ${p.remedy}`,
  ffmpegBroken: "ffmpeg non funziona correttamente",
  probeFailed: (p: { file: string }) => `ffprobe non riesce a leggere ${p.file}`,
  exited: (p: { code: number | null }) => `ffmpeg è terminato con ${p.code}`,
};
