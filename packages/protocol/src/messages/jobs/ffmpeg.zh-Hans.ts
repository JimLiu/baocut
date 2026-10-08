import type { JobsFfmpegMessages } from './ffmpeg.ts';

export const zhHans: JobsFfmpegMessages = {
  notFound: (p: { command: string; remedy: string }) => `找不到 ${p.command}：${p.remedy}`,
  ffmpegBroken: 'ffmpeg 不能正常运行',
  probeFailed: (p: { file: string }) => `ffprobe 读不出 ${p.file}`,
  exited: (p: { code: number | null }) => `ffmpeg 以 ${p.code} 退出`,
};
