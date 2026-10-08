import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const de: ResourceCapacityMessages = {
  title: "Ressourcenplanung",
  resetAll: "Alle auf automatisch zurücksetzen",
  lead: "Schwere Aufgaben wie Transkription, lokale Modelle und Exporte werden nach Computerkapazität eingereiht. Bei ausreichender Kapazität starten sie, sonst warten sie auf frühere Aufgaben. Kapazität wird automatisch erkannt; bei anderen großen Programmen oder fehlerhafter Erkennung manuell begrenzen. Leer lassen für automatisch.",
  disconnected: "Nicht mit Runtime verbunden",
  loadFailed: "Ressourcenstatus konnte nicht gelesen werden",
  loading: "Ressourcenstatus wird gelesen…",

  limitOf: (label: string, unit: string) => `${label}-Limit (${unit})`,
  unit: { memoryGB: "GB", gpuMemoryGB: "GB", cpuThreads: "Threads" },
  notSettable: "Nicht manuell einstellbar",
  inUseAndQueued: "Verwendet und eingereiht",
  inUse: (demand: string) => `Verwendet · ${demand}`,
  queued: (detail: string | null, demand: string) => `In Warteschlange · ${detail ?? "Wartet auf Start"} · Benötigt ${demand}`,
  idle: "Keine Aufgaben verwenden lokale Ressourcen",
  saveFailed: (message: string) => `Speichern fehlgeschlagen: ${message}`,
};
