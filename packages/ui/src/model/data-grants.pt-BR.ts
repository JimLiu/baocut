import type { DataGrantsMessages } from './data-grants.ts';
import { pluralForm } from '@baocut/protocol';

const times = (n: number) => pluralForm('pt-BR', n, { one: `${n} chamada`, other: `${n} chamadas` });

export const ptBR: DataGrantsMessages = {
  state: { active: 'Ativo', expired: 'Expirado', revoked: 'Revogado', exhausted: 'Limite atingido' },
  kindList: (kinds: readonly string[]) => kinds.join(', '), noKinds: 'Sem tipos de dados',
  origin: { 'provider-enable': 'Concedida por padrão ao ativar o provedor', approval: 'Concedida na aprovação', user: 'Concedida manualmente' },
  oneVideoNamed: (name: string) => `Somente o vídeo “${name}”`, oneVideo: 'Somente um vídeo', allVideos: 'Todos os vídeos', oneTask: 'Somente uma tarefa',
  budgetCap: (amount: string) => `Limite de gastos ${amount}`, budgetUnknown: 'Custo desconhecido, contado somente por chamadas', once: 'Somente desta vez', unlimited: 'Chamadas ilimitadas',
  maxCalls: (n: number) => `Até ${times(n)}`, revokedOn: (day: string) => `Revogada ${day}`, expiredOn: (day: string) => `Expirada ${day}`, expiresOn: (day: string) => `Expira ${day}`, neverUsed: 'Ainda não usada',
  usedWithAmount: (calls: number, amount: string) => `Uso: ${times(calls)} (${amount})`, used: (calls: number) => `Uso: ${times(calls)}`,
  reservedWithAmount: (calls: number, amount: string) => `${times(calls)} em andamento (${amount} reservado)`, reserved: (calls: number) => `${times(calls)} em andamento`, unknownCost: (calls: number) => `${times(calls)} com custo desconhecido`, usageSeparator: ', ',
  revokeConfirm: (running: number, sent: number) => [ 'Após revogar, novas chamadas e chamadas na fila que usam esta autorização serão recusadas.', running ? pluralForm('pt-BR', running, { one: `${running} chamada já em andamento terminará normalmente.`, other: `${running} chamadas já em andamento terminarão normalmente.` }) : '', sent ? `Os dados já enviados em ${times(sent)} e os custos incorridos não podem ser recuperados.` : '' ].filter(Boolean).join(' '),
  revoked: 'Revogado',
  sentBefore: (calls: number, amount: string | null, unknownCostCalls: number) => `Enviadas antes: ${times(calls)}${amount ? ` (${amount}${unknownCostCalls ? `, mais ${times(unknownCostCalls)} com custo desconhecido` : ''})` : ''}`,
  runningJobs: (n: number) => pluralForm('pt-BR', n, { one: `${n} tarefa em andamento terminará normalmente`, other: `${n} tarefas em andamento terminarão normalmente` }),
};
