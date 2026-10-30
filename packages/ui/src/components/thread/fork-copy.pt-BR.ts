import type { ForkMessages } from './fork-copy.ts';

export const ptBR: ForkMessages = {
  button: 'Ramificar a partir deste turno',
  fork: 'Continuar em uma nova sessão',
  forkHint: 'Leva a conversa até este turno',
  restore: 'Continuar com os vídeos restaurados para aquele momento…',
  restoreOne: (name) => `“${name}” volta ao fim deste turno`,
  restoreMany: (n) => `${n} vídeos voltam ao fim deste turno`,
  restoreNone: 'As versões daquele momento não existem mais ou não podem ser lidas',
  checking: 'Verificando o histórico de versões…',
  dialogTitle: 'Ramificar e restaurar vídeos',
  dialogLead:
    'A nova sessão leva a conversa até este turno. Os vídeos abaixo voltam ao fim deste turno. Cada restauração é salva como uma nova versão, então você pode voltar pelo histórico de versões.',
  listLabel: 'Vídeos a restaurar',
  cancel: 'Cancelar',
  confirm: 'Ramificar e restaurar',
  ok: (version, undone) =>
    `Restaurar a versão ${version}. As ${undone} versões posteriores (suas alterações e as de outras sessões) são desfeitas`,
  pruned: 'A versão daquele momento não existe mais (o histórico de versões guarda só as recentes e as salvas)',
  createdAfter: 'Este vídeo foi criado depois deste turno, então fica como está',
  chainBroken: 'O histórico de versões não pode ser lido até aquele momento',
  done: 'Ramificada em uma nova sessão',
  doneRestored: (n) =>
    `Ramificada em uma nova sessão e ${n} vídeos restaurados para aquele momento. Você pode voltar pelo histórico de versões`,
  failed: (error) => `Não foi possível ramificar: ${error}`,
  forkedFrom: (title, turn) => `Ramificada de “${title}” · até o turno ${turn}`,
  sourceDeleted: '(sessão original excluída)',
  history: (turns, omitted) => `Histórico incluído · ${turns} turnos${omitted ? ` (${omitted} anteriores omitidos)` : ''}`,
  hideHistory: 'Ocultar histórico',
};
