import type { QuestionMessages } from './question-copy.ts';

export const pl: QuestionMessages = {
  title: 'Agent ma pytanie',
  titleMany: (n) => `Agent ma pytania: ${n}`,
  pickOne: 'Wybierz jedną',
  pickMany: 'Wybierz wszystkie pasujące',
  other: 'Inna',
  otherPlaceholder: 'Wpisz swoją odpowiedź',
  submit: 'Wyślij odpowiedź',
  skip: 'Pomiń',
  hint: 'Możesz też po prostu odpowiedzieć w polu wiadomości.',
  kind: 'Pytanie',
  answered: 'Odpowiedziano',
  skipped: 'Pominięto',
  byMessage: 'Odpowiedziano wiadomością',
  cancelled: 'Zatrzymano',
  noAnswer: 'Brak odpowiedzi',
  failed: (message) => `Nie udało się wysłać: ${message}`,
};
