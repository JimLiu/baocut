import type { DriversOpencodeMessages } from './drivers-opencode.ts';

export const fr: DriversOpencodeMessages = {
  plan: "Comptes de modèles dans OpenCode",
  installHint: "Installer la version 2.x avec npm install -g @opencode/cli",
  unsupportedMajor: (p: { version: string }) =>
    `OpenCode ${p.version} est une version majeure non encore prise en charge par BaoCut. Seule la version 2.x est prise en charge.`,
  tooOld: (p: { version: string; min: string; command: string }) =>
    `OpenCode ${p.version} est trop ancien. Mettez-le à jour : BaoCut nécessite ${p.min} ou une version 2.x ultérieure (${p.command}).`,
  unsupportedVersion: (p: { version: string; min: string }) => `OpenCode ${p.version} n’est pas pris en charge. Il nécessite ${p.min} ou une version 2.x ultérieure`,
  versionUnknown: "version inconnue",
  noModelAccount: (p: { command: string }) =>
    `Aucun compte de modèle connecté dans OpenCode ; seuls les modèles gratuits OpenCode Zen sont disponibles. Exécutez ${p.command} dans un terminal pour en connecter un.`,
  probeFailed: (p: { error: string }) => `Impossible de démarrer OpenCode serve ou de lire la liste des modèles : ${p.error}`,
  externalDirectory: "Accéder à un emplacement hors du dossier de travail",
  directoryNotReady: (p: { seconds: string; directory: string }) =>
    `OpenCode n’a pas préparé le dossier ${p.directory} dans les ${p.seconds} secondes`,

  httpFailed: (p: { operation: string; status: string; tag: string; detail: string }) =>
    `OpenCode ${p.operation} en échec (HTTP ${p.status}${p.tag ? ` ${p.tag}` : ""})${p.detail ? ` : ${p.detail}` : ""}`,
  htmlResponse: "Page web reçue au lieu de l’API v2 (version incompatible ?)",
  processExited: "Le processus OpenCode s’est arrêté",
  killedBySignal: (p: { signal: string }) => `Arrêté par le signal ${p.signal}`,
  exitCode: (p: { code: string }) => `Code de sortie ${p.code}`,
  serveNotReady: (p: { seconds: string }) => `opencode serve n’a pas été prêt dans les ${p.seconds} secondes`,
  serveExitedAtStart: (p: { reason: string }) => `opencode serve s’est arrêté au démarrage (${p.reason})`,
  serveExited: "opencode serve s’est arrêté",
  streamConnectFailed: (p: { status: string }) => `Impossible de se connecter au flux d’événements (HTTP ${p.status})`,
  streamEnded: "Le flux d’événements s’est terminé",
  streamNotConnected: (p: { seconds: string }) => `Le flux d’événements ne s’est pas connecté (${p.seconds} secondes)`,
  streamLost: (p: { error: string }) => `Flux d’événements déconnecté : ${p.error}`,
  mcpFailed: (p: { name: string; server: string; error: string }) =>
    `${p.name} n’a pas pu se connecter au serveur MCP ${p.server} (${p.error}). Les outils BaoCut sont indisponibles dans cette session.`,
  mcpTimeout: (p: { name: string; servers: string }) =>
    `${p.name} ne s’est pas connecté aux serveurs MCP (${p.servers}) à temps. Les outils BaoCut peuvent être indisponibles dans cette session.`,
  promptRejected: (p: { name: string; error: string }) => `${p.name} n’a pas accepté ce message : ${p.error}`,
  setModeFailed: (p: { name: string; error: string }) => `${p.name} n’a pas pu définir le mode d’accès : ${p.error}`,
  retryFallback: "Échec de la requête au modèle. Nouvelle tentative sous peu.",
  runFailed: (p: { name: string }) => `${p.name} : échec de l’exécution`,
  endedAfterRejection: (p: { name: string }) =>
    `${p.name} a terminé ce tour après le refus d’un outil. Envoyez un autre message pour essayer une autre approche.`,
  interruptedTurn: (p: { name: string; reason: string }) => `${p.name} a interrompu ce tour (${p.reason}).`,
  modelFormat: (p: { name: string; id: string }) => `${p.name} : les modèles doivent être écrits provider/model (reçu ${p.id})`,
};
