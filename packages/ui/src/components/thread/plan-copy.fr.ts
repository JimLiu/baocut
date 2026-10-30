import type { PlanMessages } from './plan-copy.ts';

export const fr: PlanMessages = {
  title: 'L’agent a un plan à vous faire approuver',
  modeLabel: 'Mode d’accès pour la mise en œuvre',
  implement: 'Mettre en œuvre le plan',
  keepPlanning: 'Continuer à planifier',
  hint: 'Ou dites à l’agent quoi modifier dans la zone de message.',
  kind: 'Plan',
  approved: (mode) => `Approuvé · mise en œuvre en ${mode}`,
  declined: 'Non approuvé',
  byMessage: 'Réponse par message',
  cancelled: 'Arrêté',
  rowLead: 'Le plan vous convient ?',
  followUp: 'Mets en œuvre le plan ci-dessus.',
  failed: (message) => `Envoi impossible : ${message}`,
};
