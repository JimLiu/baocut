import type { JobsFfmpegMessages } from './ffmpeg.ts';

export const pl: JobsFfmpegMessages = {
  notFound: (p: { command: string; remedy: string }) => `Nie można znaleźć ${p.command}: ${p.remedy}`,
  ffmpegBroken: 'ffmpeg nie działa poprawnie',
  probeFailed: (p: { file: string }) => `ffprobe nie może odczytać ${p.file}`,
  exited: (p: { code: number | null }) => `ffmpeg zakończył działanie z kodem ${p.code}`,
};
