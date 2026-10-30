import type { QuestionMessages } from './question-copy.ts';

export const zhHant: QuestionMessages = {
  title: 'Agent 有個問題要問你',
  titleMany: (n) => `Agent 有 ${n} 個問題要問你`,
  pickOne: '選一項',
  pickMany: '可複選',
  other: '其他',
  otherPlaceholder: '寫下你的回答',
  submit: '傳送回答',
  skip: '略過',
  hint: '也可以直接在輸入框裡回覆。',
  kind: '提問',
  answered: '已回答',
  skipped: '已略過',
  byMessage: '已用訊息回答',
  cancelled: '已停止',
  noAnswer: '沒有回答',
  failed: (message) => `無法傳送：${message}`,
};
