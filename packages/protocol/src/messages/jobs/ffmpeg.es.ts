import type { JobsFfmpegMessages } from './ffmpeg.ts';
export const es: JobsFfmpegMessages = {
 notFound: (p) => `No se encuentra ${p.command}: ${p.remedy}`, ffmpegBroken: 'ffmpeg no funciona correctamente', probeFailed: (p) => `ffprobe no puede leer ${p.file}`, exited: (p) => `ffmpeg terminó con ${p.code}`,
};
