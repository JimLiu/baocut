import type { DriversPiMessages } from './drivers-pi.ts';

export const fr: DriversPiMessages = {
  plan: "Comptes de modèles dans Pi",
  installHint: "Installer Pi avec npm (npm install -g @earendil-works/pi-coding-agent, nécessite Node.js)",
  signedOut:
    "Pi n’est pas connecté. Exécutez pi dans un terminal puis /login, ou définissez une clé API de fournisseur (par exemple ANTHROPIC_API_KEY).",
  rpcFailed: (p: { error: string }) => `Impossible de démarrer le mode RPC de Pi : ${p.error}`,
  processStartFailed: (p: { error: string }) => `Le processus Pi n’a pas démarré : ${p.error}`,

  processExited: (p: { code: string; signal: string; tail: string }) =>
    `Le processus Pi s’est arrêté (code ${p.code}, signal ${p.signal})${p.tail ? ` : ${p.tail}` : ""}`,
  processClosed: "Le processus Pi est fermé",
  requestTimeout: (p: { command: string; ms: string }) => `Pi n’a pas répondu à ${p.command} dans les ${p.ms} ms`,
  stdinUnwritable: "Impossible d’écrire sur stdin de Pi",
  commandFailed: (p: { command: string }) => `Pi : ${p.command} en échec`,
  toolFallback: "Outil",
  sessionFileMissing: "fichier de session introuvable",

  withStderr: (p: { error: string; tail: string }) => `${p.error} (${p.tail})`,
  mcpNameInvalid: (p: { name: string }) =>
    `Le nom du serveur MCP ${p.name} contient des caractères refusés par Pi (seuls lettres, chiffres, _ et - sont acceptés) ; il ne peut pas être utilisé dans cette session.`,
  modelFormat: (p: { model: string }) => `Les modèles Pi doivent être écrits provider/id : ${p.model}`,
  switchModelFailed: (p: { model: string; error: string }) => `Pi n’a pas pu passer au modèle ${p.model} : ${p.error}`,
  effortUnsupported: (p: { level: string }) =>
    `Pi ne dispose pas du niveau d’effort de raisonnement « ${p.level} » ; ce tour conserve le réglage actuel.`,
  effortFailed: (p: { error: string }) => `Pi n’a pas pu définir l’effort de raisonnement (${p.error}) ; ce tour conserve le réglage actuel.`,
  mcpConnectFailed: (p: { error: string }) =>
    `Pi n’a pas pu se connecter au serveur MCP de BaoCut ; ses outils (lecture et écriture des projets, sous-titres, etc.) sont indisponibles dans cette session : ${p.error}`,
  extensionError: (p: { error: string }) => `Échec d’une extension Pi : ${p.error}`,
  modelCallFailed: "Échec de l’appel au modèle de Pi",

  notice: (p: { message: string }) => `Pi : ${p.message}`,

  extensionAsked: (p: { title: string }) =>
    `Une extension Pi voulait vous poser une question${p.title ? ` (« ${p.title} »)` : ""}. BaoCut ne peut pas encore transmettre ce type de question ; elle a été annulée pour vous.`,

  fullAccessOnly: (p: { mode: string }) =>
    `Pi ne peut pas demander avant chaque action ; BaoCut peut seulement l’exécuter en mode « ${p.mode} » : aucune demande avant les commandes ou les modifications de fichiers.`,
};
