import type { SidebarMessages } from './sidebar.ts';
import { pluralForm } from '@baocut/protocol';
export const es: SidebarMessages = {
 status: { waiting: 'Esperando aprobación', failed: 'Fallido', running: 'En curso', unread: 'Completado, sin leer' }, stopping: 'Deteniendo',
 count: {
 waiting: (n) => `${n} esperando aprobación`,
 failed: (n) => `${n} ${pluralForm('es', n, { one: 'fallido', other: 'fallidos' })}`,
 running: (n) => `${n} en curso`,
 unread: (n) => `${n} ${pluralForm('es', n, { one: 'completado', other: 'completados' })}, sin leer`,
 },
};
