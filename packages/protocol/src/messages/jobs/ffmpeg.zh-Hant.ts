import type { JobsFfmpegMessages } from './ffmpeg.ts';

export const zhHant: JobsFfmpegMessages = {
  notFound: (p: { command: string; remedy: string }) => `找不到 ${p.command}：${p.remedy}`,
  ffmpegBroken: 'ffmpeg 無法正常運作',
  probeFailed: (p: { file: string }) => `ffprobe 無法讀取 ${p.file}`,
  exited: (p: { code: number | null }) => `ffmpeg 以 ${p.code} 結束`,
};
