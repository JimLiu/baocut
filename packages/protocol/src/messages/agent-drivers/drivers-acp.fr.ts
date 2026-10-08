import type { DriversAcpMessages } from './drivers-acp.ts';

export const fr: DriversAcpMessages = {
  copilotPlan: "Abonnement GitHub Copilot",
  copilotLoginHint: "exécutez copilot login dans un terminal pour vous connecter (ou /login dans le mode interactif de copilot)",
  copilotInstallHint: "Installer GitHub Copilot CLI (npm install -g @github/copilot)",
  geminiPlan: "Compte Google",
  geminiLoginHint: "exécutez gemini dans un terminal et choisissez la connexion avec un compte Google, ou mettez GEMINI_API_KEY=… dans ~/.gemini/.env",
  geminiInstallHint: "Installer Gemini CLI (brew install gemini-cli)",
  cursorPlan: "Abonnement Cursor",
  cursorInstallHint: "Installer Cursor Agent avec le script officiel",
  grokPlan: "Compte xAI",
  grokInstallHint: "Installer Grok CLI avec le script officiel",
  kimiPlan: "Compte Kimi",
  kimiInstallHint: "Installer Kimi Code selon les instructions officielles (https://github.com/MoonshotAI/kimi-code)",
  customNoCommand: (p: { id: string }) => `L’Agent ${p.id} n’a aucune commande`,
  customInstallHint: (p: { command: string }) => `Vérifiez que ${p.command} est installé et dans PATH, ou ajoutez-le à nouveau avec un chemin absolu`,

  loginViaTerminal: (p: { command: string }) => `exécutez ${p.command} dans un terminal pour vous connecter`,
  loginPerInstructions: "suivez ses instructions pour vous connecter",

  signedOut: (p: { name: string; login: string; detail: string }) =>
    `${p.name} n’est pas connecté : ${p.login}.${p.detail ? ` (${p.detail})` : ""}`,
  probeTimeout: (p: { name: string; seconds: number }) => `${p.name} n’a pas répondu dans les ${p.seconds} secondes`,
  acpModeFailed: (p: { name: string; error: string }) => `${p.name} n’a pas démarré en mode ACP : ${p.error}`,
  exitCode: (p: { code: string }) => `code de sortie ${p.code}`,

  exited: (p: { name: string; status: string; tail: string }) => `${p.name} s’est arrêté (${p.status})${p.tail ? ` : ${p.tail}` : ""}`,
  exitedBeforeInit: (p: { name: string }) => `${p.name} s’est arrêté avant l’initialisation`,
  initTimeout: (p: { name: string }) => `${p.name} n’a pas terminé l’initialisation ACP à temps`,
  mcpHttpUnsupported: (p: { name: string }) =>
    `${p.name} ne peut pas se connecter aux serveurs MCP via HTTP ; les outils BaoCut (lecture et modification des projets, sous-titres, etc.) sont donc indisponibles dans cette session.`,
  resumeUnsupported: (p: { name: string }) => `${p.name} ne prend pas en charge la reprise des sessions`,
  onlyAlwaysAllow: (p: { name: string }) =>
    `${p.name} a seulement proposé « Toujours autoriser » cette fois. BaoCut ne l’enregistre pas dans vos réglages à votre place ; la demande a donc été refusée.`,
  modeSwitchFailed: (p: { name: string; mode: string; error: string }) => `${p.name} n’a pas pu changer le mode de session (${p.mode}) : ${p.error}`,
  noAllowAllSwitch: (p: { name: string; configId: string }) =>
    `Cette session ${p.name} n’a aucun interrupteur « tout autoriser » (${p.configId}) ; elle demandera donc chaque action en mode Accès complet.`,
  setOptionFailed: (p: { name: string; configId: string; value: string; error: string }) =>
    `${p.name} n’a pas pu définir ${p.configId}=${p.value} : ${p.error}`,
  stillAskThisTurn: (p: { failure: string }) => `${p.failure}. Chaque action sera encore demandée pendant ce tour.`,
  noMatchingMode: (p: { name: string }) =>
    `${p.name} n’a pas de mode de session correspondant à ce mode d’accès et utilise son propre défaut. BaoCut vérifie toujours les actions nécessitant une approbation selon le mode d’accès.`,
  modelSwitchUnsupported: (p: { name: string }) => `${p.name} ne peut pas changer de modèle dans une session ; le modèle actuel reste utilisé.`,
};
