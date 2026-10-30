import type { StateMessages } from './state-copy.ts';

export const it: StateMessages = {
  task: {
    running: "In corso",
    stopping: "Interruzione in corso",
    awaitingAnswer: 'In attesa della tua risposta',
    awaitingApproval: "In attesa di approvazione",
  },
};
