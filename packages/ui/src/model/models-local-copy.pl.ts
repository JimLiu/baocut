import type { ModelsLocalMessages } from './models-local-copy.ts';

export const pl: ModelsLocalMessages = {
  reason: {
    unsupported: "Nieobsługiwane na tym komputerze",
    resource: "Wyłączone",
    'worker-missing': "Brak Model Worker",
    'missing-manifest': "Brak manifestu",
    'missing-file': "Brak plików",
    'size-mismatch': "Niezgodny rozmiar pliku",
    'hash-mismatch': "Niezgodna suma kontrolna",
    incomplete: "Brak komponentów",
    'load-failed': "Nie udało się wczytać",
    relocating: "Przenoszenie",
  },
  chipDefault: "Domyślny",
  chipLoading: "Wczytywanie",
  chipReady: "Wczytano",
  chipBusy: "W toku",
  chipUnloading: "Zwalnianie",
  chipUnavailable: "Niedostępne",
  capability: {
    transcribe: "Transkrybuj",
    align: "Wyrównaj",
    synthesize: "Syntezuj",
    image: "Obraz",
    separate: "Separacja",
    diarize: "Rozróżnianie mówców",
  },
  auto: "Automatycznie",
  notInstalled: (name) => `${name} (niezainstalowany)`,
  componentName: { aligner: "Wymuszone dopasowanie", speaker: "Embedding mówcy", vad: "VAD (wykrywanie aktywności głosowej)" },
  weights: "Wagi modelu",
};
