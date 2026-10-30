import type { PlanMessages } from './plan-copy.ts';

export const pl: PlanMessages = {
  title: 'Agent ma plan do zatwierdzenia',
  modeLabel: 'Tryb dostępu podczas realizacji',
  implement: 'Zrealizuj plan',
  keepPlanning: 'Planuj dalej',
  hint: 'Albo napisz agentowi w polu wiadomości, co zmienić.',
  kind: 'Plan',
  approved: (mode) => `Zatwierdzono · realizacja w trybie ${mode}`,
  declined: 'Nie zatwierdzono',
  byMessage: 'Odpowiedziano wiadomością',
  cancelled: 'Zatrzymano',
  rowLead: 'Plan wygląda dobrze?',
  followUp: 'Zrealizuj powyższy plan.',
  failed: (message) => `Nie udało się wysłać: ${message}`,
};
