import type { JobsSaveLocationMessages } from './save-location.ts';
export const es: JobsSaveLocationMessages = { notDirectory: 'No es una carpeta', unwritable: (p) => `No se puede escribir en la ubicación de guardado: ${p.dir} (${p.problem})` };
