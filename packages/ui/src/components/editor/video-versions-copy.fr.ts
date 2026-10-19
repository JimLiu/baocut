import type { VideoVersionsMessages } from './video-versions-copy.ts';

export const fr: VideoVersionsMessages = {
  title: 'Historique des versions',
  close: 'Fermer l’historique des versions',
  tipLatest: (version: number) => `La plus récente est la version ${version}`,
  tipNone: 'Aucune version pour l’instant',
  tipOutside: 'Cette vidéo n’est pas dans un projet',
  loading: 'Chargement de l’historique des versions',
  loadFailed: (message: string) => `Impossible de charger l’historique des versions : ${message}`,
  stateSynced: 'Instantané à jour',
  stateSyncedDesc: 'L’instantané d’espace de travail du dossier de la vidéo correspond au contenu actuel.',
  statePending: 'Écriture de l’instantané',
  statePendingDesc: 'Les modifications récentes rejoignent l’instantané et l’historique des versions en quelques secondes.',
  stateConflict: 'Instantané et BaoCut tous deux modifiés',
  stateConflictDesc:
    'Les fichiers de l’instantané ont été modifiés en dehors de BaoCut, et BaoCut a aussi des modifications qui ne sont pas encore dans l’instantané. BaoCut n’écrasera pas l’instantané tant que vous n’aurez pas choisi quoi garder.',
  stateInvalid: 'Instantané illisible',
  stateInvalidDesc:
    'Les fichiers de l’instantané ne peuvent pas être analysés, donc BaoCut ne les a pas importés. BaoCut vérifie à nouveau une fois que vous les avez corrigés, ou vous pouvez les écraser avec le contenu de BaoCut.',
  stateExternal: 'Importation des modifications externes',
  stateExternalDesc:
    'Les fichiers de l’instantané ont été modifiés en dehors de BaoCut (git pull, dossier synchronisé ou édition manuelle) et BaoCut n’a pas d’autres modifications ; il les importe donc comme une version « Modification externe ».',
  stateMissing: 'Pas encore d’instantané',
  stateMissingDesc: 'L’instantané d’espace de travail n’a pas encore été écrit, ou video.json a disparu.',
  stateRebuild: 'Reconstruction nécessaire',
  stateRebuildDesc: 'Seul l’instantané d’espace de travail est présent, sans la bibliothèque de la vidéo. BaoCut reconstruit la vidéo à partir de celui-ci à l’ouverture.',
  footer: (keep: number) =>
    `Les versions sont conservées dans .bcut-snapshot/history/ du dossier de la vidéo et ne dépendent pas de git. BaoCut garde ${keep === 1 ? 'la dernière version sans nom' : `les ${keep} dernières versions sans nom`}, plus toutes les versions enregistrées.`,
  save: 'Enregistrer une version',
  saveIntro: 'Enregistrez le contenu actuel comme version nommée. Les versions enregistrées ne sont jamais nettoyées automatiquement ; vous seul pouvez les supprimer.',
  nameLabel: 'Nom',
  namePlaceholder: 'Par exemple : Montage pour validation',
  nameRequired: 'Donnez un nom à cette version',
  noteLabel: 'Note (facultatif)',
  cancel: 'Annuler',
  saveSubmit: 'Enregistrer',
  conflictIntro:
    'Ces fichiers de l’instantané ont été modifiés en dehors de BaoCut, peut-être par un git pull, un dossier synchronisé ou une édition manuelle, et BaoCut a aussi des modifications qui ne sont pas encore dans l’instantané :',
  conflictOutro:
    'Tant que vous n’avez pas choisi quoi garder, BaoCut n’écrase pas l’instantané. Vous pouvez continuer à modifier la vidéo, mais vous ne pouvez ni enregistrer une version ni revenir à une version.',
  invalidIntro:
    'Ces fichiers de l’instantané ne peuvent pas être analysés. Ils contiennent peut-être des marqueurs de conflit de fusion, sont tronqués ou ont été abîmés à la main :',
  invalidOutro:
    'BaoCut ne les a pas importés. Vous pouvez continuer à modifier la vidéo, mais vous ne pouvez ni enregistrer une version ni revenir à une version. BaoCut vérifie à nouveau une fois ces fichiers corrigés, ou vous pouvez garder le contenu de BaoCut et les écraser.',
  externalIntro: 'Ces fichiers de l’instantané ont été modifiés en dehors de BaoCut, peut-être par un git pull, un dossier synchronisé ou une édition manuelle :',
  externalOutro:
    'BaoCut n’a aucune modification absente de l’instantané ; il les importe donc directement comme une version « Modification externe ». Vous pourrez annuler l’importation ensuite.',
  stripConflict: 'L’instantané a été modifié en dehors de BaoCut, et BaoCut a aussi de nouvelles modifications. Choisissez quoi garder.',
  stripInvalid: 'Les fichiers de l’instantané sont illisibles. BaoCut ne les a pas importés.',
  view: 'Voir',
  keepVideo: 'Garder le contenu de BaoCut',
  useSnapshot: 'Utiliser l’instantané sur le disque',
  keepTitle: 'Garder le contenu de BaoCut ?',
  keepConfirm: 'Écraser l’instantané sur le disque',
  keepBody: (count: number, files: string, invalid: boolean) =>
    `Le contenu de BaoCut est écrit tout de suite dans l’instantané et écrase ${count === 1 ? `le fichier ${invalid ? 'illisible' : 'modifié'}` : `les ${count} fichiers ${invalid ? 'illisibles' : 'modifiés'}`} sur le disque${files ? ` (${files})` : ''}. Ces modifications sur le disque n’entrent pas dans l’historique des versions et ne peuvent pas être récupérées dans BaoCut ; si elles venaient de git ou d’un dossier synchronisé, vous pouvez les y récupérer.`,
  diskTitle: 'Utiliser l’instantané sur le disque ?',
  diskConfirm: 'Utiliser l’instantané sur le disque',
  diskBody: (files: string) =>
    `Le contenu de la vidéo est remplacé par l’instantané sur le disque${files ? ` (${files})` : ''} et ajouté comme version « Modification externe ». Les modifications de BaoCut qui ne sont pas encore dans l’instantané entrent d’abord dans l’historique des versions : revenez avant la version « Modification externe » pour les récupérer. Vous pouvez aussi annuler cette opération.`,
  keptTitle: 'Contenu de BaoCut conservé',
  keptText: (version: number | null) =>
    `L’instantané sur le disque correspond maintenant à BaoCut${version ? `, et vos modifications récentes sont dans la version ${version}` : ''}. Les modifications qui étaient sur le disque ne sont pas entrées dans l’historique des versions.`,
  usedDiskTitle: (version: number) => `Instantané sur le disque utilisé, ajouté comme version ${version} « Modification externe »`,
  usedDiskText: (version: number) => `Revenez avant la version ${version} pour récupérer ce qu’il y avait dans BaoCut. Vous pouvez aussi annuler cette opération.`,
  importedTitle: (version: number | null) => (version ? `Modifications externes importées comme version ${version} « Modification externe »` : 'Modifications externes importées'),
  importedText:
    'Les fichiers de l’instantané ont été modifiés en dehors de BaoCut et BaoCut n’avait pas d’autres modifications ; ils ont donc été importés directement. Revenez avant cette version pour voir le contenu d’avant l’importation, ou annulez-la.',
  importUndoneTitle: 'Importation annulée',
  importUndoneText:
    'La vidéo retrouve son contenu d’avant l’importation et est réécrite dans l’instantané en quelques secondes, ce qui écarte cette modification externe. L’annulation est elle-même une modification et entre dans une nouvelle version.',
  refusedBroken: 'Impossible de revenir à cette version',
  refusedOther: 'Non effectué',
  refusedText: (message: string) => `${message}. La vidéo n’a pas changé.`,
  savedTitle: (version: number, name: string) => `Enregistrée comme version ${version} « ${name} »`,
  savedText: 'Les versions enregistrées restent : la règle de conservation ne les supprime jamais.',
  restoredTitle: (version: number, before: boolean, recorded: number) =>
    before
      ? `Retour avant la version ${version}, ajouté comme version ${recorded}`
      : `Retour à la version ${version}, ajouté comme version ${recorded}`,
  restoredText: 'C’est une modification ordinaire : vous pouvez l’annuler ici, ou dans l’éditeur après avoir fermé cette fenêtre.',
  undo: 'Annuler',
  undoneTitle: (version: number, before: boolean) =>
    before ? `Annulé : revenir avant la version ${version}` : `Annulé : revenir à la version ${version}`,
  undoneText: 'La vidéo retrouve son contenu précédent. L’annulation est elle-même une modification et rejoint la dernière version.',
  noopTitle: 'Aucune modification',
  noopText: (version: number, before: boolean) =>
    before
      ? `La vidéo est déjà dans son état d’avant le début de la version ${version}. Rien n’a été appliqué et aucune nouvelle version n’a été créée.`
      : `La vidéo est déjà dans son état de fin de la version ${version}. Rien n’a été appliqué et aucune nouvelle version n’a été créée.`,
  deletedTitle: (name: string) => `Version enregistrée « ${name} » supprimée`,
  deletedText: 'Le contenu de la vidéo n’a pas changé.',
  emptyTitle: 'Aucune version pour l’instant',
  emptyText: (missing: boolean): string =>
    missing
      ? 'L’instantané d’espace de travail n’a pas encore été écrit. Votre prochaine modification deviendra la version 1, ou vous pouvez enregistrer une version maintenant.'
      : 'Votre prochaine modification deviendra la version 1, ou vous pouvez enregistrer une version maintenant.',
  outsideTitle: 'Cette vidéo n’est pas dans un projet',
  outsideText: 'Seules les vidéos d’un projet ont un historique des versions. Déplacez d’abord la vidéo dans un projet.',
  listLabel: 'Versions',
  versionN: (version: number) => `Version ${version}`,
  openBadge: 'Encore ouverte',
  blockedFlag: 'Retour impossible',
  unreadableTitle: 'Impossible de lire ce fichier de version',
  kindSegment: 'Modifications',
  kindSave: 'Version enregistrée',
  kindRestore: 'Retour à une version',
  kindExternal: 'Modification externe',
  kindRebuild: 'Reconstruction',
  revisions: (from: string, to: string) => (from === to ? `Révision ${to}` : `Révisions ${from}–${to}`),
  openHint: 'La dernière version est encore ouverte : jusqu’à 5 minutes sans modification ou 30 minutes au total, vos prochaines modifications y sont ajoutées.',
  openHintPending: 'La dernière version est encore ouverte. Les modifications récentes sont en cours d’écriture et y seront ajoutées en quelques secondes.',
  openHintConflict: 'La dernière version est encore ouverte, mais les nouvelles modifications n’entreront pas dans l’historique des versions tant que le conflit d’instantané n’est pas résolu.',
  openHintExternal:
    'La dernière version est encore ouverte. L’instantané sur le disque est en cours d’importation : cette version se ferme d’abord, et les modifications externes forment une version à part.',
  externalHint:
    'Cette version vient de l’extérieur de BaoCut : les fichiers de l’instantané ont été modifiés par un git pull, un dossier synchronisé ou une édition manuelle, et BaoCut les a importés comme cette version. Revenez avant cette version pour récupérer ce qu’il y avait dans BaoCut avant l’importation.',
  restoreEnd: 'Revenir à cette version',
  restoreBefore: 'Revenir avant cette version',
  deleteSaved: 'Supprimer cette version enregistrée',
  whyNotFound: 'Cette version n’existe plus',
  whyUnreadable: (version: number) => `Le fichier de la version ${version} est illisible ; on ne peut donc revenir ni à elle ni aux états antérieurs`,
  whyBroken: (version: number) => `L’historique des versions ne correspond pas à la version ${version} ; on ne peut donc pas revenir aux états antérieurs`,
  noopBoth: (version: number) => `La vidéo est déjà dans l’état de la version ${version} (son contenu est identique avant et après) ; y revenir ne change donc rien`,
  noopEnd: (version: number) => `La vidéo est déjà dans son état de fin de la version ${version} ; y revenir ne change donc rien`,
  noopBefore: (version: number) => `La vidéo est déjà dans son état d’avant le début de la version ${version} ; y revenir ne change donc rien`,
  factActors: 'Modifié par',
  factConversations: 'Sessions',
  factFiles: 'Ce qui a changé',
  factCheckpoint: 'Point de contrôle',
  actorYou: 'Vous',
  actorAgent: 'Agent',
  actorExternal: (name: string) => `Service externe ${name}`,
  actorSystem: 'BaoCut',
  actionCount: (label: string, count: number) => (count > 1 ? `${label} ×${count}` : label),
  listSeparator: ', ',
  noActions: 'Aucune modification consignée',
  noActionsRebuild: 'BaoCut a reconstruit la vidéo depuis son instantané ; aucune modification du contenu',
  omitted: (count: number) =>
    count === 1 ? 'Une autre modification a seulement été comptabilisée' : `${count} autres modifications ont seulement été comptabilisées`,
  notHere: '(pas sur cet ordinateur)',
  openConversation: (title: string) => `Ouvrir la session « ${title} »`,
  fileTimeline: 'Timeline',
  fileDocument: 'Document',
  changeAdd: 'Ajouté',
  changeDelete: 'Supprimé',
  changeModify: 'Modifié',
  noFiles: 'Aucune modification du contenu',
  diffTitle: 'Modifications',
  copyDiff: 'Copier le diff',
  copied: 'Copié',
  copyFailed: 'Impossible de copier. Sélectionnez le texte et copiez-le manuellement.',
  diffEmpty: 'Le diff de cette version est vide : le contenu est identique à celui de la fin de la version précédente.',
  diffLabel: (version: number) => `Diff de la version ${version}`,
  diffLoading: 'Chargement du diff',
  diffFailed: (message: string) => `Impossible de lire cette version : ${message}`,
  diffMore: (count: number) =>
    count === 1
      ? 'Encore 1 ligne non affichée. Copiez le diff pour tout voir.'
      : `Encore ${count} lignes non affichées. Copiez le diff pour tout voir.`,
  unreadableHeading: (file: string) => `Impossible de lire ${file}`,
  unreadableText: (why: string) =>
    `L’en-tête ou le diff du fichier de version est endommagé ; il a peut-être été tronqué ou modifié à la main. ${why}. Les versions plus récentes ne sont pas affectées.`,
  confirmRestoreTitle: (version: number, before: boolean) =>
    before ? `Revenir avant la version ${version} ?` : `Revenir à la version ${version} ?`,
  confirmRestoreBody: (version: number, before: boolean, when: string) =>
    `Le contenu de la vidéo sera remplacé par son état ${before ? `d’avant le début de la version ${version}` : `de fin de la version ${version}`} (${when}). C’est une modification annulable, ajoutée comme nouvelle version. Les versions existantes restent, et les points de contrôle et les protections ne changent pas.`,
  confirmDeleteTitle: (name: string) => `Supprimer la version enregistrée « ${name} » ?`,
  confirmDeleteMiddle: (next: number) =>
    `Seuls cette version et son point de contrôle sont supprimés : ses modifications rejoignent la version ${next}, juste après. Le contenu de la vidéo ne change pas.`,
  confirmDeleteTop: 'Seuls le nom, la note et le point de contrôle sont retirés : cette version redevient un ensemble ordinaire de modifications, et les modifications suivantes s’y ajoutent. Le contenu de la vidéo ne change pas.',
  delete: 'Supprimer',
};
