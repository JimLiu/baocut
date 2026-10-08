import type { ToolsRecordsMessages } from './tools-records.ts';

export const it: ToolsRecordsMessages = {
  generating: "Generazione in corso",
  queued: "In coda",
  cancelled: "Annullato",
  failed: "Non riuscito",
  unfinished: "Non completato",
  unknown: "Risultato sconosciuto",
  interrupted: "Il Runtime si è interrotto o riavviato prima del completamento",
  reconcile: "Il Runtime si è riavviato prima che questa chiamata rispondesse. Il risultato è sconosciuto e potrebbe essere già stato addebitato",
  noResult: "Non è stato generato nulla",
};
