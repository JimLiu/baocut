import type { RcSchedulesMessages } from './rc-schedules.ts';

export const fr: RcSchedulesMessages = {
  notFound: (p) => `Tâche planifiée introuvable : ${p.id}`,
  conversationNotFound: (p) => `Session introuvable : ${p.id}`,
  conversationArchived: 'Cette session est archivée. Restaurez-la depuis Sessions archivées avant de la planifier.',
  noProject: 'Cette session n’appartient à aucun projet : elle ne peut pas ouvrir une nouvelle session dans un projet à chaque fois.',
  invalid: 'Vérifiez la tâche planifiée : le message, la fréquence et la limite d’exécutions doivent être valides.',
  notActive: 'Seule une tâche planifiée active peut être exécutée maintenant.',
  resumeArchived:
    'La session cible est archivée. Restaurez-la depuis Sessions archivées, ou modifiez la tâche planifiée pour ouvrir une nouvelle session à chaque fois.',
  resumeDeleted: 'La session cible a été supprimée. Modifiez la tâche planifiée pour ouvrir une nouvelle session à chaque fois.',
  resumeProjectRemoved: 'Le projet a été retiré de BaoCut : impossible d’y ouvrir une nouvelle session.',
  resumeCompleted: 'Le nombre maximal d’exécutions est atteint. Augmentez la limite avant de reprendre.',
  runStopped: 'Arrêtée avant la fin',
};
