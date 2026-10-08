import type { DriversCommonMessages } from './drivers-common.ts';

export const fr: DriversCommonMessages = {
  executableMissing: (p: { command: string; path: string }) => `Le chemin indiqué pour ${p.command} (${p.path}) n’existe pas ou ne peut pas être exécuté.`,
  commandMissing: (p: { command: string; hint: string }) => `Impossible de trouver la commande ${p.command}. ${p.hint}, ou définissez son emplacement dans Réglages.`,
  commandNotFound: (p: { command: string }) => `Impossible de trouver la commande ${p.command} commande`,
  installItFirst: "Installez-le d’abord",
  versionFailed: (p: { command: string }) => `${p.command} --version ne s’est pas terminé normalement.`,
  outdated: (p: { name: string; version: string; min: string }) => `${p.name} ${p.version} est trop ancien. BaoCut nécessite ${p.min} ou une version ultérieure.`,
  startFailed: (p: { name: string; error: string }) => `${p.name} n’a pas démarré : ${p.error}`,
  openSessionFailed: (p: { name: string; error: string }) => `${p.name} n’a pas pu ouvrir de session : ${p.error}`,
  confinedUnsupported: (p: { name: string }) => `${p.name} ne prend pas en charge les appels ponctuels restreints`,

  resumeFailed: (p: { name: string; error: string }) =>
    `Impossible de reprendre la session native ${p.name}${p.error ? ` (${p.error})` : ""}. Une nouvelle session a été créée ; l’Agent ne voit pas la conversation précédente.`,
  sessionClosed: (p: { name: string }) => `La version de ${p.name} : session fermée`,
  sessionNotReady: (p: { name: string }) => `La version de ${p.name} : session pas encore prête`,
  turnInProgress: "Le tour précédent n’est pas encore terminé",
  modelSwitchFailed: (p: { name: string; model: string; error: string }) => `${p.name} n’a pas pu passer au modèle ${p.model} : ${p.error}`,
  timedOut: (p: { label: string; seconds: number }) => `${p.label} a dépassé le délai (${p.seconds} s)`,
  unknownError: "Erreur inconnue",
  unknownReason: "motif inconnu",

  imagePlaceholder: "[Image]",

  officialScript: "Script officiel",
};
