import type { PlanMessages } from './plan-copy.ts';

export const es: PlanMessages = {
  title: 'El agente tiene un plan para que lo apruebes',
  modeLabel: 'Modo de acceso al implementar',
  implement: 'Implementar el plan',
  keepPlanning: 'Seguir planificando',
  hint: 'O dile al agente qué cambiar en el cuadro de mensaje.',
  kind: 'Plan',
  approved: (mode) => `Aprobado · implementando en ${mode}`,
  declined: 'No aprobado',
  byMessage: 'Respondido con un mensaje',
  cancelled: 'Detenido',
  rowLead: '¿El plan te parece bien?',
  followUp: 'Implementa el plan de arriba.',
  failed: (message) => `No se pudo enviar: ${message}`,
};
