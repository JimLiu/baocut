import type { QuestionMessages } from './question-copy.ts';

export const ja: QuestionMessages = {
  title: 'Agent から質問があります',
  titleMany: (n) => `Agent から質問が ${n} 件あります`,
  pickOne: '1 つ選択',
  pickMany: '複数選択可',
  other: 'その他',
  otherPlaceholder: '回答を入力',
  submit: '回答を送信',
  skip: 'スキップ',
  hint: '入力欄から直接返信することもできます。',
  kind: '質問',
  answered: '回答済み',
  skipped: 'スキップ済み',
  byMessage: 'メッセージで回答済み',
  cancelled: '停止済み',
  noAnswer: '回答なし',
  failed: (message) => `送信できませんでした：${message}`,
};
