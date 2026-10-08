import type { SidebarMessages } from './sidebar.ts';

export const ja: SidebarMessages = {
  status: { waiting: '承認待ち', failed: '失敗', running: '実行中', unread: '完了・未読' },
  stopping: '停止中',
  count: {
    waiting: (n: number) => `承認待ち ${n} 件`,
    failed: (n: number) => `失敗 ${n} 件`,
    running: (n: number) => `実行中 ${n} 件`,
    unread: (n: number) => `完了・未読 ${n} 件`,
  },
};
