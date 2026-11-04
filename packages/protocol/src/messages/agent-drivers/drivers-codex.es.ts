import type { DriversCodexMessages } from './drivers-codex.ts';
export const es: DriversCodexMessages = {
 plan: 'Suscripción a ChatGPT Plus o Pro', installHint: 'Instala Codex CLI',
 signedOut: (p) => `Codex no ha iniciado sesión. Ejecuta codex login en un terminal.${p.detail ? ` (${p.detail})` : ''}`,
 loginCheckFailed: (p) => `No se pudo comprobar el inicio de sesión de Codex: falló ${p.command} login status. BaoCut ejecuta este programa con subcomandos como login status y app-server, así que un script envoltorio debe pasar sus argumentos sin cambios.${p.detail ? ` (${p.detail})` : ''}`,
  customProvider: 'Proveedor de modelos personalizado',
  chatgptAccount: 'Cuenta de ChatGPT', apiKey: 'Clave de API de OpenAI', accessToken: 'Token de acceso', workloadIdentity: 'Identidad de carga de trabajo', codexAccount: 'Cuenta de Codex',
 steerMismatch: (p) => `Codex devolvió una respuesta de turn/steer inesperada: se esperaba el turno ${p.expected}, se recibió ${p.received}`,
 appServerExited: (p) => `codex app-server terminó (código ${p.code}, señal ${p.signal})${p.stderr ? `\n${p.stderr}` : ''}`,
 connectionClosed: 'La conexión de codex app-server está cerrada', requestTimeout: (p) => `La solicitud de codex app-server agotó el tiempo: ${p.method}`,
 appServerGone: 'codex app-server ha terminado',
};
