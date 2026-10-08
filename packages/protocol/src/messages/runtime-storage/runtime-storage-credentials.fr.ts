import type { RuntimeStorageCredentialsMessages } from './runtime-storage-credentials.ts';

export const fr: RuntimeStorageCredentialsMessages = {
  denied: "Accès refusé",
  unavailable: "Le stockage des identifiants est indisponible",
  unsupported: "Cette plateforme ne prend pas en charge le stockage sécurisé du système",
  internal: "Erreur de lecture ou d’écriture de l’identifiant",
  problem: (p: { reason: string; message: string }) => `${p.reason} : ${p.message}`,
  fileWriteFailed: (p: { code: string }) => `Impossible d’écrire le fichier d’identifiant (${p.code})`,
  fileUnreadable: (p) => `Impossible de lire le fichier d’identifiant ; il a été laissé intact (${p.code})`,
  helperBadResponse: "L’assistant d’identifiants a renvoyé une réponse invalide",
  helperNotFound: "Programme d’assistance aux identifiants introuvable",
  helperTimedOut: (p: { seconds: number }) => `L’assistant d’identifiants n’a pas répondu dans les ${p.seconds} secondes`,
  helperMissing: "Le programme d’assistance aux identifiants est manquant",
  helperStartFailed: (p: { code: string }) => `L’assistant d’identifiants n’a pas démarré (${p.code})`,
  helperResponseTooLong: "La réponse de l’assistant d’identifiants est trop longue",
  helperExitedSilently: "L’assistant d’identifiants s’est arrêté sans répondre",
  helperReportedError: "L’assistant d’identifiants a signalé une erreur",
  redacted: "[masqué]",
};
