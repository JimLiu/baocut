import type { QuestionMessages } from './question-copy.ts';

export const nl: QuestionMessages = {
  title: 'De agent heeft een vraag',
  titleMany: (n) => `De agent heeft ${n} vragen`,
  pickOne: 'Kies er één',
  pickMany: 'Kies alles wat van toepassing is',
  other: 'Anders',
  otherPlaceholder: 'Typ je antwoord',
  submit: 'Antwoord versturen',
  skip: 'Overslaan',
  hint: 'Je kunt ook gewoon in het berichtvak antwoorden.',
  kind: 'Vraag',
  answered: 'Beantwoord',
  skipped: 'Overgeslagen',
  byMessage: 'Beantwoord met een bericht',
  cancelled: 'Gestopt',
  noAnswer: 'Geen antwoord',
  failed: (message) => `Versturen mislukt: ${message}`,
};
