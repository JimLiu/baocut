import type { DriversCodexMessages } from './drivers-codex.ts';

export const nl: DriversCodexMessages = {
  plan: "ChatGPT Plus- of Pro-abonnement",
  installHint: "Installeer Codex CLI",

  signedOut: (p: { detail: string }) => `Codex is niet ingelogd. Voer codex login uit in een terminal.${p.detail ? ` (${p.detail})` : ""}`,
  chatgptAccount: "ChatGPT-account",
  apiKey: "OpenAI-API-sleutel",
  accessToken: "Toegangstoken",
  workloadIdentity: "Workloadidentiteit",
  codexAccount: "Codex-account",
  steerMismatch: (p: { expected: string; received: string }) =>
    `Codex gaf een onverwacht turn/steer-antwoord: verwachte beurt ${p.expected}, ontvangen ${p.received}`,

  appServerExited: (p: { code: string; signal: string; stderr: string }) =>
    `codex app-server is afgesloten (code ${p.code}, signaal ${p.signal})${p.stderr ? `\n${p.stderr}` : ""}`,
  connectionClosed: "De verbinding met codex app-server is gesloten",
  requestTimeout: (p: { method: string }) => `codex app-server-verzoek verlopen: ${p.method}`,
  appServerGone: "codex app-server is afgesloten",
};
