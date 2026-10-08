import type { RuntimeStorageCredentialsMessages } from './runtime-storage-credentials.ts';

export const ru: RuntimeStorageCredentialsMessages = {
  denied: "Доступ запрещён",
  unavailable: "Хранилище учётных данных недоступно",
  unsupported: "Эта платформа не поддерживает системное защищённое хранилище",
  internal: "Ошибка чтения или записи учётных данных",
  problem: (p) => `${p.reason}: ${p.message}`,
  fileWriteFailed: (p) => `Не удалось записать файл учётных данных (${p.code})`,
  helperBadResponse: "Программа учётных данных вернула недопустимый ответ",
  helperNotFound: "Программа учётных данных не найдена",
  helperTimedOut: (p) => `Программа учётных данных не ответила за ${p.seconds} с`,
  helperMissing: "Программа учётных данных отсутствует",
  helperStartFailed: (p) => `Не удалось запустить программу учётных данных (${p.code})`,
  helperResponseTooLong: "Ответ программы учётных данных слишком длинный",
  helperExitedSilently: "Программа учётных данных завершилась без ответа",
  helperReportedError: "Программа учётных данных сообщила об ошибке",
  redacted: "[скрыто]",
};
