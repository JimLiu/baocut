import type { ProjectSettingsMessages } from './project-settings-copy.ts';

export const fr: ProjectSettingsMessages = {
  menuItem: 'Réglages du projet…',
  title: 'Réglages du projet',
  close: 'Fermer les réglages du projet',
  done: 'Terminé',
  loading: 'Vérification de git',
  loadFailed: (message: string) => `Impossible de vérifier git : ${message}`,

  gitHeading: 'git',
  gitLead:
    'BaoCut peut valider les instantanés d’espace de travail de vos vidéos dans le dépôt git qui contient le projet. L’historique des versions n’a pas besoin de git et fonctionne de la même façon hors d’un dépôt.',
  branch: (name: string) => `Branche ${name}`,
  gitVersion: (version: string) => `git ${version}`,
  checkAgain: 'Vérifier à nouveau',
  sentences: (first: string, second: string | null) => (second ? `${first}. ${second}.` : `${first}.`),

  lightReady: 'Prêt',
  lightPaused: (label: string) => `En pause · ${label}`,
  lightNotRepo: 'Pas dans un dépôt git',
  lightUnavailable: 'git introuvable',
  lightError: 'Échec de git',
  pauseLocked: 'Dépôt en cours d’utilisation',
  pauseMerge: 'Fusion en cours',
  pauseRebase: 'Rebase en cours',
  pauseCherryPick: 'Cherry-pick en cours',
  pauseRevert: 'Revert en cours',
  pauseBisect: 'Bisect en cours',
  pauseDetached: 'HEAD détachée',
  pauseLocalConfig: 'Filtres locaux',
  pauseLocalConfigChanged: 'Filtres locaux modifiés',

  pausedHeading: (label: string) => `Validations en pause : ${label}`,
  pausedNote:
    'Tant que les validations sont en pause, la validation automatique et « Valider dans git » attendent. L’ouverture, la modification et l’historique des versions ne sont pas concernés.',
  errorHeading: 'Échec de git',
  unavailableHeading: 'git introuvable',

  lcEntry: 'Entrée',
  lcValue: 'Commande ou fichier inclus',
  lcExplain:
    'Une fois que vous les autorisez, BaoCut suit ces entrées quand il exécute git (par exemple pour le chiffrement git-crypt). L’autorisation est enregistrée uniquement sur cet ordinateur, pas dans le projet, et BaoCut se remet en pause si les entrées ou les fichiers inclus changent. Ce n’est pas une confiance accordée au dossier : l’ouverture, la modification et l’Agent ne sont pas concernés.',
  lcWeb:
    'Ces entrées ne sont affichées, et ne peuvent être autorisées, que dans les réglages du projet de l’app de bureau BaoCut (ou avec baocut projects git-allow). Tant que les validations sont en pause, l’ouverture, la modification et l’historique des versions ne sont pas concernés.',
  allow: 'Autoriser',
  allowedTitle: 'Filtres locaux autorisés',
  allowedText: 'L’autorisation est enregistrée sur cet ordinateur, pas dans le projet. Vous pouvez valider maintenant.',
  allowFailed: 'Non autorisé',

  commit: 'Valider dans git',
  committing: 'Validation en cours',
  commitDesc: (maxMiB: number) =>
    `Valide uniquement les fichiers de BaoCut : les instantanés d’espace de travail des vidéos modifiées et les médias jusqu’à ${maxMiB} Mio. Les autres fichiers du projet et les modifications que vous avez déjà indexées restent tels quels. BaoCut ne fait pas de push.`,
  lastCommit: (commit: string, auto: boolean, ago: string) => `Dernière validation ${commit} · ${auto ? 'automatique' : 'manuelle'} · ${ago}`,
  lastFailed: (message: string) => `Échec de la dernière tentative : ${message}`,
  committedTitle: 'Validé dans git',
  committedText: (commit: string, files: number, videos: string[]) =>
    `Validation ${commit} : ${files === 1 ? '1 fichier' : `${files} fichiers`}${videos.length ? `, ${videos.join(', ')}` : ''}.`,
  committedVideo: (name: string, from: number | null, to: number | null) =>
    from === null || to === null ? `« ${name} »` : from === to ? `« ${name} » version ${to}` : `« ${name} » versions ${from}–${to}`,
  unnamedVideo: 'une vidéo',
  nothingTitle: 'Rien à valider',
  nothingText: 'Les fichiers de BaoCut sont identiques à ceux de la dernière validation.',
  commitFailed: 'Non validé',

  autoCommit: 'Validation automatique',
  autoCommitDesc:
    'Valide une fois quand le projet est resté 5 minutes sans modification, quand vous fermez la dernière vidéo ouverte du projet ou quand vous quittez BaoCut. Tous les projets de cet ordinateur partagent ce réglage.',

  initTitle: 'Initialiser git',
  initDesc: 'Crée un dépôt git dans le dossier du projet pour pouvoir y valider les instantanés.',
  initWebNote: 'Seules l’app de bureau BaoCut et la CLI (baocut projects git-init) peuvent créer un dépôt dans un dossier de l’ordinateur du Runtime.',
  initRefused: (why: string) => `Non disponible ici : ${why}`,
  initRefusedNote: 'Si vous en avez besoin, déplacez les vidéos dans un dossier de projet dédié et initialisez git à cet endroit.',
  refusalHome:
    'le projet est votre dossier personnel. Avec un dépôt ici, tous les dossiers de votre dossier personnel sembleraient en faire partie pour les autres outils.',
  refusalUserFolder:
    'le projet est un dossier utilisateur standard (comme Bureau, Documents, Téléchargements, Films, Musique ou Images). Avec un dépôt ici, tous les dossiers qu’il contient sembleraient en faire partie pour les autres outils.',
  refusalVolumeRoot: 'le projet est la racine d’un disque. Avec un dépôt ici, tout le disque semblerait en faire partie.',
  refusalInsideRepo: 'le projet est déjà dans un dépôt git.',
  initConfirmTitle: 'Initialiser git dans le dossier du projet ?',
  initConfirmBody: (path: string) =>
    `Crée un dépôt git dans ${path}. Les règles d’exclusion de BaoCut sont placées dans le propre .git/info/ du dépôt, donc aucun fichier du projet ne change. Rien n’est validé ni poussé.`,
  cancel: 'Annuler',
  initDoneTitle: 'git initialisé',
  initDoneText: 'Rien n’est encore validé. Utilisez « Valider dans git » pour faire la première validation.',
  initFailed: 'Non initialisé',

  recheckSame: 'Rien n’a changé',
  recheckReadyTitle: 'Prêt à valider',
  recheckReadyText: 'Le dépôt n’est plus en pause.',

  outsideHeading: 'Médias hors du projet',
  outsideLead:
    'Quand une vidéo utilise des médias hors du dossier du projet, son instantané d’espace de travail enregistre le chemin du média (commençant par ~/ dans votre dossier personnel, un chemin complet sinon). Après une validation ou un push, les autres ne reçoivent que le chemin, pas le fichier. Pour transmettre aussi les médias, utilisez un paquet portable.',

  stripLabel: 'git du projet',
  projectSettings: 'Réglages du projet',
};
