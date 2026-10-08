import type { DataGrantsMessages } from './data-grants.ts';
import { pluralForm } from '@baocut/protocol';
const timesEs = (n: number) => `${n} ${pluralForm('es', n, { one: 'llamada', other: 'llamadas' })}`;
export const es: DataGrantsMessages = {
  state: { active: 'Activa', expired: 'Caducada', revoked: 'Revocada', exhausted: 'Límite alcanzado' },
  kindList: (kinds) => kinds.join(', '), noKinds: 'Sin tipos de datos',
  origin: { 'provider-enable': 'Concedida por defecto al activar el proveedor', approval: 'Concedida al aprobar', user: 'Concedida manualmente' },
  oneVideoNamed: (name) => `Solo el vídeo «${name}»`, oneVideo: 'Solo un vídeo', allVideos: 'Todos los vídeos', oneTask: 'Solo una tarea',
  budgetCap: (amount) => `Límite de gasto ${amount}`, budgetUnknown: 'Coste desconocido, se cuentan solo las llamadas',
  once: 'Solo esta vez', unlimited: 'Llamadas ilimitadas', maxCalls: (n) => `Hasta ${timesEs(n)}`,
  revokedOn: (day) => `Revocada ${day}`, expiredOn: (day) => `Caducada ${day}`, expiresOn: (day) => `Caduca ${day}`,
  neverUsed: 'Aún sin usar', usedWithAmount: (calls, amount) => `Uso: ${timesEs(calls)} (${amount})`, used: (calls) => `Uso: ${timesEs(calls)}`,
  reservedWithAmount: (calls, amount) => `${timesEs(calls)} en curso (${amount} reservados)`, reserved: (calls) => `${timesEs(calls)} en curso`,
  unknownCost: (calls) => `${timesEs(calls)} con coste desconocido`, usageSeparator: ', ',
  revokeConfirm: (running, sent) => [
    'Tras revocarla, se rechazarán las llamadas nuevas y en cola que usen esta autorización.',
    running ? `${pluralForm('es', running, { one: `La ${timesEs(running)} que ya está en curso terminará`, other: `Las ${timesEs(running)} que ya están en curso terminarán` })} normalmente.` : '',
    sent ? `Los datos ya enviados en ${timesEs(sent)} y los costes incurridos no se pueden recuperar.` : '',
  ].filter(Boolean).join(' '),
  revoked: 'Revocada',
  sentBefore: (calls, amount, unknownCostCalls) => `Enviado previamente en ${timesEs(calls)}${amount ? ` (${amount}${unknownCostCalls ? `, más ${timesEs(unknownCostCalls)} con coste desconocido` : ''})` : ''}`,
  runningJobs: (n) => pluralForm('es', n, { one: `${n} tarea en curso terminará normalmente`, other: `${n} tareas en curso terminarán normalmente` }),
};
