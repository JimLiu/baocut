import type { LocalModelsMessages } from './local-models-copy.ts';

export const it: LocalModelsMessages = {
  install: {
    availableNote: 'Prima del download vedrai quanto verrà scaricato e lo spazio su disco disponibile. Puoi mettere in pausa; ciò che è già stato scaricato viene conservato e ripreso la prossima volta.',
    download: 'Scarica', complete: 'Completa', downloadSize: (size: string) => `Scarica ${size}`, completeSize: (size: string) => `Completa ${size}`, resume: 'Riprendi download', pause: 'Pausa', cancelDownload: 'Annulla download', discard: 'Scarta file scaricati', repair: 'Ripara…', remove: 'Elimina…',
    more: (id: string) => `Altro · ${id}`, details: 'Dettagli', hideDetails: 'Nascondi dettagli',
    componentLine: (state: 'installed' | 'missing', size: string | null) => state === 'installed' ? `Installato${size ? ` · ${size}` : ''}` : `Mancante${size ? ` · ${size}` : ''}`,
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
  shared: {
    title: 'Componenti condivisi',
    note: 'Più modelli di questa categoria li usano. Ognuno si installa una sola volta e viene rimosso insieme all’ultimo modello che lo usa.',
    summaryRepair: (n: number) => (n === 1 ? '1 componente da completare' : `${n} componenti da completare`),
    summaryCount: (n: number) => (n === 1 ? '1 componente condiviso' : `${n} componenti condivisi`),
    usage: (live: number, all: number) => `${live === 1 ? '1 modello installato lo usa' : `${live} modelli installati lo usano`} · ${all} ne hanno bisogno`,
    usageNone: (all: number) => `${all} modelli lo useranno · nessuno ancora installato`,
    withModel: (size: string | null) => `Si scarica con il primo modello che installi${size ? ` · ${size}` : ''}`,
    completeNote: (name: string) => `I componenti condivisi si scaricano con un modello che li usa. Viene aggiunto solo ciò che manca a «${name}»; i file installati restano invariati.`,
  },
};
