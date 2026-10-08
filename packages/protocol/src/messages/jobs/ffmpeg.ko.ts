import type { JobsFfmpegMessages } from './ffmpeg.ts';

export const ko: JobsFfmpegMessages = {
  notFound: (p: { command: string; remedy: string }) => `${p.command} 명령을 찾을 수 없습니다: ${p.remedy}`,
  ffmpegBroken: 'ffmpeg 도구가 제대로 동작하지 않습니다',
  probeFailed: (p: { file: string }) => `ffprobe로 ${p.file} 파일을 읽을 수 없습니다`,
  exited: (p: { code: number | null }) => `ffmpeg 프로세스가 ${p.code} 코드로 종료되었습니다`,
};
