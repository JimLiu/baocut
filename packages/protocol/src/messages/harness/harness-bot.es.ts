import type { HarnessBotMessages } from './harness-bot.ts';

export const es: HarnessBotMessages = {
  roleLocked: 'Esta conversación pertenece a un canal o tarea del Bot. Cámbiala desde la configuración del canal o de la tarea.',
  unattendedNeedsApprovals: (p) => `${p.agent} no puede pedir aprobación paso a paso, así que este paso necesita que estés presente para ejecutarse.`,
};
