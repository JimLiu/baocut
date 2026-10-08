import type { ResourceCapacityMessages } from './resource-capacity-copy.ts';

export const ru: ResourceCapacityMessages = {
  title: "Планирование ресурсов",
  resetAll: "Вернуть всё в автоматический режим",
  lead: "Тяжёлые задачи, такие как расшифровка, локальные модели и экспорт, ставятся в очередь по ресурсам этого компьютера: запускаются, когда ресурсов хватает, иначе ждут завершения предыдущих. Ресурсы определяются автоматически. Если здесь работают другие тяжёлые программы или определение неточно, задайте лимит вручную; оставьте поле пустым для автоматического режима.",
  disconnected: "Нет подключения к Runtime",
  loadFailed: "Не удалось прочитать состояние ресурсов",
  loading: "Чтение состояния ресурсов…",
  limitOf: (label: string, unit: string) => `${label} — лимит (${unit})`,
  unit: { memoryGB: "ГБ", gpuMemoryGB: "ГБ", cpuThreads: "потоки" },
  notSettable: "Нельзя задать вручную",
  inUseAndQueued: "Используется и в очереди",
  inUse: (demand: string) => `Используется · ${demand}`,
  queued: (detail: string | null, demand: string) => `В очереди · ${detail ?? "Ожидание запуска"} · Требуется ${demand}`,
  idle: "Нет задач, использующих локальные ресурсы",
  saveFailed: (message: string) => `Не удалось сохранить: ${message}`,
};
