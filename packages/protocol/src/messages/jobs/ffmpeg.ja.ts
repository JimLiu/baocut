import type { JobsFfmpegMessages } from './ffmpeg.ts';

export const ja: JobsFfmpegMessages = {
  notFound: (p: { command: string; remedy: string }) => `${p.command} が見つかりません：${p.remedy}`,
  ffmpegBroken: 'ffmpeg が正常に動作していません',
  probeFailed: (p: { file: string }) => `ffprobe で ${p.file} を読み取れません`,
  exited: (p: { code: number | null }) => `ffmpeg がコード ${p.code} で終了しました`,
};
