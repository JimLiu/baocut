import type { ServicesMessages } from './services.ts';
import { pluralForm } from '@baocut/protocol';
export const es: ServicesMessages = {
 portRange: 'Introduce un puerto entre 1024 y 65535', portTaken: (port, service) => `${port} ya lo usa «${service}»; elige otro puerto`, browser: 'Navegador',
 sessionMeta: (connections, ago, expires) => [connections ? `${connections} ${pluralForm('es', connections, { one: 'conexión', other: 'conexiones' })}` : 'Sin conexiones', `Activo ${ago}`, expires ? `Caduca a las ${expires}` : null].filter(Boolean).join(' · '),
 runtime: { connected: 'Conectado', incompatible: 'Versión incompatible', disconnected: 'Sin conexión' },
};
