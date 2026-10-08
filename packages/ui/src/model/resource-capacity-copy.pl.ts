import { pluralForm } from '@baocut/protocol';
import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const pl: ResourceCapacityMessages = {
  sources: {
    system: "Wykryte przez system",
    setting: "Ustawione ręcznie",
    'unified-estimate': "Oszacowane na podstawie pamięci zunifikowanej",
    unknown: "Nieznane",
    statfs: "Wolne miejsce na dysku z plikami tymczasowymi",
  },
  dimensions: { memory: "Pamięć", gpuMemory: "Pamięć GPU", cpuThreads: "Wątki CPU", scratchDisk: "Miejsce na pliki tymczasowe" },
  unknown: "Nieznane",
  threads: (n: number) => pluralForm('pl', n, { one: `${n} wątek`, few: `${n} wątki`, many: `${n} wątków`, other: `${n} wątku` }),
  unifiedMemory: "Współdzielona z pamięcią; użycie GPU także wlicza się do pamięci",
  inUse: (amount) => `${amount} w użyciu`,
  backgroundAvailable: (amount) => `${amount} dostępne dla zadań w tle`,
  demandPart: (dimension, amount) => `${dimension} ${amount}`,
  joinDemand: (parts) => parts.join(", "),
  noDemand: "Nie używa zasobów lokalnych",
  auto: "Automatyczny",
  autoWith: (value) => `Automatyczny (${value})`,
};
