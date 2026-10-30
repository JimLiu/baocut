import type { ForkMessages } from './fork-copy.ts';

export const fr: ForkMessages = {
  button: 'Dériver depuis ce tour',
  fork: 'Continuer dans une nouvelle session',
  forkHint: 'Reprend la conversation jusqu’à ce tour',
  restore: 'Continuer avec les vidéos restaurées à ce moment…',
  restoreOne: (name) => `« ${name} » revient à la fin de ce tour`,
  restoreMany: (n) => `${n} vidéos reviennent à la fin de ce tour`,
  restoreNone: 'Les versions de ce moment n’existent plus ou sont illisibles',
  checking: 'Vérification de l’historique des versions…',
  dialogTitle: 'Dériver et restaurer les vidéos',
  dialogLead:
    'La nouvelle session reprend la conversation jusqu’à ce tour. Les vidéos ci-dessous reviennent à la fin de ce tour. Chaque restauration est enregistrée comme nouvelle version : vous pouvez revenir depuis l’historique des versions.',
  listLabel: 'Vidéos à restaurer',
  cancel: 'Annuler',
  confirm: 'Dériver et restaurer',
  ok: (version, undone) =>
    `Restaurer la version ${version}. Les ${undone} versions suivantes (vos modifications et celles d’autres sessions) sont annulées`,
  pruned: 'La version de ce moment n’existe plus (l’historique ne garde que les versions récentes et enregistrées)',
  createdAfter: 'Cette vidéo a été créée après ce tour : elle reste telle quelle',
  chainBroken: 'L’historique des versions est illisible jusqu’à ce moment',
  done: 'Dérivée dans une nouvelle session',
  doneRestored: (n) =>
    `Dérivée dans une nouvelle session, ${n} vidéos restaurées à ce moment. Vous pouvez revenir depuis l’historique des versions`,
  failed: (error) => `Impossible de dériver : ${error}`,
  forkedFrom: (title, turn) => `Dérivée de « ${title} » · jusqu’au tour ${turn}`,
  sourceDeleted: '(session d’origine supprimée)',
  history: (turns, omitted) => `Historique repris · ${turns} tours${omitted ? ` (${omitted} plus anciens omis)` : ''}`,
  hideHistory: 'Masquer l’historique',
};
