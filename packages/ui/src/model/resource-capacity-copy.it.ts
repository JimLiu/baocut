import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: ResourceCapacityMessages = {
  sources: { system: 'Rilevato dal sistema', setting: 'Impostato manualmente', 'unified-estimate': 'Stimato dalla memoria unificata', unknown: 'Sconosciuto', statfs: 'Spazio libero sul disco che contiene i file temporanei' },
  dimensions: { memory: 'Memoria', gpuMemory: 'Memoria GPU', cpuThreads: 'Thread CPU', scratchDisk: 'Spazio temporaneo su disco' },
  unknown: 'Sconosciuto',
  threads: (n) => `${n} thread`,
  unifiedMemory: 'Condivisa con la memoria; l’utilizzo della GPU viene conteggiato anche nella memoria',
  inUse: (amount) => `${amount} in uso`,
  backgroundAvailable: (amount) => `${amount} disponibili per le attività in background`,
  demandPart: (dimension, amount) => `${dimension} ${amount}`,
  joinDemand: (parts) => parts.join(', '),
  noDemand: 'Non usa risorse locali',
  auto: 'Automatico',
  autoWith: (value) => `Automatico (${value})`,
};
