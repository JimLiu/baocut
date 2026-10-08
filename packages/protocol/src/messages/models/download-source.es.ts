import type { ModelsDownloadSourceMessages } from './download-source.ts';
export const es: ModelsDownloadSourceMessages = { invalidEndpoint: (p) => `${p.name} debe ser una URL base que empiece con http(s)://, sin credenciales, parámetros de consulta ni fragmento` };
