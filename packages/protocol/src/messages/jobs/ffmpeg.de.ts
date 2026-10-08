import type { JobsFfmpegMessages } from './ffmpeg.ts';

export const de: JobsFfmpegMessages = {
  notFound: (p: { command: string; remedy: string }) => `Nicht gefunden: ${p.command}: ${p.remedy}`,
  ffmpegBroken: "ffmpeg funktioniert nicht ordnungsgemäß",
  probeFailed: (p: { file: string }) => `ffprobe kann nicht lesen: ${p.file}`,
  exited: (p: { code: number | null }) => `ffmpeg wurde beendet mit ${p.code}`,
};
