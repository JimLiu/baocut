import type { PlanMessages } from './plan-copy.ts';

export const zhHans: PlanMessages = {
  title: 'Agent 写好了方案，等你批准',
  modeLabel: '实施时的访问模式',
  implement: '按方案实施',
  keepPlanning: '继续改方案',
  hint: '也可以直接在输入框里说要改什么。',
  kind: '方案',
  approved: (mode) => `已批准 · 按「${mode}」实施`,
  declined: '未批准',
  byMessage: '已用消息回复',
  cancelled: '已停止',
  rowLead: '方案没问题？',
  followUp: '按上面的方案实施。',
  failed: (message) => `没能发送：${message}`,
};
