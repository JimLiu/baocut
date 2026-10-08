import type { TaskFactsMessages } from './task-facts.ts';

export const ja: TaskFactsMessages = {
  fact: {
    kind: '種類',
    submitter: '開始元',
    status: '状態',
    startedAt: '開始',
    runsOn: '実行場所',
    language: '言語',
    phase: 'フェーズ',
    images: '画像',
    took: '所要時間',
    cost: '費用',
  },
  imageCount: (count: number) => `${count} 枚`,
};
