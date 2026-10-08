import { pluralForm } from '@baocut/protocol';
import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const fr: ResourceCapacityMessages = {
  sources: {
    system: "Détecté par le système",
    setting: "Défini manuellement",
    'unified-estimate': "Estimé depuis la mémoire unifiée",
    unknown: "Inconnu",
    statfs: "Espace libre du disque temporaire",
  },
  dimensions: { memory: "Mémoire", gpuMemory: "Mémoire GPU", cpuThreads: "Threads CPU", scratchDisk: "Espace disque temporaire" },
  unknown: "Inconnu",
  threads: (n: number) => `${n} ${pluralForm('fr', n, { one: "thread", other: "threads" })}`,
  unifiedMemory: "Partagée avec la mémoire ; utilisation GPU aussi comptée en mémoire",
  inUse: (amount: string) => `${amount} utilisés`,
  backgroundAvailable: (amount: string) => `${amount} disponibles pour les tâches en arrière-plan`,
  demandPart: (dimension: string, amount: string) => `${dimension} ${amount}`,
  joinDemand: (parts: readonly string[]) => parts.join(", "),
  noDemand: "Aucune ressource locale utilisée",
  auto: "Automatique",
  autoWith: (value: string) => `Automatique (${value})`,
};
