import type { StateMessages } from './state-copy.ts';

export const it: StateMessages = {
  task: {
    running: "In corso",
    stopping: "Interruzione in corso",
    awaitingApproval: "In attesa di approvazione",
  },
};
