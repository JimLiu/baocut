import type { RcSchedulesMessages } from './rc-schedules.ts';

export const it: RcSchedulesMessages = {
  notFound: (p) => `Attività pianificata non trovata: ${p.id}`,
  conversationNotFound: (p) => `Sessione non trovata: ${p.id}`,
  conversationArchived: 'Questa sessione è archiviata. Ripristinala da Sessioni archiviate prima di pianificarla.',
  noProject: 'Questa sessione non fa parte di un progetto, quindi non può aprire ogni volta una nuova sessione in un progetto.',
  invalid: 'Controlla l’attività pianificata: messaggio, frequenza e limite di esecuzioni devono essere validi.',
  notActive: 'Solo un’attività pianificata attiva può essere eseguita ora.',
  resumeArchived:
    'La sessione di destinazione è archiviata. Ripristinala da Sessioni archiviate oppure modifica l’attività pianificata per aprire ogni volta una nuova sessione.',
  resumeDeleted: 'La sessione di destinazione è stata eliminata. Modifica l’attività pianificata per aprire ogni volta una nuova sessione.',
  resumeProjectRemoved: 'Il progetto è stato rimosso da BaoCut, quindi non è possibile aprirvi una nuova sessione.',
  resumeCompleted: 'Ha già raggiunto il numero massimo di esecuzioni. Aumenta il limite prima di riprendere.',
  runStopped: 'Interrotta prima della fine',
};
