import type { StateMessages } from './state-copy.ts';

export const tr: StateMessages = {
  task: {
    running: 'İşleniyor',
    stopping: 'Durduruluyor',
    awaitingAnswer: 'Yanıt bekleniyor',
    awaitingApproval: 'Onay bekleniyor',
  },
};
