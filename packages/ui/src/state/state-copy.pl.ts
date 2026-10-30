import type { StateMessages } from './state-copy.ts';

export const pl: StateMessages = {
  task: {
    running: 'Przetwarzanie',
    stopping: 'Zatrzymywanie',
    awaitingAnswer: 'Oczekiwanie na odpowiedź',
    awaitingApproval: 'Oczekiwanie na zatwierdzenie',
  },
};
