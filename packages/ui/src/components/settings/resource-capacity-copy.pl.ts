import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const pl: ResourceCapacityMessages = {
  title: "Planowanie zasobów",
  resetAll: "Przywróć automatyczne dla wszystkich",
  lead: "Ciężkie zadania, takie jak transkrypcja, modele lokalne i eksport, są kolejkowane według możliwości tego komputera: ruszają, gdy wystarczy zasobów, albo czekają na ukończenie wcześniejszych. Pojemność jest wykrywana automatycznie. Jeśli działają też inne duże programy lub wykrywanie jest niedokładne, ustaw limit ręcznie; pozostaw puste dla trybu automatycznego.",
  disconnected: "Brak połączenia z Runtime",
  loadFailed: "Nie udało się odczytać stanu zasobów",
  loading: "Odczytywanie stanu zasobów…",
  limitOf: (label: string, unit: string) => `${label} – limit (${unit})`,
  unit: { memoryGB: "GB", gpuMemoryGB: "GB", cpuThreads: "wątki" },
  notSettable: "Nie można ustawić ręcznie",
  inUseAndQueued: "W użyciu i w kolejce",
  inUse: (demand: string) => `W użyciu · ${demand}`,
  queued: (detail: string | null, demand: string) => `W kolejce · ${detail ?? "Oczekiwanie na uruchomienie"} · Wymaga ${demand}`,
  idle: "Żadne zadania nie używają zasobów lokalnych",
  saveFailed: (message: string) => `Nie udało się zapisać: ${message}`,
};
