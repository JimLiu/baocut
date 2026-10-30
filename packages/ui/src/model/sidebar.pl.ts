import type { SidebarMessages } from './sidebar.ts';

export const pl: SidebarMessages = {
  status: { answer: 'Oczekiwanie na odpowiedź', waiting: "Oczekiwanie na zatwierdzenie", failed: "Niepowodzenie", running: "W toku", unread: "Gotowe, nieprzeczytane" },
  stopping: "Zatrzymywanie",
  group: { waiting: 'Czeka na Ciebie', rest: 'Pozostałe sesje' },
  count: {
    answer: (n: number) => `${n} oczekuje na odpowiedź`,
    waiting: (n: number) => `${n} oczekuje na zatwierdzenie`,
    failed: (n: number) => `${n} z niepowodzeniem`,
    running: (n: number) => `${n} w trakcie`,
    unread: (n: number) => `${n} ukończono, nieprzeczytane`,
  },
};
