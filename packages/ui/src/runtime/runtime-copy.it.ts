import type { RuntimeMessages } from './runtime-copy.ts';

export const it: RuntimeMessages = {
  missingContext: "RuntimeContext manca",
  mediaStatus: (status) => `Il servizio multimediale ha restituito ${status}`,
  noRootSequence: "Il nuovo video non ha una sequenza principale",
  edit: {
    importAssets: "Importa materiali",
    setBackground: "Imposta sfondo",
    addWaveform: "Aggiungi forma d’onda",
  },
  waveformName: "Forma d’onda",
  noDuration: "Il video non ha ancora una durata, quindi la forma d’onda non è stata aggiunta",
  noOpenVideo: "Nessun video aperto",
  notCaughtUp: "Il video non è ancora aggiornato e non può essere modificato al momento",
};
