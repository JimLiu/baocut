import type { UpdateMessages, UpdateStep } from './update-copy.ts';

const STEP: Record<UpdateStep, string> = {
  install: '설치를 시작하지 못했습니다',
  check: '업데이트를 확인하지 못했습니다',
  download: '다운로드를 시작하지 못했습니다',
  cancel: '다운로드를 취소하지 못했습니다',
  retry: '다시 시도하지 못했습니다',
  downloadPage: '다운로드 페이지를 열지 못했습니다',
};

export const ko: UpdateMessages = {
  failed: (step, message) => `${STEP[step]}: ${message}`,
  progress: '다운로드 진행률',
  notes: '이 버전의 새로운 기능',
  close: '닫기',
};
