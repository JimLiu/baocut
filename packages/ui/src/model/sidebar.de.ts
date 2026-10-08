import type { SidebarMessages } from './sidebar.ts';

export const de: SidebarMessages = {
  status: { waiting: "Wartet auf Genehmigung", failed: "Fehlgeschlagen", running: "Läuft", unread: "Fertig, ungelesen" },
  stopping: "Wird gestoppt",

  count: {
    waiting: (n: number) => `${n} warten auf Genehmigung`,
    failed: (n: number) => `${n} fehlgeschlagen`,
    running: (n: number) => `${n} laufend`,
    unread: (n: number) => `${n} fertig, ungelesen`,
  },
};
