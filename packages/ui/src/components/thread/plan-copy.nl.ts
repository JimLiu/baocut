import type { PlanMessages } from './plan-copy.ts';

export const nl: PlanMessages = {
  title: 'De agent heeft een plan dat je kunt goedkeuren',
  modeLabel: 'Toegangsmodus voor de uitvoering',
  implement: 'Plan uitvoeren',
  keepPlanning: 'Verder plannen',
  hint: 'Of vertel de agent in het berichtvak wat er anders moet.',
  kind: 'Plan',
  approved: (mode) => `Goedgekeurd · uitvoering in ${mode}`,
  declined: 'Niet goedgekeurd',
  byMessage: 'Beantwoord met een bericht',
  cancelled: 'Gestopt',
  rowLead: 'Klopt het plan?',
  followUp: 'Voer het plan hierboven uit.',
  failed: (message) => `Verzenden mislukt: ${message}`,
};
