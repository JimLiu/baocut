import type { SidebarMessages } from './sidebar.ts';

export const ko: SidebarMessages = {
  status: { answer: '답변 대기 중', waiting: '승인 대기 중', failed: '실패', running: '진행 중', unread: '완료(읽지 않음)' },
  stopping: '중지 중',
  group: { waiting: '확인 필요', rest: '기타 세션' },
  count: {
    answer: (n: number) => `${n}개 답변 대기 중`,
    waiting: (n: number) => `${n}개 승인 대기 중`,
    failed: (n: number) => `${n}개 실패`,
    running: (n: number) => `${n}개 진행 중`,
    unread: (n: number) => `${n}개 완료(읽지 않음)`,
  },
};
