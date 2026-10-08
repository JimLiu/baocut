import type { RuntimeStorageGrantsMessages } from './runtime-storage-grants.ts';

export const ptBR: RuntimeStorageGrantsMessages = {
  localNeedsNoGrant: 'O processamento local não precisa de autorização',
  dataKindRequired: 'Forneça pelo menos um tipo de dado',
  budgetCapRequired: 'Uma autorização com limite de gastos precisa de budgetCap',
  unknownCostNoCap: 'Uma autorização com custo desconhecido não pode ter limite de gastos. Para definir um limite, use estimate-cap',
  expiryPassed: 'O prazo de validade já passou',
  grantNotFound: 'Não existe esta autorização',
  grantRevoked: 'A autorização foi revogada e não pode ser alterada. Emita uma nova',
  cannotRemoveCap: 'Uma autorização com limite de gastos não pode perder o limite. Revogue e emita uma nova autorização com custo desconhecido',
  unknownCostCannotCap: 'Uma autorização com custo desconhecido não pode definir limite de gastos. Revogue e emita uma nova autorização estimate-cap',
  cannotChangeCurrency: 'A moeda não pode ser alterada',
  expiryPassedRevoke: 'O prazo de validade já passou. Para interromper agora, revogue',
  revokeNote: 'Após revogar, nenhuma nova chamada é feita, e chamadas na fila são rejeitadas ao iniciar. Os dados já enviados ao provedor e os custos já incorridos não podem ser revertidos localmente; chamadas em andamento terminam normalmente e contam no uso.',
  taskCallLimit: 'O limite de chamadas do orçamento da tarefa deve ser um inteiro positivo',
  providerGrantPurpose: (p) => `Emitida por padrão ao ativar ${p.label}`,
  invalidCurrency: (p) => `A moeda deve ter três letras maiúsculas (ISO 4217): ${p.currency}`,
};
