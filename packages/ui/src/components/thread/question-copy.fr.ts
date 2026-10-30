import type { QuestionMessages } from './question-copy.ts';

export const fr: QuestionMessages = {
  title: 'L’agent a une question',
  titleMany: (n) => `L’agent a ${n} questions`,
  pickOne: 'Choisissez-en une',
  pickMany: 'Choisissez toutes celles qui s’appliquent',
  other: 'Autre',
  otherPlaceholder: 'Saisissez votre réponse',
  submit: 'Envoyer la réponse',
  skip: 'Passer',
  hint: 'Vous pouvez aussi répondre dans la zone de message.',
  kind: 'Question',
  answered: 'Répondu',
  skipped: 'Passée',
  byMessage: 'Répondu par un message',
  cancelled: 'Arrêtée',
  noAnswer: 'Pas de réponse',
  failed: (message) => `Envoi impossible : ${message}`,
};
