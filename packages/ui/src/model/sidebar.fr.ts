import type { SidebarMessages } from './sidebar.ts';

export const fr: SidebarMessages = {
  status: { answer: 'En attente de votre réponse', waiting: "Attente d’approbation", failed: "Échec", running: "En cours", unread: "Terminé, non lu" },
  stopping: "Arrêt",
  group: { waiting: 'Requiert votre attention', rest: 'Autres sessions' },

  count: {
    answer: (n: number) => `${n} en attente de votre réponse`,
    waiting: (n: number) => `${n} en attente d’approbation`,
    failed: (n: number) => `${n} en échec`,
    running: (n: number) => `${n} actifs`,
    unread: (n: number) => `${n} terminés, non lus`,
  },
};
