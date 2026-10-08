import type { HarnessRunsMessages } from './harness-runs.ts';

export const fr: HarnessRunsMessages = {
  retrying: (p: { message: string }) => `${p.message} (nouvelle tentative)`,
  modeChanged: (p: { to: string; from: string }) => `Mode d’accès changé en « ${p.to} » (ancien : « ${p.from} »). S’applique aux prochaines actions.`,
  jobsCancelled: (p: { count: number }) =>
    `Annulation demandée pour les tâches inachevées en arrière-plan de cette session (${p.count}). Les résultats terminés sont conservés.`,
  jobsCancelledGenerated: (p: { count: number }) =>
    `Annulation demandée pour les tâches inachevées en arrière-plan de cette session (${p.count}, génération ou transcription). Les résultats terminés sont conservés.`,
  goalChangedStopped: "Objectif changé : ancienne tâche arrêtée. Une nouvelle tâche démarre pour le nouvel objectif.",
  goalChangedKept:
    "Objectif changé : le tour de l’ancienne tâche a été arrêté. Les tâches en arrière-plan déjà soumises se terminent normalement et leurs résultats restent candidats. Une nouvelle tâche démarre pour le nouvel objectif.",
  stopReplyUnconfirmed: (p: { agent: string }) => `Arrêt de réponse demandé, mais impossible de confirmer que ${p.agent} s’est arrêté.`,
  stopUnconfirmed: (p: { agent: string }) => `Arrêt demandé, mais impossible de confirmer que ${p.agent} s’est arrêté.`,
  stopTimedOut: (p: { agent: string }) =>
    `${p.agent} n’a pas confirmé l’arrêt en 10 secondes ; son processus a donc été terminé. Les étapes dont l’annulation n’est pas confirmée peuvent déjà avoir pris effet.`,
  agentRemovedNotice: (p: { agent: string }) =>
    `L’Agent ${p.agent} a été retiré ; cette tâche n’a pas abouti. Les modifications déjà faites ne sont pas annulées automatiquement.`,
  agentRemoved: (p: { agent: string }) => `L’Agent ${p.agent} a été retiré`,
  runtimeStoppedNotice: "La tâche était en cours à l’arrêt du Runtime ; elle a été interrompue.",
  runtimeExitedNotice: "Le Runtime s’est arrêté pendant la tâche ; elle n’a pas abouti. Les modifications déjà faites ne sont pas annulées automatiquement.",
  runtimeExited: "Le Runtime s’est arrêté pendant la tâche",
  turnFailed: "Échec du tour",
  processExited: (p: { agent: string; error: string }) => `${p.agent} : processus arrêté inopinément : ${p.error}`,
  noErrorMessage: "aucun message d’erreur",

  fileChangeSummary: "Modifier les fichiers",
};
