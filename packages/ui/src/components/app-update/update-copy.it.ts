import type { UpdateMessages, UpdateStep } from './update-copy.ts';

const STEP: Record<UpdateStep, string> = {
  install: "avviare l’installazione",
  check: "verificare gli aggiornamenti",
  download: "avviare il download",
  cancel: "annullare il download",
  retry: "Riprova",
  downloadPage: "aprire la pagina di download",
};

export const it: UpdateMessages = {
  failed: (step, message) => `Impossibile ${STEP[step]}: ${message}`,
  progress: "Avanzamento del download",
  notes: "Novità di questa versione",
  close: "Chiudi",
};
