import type { ToolsGalleryMessages } from './tools-gallery.ts';
import { pluralForm } from '@baocut/protocol';

export const it: ToolsGalleryMessages = {
  transcode: 'Codificato su questo computer con ffmpeg · nessun caricamento',
  linkReady: 'Strumento di download pronto',
  pipelineMissing: 'Questa versione del Runtime non ha ancora un flusso per questo strumento, quindi al momento non può essere usato',
  withRemedy: (message, remedy) => `${message}. ${remedy}`,
  localModels: (n) => pluralForm('it', n, { one: `${n} modello locale`, other: `${n} modelli locali` }),
  cloudConnected: (n) => pluralForm('it', n, { one: `${n} provider online connesso`, other: `${n} provider online connessi` }),
  noSpeech: 'Nessun modello di sintesi vocale ancora disponibile',
  noImage: 'Nessun modello di generazione di immagini ancora disponibile',
  noText: 'Nessun modello di testo ancora disponibile',
};
