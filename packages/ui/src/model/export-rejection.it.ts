import type { ExportRejectionMessages } from './export-rejection.ts';

export const it: ExportRejectionMessages = {
  portableReason: { missing: 'File non trovato', changed: 'Contenuto diverso da quando è stato aggiunto', unreadable: 'Impossibile leggere' },
  titles: {
    VIDEO_NOT_OPEN: 'Il video non è aperto', EXPORT_KIND_UNSUPPORTED: 'Questa versione non può ancora esportare questo tipo di contenuto', EXPORT_SOURCE_UNSUPPORTED: 'Questo documento non può essere esportato in questo modo', EXPORT_NOTHING_TO_EXPORT: 'Nulla nell’intervallo può essere esportato', EXPORT_SOURCE_NOT_FOUND: 'Nessun documento può essere esportato', EXPORT_SOURCE_AMBIGUOUS: 'Diversi documenti possono essere esportati', EXPORT_TOOL_MISSING: 'Su questo computer manca uno strumento necessario per l’esportazione', EXPORT_UNSUPPORTED_CONTENT: 'Alcuni contenuti non possono essere renderizzati per l’esportazione', ASSET_MISSING: 'Alcuni materiali non sono leggibili', ASSET_CHANGED: 'Alcuni materiali sono cambiati', ENTITY_NOT_FOUND: 'La sequenza non esiste', DUB_GROUP_NOT_FOUND: 'Impossibile trovare questo gruppo di doppiaggio', EXPORT_PACKAGE_LOCAL_PATH: 'Alcuni documenti contengono percorsi di questo computer', EXPORT_PACKAGE_UNSUPPORTED: 'Alcuni file non possono essere inclusi in un pacchetto portatile', EXPORT_INSUFFICIENT_SPACE: 'Spazio insufficiente sul disco della destinazione di esportazione', EXPORT_DESTINATION_EXISTS: 'Esiste già un file con lo stesso nome', EXPORT_DESTINATION_UNWRITABLE: 'Impossibile scrivere nella destinazione di esportazione', EXPORT_RENDER_FAILED: 'Impossibile renderizzare il video', EXPORT_VALIDATION_FAILED: 'Il file esportato non ha superato la validazione', EXPORT_PUBLISH_FAILED: 'Impossibile salvare i file nella destinazione di esportazione', EXPORT_PARTIALLY_PUBLISHED: 'Sono stati salvati solo alcuni file', RESOURCE_ADMISSION_UNSATISFIABLE: 'Questo computer non ha risorse sufficienti per questa esportazione',
  },
  resources: { memory: 'Memoria', gpuMemory: 'Memoria GPU', cpuThreads: 'Thread CPU', scratchDisk: 'Spazio su disco per file temporanei' },
  problemSeparator: '; ', fileProblems: (file: string, problems: string) => `${file}: ${problems}`,
  notStarted: 'L’esportazione non è iniziata', failed: 'Esportazione non riuscita', missingTool: (tool: string) => `Mancante: ${tool}`,
  assetMissingHint: 'Trova il file o ricollegalo in «Materiali», poi esporta di nuovo.',
  assetChangedHint: 'Ricollega questo materiale o rimetti il file originale al suo posto, poi esporta di nuovo.',
  nothingHint: 'Scegli un altro intervallo o inserisci prima qualcosa nella timeline.',
  space: (required: string, available: string) => `Richiede circa ${required}; rimangono solo ${available}`,
  notEnough: (resource: string) => `Insufficiente: ${resource}`, resourceHint: 'Esporta un intervallo più breve o scegli una risoluzione inferiore, poi riprova.',
};
