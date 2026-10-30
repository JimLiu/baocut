import type { PlanMessages } from './plan-copy.ts';

export const it: PlanMessages = {
  title: 'L’agente ha un piano da farti approvare',
  modeLabel: 'Modalità di accesso per l’attuazione',
  implement: 'Attua il piano',
  keepPlanning: 'Continua a pianificare',
  hint: 'Oppure di’ all’agente cosa cambiare nella casella dei messaggi.',
  kind: 'Piano',
  approved: (mode) => `Approvato · attuazione in ${mode}`,
  declined: 'Non approvato',
  byMessage: 'Risposto con un messaggio',
  cancelled: 'Interrotto',
  rowLead: 'Il piano va bene?',
  followUp: 'Attua il piano qui sopra.',
  failed: (message) => `Invio non riuscito: ${message}`,
};
