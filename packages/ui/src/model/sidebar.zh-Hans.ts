import type { SidebarMessages } from './sidebar.ts';

export const zhHans: SidebarMessages = {
  status: { answer: '等待回答', waiting: '等待批准', failed: '失败', running: '进行中', unread: '已完成未读' },
  stopping: '正在停止',
  group: { waiting: '等你处理', rest: '其他会话' },
  count: {
    answer: (n: number) => `${n} 个等待回答`,
    waiting: (n: number) => `${n} 个等待批准`,
    failed: (n: number) => `${n} 个失败`,
    running: (n: number) => `${n} 个进行中`,
    unread: (n: number) => `${n} 个已完成未读`,
  },
};
