import type { DriversCodexMessages } from './drivers-codex.ts';

export const pl: DriversCodexMessages = {
  plan: "Subskrypcja ChatGPT Plus lub Pro",
  installHint: "Zainstaluj Codex CLI",
  signedOut: (p) => `Codex nie jest zalogowany. Uruchom codex login w terminalu.${p.detail ? ` (${p.detail})` : ""}`,
  loginCheckFailed: (p) => `Nie udało się sprawdzić logowania do Codex: ${p.command} login status zakończyło się błędem. BaoCut uruchamia ten program z podpoleceniami takimi jak login status i app-server, więc skrypt opakowujący musi przekazywać argumenty bez zmian.${p.detail ? ` (${p.detail})` : ''}`,
  customProvider: 'Niestandardowy dostawca modeli',
  chatgptAccount: "Konto ChatGPT",
  apiKey: "Klucz API OpenAI",
  accessToken: "Token dostępu",
  workloadIdentity: "Tożsamość obciążenia",
  codexAccount: "Konto Codex",
  steerMismatch: (p) => `Codex zwrócił nieoczekiwaną odpowiedź turn/steer: oczekiwano tury ${p.expected}, otrzymano ${p.received}`,
  appServerExited: (p) => `codex app-server zakończył działanie (kod ${p.code}, sygnał ${p.signal})${p.stderr ? `
${p.stderr}` : ""}`,
  connectionClosed: "Połączenie z codex app-server jest zamknięte",
  requestTimeout: (p) => `Upłynął limit czasu żądania codex app-server: ${p.method}`,
  appServerGone: "codex app-server zakończył działanie",
};
