import type { TaskFactsMessages } from './task-facts.ts';

export const zhHans: TaskFactsMessages = {
  fact: {
    kind: '类型',
    submitter: '发起方',
    status: '状态',
    startedAt: '开始于',
    runsOn: '跑在',
    language: '语言',
    phase: '阶段',
    images: '图片',
    took: '用时',
    cost: '费用',
  },
  imageCount: (count: number) => `${count} 张`,
};
