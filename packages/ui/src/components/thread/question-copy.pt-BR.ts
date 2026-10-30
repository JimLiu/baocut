import type { QuestionMessages } from './question-copy.ts';

export const ptBR: QuestionMessages = {
  title: 'O agente tem uma pergunta',
  titleMany: (n) => `O agente tem ${n} perguntas`,
  pickOne: 'Escolha uma',
  pickMany: 'Escolha todas as que se aplicam',
  other: 'Outra',
  otherPlaceholder: 'Digite sua resposta',
  submit: 'Enviar resposta',
  skip: 'Pular',
  hint: 'Você também pode responder na caixa de mensagem.',
  kind: 'Pergunta',
  answered: 'Respondida',
  skipped: 'Pulada',
  byMessage: 'Respondida com uma mensagem',
  cancelled: 'Interrompida',
  noAnswer: 'Sem resposta',
  failed: (message) => `Não foi possível enviar: ${message}`,
};
