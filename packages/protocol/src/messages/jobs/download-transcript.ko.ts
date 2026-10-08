import type { JobsDownloadTranscriptMessages } from './download-transcript.ts';

export const ko: JobsDownloadTranscriptMessages = {
  fileTranscribeUnavailable: '파일 전사를 사용할 수 없습니다',
  notCompleted: '전사가 완료되지 않았습니다. 영상 파일은 유지했습니다',
  resultMissing: '전사 결과를 찾을 수 없습니다',
  tooManySameName: (p: { name: string }) => `결과물 폴더에 같은 이름의 파일이 너무 많습니다: ${p.name}`,
};
