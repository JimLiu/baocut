import type { DriversCodexMessages } from './drivers-codex.ts';

export const de: DriversCodexMessages = {
  plan: "ChatGPT Plus- oder Pro-Abonnement",
  installHint: "Codex CLI installieren",

  signedOut: (p: { detail: string }) => `Codex ist nicht angemeldet. Im Terminal codex login ausführen.${p.detail ? ` (${p.detail})` : ""}`,
  loginCheckFailed: (p) => `Die Codex-Anmeldung konnte nicht geprüft werden: ${p.command} login status ist fehlgeschlagen. BaoCut startet dieses Programm mit Unterbefehlen wie login status und app-server, daher muss ein Wrapper-Skript seine Argumente unverändert weitergeben.${p.detail ? ` (${p.detail})` : ''}`,
  customProvider: 'Benutzerdefinierter Modellanbieter',
  chatgptAccount: "ChatGPT-Konto",
  apiKey: "OpenAI-API-Schlüssel",
  accessToken: "Zugriffstoken",
  workloadIdentity: "Workload-Identität",
  codexAccount: "Codex-Konto",
  steerMismatch: (p: { expected: string; received: string }) =>
    `Codex gab eine unerwartete turn/steer-Antwort zurück: erwartete Runde ${p.expected}, erhalten ${p.received}`,

  appServerExited: (p: { code: string; signal: string; stderr: string }) =>
    `codex app-server wurde beendet (Code ${p.code}, Signal ${p.signal})${p.stderr ? `\n${p.stderr}` : ""}`,
  connectionClosed: "Die Verbindung zu codex app-server ist geschlossen",
  requestTimeout: (p: { method: string }) => `Zeitüberschreitung bei codex app-server-Anfrage: ${p.method}`,
  appServerGone: "codex app-server wurde beendet",
};
