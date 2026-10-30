import type { PlanMessages } from './plan-copy.ts';

export const zhHant: PlanMessages = {
  title: 'Agent 寫好了方案，等你核准',
  modeLabel: '實施時的存取模式',
  implement: '按方案實施',
  keepPlanning: '繼續改方案',
  hint: '也可以直接在輸入框裡說要改什麼。',
  kind: '方案',
  approved: (mode) => `已核准 · 按「${mode}」實施`,
  declined: '未核准',
  byMessage: '已用訊息回覆',
  cancelled: '已停止',
  rowLead: '方案沒問題？',
  followUp: '按上面的方案實施。',
  failed: (message) => `沒能傳送：${message}`,
};
