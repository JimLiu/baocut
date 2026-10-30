import type { QuestionMessages } from './question-copy.ts';

export const de: QuestionMessages = {
  title: 'Der Agent hat eine Frage',
  titleMany: (n) => `Der Agent hat ${n} Fragen`,
  pickOne: 'Eine auswählen',
  pickMany: 'Alle zutreffenden auswählen',
  other: 'Andere',
  otherPlaceholder: 'Deine Antwort',
  submit: 'Antwort senden',
  skip: 'Überspringen',
  hint: 'Du kannst auch direkt im Nachrichtenfeld antworten.',
  kind: 'Frage',
  answered: 'Beantwortet',
  skipped: 'Übersprungen',
  byMessage: 'Per Nachricht beantwortet',
  cancelled: 'Gestoppt',
  noAnswer: 'Keine Antwort',
  failed: (message) => `Senden fehlgeschlagen: ${message}`,
};
