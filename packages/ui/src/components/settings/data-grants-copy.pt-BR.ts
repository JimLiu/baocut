import type { DataGrantsMessages } from './data-grants-copy.ts';

export const ptBR: DataGrantsMessages = {
  title: "Autorizações de compartilhamento de dados",
  showEnded: (count: number) => `Mostrar encerradas (${count})`,
  lead: "Dados enviados a provedores de nuvem precisam de autorização: uma é concedida por padrão ao ativar um provedor e outra ao escolher “Sempre permitir” durante a aprovação. Após revogá-la, novas chamadas não enviam dados; dados e cobranças já enviados não podem ser revertidos. Modelos locais não precisam de autorização.",
  loading: "Carregando autorizações…",
  disconnected: "Não conectado ao Runtime",
  revoke: "Revogar",
  noActive: "Nenhuma autorização ativa",
  none: "Ainda não há autorizações",
  emptyDesc: "As autorizações aparecem aqui quando você ativa um provedor de nuvem ou escolhe “Sempre permitir” durante a aprovação.",
  revokeTitle: (name: string) => `Revogar “${name}”?`,
  revokeFailed: (message: string) => `Não foi possível revogar: ${message}`,
  cancel: "Cancelar",
};
