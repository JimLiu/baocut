import type { StateMessages } from './state-copy.ts';

export const pl: StateMessages = {
  task: {
    running: 'Przetwarzanie',
    stopping: 'Zatrzymywanie',
    awaitingApproval: 'Oczekiwanie na zatwierdzenie',
  },
};
