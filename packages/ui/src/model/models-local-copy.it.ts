import type { ModelsLocalMessages } from './models-local-copy.ts';

export const it: ModelsLocalMessages = {
  reason: {
    unsupported: "Non supportato su questo computer",
    resource: "Disattivato",
    'worker-missing': "Model Worker mancante",
    'missing-manifest': "Manifesto mancante",
    'missing-file': "File mancanti",
    'size-mismatch': "Dimensione del file non corrispondente",
    'hash-mismatch': "Checksum non corrispondente",
    incomplete: "Componenti mancanti",
    'load-failed': "Impossibile caricare",
    relocating: "Spostamento in corso",
  },
  chipDefault: "Predefinito",
  chipLoading: "Caricamento in corso",
  chipReady: "Caricato",
  chipBusy: "In esecuzione",
  chipUnloading: "Scaricamento dalla memoria in corso",
  chipUnavailable: "Non disponibile",
  capability: {
    transcribe: "Trascrivi",
    align: "Allinea",
    synthesize: "Sintetizza",
    image: "Immagine",
    separate: "Separa",
    diarize: "Diarizzazione dei parlanti",
  },
  auto: "Automatico",
  notInstalled: (name) => `${name} (non installato)`,
  componentName: { aligner: "Allineatore forzato", speaker: "Embedding del parlante", vad: "VAD (rilevamento dell’attività vocale)" },
  weights: "Pesi del modello",
};
