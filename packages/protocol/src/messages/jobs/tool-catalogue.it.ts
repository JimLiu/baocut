import type { JobsToolCatalogueMessages } from './tool-catalogue.ts';

export const it: JobsToolCatalogueMessages = {
  transcribeLabel: 'Trascrivi',
  transcribeDescription: 'Trascrivi un file multimediale locale o un video nello Space. Per un video, scrive una nuova trascrizione e crea un livello di sottotitoli; per un solo file, scrive TXT e SRT nella posizione di salvataggio o può creare un nuovo video.',
  translateSubtitlesLabel: 'Traduci sottotitoli',
  translateSubtitlesDescription: 'Traduci la trascrizione di un video frase per frase in un’altra lingua e scrivila nel video come nuova traduzione. Può anche tradurre un file di sottotitoli SRT / VTT (un file locale o una voce di sottotitoli nello Space) in un nuovo file di sottotitoli.',
  dubLabel: 'Doppiaggio tradotto',
  dubDescription: 'Sintetizza voce nella lingua di destinazione frase per frase dalla trascrizione (traducendo prima se non esiste una traduzione), allinea i tempi e scrivila nel video come nuovo gruppo di doppiaggio.',
  synthesizeSpeechLabel: 'Genera voce',
  synthesizeSpeechDescription: 'Sintetizza voce da un testo; il risultato è audio. Può anche leggere un documento o una voce di sottotitoli nello Space (sottotitoli senza timecode).',
  generateTextLabel: 'Genera testo',
  generateTextDescription: 'Genera testo da un prompt (facoltativamente seguendo un JSON Schema); il risultato è testo. Documenti o voci di sottotitoli nello Space possono essere allegati come materiale.',
  generateImageLabel: 'Genera immagine', generateImageDescription: 'Genera un’immagine da una descrizione; il risultato è un’immagine.',
  linkImportLabel: 'Scarica video', linkImportDescription: 'Scarica un video su questo computer con yt-dlp. Puoi usare i cookie del browser e trascrivere il download in una trascrizione e sottotitoli.',
  compressVideoLabel: 'Comprimi video', compressVideoDescription: 'Comprimi i file video uno per uno: da file a file, non viene creato alcun video e i risultati non sovrascrivono i file esistenti.',
  mergeVideoLabel: 'Unisci video', mergeVideoDescription: 'Unisci diversi file video in uno solo, in ordine: da file a file, non viene creato alcun video e i risultati non sovrascrivono i file esistenti.',
  extractAudioLabel: 'Estrai audio', extractAudioDescription: 'Estrai la traccia audio da un file video o audio. I codec compatibili con un contenitore comune vengono copiati senza modifiche; gli altri vengono ricodificati in AAC. Da file a file, non viene creato alcun video e i risultati non sovrascrivono i file esistenti.',
};
