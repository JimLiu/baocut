import type { JobsFfmpegMessages } from './ffmpeg.ts';

export const ru: JobsFfmpegMessages = {
  notFound: (p: { command: string; remedy: string }) => `Не удалось найти ${p.command}: ${p.remedy}`,
  ffmpegBroken: 'ffmpeg работает неправильно',
  probeFailed: (p: { file: string }) => `ffprobe не может прочитать ${p.file}`,
  exited: (p: { code: number | null }) => `ffmpeg завершился с кодом ${p.code}`,
};
