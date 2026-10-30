import type { PlanMessages } from './plan-copy.ts';

export const ko: PlanMessages = {
  title: '에이전트가 계획을 작성했습니다. 승인해 주세요',
  modeLabel: '구현 시 액세스 모드',
  implement: '계획대로 구현',
  keepPlanning: '계획 계속 수정',
  hint: '메시지 입력란에서 바꿀 점을 말해도 됩니다.',
  kind: '계획',
  approved: (mode) => `승인됨 · "${mode}"(으)로 구현`,
  declined: '승인 안 함',
  byMessage: '메시지로 답함',
  cancelled: '중지됨',
  rowLead: '계획이 괜찮나요?',
  followUp: '위 계획대로 구현해 주세요.',
  failed: (message) => `보내지 못했습니다: ${message}`,
};
