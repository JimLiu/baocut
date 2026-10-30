import type { QuestionMessages } from './question-copy.ts';

export const ru: QuestionMessages = {
  title: 'У агента есть вопрос',
  titleMany: (n) => `У агента есть вопросы: ${n}`,
  pickOne: 'Выберите один вариант',
  pickMany: 'Выберите все подходящие',
  other: 'Другое',
  otherPlaceholder: 'Введите свой ответ',
  submit: 'Отправить ответ',
  skip: 'Пропустить',
  hint: 'Можно просто ответить в поле сообщения.',
  kind: 'Вопрос',
  answered: 'Отвечено',
  skipped: 'Пропущено',
  byMessage: 'Отвечено сообщением',
  cancelled: 'Остановлено',
  noAnswer: 'Нет ответа',
  failed: (message) => `Не удалось отправить: ${message}`,
};
