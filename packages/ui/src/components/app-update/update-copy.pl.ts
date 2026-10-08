import type { UpdateMessages, UpdateStep } from './update-copy.ts';

const STEP: Record<UpdateStep, string> = {
  install: 'rozpocząć instalacji',
  check: 'sprawdzić aktualizacji',
  download: 'rozpocząć pobierania',
  cancel: 'anulować pobierania',
  retry: 'spróbować ponownie',
  downloadPage: 'otworzyć strony pobierania',
};

export const pl: UpdateMessages = {
  failed: (step, message) => `Nie udało się ${STEP[step]}: ${message}`,
  progress: 'Postęp pobierania',
  notes: 'Co nowego w tej wersji',
  close: 'Zamknij',
};
