import { pluralForm } from '../../i18n.ts';
import type { RcBotMessages } from './rc-bot.ts';

const minutes = (n: number) => `${n} ${pluralForm('fr', n, { one: 'minute', other: 'minutes' })}`;

export const fr: RcBotMessages = {
  // ---- 频道 ----
  mainChannelName: 'Principal',
  channelNotFound: (p: { id: string }) => `Canal introuvable : ${p.id}`,
  mainChannelLocked: 'Le canal principal ne peut être ni archivé ni supprimé.',
  channelArchived: 'Ce canal est archivé. Restaurez-le pour continuer à y travailler.',
  channelDeleteCountsChanged: 'Le nombre de tâches ou de tâches planifiées de ce canal a changé. Vérifiez à nouveau avant de supprimer.',
  memoryVersionConflict: 'La mémoire a changé depuis que vous l’avez ouverte. Consultez la dernière version, puis réessayez.',
  memoryTooLarge: (p: { max: number }) => `La mémoire ne peut pas dépasser ${p.max} Ko. Faites un peu de tri avant d’en ajouter.`,
  memorySensitive: 'Ne mettez ni clés, ni mots de passe, ni numéros d’identité ou de carte dans la mémoire.',
  accessAboveChannelMax: 'Le mode d’accès de la tâche ne peut pas dépasser la limite du canal.',

  // ---- 任务 ----
  workItemNotFound: (p: { id: string }) => `Tâche introuvable : ${p.id}`,
  transitionDenied: (p: { from: string; event: string }) => `Cette tâche ne peut pas effectuer « ${p.event} » tant qu’elle est à l’état ${p.from}.`,
  textHasLinkOrNumber: 'Le texte d’une tâche ne doit contenir ni liens, ni adresses e-mail, ni longs numéros. Placez-les plutôt dans les ressources.',
  titleByUser: 'Vous avez écrit ce titre, l’agent ne peut donc pas le modifier.',
  userTasksNoThread: 'Vos propres tâches ne démarrent pas de fil.',
  stoppedByYou: 'Vous avez arrêté ceci.',
  continueOrStop: 'Continuer ou arrêter ?',
  optionContinue: 'Continuer',
  optionStop: 'Arrêter',
  stalledNoProgress: (p: { minutes: number }) => `Aucune progression depuis ${minutes(p.minutes)}.`,
  stalledJobHung: (p: { job: string }) => `${p.job} ne donne plus de nouvelles depuis bien plus longtemps que prévu.`,
  stalledBudget: 'Cette tâche a utilisé 80 % de son budget.',
  interruptedOnExit: 'Interrompue lors de la dernière fermeture de BaoCut.',
  threadLost: 'Le fil de cette tâche est introuvable.',
  needsYouToRun: (p: { agent: string }) => `Cette étape nécessite votre présence : ${p.agent} ne peut pas demander d’approbation étape par étape. Continuer maintenant ?`,
  approvalWaiting: (p: { summary: string }) => `En attente de votre approbation : ${p.summary}`,
  youAnswered: (p: { text: string }) => `Votre réponse : ${p.text}`,
  youConfirmedDone: 'Vous avez confirmé que c’est terminé.',
  youReopened: 'Vous avez rouvert cette tâche.',
  previousQuestion: (p: { text: string }) => `Question précédente : ${p.text}`,
  implicitReopenNote: (p: { what: string }) => `Le fil a modifié ${p.what} après la résolution de la tâche.`,
  movedFrom: (p: { channel: string }) => `Déplacée depuis ${p.channel}.`,
  queued: (p: { position: number }) => `En attente d’une place libre (n° ${p.position}).`,
  revertUserEdits: (p: { video: string; version: number }) =>
    `Vous avez modifié ${p.video} dans la version ${p.version} : impossible d’annuler uniquement les modifications de l’agent.`,
  revertMixedVersion: (p: { video: string; version: number }) =>
    `La version ${p.version} de ${p.video} mêle vos modifications à celles de l’agent : impossible d’annuler uniquement les modifications de l’agent.`,

  // ---- 频道对话里 Runtime 写的 ----
  fallbackRelay: (p: { title: string; headline: string }) => `${p.title} : ${p.headline}`,
  reminder: (p: { title: string }) => `Rappel : ${p.title}`,
  reminderOverdue: (p: { title: string; date: string }) => `${p.title} était à faire pour le ${p.date}. Elle est toujours ouverte.`,
  reminderStale: (p: { title: string; days: number }) =>
    `${p.title} vous attend depuis ${p.days} ${pluralForm('fr', p.days, { one: 'jour', other: 'jours' })}.`,
  welcome:
    'Bonjour, je suis votre assistant ici. Dites-moi ce que vous voulez faire de vos vidéos et je m’en occupe. Je vous préviendrai quand quelque chose aura besoin de vous.',
  welcomeWithProjects: (p: { projects: number; videos: number }) =>
    `Bonjour, je suis votre assistant ici. Je vois ${p.projects} ${pluralForm('fr', p.projects, { one: 'projet', other: 'projets' })} avec ${p.videos} ${pluralForm('fr', p.videos, { one: 'vidéo', other: 'vidéos' })}. Dites-moi ce que vous voulez faire et je m’en occupe.`,
  starterSummarize: 'Résumer une vidéo',
  starterSummarizeText: 'Résume ma dernière vidéo',
  starterCaptions: 'Ajouter des sous-titres',
  starterCaptionsText: 'Ajoute des sous-titres à ma dernière vidéo',
  starterHighlights: 'Trouver les temps forts',
  starterHighlightsText: 'Trouve les meilleurs moments de ma dernière vidéo',
  markDone: 'Marquer comme terminée',
  handoffDriver: (p: { agent: string }) => `On continue avec ${p.agent}.`,
  editedMessage: 'Vous avez modifié ce message.',
  reactionYes: 'Oui',
  reactionNo: 'Non',
  approvalNeedsYou: 'Une approbation vous attend.',
  makeNoGenerator: 'Aucun modèle de texte n’est configuré : les suggestions ne sont pas disponibles.',
  scheduleNotReady: 'Les tâches planifiées ne sont pas disponibles pour le moment.',
  proposalChannelExists: 'Un canal portant ce nom existe déjà.',
  dependencyWaiting: (p: { title: string }) => `En attente de « ${p.title} ».`,
  lateStart: (p: { minutes: number }) => `Démarrée avec ${minutes(p.minutes)} de retard.`,

  // ---- 通知 ----
  notifyNeedsReview: (p: { title: string }) => `${p.title} est prête pour votre relecture`,
  notifyNeedsInput: (p: { title: string }) => `${p.title} attend votre réponse`,
  notifyStalled: (p: { title: string }) => `${p.title} est bloquée`,
  notifyReminder: (p: { title: string }) => `Rappel : ${p.title}`,

  // ---- 提议 ----
  proposalNotFound: 'Cette carte n’est plus disponible.',
  proposalHandled: 'Cette carte a déjà été traitée.',
  chipStale: 'Ces suggestions ne sont plus à jour.',
  userOnly: 'Seul l’utilisateur peut faire ceci.',
  notReady: 'Le mode Bot n’est pas encore prêt.',
  automationPaused: 'L’automatisation est en pause.',
};
