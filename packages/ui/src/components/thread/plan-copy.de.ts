import type { PlanMessages } from './plan-copy.ts';

export const de: PlanMessages = {
  title: 'Der Agent hat einen Plan zur Genehmigung',
  modeLabel: 'Zugriffsmodus für die Umsetzung',
  implement: 'Plan umsetzen',
  keepPlanning: 'Weiter planen',
  hint: 'Oder sag dem Agenten im Nachrichtenfeld, was er ändern soll.',
  kind: 'Plan',
  approved: (mode) => `Genehmigt · Umsetzung in ${mode}`,
  declined: 'Nicht genehmigt',
  byMessage: 'Per Nachricht beantwortet',
  cancelled: 'Gestoppt',
  rowLead: 'Passt der Plan?',
  followUp: 'Setze den Plan oben um.',
  failed: (message) => `Senden fehlgeschlagen: ${message}`,
};
