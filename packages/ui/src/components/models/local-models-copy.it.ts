import type { LocalModelsMessages } from './local-models-copy.ts';

export const it: LocalModelsMessages = {
  install: {
    availableNote: 'Prima del download vedrai quanto verrà scaricato e lo spazio su disco disponibile. Puoi mettere in pausa; ciò che è già stato scaricato viene conservato e ripreso la prossima volta.',
    download: 'Scarica', complete: 'Completa', resume: 'Riprendi download', pause: 'Pausa', cancelDownload: 'Annulla download', discard: 'Scarta file scaricati', repair: 'Ripara…', remove: 'Elimina…',
    more: (id: string) => `Altro · ${id}`, details: 'Dettagli', hideDetails: 'Nascondi dettagli',
    componentLine: (state: 'installed' | 'missing', size: string | null) => state === 'installed' ? `Installato${size ? ` · ${size}` : ''}` : 'Mancante',
    sharedWith: (ids: string[]) => `Condiviso con ${ids.join(', ')}`, noComponents: 'Questo Runtime non ha riportato dettagli sui componenti.',
    installTitle: (id: string) => `Scarica ${id}`, repairTitle: (id: string) => `Riparare «${id}»?`, completeTitle: (id: string) => `Completa ${id}`, planning: 'Calcolo di cosa scaricare…', verifying: 'Ricerca di file danneggiati o mancanti. Può richiedere tempo con file grandi…',
    planFailed: 'Impossibile ottenere il piano di download', upToDate: 'Tutti i file sono presenti e verificati. Nulla da scaricare.', completeNote: 'Il modello è già installato. Vengono scaricati solo i componenti facoltativi mancanti; i file installati restano invariati.', repairUpToDate: 'Tutti i file sono integri. Nulla da scaricare di nuovo.',
    repairThenCheck: 'Vengono scaricati di nuovo solo i file danneggiati o mancanti; quelli integri rimangono invariati. La verifica viene ripetuta automaticamente dopo la riparazione.',
    replanned: 'La dimensione del download è appena cambiata. Ecco il nuovo piano; conferma di nuovo.', source: (url: string) => `Origine del download: ${url}`,
    confirmInstall: (size: string) => `Scarica ${size}`, confirmRepair: 'Ripara', cancel: 'Annulla', close: 'Chiudi',
    started: (id: string) => `Download di ${id} · l’avanzamento appare in questa riga e in «Attività in background»`,
    paused: (id: string) => `In pausa: ${id} · ciò che è già stato scaricato viene conservato`,
    discardTitle: (id: string) => `Scartare la parte scaricata di ${id}?`,
    discardBody: 'Il prossimo download ricomincia da zero. I file che altri pacchetti di modelli stanno scaricando e i componenti condivisi non vengono eliminati.',
    discarded: (id: string) => `Parte scaricata scartata: ${id}`, removeTitle: (id: string) => `Eliminare ${id}?`, removeConfirm: 'Elimina',
    stopFailed: (text: string) => `Impossibile interrompere: ${text}`, removeFailed: (text: string) => `Impossibile eliminare: ${text}`, installFailed: (text: string) => `L’ultimo download non è terminato: ${text}`,
  },
};
