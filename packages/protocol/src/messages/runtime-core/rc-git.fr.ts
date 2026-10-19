import type { RcGitMessages } from './rc-git.ts';

export const fr: RcGitMessages = {
  gitPurpose: "Valide dans git les fichiers BaoCut d'un projet (facultatif)",
  gitMissingRemedyMac: "Installez git : exécutez xcode-select --install dans Terminal pour obtenir les Command Line Tools, ou installez-le avec Homebrew (brew install git)",
  gitMissingRemedyWin: 'Installez Git for Windows depuis https://git-scm.com/download/win',
  gitMissingRemedyLinux: 'Installez git avec votre gestionnaire de paquets',
  xcodeStub: "/usr/bin/git propose seulement d'installer les Command Line Tools tant qu'elles ne sont pas installées",

  notRepo: "Ce projet n'est pas dans un dépôt git",
  initRemedy: 'Exécutez baocut projects git-init dans le dossier du projet, ou lancez vous-même git init là où vous voulez le dépôt',
  initHome: "BaoCut ne crée pas de dépôt git dans votre dossier personnel : pour les autres outils, tous les dossiers qu'il contient feraient partie d'un même dépôt",
  initUserFolder: (p) =>
    `BaoCut ne crée pas de dépôt git dans un dossier utilisateur standard (${p.path}) : pour les autres outils, tous les dossiers qu'il contient feraient partie d'un même dépôt`,
  initVolumeRoot: "BaoCut ne crée pas de dépôt git à la racine d'un volume ou d'un lecteur",
  initInsideRepo: 'Ce projet est déjà dans un dépôt git',
  initElsewhere: "Déplacez d'abord le projet dans son propre dossier, ou exécutez vous-même git init à l'endroit voulu pour le dépôt",
  pausedLocked: 'Le dépôt est utilisé par une autre commande git (index.lock existe)',
  lockedRemedy:
    "Laissez l'autre commande git se terminer. BaoCut réessaie à la prochaine validation et ne supprime jamais le fichier de verrou ; si aucune commande git ne tourne, supprimez le verrou vous-même",
  pausedMerge: 'Le dépôt est en cours de fusion',
  pausedRebase: 'Le dépôt est en cours de rebase',
  pausedCherryPick: 'Le dépôt est en cours de cherry-pick',
  pausedRevert: 'Le dépôt est en cours de revert',
  pausedBisect: 'Le dépôt est en cours de bisect',
  pausedDetached: "HEAD est détachée (le dépôt n'est sur aucune branche)",
  repoStateRemedy: "Terminez ou annulez l'opération dans git ; BaoCut reprend ensuite les validations",
  detachedRemedy: 'Passez sur une branche dans git ; BaoCut reprend ensuite les validations',
  pausedLocalConfig:
    "La configuration locale du dépôt exécute des programmes ou inclut d'autres fichiers (filtres ou include) : BaoCut n'exécute donc pas les commandes git qui lisent vos fichiers",
  pausedLocalConfigChanged: 'Les filtres ou include locaux du dépôt ont changé après votre autorisation : BaoCut a de nouveau suspendu ses validations',
  localConfigRemedy: "Examinez les entrées et les commandes qu'elles exécutent, puis autorisez-les avec baocut projects git-allow",
  gitFailed: (p) => `git a échoué dans ce dépôt : ${p.detail}`,

  manageOnlyInAppOrCli: "Seules l'application de bureau et la CLI peuvent initialiser git ou autoriser les filtres locaux",
  digestChanged: 'La configuration locale a changé après son examen ; examinez de nouveau les entrées',
  commitFailed: (p) => `La validation dans git a échoué : ${p.detail}`,
  initFailed: (p) => `L'initialisation de git a échoué : ${p.detail}`,

  commitSummary: (p) => `Valider dans git les fichiers BaoCut du projet « ${p.name} »`,
  commitTitle: (p) => `BaoCut : mise à jour de ${p.names}`,
};
