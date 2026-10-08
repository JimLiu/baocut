import type { RcGatewayMessages } from './rc-gateway.ts';
export const es: RcGatewayMessages = {
 helloTimeout: 'El intercambio inicial agotó el tiempo', textFramesOnly: 'Solo se aceptan tramas de texto', frameNotJson: 'La trama no es JSON válido', frameUnrecognized: 'Trama no reconocida', unknownMethod: (p) => `Método desconocido: ${p.method}`, invalidParams: 'Parámetros no válidos', helloRequired: 'La primera trama debe ser hello', invalidToken: 'Token no válido',
 protocolMismatch: (p) => `Versiones de protocolo incompatibles: cliente ${p.client}, Runtime ${p.runtime}`, internalError: 'Error interno', catalogLocalOnly: 'El catálogo de herramientas solo está disponible para la CLI local y la aplicación de escritorio',
};
