import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const it: ResourceCapacityMessages = {
  title: 'Pianificazione delle risorse',
  resetAll: 'Reimposta tutto su automatico',
  lead: 'Le attività pesanti come trascrizione, modelli locali ed esportazioni vengono messe in coda in base alla capacità di questo computer: iniziano quando c’è spazio e altrimenti attendono che quelle precedenti terminino. La capacità viene rilevata automaticamente. Se questo computer esegue anche altri programmi pesanti o il rilevamento non è preciso, puoi impostare un limite manualmente; lascia vuoto per la modalità automatica.',
  disconnected: 'Non connesso al Runtime',
  loadFailed: 'Impossibile leggere lo stato delle risorse',
  loading: 'Lettura dello stato delle risorse…',
  limitOf: (label: string, unit: string) => `Limite di ${label} (${unit})`,
  unit: { memoryGB: 'GB', gpuMemoryGB: 'GB', cpuThreads: 'thread' },
  notSettable: 'Non può essere impostato manualmente',
  inUseAndQueued: 'In uso e in coda',
  inUse: (demand: string) => `In uso · ${demand}`,
  queued: (detail: string | null, demand: string) => `In coda · ${detail ?? 'In attesa di avvio'} · Richiede ${demand}`,
  idle: 'Nessuna attività sta usando risorse locali',
  saveFailed: (message: string) => `Impossibile salvare: ${message}`,
};
