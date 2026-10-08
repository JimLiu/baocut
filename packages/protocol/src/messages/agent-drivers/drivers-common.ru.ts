import type { DriversCommonMessages } from './drivers-common.ts';

export const ru: DriversCommonMessages = {
  executableMissing: (p) => `Указанная команда ${p.command} (${p.path}) не существует или не запускается.`,
  commandMissing: (p) => `Не удалось найти команду ${p.command}. ${p.hint} или укажите расположение в настройках.`,
  commandNotFound: (p) => `Не удалось найти команду ${p.command} — команда`,
  installItFirst: "Сначала установите",
  versionFailed: (p) => `${p.command} --version завершилась нештатно.`,
  outdated: (p) => `${p.name} ${p.version} слишком старый. BaoCut требует ${p.min} или новее.`,
  startFailed: (p) => `${p.name} не удалось запустить: ${p.error}`,
  openSessionFailed: (p) => `${p.name} не удалось открыть сессию: ${p.error}`,
  confinedUnsupported: (p) => `${p.name} не поддерживает ограниченные разовые вызовы`,
  resumeFailed: (p) => `Не удалось продолжить нативную сессию ${p.name}${p.error ? ` (${p.error})` : ""}. Начата новая сессия; агент не видит предыдущий разговор.`,
  sessionClosed: (p) => `Компонент ${p.name} — сессия закрыта`,
  sessionNotReady: (p) => `Компонент ${p.name} — сессия ещё не готова`,
  turnInProgress: "Предыдущая итерация ещё не завершена",
  modelSwitchFailed: (p) => `${p.name} не удалось переключить на модель ${p.model}: ${p.error}`,
  timedOut: (p) => `${p.label} — время ожидания истекло (${p.seconds} с)`,
  unknownError: "Неизвестная ошибка",
  unknownReason: "неизвестная причина",
  imagePlaceholder: "[Изображение]",
  officialScript: "Официальный скрипт",
};
