import type { JobsLinkImportMessages } from './link-import.ts';

export const it: JobsLinkImportMessages = {
  languageTag: 'deve essere un tag di lingua BCP 47', requiresTranscribe: 'può essere indicato solo con transcribe',
  noVideoDiarize: 'Senza un video di destinazione vengono scritte solo trascrizioni indipendenti; i parlanti non possono essere separati',
  noVideoCaptions: 'Non vengono creati livelli di sottotitoli senza un video di destinazione', notWrittenToVideo: 'La trascrizione è terminata ma non è stata scritta nel video',
  label: 'Scarica video',
  description: 'Scarica un video in una cartella con yt-dlp, trascrivendolo facoltativamente in TXT e SRT. Il progetto di appartenenza e la cartella di salvataggio sono indipendenti; il protocollo precedente accetta ancora una destinazione di importazione video. Richiede l’installazione di yt-dlp e il consenso al suo utilizzo.',
  offlineStrict: 'I link non vengono scaricati in modalità rigorosamente offline', cannotCreateVideo: 'Questo Runtime non può creare video', cannotTranscribe: 'Questo Runtime non può trascrivere',
  fileTranscribeUnavailable: 'La trascrizione di file non è disponibile', videoNotOpen: 'Il video non è aperto', sourceExpired: 'Il link originale non è più disponibile: avvia una nuova importazione',
  stepResolve: 'Risolvi link', stepDownload: 'Scarica', stepVerify: 'Verifica la decodifica', stepPublish: 'Sposta nella cartella dei download', stepCreate: 'Crea video', stepImport: 'Importa nel video', stepTranscribe: 'Trascrivi',
  undecodable: 'Il file scaricato non può essere decodificato', noStreams: 'Il file scaricato non ha né immagine né suono',
  undecodableRemedy: 'Il file di origine è incompleto o in un formato non supportato: riprova o prova un altro formato (audioOnly)',
  noMediaFile: 'Lo strumento di download non ha lasciato un file multimediale',
  destinationUnwritable: (p) => `Impossibile scrivere nella cartella di salvataggio: ${p.dir}`,
  destinationRemedy: 'Verifica che la cartella di salvataggio (la cartella Download è l’impostazione downloads.directory; in un progetto è downloads/ del progetto) esista e sia scrivibile',
  publishedOutside: 'Il file pubblicato è fuori dalla cartella di salvataggio', diskFull: 'Spazio su disco insufficiente per la cartella dei download',
  unsupportedBrowser: 'non è un browser supportato', browserItems: 'deve contenere solo browser supportati', noDuplicates: 'non può contenere duplicati', saveToInvalid: 'deve essere downloads o project',
  languageItems: 'deve contenere solo codici di lingua (ad esempio en, zh-Hans)', projectMismatch: 'non corrisponde al progetto in target.create', conversationMismatch: 'non corrisponde alla sessione in target.create',
};
