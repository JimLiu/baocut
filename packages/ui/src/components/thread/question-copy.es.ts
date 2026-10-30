import type { QuestionMessages } from './question-copy.ts';

export const es: QuestionMessages = {
  title: 'El agente tiene una pregunta',
  titleMany: (n) => `El agente tiene ${n} preguntas`,
  pickOne: 'Elige una',
  pickMany: 'Elige todas las que correspondan',
  other: 'Otra',
  otherPlaceholder: 'Escribe tu respuesta',
  submit: 'Enviar respuesta',
  skip: 'Omitir',
  hint: 'También puedes responder en el cuadro de mensaje.',
  kind: 'Pregunta',
  answered: 'Respondida',
  skipped: 'Omitida',
  byMessage: 'Respondida con un mensaje',
  cancelled: 'Detenida',
  noAnswer: 'Sin respuesta',
  failed: (message) => `No se pudo enviar: ${message}`,
};
