import type { UpdateMessages, UpdateStep } from './update-copy.ts';

const STEP: Record<UpdateStep, string> = { install: 'démarrer l’installation', check: 'rechercher des mises à jour', download: 'démarrer le téléchargement', cancel: 'annuler le téléchargement', retry: 'réessayer', downloadPage: 'ouvrir la page de téléchargement' };

export const fr: UpdateMessages = {
  failed: (step: UpdateStep, message: string) => `Impossible de ${STEP[step]} : ${message}`,
  progress: "Progression du téléchargement",
  notes: "Nouveautés de cette version",
  close: "Fermer",
};
