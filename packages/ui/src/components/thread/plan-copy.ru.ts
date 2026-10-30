import type { PlanMessages } from './plan-copy.ts';

export const ru: PlanMessages = {
  title: 'Агент подготовил план и ждёт одобрения',
  modeLabel: 'Режим доступа при выполнении',
  implement: 'Выполнить план',
  keepPlanning: 'Продолжить планирование',
  hint: 'Или напишите агенту в поле сообщения, что изменить.',
  kind: 'План',
  approved: (mode) => `Одобрено · выполнение в режиме «${mode}»`,
  declined: 'Не одобрено',
  byMessage: 'Ответ сообщением',
  cancelled: 'Остановлено',
  rowLead: 'План устраивает?',
  followUp: 'Выполни план выше.',
  failed: (message) => `Не удалось отправить: ${message}`,
};
