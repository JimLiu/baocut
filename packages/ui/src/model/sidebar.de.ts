import type { SidebarMessages } from './sidebar.ts';

export const de: SidebarMessages = {
  status: { answer: 'Wartet auf Ihre Antwort', waiting: "Wartet auf Genehmigung", failed: "Fehlgeschlagen", running: "Läuft", unread: "Fertig, ungelesen" },
  stopping: "Wird gestoppt",

  count: {
    answer: (n: number) => `${n} warten auf Ihre Antwort`,
    waiting: (n: number) => `${n} warten auf Genehmigung`,
    failed: (n: number) => `${n} fehlgeschlagen`,
    running: (n: number) => `${n} laufend`,
    unread: (n: number) => `${n} fertig, ungelesen`,
  },
};
