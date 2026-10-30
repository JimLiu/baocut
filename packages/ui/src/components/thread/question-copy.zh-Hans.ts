import type { QuestionMessages } from './question-copy.ts';

export const zhHans: QuestionMessages = {
  title: 'Agent 有个问题要问你',
  titleMany: (n) => `Agent 有 ${n} 个问题要问你`,
  pickOne: '选一项',
  pickMany: '可多选',
  other: '其他',
  otherPlaceholder: '写下你的回答',
  submit: '发送回答',
  skip: '跳过',
  hint: '也可以直接在输入框里回复。',
  kind: '提问',
  answered: '已回答',
  skipped: '已跳过',
  byMessage: '已用消息回答',
  cancelled: '已停止',
  noAnswer: '没有回答',
  failed: (message) => `没能发送：${message}`,
};
