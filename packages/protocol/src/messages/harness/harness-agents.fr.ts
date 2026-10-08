import type { HarnessAgentsMessages } from './harness-agents.ts';

export const fr: HarnessAgentsMessages = {
  listSeparator: ", ",
  noDriver: (p: { id: string }) => `Aucun Agent enregistré avec l’identifiant ${p.id}`,
  probeFailed: (p: { error: string }) => `Échec de détection : ${p.error}`,
  cannotChangeAgent: "Cette session a déjà démarré ; son Agent ne peut plus être changé. Créez une session pour en choisir un autre.",
  noBudgetLedger: "Ce Runtime n’a pas de registre des budgets de tâches ; impossible de définir des budgets",
  driverGone: (p: { id: string }) =>
    `L’Agent ${p.id} a été retiré ou n’est pas enregistré ; cette session ne peut plus envoyer de message. Créez une session avec un autre Agent.`,
  driverUnverified: (p: { agent: string }) =>
    `${p.agent} n’a pas encore réussi les tests d’intégration BaoCut. Seuls les résultats de détection sont affichés ; aucune session ne peut démarrer.`,
  fullAccessOnly: (p: { agent: string; fullAccess: string; current: string }) =>
    `${p.agent} ne peut pas demander une approbation étape par étape et fonctionne uniquement en mode « ${p.fullAccess} » (actuellement « ${p.current} »). Passez à « ${p.fullAccess} » et renvoyez le message, ou utilisez un autre Agent.`,
  runtimeStopping: "Le Runtime s’arrête",
  sessionBusy: "Une tâche est encore en cours dans cette session. Arrêtez-la ou attendez sa fin.",
  sessionBusyOther: "Cette session exécute une autre tâche. Arrêtez-la ou attendez sa fin.",
  oldTaskNotStopped: "L’ancienne tâche n’est pas encore arrêtée. Réessayez plus tard",
  attachmentsUnsupported: "Cette version ne peut pas encore envoyer d’images jointes",
  attachmentDuplicate: "Une pièce jointe ne peut figurer qu’une fois par message",
  tooManyImages: (p: { max: number }) => `Un message peut contenir au plus ${p.max} images`,
  imagesUnsupported: "Cet Agent ne prend pas en charge les images",
  contractRevisionMissing: (p: { revision: number; latest: number }) =>
    `Le contrat de tâche n’a pas de révision ${p.revision} (dernière : ${p.latest})`,
  taskEnded: "La tâche est terminée (ou s’arrête) ; son contrat ne peut plus être modifié. Utilisez tasks.changeGoal pour changer l’objectif",
  contractRevisionStale: (p: { latest: number; expected: number }) =>
    `Le contrat est déjà à la révision ${p.latest}, pas ${p.expected}. Relisez-le avant de le modifier`,
  checkMissing: (p: { id: string }) => `Le contrat n’a pas cette vérification : ${p.id}`,
  taskNotFound: (p: { id: string }) => `Tâche introuvable : ${p.id}`,
  approvalNotFound: (p: { id: string }) => `Approbation introuvable : ${p.id}`,
  builtinId: (p: { id: string }) => `${p.id} est un identifiant d’Agent intégré. Choisissez-en un autre`,
  agentExists: (p: { id: string }) => `Un Agent avec l’identifiant ${p.id} existe déjà`,
  builtinNotRemovable: (p: { agent: string }) => `${p.agent} est intégré et ne peut pas être retiré. Vous pouvez le désactiver dans Réglages`,
  agentMissing: (p: { id: string }) => `Aucun Agent n’a l’identifiant ${p.id}`,
  providersUnsupported: "Ce Runtime ne peut pas ajouter ou retirer des Agents",
  modelMissing: (p: { agent: string; model: string; choices: string }) => `${p.agent} n’a aucun modèle « ${p.model} ». Choisissez parmi ${p.choices}`,
  effortMissing: (p: { model: string; effort: string; choices: string }) =>
    `Le modèle « ${p.model} » n’a aucun effort de raisonnement « ${p.effort} ». Choisissez parmi ${p.choices}`,
  effortUnsupported: (p: { model: string }) => `Le modèle « ${p.model} » n’a pas de niveaux d’effort de raisonnement`,
  approvalNoGrant: "Cette approbation n’envoie pas de données et ne peut donc pas inclure de choix d’autorisation",
  contractFieldsReadonly: (p: { fields: string }) =>
    `L’Agent ne peut pas modifier ces champs du contrat : ${p.fields}. Seul l’utilisateur décide du mode d’accès, des permissions, du budget et des plages protégées`,
};
