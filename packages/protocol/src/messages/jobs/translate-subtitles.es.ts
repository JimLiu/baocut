import type { JobsTranslateSubtitlesMessages } from './translate-subtitles.ts';
export const es: JobsTranslateSubtitlesMessages = {
 label: 'Traducir archivo de subtítulos', description: 'Traduce un archivo de subtítulos SRT o WebVTT a otro idioma, subtítulo por subtítulo, y escribe un archivo nuevo. La cantidad de subtítulos y sus códigos de tiempo se conservan; el resultado puede ser bilingüe o tener otro formato. El vídeo no se modifica.',
 stepRead: 'Leer subtítulos', stepTranslate: 'Traducir', stepCheck: 'Comprobar', stepPublish: 'Publicar',
 noStructuredOutput: (p) => `El modelo ${p.model} no admite salida estructurada, por lo que no se puede usar para traducir`, artifactGone: (p) => `El resultado ${p.artifactId} ya no existe`, paramNotAbsolute: (p) => `El parámetro ${p.key} debe ser una ruta absoluta`,
 inputNotSubtitle: 'El parámetro input debe ser un archivo .srt o .vtt', languageInvalid: (p) => `El parámetro ${p.key} debe ser una etiqueta de idioma BCP 47`, bilingualInvalid: 'El parámetro bilingual debe ser true o false',
 fileNotFound: (p) => `No se encontró el archivo de subtítulos ${p.file}`, fileTooLarge: (p) => `El archivo de subtítulos tiene ${p.bytes} bytes, por encima del límite de ${p.limit}`, noText: 'El archivo de subtítulos no tiene texto que traducir', allEmpty: 'Todos los subtítulos están vacíos',
 markupStripped: (p) => `${p.count} subtítulos tenían marcado en línea (cursiva, color, posición y demás) que no se conservó en la traducción`, cueNoTranslation: (p) => `El subtítulo ${p.n} no tiene traducción`, rereadFailed: 'No se pudieron volver a leer los subtítulos escritos',
 cueCountMismatch: (p) => `Se escribieron ${p.written} subtítulos; el archivo original tiene ${p.original}`, timingChanged: (p) => `El código de tiempo del subtítulo ${p.n} cambió: ${p.from} → ${p.to}`, cannotMatch: 'La traducción no se puede escribir como subtítulos que coincidan uno a uno con el archivo original',
 settingsDropped: (p) => `Convertido a SRT: los ajustes de ${p.settings} subtítulos y ${p.blocks} bloques NOTE, STYLE y REGION no son compatibles y no se conservaron`,
};
