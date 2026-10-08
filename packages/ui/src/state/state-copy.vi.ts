import type { StateMessages } from './state-copy.ts';

export const vi: StateMessages = {
  task: {
    running: 'Đang xử lý',
    stopping: 'Đang dừng',
    awaitingApproval: 'Đang chờ phê duyệt',
  },
};
