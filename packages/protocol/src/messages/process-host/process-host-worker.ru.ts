import type { ProcessHostWorkerMessages } from './process-host-worker.ts';

export const ru: ProcessHostWorkerMessages = {
  requestFailed: (p) => `${p.method} — ошибка: ${p.code}: ${p.message}`,
  exited: (p) => `${p.method} не завершён: дочерний процесс завершился (код ${p.code}, сигнал ${p.signal})`,
  notRunning: (p) => `${p.method} не отправлен: дочерний процесс не запущен`,
  timedOut: (p) => `${p.method} — время ожидания истекло (${p.ms} мс)`,
  spawnFailed: (p) => `Не удалось запустить ${p.command}: ${p.error}`,
  malformedError: "Дочерний процесс вернул ошибку неверного формата",
};
