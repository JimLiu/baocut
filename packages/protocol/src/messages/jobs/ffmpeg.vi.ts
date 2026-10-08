import type { JobsFfmpegMessages } from './ffmpeg.ts';

export const vi: JobsFfmpegMessages = {
  notFound: (p: { command: string; remedy: string }) => `Không tìm thấy ${p.command}: ${p.remedy}`,
  ffmpegBroken: 'ffmpeg không hoạt động bình thường',
  probeFailed: (p: { file: string }) => `ffprobe không đọc được ${p.file}`,
  exited: (p: { code: number | null }) => `ffmpeg thoát với mã ${p.code}`,
};
