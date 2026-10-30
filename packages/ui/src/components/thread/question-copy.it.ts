import type { QuestionMessages } from './question-copy.ts';

export const it: QuestionMessages = {
  title: 'L’agente ha una domanda',
  titleMany: (n) => `L’agente ha ${n} domande`,
  pickOne: 'Scegline una',
  pickMany: 'Scegli tutte quelle valide',
  other: 'Altro',
  otherPlaceholder: 'Scrivi la tua risposta',
  submit: 'Invia risposta',
  skip: 'Salta',
  hint: 'Puoi anche rispondere direttamente nella casella del messaggio.',
  kind: 'Domanda',
  answered: 'Risposta inviata',
  skipped: 'Saltata',
  byMessage: 'Risposta con un messaggio',
  cancelled: 'Interrotta',
  noAnswer: 'Nessuna risposta',
  failed: (message) => `Impossibile inviare: ${message}`,
};
