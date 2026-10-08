import type { UpdateMessages, UpdateStep } from './update-copy.ts';
const STEP: Record<UpdateStep, string> = { install: 'iniciar la instalación', check: 'comprobar actualizaciones', download: 'iniciar la descarga', cancel: 'cancelar la descarga', retry: 'reintentar', downloadPage: 'abrir la página de descarga' };
export const es: UpdateMessages = { failed: (step, message) => `No se pudo ${STEP[step]}: ${message}`, progress: 'Progreso de descarga', notes: 'Novedades de esta versión', close: 'Cerrar' };
