import { pluralForm } from '@baocut/protocol';
import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const de: ResourceCapacityMessages = {
  sources: {
    system: "Vom System erkannt",
    setting: "Manuell festgelegt",
    'unified-estimate': "Aus gemeinsamem Speicher geschätzt",
    unknown: "Unbekannt",
    statfs: "Freier Speicherplatz für temporäre Dateien",
  },
  dimensions: { memory: "Arbeitsspeicher", gpuMemory: "GPU-Speicher", cpuThreads: "CPU-Threads", scratchDisk: "Temporärer Speicherplatz" },
  unknown: "Unbekannt",
  threads: (n: number) => `${n} ${pluralForm('de', n, { one: "Thread", other: "Threads" })}`,
  unifiedMemory: "Gemeinsam mit Arbeitsspeicher; GPU-Nutzung zählt auch dort",
  inUse: (amount: string) => `${amount} verwendet`,
  backgroundAvailable: (amount: string) => `${amount} für Hintergrundaufgaben verfügbar`,
  demandPart: (dimension: string, amount: string) => `${dimension} ${amount}`,
  joinDemand: (parts: readonly string[]) => parts.join(", "),
  noDemand: "Verwendet keine lokalen Ressourcen",
  auto: "Automatisch",
  autoWith: (value: string) => `Automatisch (${value})`,
};
