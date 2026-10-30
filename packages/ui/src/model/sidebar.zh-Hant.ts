import type { SidebarMessages } from './sidebar.ts';

export const zhHant: SidebarMessages = {
  status: { answer: '等待回答', waiting: '等待核准', failed: '失敗', running: '執行中', unread: '已完成，未讀' },
  stopping: '正在停止',
  group: { waiting: '等你處理', rest: '其他對話' },
  count: {
    answer: (n: number) => `${n} 個等待回答`,
    waiting: (n: number) => `${n} 個等待核准`,
    failed: (n: number) => `${n} 個失敗`,
    running: (n: number) => `${n} 個執行中`,
    unread: (n: number) => `${n} 個已完成未讀`,
  },
};
