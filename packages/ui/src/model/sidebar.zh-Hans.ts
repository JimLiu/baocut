import type { SidebarMessages } from './sidebar.ts';

export const zhHans: SidebarMessages = {
  status: { waiting: '等待批准', failed: '失败', running: '进行中', unread: '已完成未读' },
  stopping: '正在停止',
  count: {
    waiting: (n: number) => `${n} 个等待批准`,
    failed: (n: number) => `${n} 个失败`,
    running: (n: number) => `${n} 个进行中`,
    unread: (n: number) => `${n} 个已完成未读`,
  },
};
