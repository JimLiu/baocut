import type { JobsDownloadTranscriptMessages } from './download-transcript.ts';
export const es: JobsDownloadTranscriptMessages = {
 fileTranscribeUnavailable: 'La transcripción de archivos no está disponible', notCompleted: 'La transcripción no terminó; se conservó el archivo de vídeo', resultMissing: 'No se encuentra el resultado de la transcripción',
 tooManySameName: (p) => `Demasiados archivos con el mismo nombre en la carpeta de salida: ${p.name}`,
};
