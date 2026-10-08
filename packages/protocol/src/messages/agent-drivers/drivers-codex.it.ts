import type { DriversCodexMessages } from './drivers-codex.ts';

export const it: DriversCodexMessages = {
  plan: "Abbonamento ChatGPT Plus o Pro",
  installHint: "Installa Codex CLI",
  signedOut: (p) => `Codex non ha effettuato l’accesso. Esegui codex login in un terminale.${p.detail ? ` (${p.detail})` : ""}`,
  chatgptAccount: "Account ChatGPT",
  apiKey: "Chiave API OpenAI",
  accessToken: "Token di accesso",
  workloadIdentity: "Identità del carico di lavoro",
  codexAccount: "Account Codex",
  steerMismatch: (p) => `Codex ha dato una risposta inattesa a turn/steer: turno previsto ${p.expected}, ricevuto ${p.received}`,
  appServerExited: (p) => `codex app-server è terminato (code ${p.code}, signal ${p.signal})${p.stderr ? `
${p.stderr}` : ""}`,
  connectionClosed: "La connessione a codex app-server è chiusa",
  requestTimeout: (p) => `La richiesta di codex app-server è scaduta: ${p.method}`,
  appServerGone: "codex app-server è terminato",
};
