import type { SidebarMessages } from './sidebar.ts';

export const zhHant: SidebarMessages = {
  status: { waiting: '等待核准', failed: '失敗', running: '執行中', unread: '已完成，未讀' },
  stopping: '正在停止',
  count: {
    waiting: (n: number) => `${n} 個等待核准`,
    failed: (n: number) => `${n} 個失敗`,
    running: (n: number) => `${n} 個執行中`,
    unread: (n: number) => `${n} 個已完成未讀`,
  },
};
