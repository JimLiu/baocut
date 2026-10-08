import type { StateMessages } from './state-copy.ts';

export const ko: StateMessages = {
  task: {
    running: '진행 중',
    stopping: '중지하는 중',
    awaitingApproval: '승인 대기 중',
  },
};
