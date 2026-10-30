import type { PlanMessages } from './plan-copy.ts';

export const ja: PlanMessages = {
  title: 'エージェントがプランを作成しました。承認してください',
  modeLabel: '実装時のアクセスモード',
  implement: 'プランどおり実装',
  keepPlanning: 'プランの修正を続ける',
  hint: 'メッセージ欄で修正点を伝えることもできます。',
  kind: 'プラン',
  approved: (mode) => `承認済み · 「${mode}」で実装`,
  declined: '未承認',
  byMessage: 'メッセージで返信済み',
  cancelled: '停止済み',
  rowLead: 'プランはこれでよいですか？',
  followUp: '上のプランどおりに実装してください。',
  failed: (message) => `送信できませんでした：${message}`,
};
