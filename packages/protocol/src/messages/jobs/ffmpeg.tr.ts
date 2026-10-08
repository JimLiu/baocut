import type { JobsFfmpegMessages } from './ffmpeg.ts';

export const tr: JobsFfmpegMessages = {
  notFound: (p: { command: string; remedy: string }) => `${p.command} bulunamıyor: ${p.remedy}`,
  ffmpegBroken: 'ffmpeg düzgün çalışmıyor',
  probeFailed: (p: { file: string }) => `ffprobe, ${p.file} adlı dosyayı okuyamıyor`,
  exited: (p: { code: number | null }) => `ffmpeg çıkış kodu: ${p.code}`,
};
