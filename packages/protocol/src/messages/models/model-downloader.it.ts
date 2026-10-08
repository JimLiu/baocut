import type { ModelsModelDownloaderMessages } from './model-downloader.ts';

export const it: ModelsModelDownloaderMessages = {
  remedyNoSpace: "Il disco che contiene la cartella dei modelli ha esaurito lo spazio. Libera spazio sufficiente (o sposta la cartella dei modelli su un altro disco nelle Impostazioni), poi installa di nuovo",
  remedyNetwork: "Impossibile raggiungere la rete o download interrotto. Controlla la rete e installa di nuovo; il download riprenderà da dove si è fermato. Puoi anche cambiare mirror in «Origine del download dei modelli» in «Impostazioni › Generali»",
  remedyIntegrity: "Un file scaricato non corrisponde alla dimensione o al valore sha256 del manifesto (l’origine o il mirror ha contenuti errati). Il file non valido è stato eliminato; passa a un’altra origine di download e installa di nuovo",
  remedySource: "L’origine del download non contiene questo file o ha negato l’accesso. Verifica che il mirror impostato in «Origine del download dei modelli» in «Impostazioni › Generali» (o nella variabile d’ambiente BAOCUT_MODELS_ENDPOINT) sia completo",
  remedyManifestIncomplete: "Il manifesto integrato di questo pacchetto di modelli non ha un sha256 attendibile, quindi non può essere installato. Attendi un aggiornamento di BaoCut",
  downloadFailed: (p: { file: string; reason: string }) => `Impossibile scaricare ${p.file}: ${p.reason}`,
  integrityMismatch: (p: { file: string }) => `${p.file} ha una dimensione o un valore sha256 che non corrisponde al manifesto`,
  sourceHttp: (p: { file: string; status: number }) => `L’origine del download per ${p.file} ha restituito HTTP ${p.status}`,
  diskFull: "Il disco si è riempito durante la scrittura dei file del modello",
};
