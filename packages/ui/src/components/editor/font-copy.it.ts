import type { FontMessages } from './font-copy.ts';

export const it: FontMessages = {
  cancelDownload: 'Annulla download', searchFonts: 'Cerca font', searchFontsPlaceholder: 'Cerca font…',
  category: 'Categoria', allCategories: 'Tutte le categorie', script: 'Sistema di scrittura', allScripts: 'Tutti i sistemi di scrittura',
  listFailed: 'Impossibile ottenere l’elenco dei font', listLoading: 'Recupero dell’elenco dei font…', noMatch: 'Nessun font corrispondente',
  downloadable: (count: string) => ` · ${count} scaricabili`,
  use: (family: string) => `Usa ${family}`, download: 'Scarica',
  downloadFamily: (family: string) => `Scarica ${family}`, cancelDownloadFamily: (family: string) => `Annulla il download di ${family}`,
  retryTip: (message: string) => `Riprova · ${message}`, retryFamily: (family: string) => `Prova a scaricare di nuovo ${family}`,
  detailsTip: 'Dettagli e licenza del font', detailsFamily: (family: string) => `Dettagli e licenza di ${family}`,
  skipThis: 'Salta questo', cancelAllTip: 'Annulla tutto · usa per ora font alternativi', cancelAll: 'Annulla tutto',
  collapse: 'Nascondi', view: 'Visualizza', gotIt: 'Capito', settings: 'Impostazioni', progress: 'Avanzamento del download dei font', retry: 'Riprova',
  systemFont: 'Font di sistema', pingFang: 'PingFang SC', songti: 'Songti SC', kaiti: 'Kaiti SC', font: 'Font',
  fontValue: (label: string, font: string) => `${label}: ${font}`,
  backToList: 'Torna all’elenco dei font', deleteDownloaded: 'Elimina file scaricati', useThis: 'Usa questo font',
};
