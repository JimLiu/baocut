import type { SidebarMessages } from './sidebar.ts';

export const ru: SidebarMessages = {
  status: { waiting: "Ожидание одобрения", failed: "Ошибка", running: "Выполняется", unread: "Готово, не прочитано" },
  stopping: "Остановка",
  count: {
    waiting: (n: number) => `${n} ожидают одобрения`,
    failed: (n: number) => `${n} с ошибкой`,
    running: (n: number) => `${n} выполняется`,
    unread: (n: number) => `${n} завершено, не прочитано`,
  },
};
