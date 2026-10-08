import type { TaskFactsMessages } from './task-facts.ts';

export const zhHant: TaskFactsMessages = {
  fact: {
    kind: '類型',
    submitter: '發起者',
    status: '狀態',
    startedAt: '開始時間',
    runsOn: '執行位置',
    language: '語言',
    phase: '階段',
    images: '圖片',
    took: '耗時',
    cost: '費用',
  },
  imageCount: (count: number) => `${count} 張`,
};
