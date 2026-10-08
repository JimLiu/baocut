import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: ResourceCapacityMessages = {
  sources: { system: 'Detectado pelo sistema', setting: 'Definido manualmente', 'unified-estimate': 'Estimado pela memória unificada', unknown: 'Desconhecido', statfs: 'Espaço livre no disco que contém os arquivos temporários' },
  dimensions: { memory: 'Memória', gpuMemory: 'Memória da GPU', cpuThreads: 'Threads de CPU', scratchDisk: 'Espaço temporário em disco' },
  unknown: 'Desconhecido',
  threads: (n) => pluralForm('pt-BR', n, { one: `${n} thread`, other: `${n} threads` }),
  unifiedMemory: 'Compartilhada com a memória; o uso da GPU também conta como uso de memória',
  inUse: (amount) => `${amount} em uso`,
  backgroundAvailable: (amount) => `${amount} disponíveis para tarefas em segundo plano`,
  demandPart: (dimension, amount) => `${dimension} ${amount}`,
  joinDemand: (parts) => parts.join(', '),
  noDemand: 'Não usa recursos locais',
  auto: 'Automático',
  autoWith: (value) => `Automático (${value})`,
};
