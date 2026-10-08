import type { ProcessHostWorkerMessages } from './process-host-worker.ts';
export const es: ProcessHostWorkerMessages = {
 requestFailed: (p) => `${p.method} falló: ${p.code}: ${p.message}`, exited: (p) => `${p.method} no terminó: el proceso hijo terminó (código ${p.code}, señal ${p.signal})`, notRunning: (p) => `${p.method} no se envió: el proceso hijo no está en ejecución`,
 timedOut: (p) => `${p.method} agotó el tiempo (${p.ms} ms)`, spawnFailed: (p) => `No se pudo iniciar ${p.command}: ${p.error}`, malformedError: 'El proceso hijo devolvió un error con formato incorrecto',
};
