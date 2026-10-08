import type { JobsSubtitleFileMessages } from './subtitle-file.ts';
export const es: JobsSubtitleFileMessages = {
 tooLarge: (p) => `El archivo de subtítulos tiene ${p.bytes} bytes, por encima del límite de ${p.limit}`, tooManyCues: (p) => `Más de ${p.limit} subtítulos`, invalidAt: (p) => `Línea ${p.line} del archivo de subtítulos: ${p.problem}`,
 nul: 'El archivo contiene caracteres NUL y no parece ser subtítulos de texto', vttHeader: 'Un archivo WebVTT debe empezar con WEBVTT', vttHeaderBlank: 'Deja una línea vacía después del encabezado WEBVTT y antes de los subtítulos',
 empty: 'El archivo no tiene subtítulos', noTiming: 'Este bloque tiene texto, pero no una línea de tiempos', tooManyIdLines: 'Solo puede haber una línea de número o identificador antes de la línea de tiempos',
 srtIndex: (p) => `Una línea de índice SRT debe ser un número: ${p.id}`, badTiming: (p) => `Línea de tiempos incorrecta: ${p.timing}`, endBeforeStart: 'El tiempo de fin es anterior al de inicio',
 timingInText: 'Hay una línea de tiempos en el texto del subtítulo (puede faltar una línea vacía entre dos subtítulos)', cueTooLong: (p) => `El texto de un subtítulo supera los ${p.max} caracteres`, minuteSecondRange: 'Los minutos o segundos superan 59',
};
