import type { TaskFactsMessages } from './task-facts.ts';

export const ko: TaskFactsMessages = {
  fact: {
    kind: '유형',
    submitter: '시작 주체',
    status: '상태',
    startedAt: '시작',
    runsOn: '실행 위치',
    language: '언어',
    phase: '단계',
    images: '이미지',
    took: '소요 시간',
    cost: '비용',
  },
  imageCount: (count: number) => `${count}장`,
};
