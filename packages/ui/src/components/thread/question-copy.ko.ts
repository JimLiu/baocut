import type { QuestionMessages } from './question-copy.ts';

export const ko: QuestionMessages = {
  title: 'Agent가 질문이 있습니다',
  titleMany: (n) => `Agent가 질문 ${n}개가 있습니다`,
  pickOne: '하나 선택',
  pickMany: '여러 개 선택 가능',
  other: '기타',
  otherPlaceholder: '답변 입력',
  submit: '답변 보내기',
  skip: '건너뛰기',
  hint: '입력란에서 바로 답장해도 됩니다.',
  kind: '질문',
  answered: '답변함',
  skipped: '건너뜀',
  byMessage: '메시지로 답변함',
  cancelled: '중지됨',
  noAnswer: '답변 없음',
  failed: (message) => `보내지 못했습니다: ${message}`,
};
