import type { ClientConnectionMessages } from './client-connection.ts';
export const es: ClientConnectionMessages = {
 closed: 'El cliente está cerrado', disconnected: 'Se perdió la conexión con el Runtime', connectionLost: 'Conexión perdida', cannotConnect: 'No se puede conectar con el Runtime',
 requestTimedOut: (p) => `La solicitud agotó el tiempo: ${p.method}`, unknownError: 'Error desconocido',
};
