import type { JobsFfmpegMessages } from './ffmpeg.ts';

export const nl: JobsFfmpegMessages = {
  notFound: (p: { command: string; remedy: string }) => `Kan niet vinden: ${p.command}: ${p.remedy}`,
  ffmpegBroken: "ffmpeg werkt niet goed",
  probeFailed: (p: { file: string }) => `ffprobe kan niet lezen: ${p.file}`,
  exited: (p: { code: number | null }) => `ffmpeg is afgesloten met ${p.code}`,
};
