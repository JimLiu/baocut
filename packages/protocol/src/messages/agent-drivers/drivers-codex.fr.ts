import type { DriversCodexMessages } from './drivers-codex.ts';

export const fr: DriversCodexMessages = {
  plan: "Abonnement ChatGPT Plus ou Pro",
  installHint: "Installer Codex CLI",

  signedOut: (p: { detail: string }) => `Codex n’est pas connecté. Exécutez codex login dans un terminal.${p.detail ? ` (${p.detail})` : ""}`,
  loginCheckFailed: (p) => `Impossible de vérifier la connexion à Codex : ${p.command} login status a échoué. BaoCut lance ce programme avec des sous-commandes comme login status et app-server : un script d’encapsulation doit donc transmettre ses arguments tels quels.${p.detail ? ` (${p.detail})` : ''}`,
  customProvider: 'Fournisseur de modèles personnalisé',
  chatgptAccount: "Compte ChatGPT",
  apiKey: "Clé API OpenAI",
  accessToken: "Jeton d'accès",
  workloadIdentity: "Identité de charge de travail",
  codexAccount: "Compte Codex",
  steerMismatch: (p: { expected: string; received: string }) =>
    `Réponse turn/steer inattendue de Codex : tour attendu ${p.expected}, reçu ${p.received}`,

  appServerExited: (p: { code: string; signal: string; stderr: string }) =>
    `codex app-server s’est arrêté (code ${p.code}, signal ${p.signal})${p.stderr ? `
${p.stderr}` : ""}`,
  connectionClosed: "La connexion codex app-server est fermée",
  requestTimeout: (p: { method: string }) => `Délai de requête codex app-server dépassé : ${p.method}`,
  appServerGone: "codex app-server s’est arrêté",
};
