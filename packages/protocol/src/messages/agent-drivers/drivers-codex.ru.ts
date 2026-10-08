import type { DriversCodexMessages } from './drivers-codex.ts';

export const ru: DriversCodexMessages = {
  plan: "Подписка ChatGPT Plus или Pro",
  installHint: "Установите Codex CLI",
  signedOut: (p) => `В Codex не выполнен вход. Выполните codex login в терминале.${p.detail ? ` (${p.detail})` : ""}`,
  chatgptAccount: "Аккаунт ChatGPT",
  apiKey: "Ключ API OpenAI",
  accessToken: "Токен доступа",
  workloadIdentity: "Идентификатор рабочей нагрузки",
  codexAccount: "Аккаунт Codex",
  steerMismatch: (p) => `Codex вернул неожиданный ответ turn/steer: ожидалась итерация ${p.expected}, получено ${p.received}`,
  appServerExited: (p) => `codex app-server завершился (код ${p.code}, сигнал ${p.signal})${p.stderr ? `
${p.stderr}` : ""}`,
  connectionClosed: "Соединение с codex app-server закрыто",
  requestTimeout: (p) => `Время ожидания запроса codex app-server истекло: ${p.method}`,
  appServerGone: "codex app-server завершился",
};
